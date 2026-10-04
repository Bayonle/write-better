import { useEffect, useMemo, useRef, useState } from "react";
import { draftText, wordCount } from "../model";
import type { Notebook } from "../notebook";

export function NotebookView({
  book,
  onOpen,
  onNew,
  onRemove,
  onRestore,
  onBack,
  onBackup,
}: {
  book: Notebook;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
  onBack: () => void;
  onBackup: () => void;
}) {
  const [deleted, setDeleted] = useState(false);
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const sectionButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!(event.target as Element).closest(".notebook-row-actions"))
        setActions(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const drafts = useMemo(
    () =>
      [...(deleted ? (book.deleted ?? []) : book.docs)]
        .sort((a, b) => b.updated - a.updated)
        .map((draft) => ({ draft, text: draftText(draft) }))
        .filter(({ draft, text }) =>
          `${draft.title}\n${text}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        ),
    [book, deleted, query],
  );
  function section(next: boolean) {
    setDeleted(next);
    setQuery("");
    setActions(null);
  }
  return (
    <main
      className="notebook-view"
      aria-label="Notebook"
      onKeyDown={(event) => {
        if (event.key === "Escape" && actions) {
          const trigger = event.currentTarget.querySelector<HTMLButtonElement>(
            '.notebook-row-actions [aria-expanded="true"]',
          );
          setActions(null);
          trigger?.focus();
        }
      }}
    >
      <div className="notebook-heading">
        <div>
          <p className="eyebrow">YOUR NOTEBOOK</p>
          <h1 ref={heading} tabIndex={-1}>
            A place for every thought.
          </h1>
          <p>Pick up a draft, or begin something new.</p>
        </div>
        <button className="primary-button" onClick={onNew}>
          + New draft
        </button>
      </div>
      <div className="notebook-layout">
        <aside className="notebook-navigation" aria-label="Notebook sections">
          <nav aria-label="Draft collections">
            <button aria-pressed={!deleted} onClick={() => section(false)}>
              Drafts <span>{book.docs.length}</span>
            </button>
            <button
              ref={sectionButton}
              aria-pressed={deleted}
              onClick={() => section(true)}
            >
              Recently Deleted <span>{book.deleted?.length ?? 0}</span>
            </button>
          </nav>
          <div className="notebook-storage">
            <p>
              Drafts save automatically on this computer. They aren’t synced
              across devices.
            </p>
            <button onClick={onBackup}>Export notebook backup ↗</button>
          </div>
        </aside>
        <section
          className="notebook-drafts"
          aria-labelledby="collection-heading"
        >
          <div className="notebook-list-heading">
            <div>
              <h2 id="collection-heading">
                {deleted ? "Recently Deleted" : "Your drafts"}
              </h2>
              <p>
                {deleted
                  ? "Restore a draft anytime. Nothing expires automatically."
                  : "Most recently edited first."}
              </p>
            </div>
            <label className="notebook-search">
              <span className="sr-only">Search drafts</span>
              <input
                type="search"
                placeholder="Find a draft…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <p className="sr-only" role="status">
            {drafts.length} {drafts.length === 1 ? "draft" : "drafts"}
            {query ? " matching your search" : ""}
          </p>
          {!drafts.length ? (
            <div className="notebook-empty">
              <h3>
                {query
                  ? "No matching drafts."
                  : deleted
                    ? "No deleted drafts."
                    : "Room for a new thought."}
              </h3>
              <p>
                {query
                  ? "Try a different title or a few words from the draft."
                  : deleted
                    ? "Drafts you remove will stay here until you restore them."
                    : "Start a draft whenever you’re ready."}
              </p>
              {query && (
                <button onClick={() => setQuery("")}>Clear search</button>
              )}
            </div>
          ) : (
            <ul className="notebook-list">
              {drafts.map(({ draft, text }) => (
                <li
                  key={draft.id}
                  className={`notebook-row ${!deleted && draft.id === book.currentId ? "current" : ""}`}
                >
                  {deleted ? (
                    <div className="notebook-row-content">
                      <h3>{draft.title || "Untitled"}</h3>
                      <p className="notebook-excerpt">
                        {text.slice(0, 240) || "An unwritten thought."}
                      </p>
                      <p className="notebook-row-meta">
                        {wordCount(text)} words
                      </p>
                    </div>
                  ) : (
                    <button
                      className="notebook-open"
                      aria-label={`Open ${draft.title || "Untitled"}`}
                      onClick={() => onOpen(draft.id)}
                    >
                      <span className="notebook-row-title">
                        {draft.title || "Untitled"}
                        {draft.id === book.currentId && (
                          <span className="current-draft-label">
                            Current draft
                          </span>
                        )}
                      </span>
                      <span className="notebook-excerpt">
                        {text.slice(0, 240) || "An unwritten thought."}
                      </span>
                      <span className="notebook-row-meta">
                        {wordCount(text)} words{" "}
                        <span aria-hidden="true">·</span> Edited{" "}
                        {new Date(draft.updated).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </button>
                  )}
                  <div className="notebook-row-actions">
                    {deleted ? (
                      <button
                        aria-label={`Restore ${draft.title || "Untitled"}`}
                        onClick={() => {
                          onRestore(draft.id);
                          sectionButton.current?.focus();
                        }}
                      >
                        Restore
                      </button>
                    ) : (
                      <>
                        <button
                          aria-label={`Actions for ${draft.title || "Untitled"}`}
                          aria-expanded={actions === draft.id}
                          onClick={() =>
                            setActions(actions === draft.id ? null : draft.id)
                          }
                        >
                          •••
                        </button>
                        {actions === draft.id && (
                          <button
                            className="notebook-remove"
                            onClick={() => {
                              onRemove(draft.id);
                              setActions(null);
                              sectionButton.current?.focus();
                            }}
                          >
                            Move to Recently Deleted
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button className="notebook-return" onClick={onBack}>
            ← Back to current draft
          </button>
        </section>
      </div>
    </main>
  );
}
