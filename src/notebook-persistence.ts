import { sampleDraft } from "./model";
import { validateNotebook } from "./notebook";
import type { Notebook, Snapshot } from "./notebook";

export const LEGACY_KEY = "write-on.v1";
export const PENDING_PREFIX = "write-on.sqlite.pending.";
interface Pending {
  book: Notebook;
  baseline: Notebook | null;
  revision: number;
  databaseId: string;
}
interface State {
  book: Notebook;
  ready: boolean;
  status: string;
  error: string;
  conflict: boolean;
  dirty: boolean;
}
type Storage = Pick<
  globalThis.Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
type Request = (path: string, init?: RequestInit) => Promise<Response>;
const same = (a: Notebook | null, b: Notebook) =>
  a !== null &&
  JSON.stringify(validateNotebook(a)) === JSON.stringify(validateNotebook(b));

/** Serializes saves and retains unacknowledged edits independently of the old notebook. */
export class NotebookPersistence {
  private state: State;
  private listeners = new Set<() => void>();
  private snapshot: Snapshot | null = null;
  private inFlight = false;
  private initializing = false;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private recovered: { key: string; raw: string } | undefined;
  private cacheError = "";
  constructor(
    private storage: Storage,
    private pendingKey: string,
    private request: Request = (path, init) => fetch(path, init),
  ) {
    const d = sampleDraft();
    this.state = {
      book: { version: 1, currentId: d.id, docs: [d] },
      ready: false,
      status: "Opening notebook…",
      error: "",
      conflict: false,
      dirty: false,
    };
  }
  getState = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private async api(
    path: string,
    input?: unknown,
    method = "POST",
  ): Promise<Snapshot> {
    const response = await this.request(
      path,
      input === undefined
        ? { signal: AbortSignal.timeout(15000) }
        : {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(15000),
          },
    );
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(
        data.error || "Could not reach the notebook server.",
      );
      if (response.status === 409) error.name = "RevisionConflict";
      throw error;
    }
    if (
      !Number.isSafeInteger(data.revision) ||
      data.revision < 0 ||
      typeof data.databaseId !== "string"
    )
      throw new Error("Invalid notebook server response.");
    return {
      revision: data.revision,
      databaseId: data.databaseId,
      book: data.book === null ? null : validateNotebook(data.book),
    };
  }
  private readPending(): Pending | null {
    let key = this.pendingKey,
      raw = this.storage.getItem(key);
    if (!raw) {
      // A new tab can recover an unacknowledged save left by a closed tab.
      for (let i = 0; i < this.storage.length; i++) {
        const candidate = this.storage.key(i);
        if (candidate?.startsWith(PENDING_PREFIX)) {
          key = candidate;
          raw = this.storage.getItem(key);
          if (raw) break;
        }
      }
    }
    if (!raw) return null;
    const pending = JSON.parse(raw);
    if (
      !Number.isSafeInteger(pending.revision) ||
      typeof pending.databaseId !== "string"
    )
      throw new Error(
        "Browser recovery data could not be read. It has been left untouched.",
      );
    this.recovered = { key, raw };
    return {
      ...pending,
      book: validateNotebook(pending.book),
      baseline:
        pending.baseline === null ? null : validateNotebook(pending.baseline),
    };
  }
  async initialize() {
    if (this.initializing || this.state.ready) return;
    this.initializing = true;
    this.publish({ error: "", status: "Opening notebook…" });
    try {
      let pending: Pending | null = null,
        legacy: Notebook | null = null,
        browserIssue = "";
      try {
        pending = this.readPending();
        const legacyRaw = this.storage.getItem(LEGACY_KEY);
        legacy = legacyRaw ? validateNotebook(JSON.parse(legacyRaw)) : null;
      } catch {
        this.recovered = undefined;
        browserIssue =
          "Browser recovery or legacy data could not be read. It has been left untouched; SQLite drafts remain available.";
      }
      if (pending) this.publish({ book: pending.book });
      else if (legacy) this.publish({ book: legacy });
      let remote = await this.api("/api/notebook");
      if (browserIssue && !remote.book)
        throw new Error(
          "Browser drafts could not be read and the database is empty. Browser data has been left untouched; restore access before migration.",
        );
      if (legacy)
        remote = await this.api("/api/notebook/import", {
          book: legacy,
          source: "legacy",
        });
      if (pending && !same(remote.book, pending.book)) {
        this.snapshot = {
          book: pending.baseline,
          revision: pending.revision,
          databaseId: pending.databaseId,
        };
        const conflict =
          remote.databaseId !== pending.databaseId ||
          remote.revision !== pending.revision;
        this.publish({
          book: pending.book,
          ready: true,
          dirty: true,
          conflict,
          error: conflict
            ? "Saved drafts changed while edits were pending. Keep both versions to recover your writing. Pending deletions will not remove newer saved drafts."
            : "",
          status: "Unsaved changes",
        });
        this.cache();
        if (!conflict) await this.flush();
        return;
      }
      if (!remote.book)
        remote = await this.api(
          "/api/notebook",
          {
            book: this.state.book,
            revision: remote.revision,
            databaseId: remote.databaseId,
          },
          "PUT",
        );
      this.snapshot = remote;
      if (!browserIssue) this.clearCache();
      this.publish({
        book: remote.book!,
        ready: true,
        dirty: false,
        conflict: false,
        status: "Saved to SQLite",
        error: browserIssue || this.cacheError,
      });
    } catch (error) {
      this.publish({
        error: this.message(error),
        status: "Notebook unavailable",
      });
    } finally {
      this.initializing = false;
    }
  }
  private message(error: unknown) {
    return error instanceof Error
      ? error.message
      : "Could not save the notebook. Retry or export a backup.";
  }
  private cache() {
    if (!this.snapshot) return;
    try {
      this.storage.setItem(
        this.pendingKey,
        JSON.stringify({
          book: this.state.book,
          baseline: this.snapshot.book,
          revision: this.snapshot.revision,
          databaseId: this.snapshot.databaseId,
        }),
      );
      this.cacheError = "";
    } catch {
      this.cacheError =
        "Browser recovery storage is unavailable. Keep this window open until SQLite confirms the save, or export a backup.";
    }
  }
  private clearCache() {
    try {
      this.storage.removeItem(this.pendingKey);
      if (
        this.recovered &&
        this.storage.getItem(this.recovered.key) === this.recovered.raw
      )
        this.storage.removeItem(this.recovered.key);
      this.recovered = undefined;
      this.cacheError = "";
    } catch {
      this.cacheError =
        "Saved to SQLite. Browser recovery storage is unavailable or could not be cleared.";
    }
  }
  update(book: Notebook) {
    if (!this.state.ready) return;
    this.generation++;
    this.publish({ book, dirty: true, status: "Saving…" });
    this.cache();
    if (this.cacheError) this.publish({ error: this.cacheError });
    clearTimeout(this.timer);
    if (!this.state.conflict)
      this.timer = setTimeout(() => {
        void this.flush();
      }, 250);
  }
  async flush() {
    clearTimeout(this.timer);
    if (
      !this.state.ready ||
      !this.state.dirty ||
      this.inFlight ||
      this.state.conflict ||
      !this.snapshot
    )
      return;
    this.inFlight = true;
    const generation = this.generation,
      book = this.state.book;
    this.publish({ status: "Saving…", error: this.cacheError });
    let success = false;
    try {
      this.snapshot = await this.api(
        "/api/notebook",
        {
          book,
          revision: this.snapshot.revision,
          databaseId: this.snapshot.databaseId,
        },
        "PUT",
      );
      success = true;
      if (generation === this.generation) {
        this.clearCache();
        this.publish({
          dirty: false,
          status: "Saved to SQLite",
          error: this.cacheError,
        });
      } else {
        this.cache();
      }
    } catch (error) {
      const conflict =
        error instanceof Error && error.name === "RevisionConflict";
      this.publish({
        conflict,
        status: "Not saved to SQLite",
        error: `${this.message(error)}${this.cacheError ? ` ${this.cacheError}` : ""}`,
      });
    } finally {
      this.inFlight = false;
      if (success && this.state.dirty) await this.flush();
    }
  }
  async retry() {
    if (!this.state.ready) return this.initialize();
    if (this.inFlight) return;
    // If an acknowledgement was lost, recognize the committed save before retrying.
    try {
      const remote = await this.api("/api/notebook");
      if (same(remote.book, this.state.book)) {
        this.snapshot = remote;
        this.clearCache();
        this.publish({
          dirty: false,
          conflict: false,
          status: "Saved to SQLite",
          error: this.cacheError,
        });
        return;
      }
    } catch (error) {
      this.publish({ error: this.message(error) });
      return;
    }
    await this.flush();
  }
  async recover() {
    if (this.inFlight || !this.snapshot) return;
    this.inFlight = true;
    const generation = this.generation;
    try {
      const remote = await this.api("/api/notebook/import", {
        book: this.state.book,
        baseline: this.snapshot.book,
        source: "recovery",
      });
      if (generation !== this.generation) {
        this.publish({
          error:
            "The earlier edits were recovered. Keep both versions again to recover the latest edits.",
        });
        return;
      }
      this.snapshot = remote;
      this.clearCache();
      this.publish({
        book: remote.book!,
        dirty: false,
        conflict: false,
        status: "Saved to SQLite",
        error: this.cacheError,
      });
    } catch (error) {
      this.publish({ error: this.message(error) });
    } finally {
      this.inFlight = false;
    }
  }
  dispose() {
    clearTimeout(this.timer);
  }
}
