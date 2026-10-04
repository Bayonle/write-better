import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { newDraft, uid } from "../model";
import { NotebookPersistence, PENDING_PREFIX } from "../notebook-persistence";
import type { Draft, Mutate } from "../types";
import type { Notebook } from "../notebook";
import { restoreDraft, trashDraft } from "../notebook";

export function useNotebook() {
  const [persistence] = useState(() => {
    // Each loaded window owns its own recovery entry, including duplicated tabs.
    const browserStorage = {
      get length() {
        return localStorage.length;
      },
      key: (index: number) => localStorage.key(index),
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => localStorage.setItem(key, value),
      removeItem: (key: string) => localStorage.removeItem(key),
    };
    return new NotebookPersistence(browserStorage, PENDING_PREFIX + uid());
  });
  const state = useSyncExternalStore(
    persistence.subscribe,
    persistence.getState,
  );
  const { book, error } = state;
  const ref = useRef(book);
  ref.current = book;
  useEffect(() => {
    void persistence.initialize();
    const leave = (event: BeforeUnloadEvent) => {
      if (persistence.getState().dirty) {
        void persistence.flush();
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") void persistence.flush();
    };
    const online = () => {
      void persistence.retry();
    };
    window.addEventListener("beforeunload", leave);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      persistence.dispose();
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [persistence]);
  const history = useRef<{
    undo: Draft[];
    redo: Draft[];
    kind: string;
    time: number;
  }>({ undo: [], redo: [], kind: "", time: 0 });
  const current = () =>
    ref.current.docs.find((d) => d.id === ref.current.currentId)!;
  function save(next: Notebook) {
    ref.current = next;
    persistence.update(next);
  }
  const mutate: Mutate = (edit, kind = "action") => {
    const old = current(),
      next = structuredClone(old);
    edit(next);
    if (JSON.stringify(next) === JSON.stringify(old)) return;
    const h = history.current;
    if (
      !kind.startsWith("typing:") ||
      h.kind !== kind ||
      Date.now() - h.time > 900
    ) {
      h.undo.push(structuredClone(old));
      if (h.undo.length > 100) h.undo.shift();
    }
    h.kind = kind;
    h.time = Date.now();
    h.redo = [];
    next.updated = Date.now();
    save({
      ...ref.current,
      docs: ref.current.docs.map((d) => (d.id === next.id ? next : d)),
    });
  };
  function undo(redo = false) {
    const h = history.current,
      from = redo ? h.redo : h.undo,
      to = redo ? h.undo : h.redo;
    const next = from.pop();
    if (!next) return;
    to.push(structuredClone(current()));
    h.kind = "";
    next.updated = Date.now();
    save({
      ...ref.current,
      docs: ref.current.docs.map((d) => (d.id === next.id ? next : d)),
    });
  }
  function switchDraft(id: string) {
    if (!ref.current.docs.some((d) => d.id === id)) return;
    history.current = { undo: [], redo: [], kind: "", time: 0 };
    save({ ...ref.current, currentId: id });
  }
  function add(draft = newDraft()) {
    save({ ...ref.current, docs: [draft, ...ref.current.docs] });
    switchDraft(draft.id);
  }
  function remove(id: string) {
    if (!ref.current.docs.some((d) => d.id === id)) return;
    save(trashDraft(ref.current, id));
    history.current = { undo: [], redo: [], kind: "", time: 0 };
    return () => restore(id);
  }
  function restore(id: string) {
    save(restoreDraft(ref.current, id));
  }
  function addDeleted(draft: Draft) {
    save({ ...ref.current, deleted: [draft, ...(ref.current.deleted ?? [])] });
  }
  return {
    book,
    draft: book.docs.find((d) => d.id === book.currentId)!,
    current,
    mutate,
    undo,
    switchDraft,
    add,
    remove,
    restore,
    addDeleted,
    error,
    ready: state.ready,
    status: state.status,
    conflict: state.conflict,
    retry: () => {
      void persistence.retry();
    },
    recover: () => {
      history.current = { undo: [], redo: [], kind: "", time: 0 };
      void persistence.recover();
    },
    canUndo: history.current.undo.length > 0,
    canRedo: history.current.redo.length > 0,
    save: () => {
      void persistence.flush();
    },
  };
}
