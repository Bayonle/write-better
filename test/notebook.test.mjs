import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { once } from "node:events";
import { NotebookStore, RevisionConflict } from "../server/notebook-store.ts";
import { notebookAPI } from "../server/notebook-api.ts";
import { newDraft, sampleDraft, chooseAlternative } from "../src/model.ts";
import { validateNotebook, MAX_NOTEBOOK_BYTES } from "../src/notebook.ts";
import {
  NotebookPersistence,
  LEGACY_KEY,
  PENDING_PREFIX,
} from "../src/notebook-persistence.ts";

const book = (...docs) => ({ version: 1, currentId: docs[0].id, docs });
const save = (store, notebook) => {
  const s = store.read();
  return store.save(notebook, s.revision, s.databaseId);
};
class MemoryStorage {
  values = new Map();
  get length() {
    return this.values.size;
  }
  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, value);
  }
  removeItem(key) {
    this.values.delete(key);
  }
}
function transport(store) {
  return async (path, init) => {
    const input = init?.body ? JSON.parse(init.body) : null;
    try {
      const result = path.endsWith("/import")
        ? store.import(input.book, input.source, input.baseline)
        : input
          ? store.save(input.book, input.revision, input.databaseId)
          : store.read();
      return new Response(JSON.stringify(result), { status: 200 });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error instanceof RevisionConflict ? 409 : 500,
      });
    }
  };
}

test("SQLite roundtrips the entire notebook across closing and reopening the file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "write-on-test-"));
  const path = join(directory, "notebook.sqlite");
  let store = new NotebookStore(path);
  try {
    const d = sampleDraft(),
      alternative = d.blocks[0].runs.find((r) => r.alternatives);
    chooseAlternative(alternative, 2);
    alternative.dim = true;
    const expected = validateNotebook(
      book(d, newDraft("Second", "## Markdown\n\n- [x] saved")),
    );
    const saved = save(store, expected);
    store.close();
    store = new NotebookStore(path);
    assert.deepEqual(store.read(), saved);
    assert.deepEqual(store.read().book, expected);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("migration is idempotent and cannot resurrect a draft deleted after migration", () => {
  const store = new NotebookStore(":memory:");
  try {
    const d = sampleDraft(),
      second = newDraft("Second");
    const initial = book(d, second);
    store.import(initial, "legacy");
    const changed = store.read().book;
    changed.docs = changed.docs.filter((x) => x.id !== d.id);
    changed.currentId = second.id;
    save(store, changed);
    const revision = store.read().revision;
    store.import(initial, "legacy");
    assert.deepEqual(
      store.read().book.docs.map((d) => d.id),
      [second.id],
    );
    assert.equal(store.read().revision, revision);
  } finally {
    store.close();
  }
});
test("stale revisions, another database identity, and malformed notebooks cannot overwrite stored data", () => {
  const store = new NotebookStore(":memory:");
  try {
    const first = save(store, book(sampleDraft()));
    const newer = structuredClone(first.book);
    newer.docs[0].title = "Newer";
    save(store, newer);
    assert.throws(
      () => store.save(first.book, first.revision, first.databaseId),
      RevisionConflict,
    );
    assert.throws(
      () => store.save(first.book, store.read().revision, "another-database"),
      RevisionConflict,
    );
    const invalid = structuredClone(newer);
    invalid.docs[0].blocks[0].runs[0].id = invalid.docs[0].id;
    assert.throws(() => save(store, invalid));
    assert.equal(store.read().book.docs[0].title, "Newer");
    assert.equal(store.read().revision, 2);
  } finally {
    store.close();
  }
});
test("conflict recovery preserves both wordings without resurrecting unchanged deleted drafts", () => {
  const store = new NotebookStore(":memory:");
  try {
    const baseline = book(
      newDraft("Original", "First"),
      newDraft("Removed", "Unchanged"),
    );
    save(store, baseline);
    const remote = structuredClone(baseline);
    remote.docs = [remote.docs[0]];
    remote.docs[0].title = "Remote edit";
    save(store, remote);
    const local = structuredClone(baseline);
    local.docs[0].title = "Local edit";
    const result = store.import(local, "recovery", baseline);
    assert.deepEqual(
      result.book.docs.map((d) => d.title),
      ["Remote edit", "Local edit (recovered)"],
    );
    assert.notEqual(
      result.book.docs[0].blocks[0].id,
      result.book.docs[1].blocks[0].id,
    );
    assert.deepEqual(store.import(local, "recovery", baseline), result);
  } finally {
    store.close();
  }
});
test("client imports old browser data once, retains the old copy, and loads SQLite in a fresh browser", async () => {
  const store = new NotebookStore(":memory:"),
    storage = new MemoryStorage();
  const original = JSON.stringify(book(sampleDraft()));
  storage.setItem(LEGACY_KEY, original);
  const client = new NotebookPersistence(
    storage,
    PENDING_PREFIX + "one",
    transport(store),
  );
  const fresh = new NotebookPersistence(
    new MemoryStorage(),
    PENDING_PREFIX + "two",
    transport(store),
  );
  try {
    await client.initialize();
    assert.equal(client.getState().status, "Saved to SQLite");
    assert.equal(storage.getItem(LEGACY_KEY), original);
    await fresh.initialize();
    assert.deepEqual(fresh.getState().book, client.getState().book);
  } finally {
    client.dispose();
    fresh.dispose();
    store.close();
  }
});
test("client serializes overlapping saves and only clears recovery after the newest acknowledgement", async () => {
  const store = new NotebookStore(":memory:"),
    storage = new MemoryStorage(),
    send = transport(store);
  let release,
    writes = 0;
  const client = new NotebookPersistence(
    storage,
    PENDING_PREFIX + "one",
    async (path, init) => {
      if (init?.method === "PUT" && ++writes === 2)
        await new Promise((resolve) => {
          release = resolve;
        });
      return send(path, init);
    },
  );
  try {
    await client.initialize();
    const first = structuredClone(client.getState().book);
    first.docs[0].title = "First";
    client.update(first);
    const saving = client.flush();
    const last = structuredClone(first);
    last.docs[0].title = "Newest";
    client.update(last);
    assert.equal(client.getState().dirty, true);
    assert.match(storage.getItem(PENDING_PREFIX + "one"), /Newest/);
    release();
    await saving;
    assert.equal(store.read().book.docs[0].title, "Newest");
    assert.equal(client.getState().dirty, false);
    assert.equal(storage.getItem(PENDING_PREFIX + "one"), null);
  } finally {
    client.dispose();
    store.close();
  }
});
test("a failed save survives reload and is recovered from the browser outbox", async () => {
  const store = new NotebookStore(":memory:"),
    storage = new MemoryStorage(),
    send = transport(store);
  let offline = false;
  const client = new NotebookPersistence(
    storage,
    PENDING_PREFIX + "one",
    async (path, init) => {
      if (offline) throw new Error("Offline");
      return send(path, init);
    },
  );
  const reopened = new NotebookPersistence(
    storage,
    PENDING_PREFIX + "new-tab",
    send,
  );
  try {
    await client.initialize();
    const changed = structuredClone(client.getState().book);
    changed.docs[0].title = "Pending writing";
    offline = true;
    client.update(changed);
    await client.flush();
    client.dispose();
    assert.equal(client.getState().status, "Not saved to SQLite");
    assert.match(storage.getItem(PENDING_PREFIX + "one"), /Pending writing/);
    await reopened.initialize();
    assert.equal(store.read().book.docs[0].title, "Pending writing");
    assert.equal(storage.getItem(PENDING_PREFIX + "one"), null);
    assert.equal(reopened.getState().dirty, false);
  } finally {
    client.dispose();
    reopened.dispose();
    store.close();
  }
});
test("lost save acknowledgements can be retried without duplicating drafts", async () => {
  const store = new NotebookStore(":memory:"),
    storage = new MemoryStorage(),
    send = transport(store);
  let lose = false;
  const client = new NotebookPersistence(
    storage,
    PENDING_PREFIX + "one",
    async (path, init) => {
      const result = await send(path, init);
      if (lose && init?.method === "PUT") {
        lose = false;
        throw new Error("Connection lost");
      }
      return result;
    },
  );
  try {
    await client.initialize();
    const changed = structuredClone(client.getState().book);
    changed.docs[0].title = "Committed";
    lose = true;
    client.update(changed);
    await client.flush();
    assert.equal(client.getState().dirty, true);
    await client.retry();
    assert.equal(client.getState().dirty, false);
    assert.equal(store.read().book.docs.length, 1);
    assert.equal(store.read().book.docs[0].title, "Committed");
  } finally {
    client.dispose();
    store.close();
  }
});
test("two clients report a conflict and can keep both versions", async () => {
  const store = new NotebookStore(":memory:");
  const a = new NotebookPersistence(
      new MemoryStorage(),
      PENDING_PREFIX + "a",
      transport(store),
    ),
    b = new NotebookPersistence(
      new MemoryStorage(),
      PENDING_PREFIX + "b",
      transport(store),
    );
  try {
    await a.initialize();
    await b.initialize();
    const one = structuredClone(a.getState().book),
      two = structuredClone(b.getState().book);
    one.docs[0].title = "Window A";
    two.docs[0].title = "Window B";
    a.update(one);
    await a.flush();
    b.update(two);
    await b.flush();
    assert.equal(b.getState().conflict, true);
    assert.equal(store.read().book.docs[0].title, "Window A");
    await b.recover();
    assert.deepEqual(
      store.read().book.docs.map((d) => d.title),
      ["Window A", "Window B (recovered)"],
    );
    assert.equal(b.getState().dirty, false);
  } finally {
    a.dispose();
    b.dispose();
    store.close();
  }
});
test("notebook API rejects cross-origin writes, invalid JSON and oversized bodies; returns conflicts", async () => {
  const store = new NotebookStore(":memory:");
  const server = http
    .createServer((req, res) => {
      void notebookAPI(req, res, store);
    })
    .listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (body, headers = {}) =>
    fetch(origin + "/api/notebook", {
      method: "PUT",
      headers: { origin, "content-type": "application/json", ...headers },
      body,
    });
  try {
    const initial = await (await fetch(origin + "/api/notebook")).json();
    const payload = JSON.stringify({ ...initial, book: book(sampleDraft()) });
    assert.equal(
      (await request(payload, { origin: "https://evil.example" })).status,
      403,
    );
    assert.equal((await request("broken")).status, 400);
    assert.equal((await request(payload)).status, 200);
    assert.equal((await request(payload)).status, 409);
    assert.equal(
      (await request(" ".repeat(MAX_NOTEBOOK_BYTES + 1))).status,
      413,
    );
    assert.equal(store.read().revision, 1);
  } finally {
    server.close();
    await once(server, "close");
    store.close();
  }
});

test("existing SQLite drafts remain usable when browser storage is unavailable", async () => {
  const store = new NotebookStore(":memory:");
  save(store, book(newDraft("Stored on disk", "Saved")));
  const storage = new MemoryStorage();
  storage.getItem = () => {
    throw new Error("Blocked");
  };
  storage.setItem = () => {
    throw new Error("Blocked");
  };
  storage.removeItem = () => {
    throw new Error("Blocked");
  };
  const client = new NotebookPersistence(
    storage,
    PENDING_PREFIX + "blocked",
    transport(store),
  );
  try {
    await client.initialize();
    assert.equal(client.getState().ready, true);
    assert.equal(client.getState().book.docs[0].title, "Stored on disk");
    const changed = structuredClone(client.getState().book);
    changed.docs[0].title = "Still editable";
    client.update(changed);
    await client.flush();
    assert.equal(client.getState().dirty, false);
    assert.equal(store.read().book.docs[0].title, "Still editable");
  } finally {
    client.dispose();
    store.close();
  }
});

test("recently deleted writing survives SQLite reopen and restores all alternatives", async () => {
  const { trashDraft, restoreDraft } = await import("../src/notebook.ts");
  const directory = await mkdtemp(join(tmpdir(), "write-on-trash-"));
  const path = join(directory, "notebook.sqlite");
  let store = new NotebookStore(path);
  try {
    const original = sampleDraft();
    const trashed = trashDraft(book(original), original.id);
    assert.equal(trashed.docs.length, 1);
    assert.notEqual(trashed.currentId, original.id);
    save(store, trashed);
    store.close();
    store = new NotebookStore(path);
    const reopened = store.read().book;
    assert.deepEqual(
      reopened.deleted[0],
      validateNotebook(book(original)).docs[0],
    );
    const restored = restoreDraft(reopened, original.id);
    save(store, restored);
    assert.deepEqual(
      store.read().book.docs.find((d) => d.id === original.id),
      reopened.deleted[0],
    );
    assert.equal(store.read().book.deleted?.length ?? 0, 0);
    assert.deepEqual(restoreDraft(restored, original.id), restored);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("notebook validation rejects identities duplicated between live and deleted drafts", () => {
  const draft = sampleDraft();
  assert.throws(
    () => validateNotebook({ ...book(draft), deleted: [draft] }),
    /duplicate/,
  );
  assert.throws(
    () => validateNotebook({ ...book(draft), deleted: {} }),
    /deleted/,
  );
});

test("pending deletion recovery keeps newer live writing and missing deleted drafts", () => {
  const store = new NotebookStore(":memory:");
  try {
    const live = newDraft("Live", "newer writing");
    save(store, book(live));
    const missing = sampleDraft();
    const imported = { ...book(newDraft("Other")), deleted: [live, missing] };
    const result = store.import(imported, "recovery");
    assert.equal(result.book.docs.find((d) => d.id === live.id).title, "Live");
    assert.equal(result.book.deleted.length, 1);
    assert.equal(result.book.deleted[0].id, missing.id);
    assert.equal(store.import(imported, "recovery").revision, result.revision);
  } finally {
    store.close();
  }
});

test("recovery of edited deleted writing creates a live copy without losing the deleted version", () => {
  const store = new NotebookStore(":memory:");
  try {
    const deleted = newDraft("Original", "original words");
    save(store, { ...book(newDraft("Current")), deleted: [deleted] });
    const edited = structuredClone(deleted);
    edited.title = "Edited offline";
    const result = store.import(book(edited), "recovery");
    assert.equal(result.book.deleted[0].title, "Original");
    const recovered = result.book.docs.find(
      (d) => d.title === "Edited offline (recovered)",
    );
    assert.ok(recovered);
    assert.notEqual(recovered.id, deleted.id);
    assert.equal(result.book.currentId, recovered.id);
  } finally {
    store.close();
  }
});
