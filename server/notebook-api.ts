import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { MAX_NOTEBOOK_BYTES, validateNotebook } from "../src/notebook";
import { NotebookStore, RevisionConflict } from "./notebook-store";

export const databasePath = process.env.WRITE_ON_DB_PATH
  ? resolve(process.env.WRITE_ON_DB_PATH)
  : fileURLToPath(new URL("../data/write-on.sqlite", import.meta.url));
let defaultStore: NotebookStore | undefined;
export function getNotebookStore() {
  return (defaultStore ??= new NotebookStore(databasePath));
}
export async function notebookAPI(
  req: IncomingMessage,
  res: ServerResponse,
  store: NotebookStore,
) {
  const send = (status: number, value: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  const path = new URL(req.url || "/", "http://localhost").pathname;
  if (req.method === "GET" && path === "/api/notebook") {
    try {
      send(200, store.read());
    } catch {
      send(500, {
        error:
          "Could not read the notebook database. The database has been left untouched.",
      });
    }
    return;
  }
  if (!(
    (req.method === "PUT" && path === "/api/notebook") ||
    (req.method === "POST" && path === "/api/notebook/import")
  )) {
    send(405, { error: "Method not allowed." });
    return;
  }
  if (
    req.headers.origin !== `http://${req.headers.host}` ||
    !req.headers["content-type"]?.startsWith("application/json")
  ) {
    send(403, { error: "Open write_better. locally to save drafts." });
    return;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_NOTEBOOK_BYTES) {
      send(413, {
        error:
          "The notebook exceeds the 16 MB save limit. Export a backup before removing drafts.",
      });
      return;
    }
    chunks.push(buffer);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!input || typeof input !== "object") throw new Error();
    input.book = validateNotebook(input.book);
    if (
      req.method === "PUT" &&
      (!Number.isSafeInteger(input.revision) ||
        input.revision < 0 ||
        typeof input.databaseId !== "string")
    )
      throw new Error();
    if (req.method === "POST") {
      if (!["legacy", "recovery"].includes(input.source)) throw new Error();
      if (input.baseline !== null && input.baseline !== undefined)
        input.baseline = validateNotebook(input.baseline);
    }
  } catch {
    send(400, { error: "Invalid notebook data. Nothing was saved." });
    return;
  }
  try {
    send(
      200,
      req.method === "PUT"
        ? store.save(input.book, input.revision, input.databaseId)
        : store.import(input.book, input.source, input.baseline),
    );
  } catch (error) {
    if (error instanceof RevisionConflict)
      send(409, {
        error:
          "Another window saved changes. Keep both versions to preserve your edits.",
      });
    else
      send(500, {
        error:
          "Could not save to SQLite. Your pending edits remain in this browser; retry or export a backup.",
      });
  }
}
