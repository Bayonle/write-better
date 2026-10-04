import { newDraft, validateDraft } from "./model";
import type { Draft } from "./types";

export interface Notebook {
  version: 1;
  docs: Draft[];
  currentId: string;
  deleted?: Draft[];
}
export interface Snapshot {
  book: Notebook | null;
  revision: number;
  databaseId: string;
}
export const MAX_NOTEBOOK_BYTES = 16 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
export function validateNotebook(value: unknown): Notebook {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.docs) ||
    !value.docs.length ||
    value.docs.length > 1000 ||
    typeof value.currentId !== "string"
  )
    throw new Error("Invalid notebook.");
  const ids = new Set<string>();
  if (
    value.deleted !== undefined &&
    (!Array.isArray(value.deleted) || value.deleted.length > 1000)
  )
    throw new Error("Invalid recently deleted drafts.");
  const checkDraft = (raw: unknown) => {
    // Reuse backup validation, but preserve identities for persistence and selection.
    const checked = validateDraft(raw);
    const input = raw as Draft;
    function id(value: unknown): string {
      if (
        typeof value !== "string" ||
        !value ||
        value.length > 128 ||
        ids.has(value)
      )
        throw new Error("Invalid or duplicate notebook identity.");
      ids.add(value);
      return value;
    }
    checked.id = id(input.id);
    if (!Number.isFinite(input.updated) || input.updated < 0)
      throw new Error("Invalid draft timestamp.");
    checked.updated = input.updated;
    checked.blocks.forEach((block, i) => {
      block.id = id(input.blocks[i].id);
      block.runs.forEach((run, j) => {
        run.id = id(input.blocks[i].runs[j].id);
      });
    });
    checked.overflow.forEach((note, i) => {
      note.id = id(input.overflow[i].id);
    });
    return checked;
  };
  const docs = value.docs.map(checkDraft);
  const deleted = (value.deleted as unknown[] | undefined)?.map(checkDraft);
  if (!docs.some((d) => d.id === value.currentId))
    throw new Error("The selected draft is missing.");
  return {
    version: 1,
    docs,
    currentId: value.currentId,
    ...(deleted?.length ? { deleted } : {}),
  };
}

export function trashDraft(book: Notebook, id: string): Notebook {
  const draft = book.docs.find((d) => d.id === id);
  if (!draft) return book;
  const docs = book.docs.filter((d) => d.id !== id);
  if (!docs.length) docs.push(newDraft());
  return {
    ...book,
    docs,
    deleted: [draft, ...(book.deleted ?? [])],
    currentId: book.currentId === id ? docs[0].id : book.currentId,
  };
}

export function restoreDraft(book: Notebook, id: string): Notebook {
  const draft = book.deleted?.find((d) => d.id === id);
  if (!draft) return book;
  return {
    ...book,
    docs: [draft, ...book.docs],
    deleted: book.deleted!.filter((d) => d.id !== id),
  };
}
export function draftContent(draft: Draft) {
  return JSON.stringify({
    title: draft.title,
    blocks: draft.blocks.map((b) =>
      b.runs.map((r) => ({
        text: r.text,
        dim: Boolean(r.dim),
        alternatives: r.alternatives,
        choice: r.choice,
        article: Boolean(r.article),
      })),
    ),
    overflow: draft.overflow.map((n) => n.text),
  });
}
