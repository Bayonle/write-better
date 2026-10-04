import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { draftContent, validateNotebook } from "../src/notebook";
import type { Notebook, Snapshot } from "../src/notebook";
import { validateDraft } from "../src/model";

export class RevisionConflict extends Error {}
export class NotebookStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db
      .exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS notebook (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, database_id TEXT NOT NULL, document TEXT);
      CREATE TABLE IF NOT EXISTS imports (fingerprint TEXT PRIMARY KEY);
      PRAGMA user_version = 1;`);
    this.db
      .prepare("INSERT OR IGNORE INTO notebook VALUES (1, 0, ?, NULL)")
      .run(randomUUID());
  }
  read(): Snapshot {
    const row = this.db
      .prepare(
        "SELECT revision, database_id, document FROM notebook WHERE id = 1",
      )
      .get()!;
    return {
      revision: Number(row.revision),
      databaseId: String(row.database_id),
      book:
        row.document === null
          ? null
          : validateNotebook(JSON.parse(String(row.document))),
    };
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  save(book: Notebook, revision: number, databaseId: string): Snapshot {
    const checked = validateNotebook(book);
    return this.transaction(() => {
      const current = this.read();
      if (current.revision !== revision || current.databaseId !== databaseId)
        throw new RevisionConflict("Another window saved changes.");
      this.db
        .prepare(
          "UPDATE notebook SET document = ?, revision = revision + 1 WHERE id = 1",
        )
        .run(JSON.stringify(checked));
      return this.read();
    });
  }
  /** Idempotent browser migration/recovery. Conflicting drafts become new copies. */
  import(
    book: Notebook,
    source: "legacy" | "recovery",
    baseline: Notebook | null = null,
  ): Snapshot {
    const checked = validateNotebook(book);
    const base = baseline ? validateNotebook(baseline) : null;
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ source, book: checked, baseline: base }))
      .digest("hex");
    return this.transaction(() => {
      if (
        this.db
          .prepare("SELECT 1 FROM imports WHERE fingerprint = ?")
          .get(fingerprint)
      )
        return this.read();
      const current = this.read();
      let merged = current.book ? structuredClone(current.book) : checked;
      let changed = !current.book;
      if (current.book) {
        for (const incoming of checked.docs) {
          const old = base?.docs.find((d) => d.id === incoming.id);
          if (
            source === "recovery" &&
            old &&
            draftContent(old) === draftContent(incoming)
          )
            continue;
          const existing = [...merged.docs, ...(merged.deleted ?? [])].find(
            (d) => d.id === incoming.id,
          );
          if (existing && draftContent(existing) === draftContent(incoming))
            continue;
          // Regenerate internal IDs on copied drafts so every UI identity stays unique.
          const copy = validateDraft(incoming);
          copy.id = existing ? copy.id : incoming.id;
          copy.updated = incoming.updated;
          if (existing)
            copy.title = `${incoming.title} (recovered)`.slice(0, 300);
          merged.docs.push(copy);
          changed = true;
          if (incoming.id === checked.currentId) merged.currentId = copy.id;
        }
        // Recovery never applies a stale deletion to a newer live draft. Keep
        // otherwise missing deleted writing recoverable, including backup imports.
        for (const incoming of checked.deleted ?? []) {
          const existing = [...merged.docs, ...(merged.deleted ?? [])].find(
            (d) => d.id === incoming.id,
          );
          if (existing && draftContent(existing) === draftContent(incoming))
            continue;
          const copy = validateDraft(incoming);
          copy.id = existing ? copy.id : incoming.id;
          copy.updated = incoming.updated;
          merged.deleted = [...(merged.deleted ?? []), copy];
          changed = true;
        }
      }
      merged = validateNotebook(merged);
      if (changed)
        this.db
          .prepare(
            "UPDATE notebook SET document = ?, revision = revision + 1 WHERE id = 1",
          )
          .run(JSON.stringify(merged));
      this.db.prepare("INSERT INTO imports VALUES (?)").run(fingerprint);
      return this.read();
    });
  }
  close() {
    this.db.close();
  }
}
