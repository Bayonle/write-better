import { useEffect, useRef, useState } from "react";
import { useNotebook } from "./hooks/useNotebook";
import { validateNotebook, MAX_NOTEBOOK_BYTES } from "./notebook";
import { useAI } from "./hooks/useAI";
import { WritingEditor } from "./components/WritingEditor";
import type { EditorHandle } from "./components/WritingEditor";
import { MarkdownEditor, MarkdownPreview } from "./components/MarkdownEditor";
import { InlineAlternatives } from "./components/InlineAlternatives";
import { NotebookView } from "./components/NotebookView";
import { Toast } from "./components/Toast";
import { Dialog } from "./components/Dialog";
import { Lab } from "./components/Lab";
import { applyMarkdownSource } from "./markdown";
import {
  articleContextFor,
  attachArticleContext,
  block,
  contextualWording,
  createAlternative,
  draftText,
  fromMarkdown,
  insertText,
  locateRun,
  plain,
  replaceRange,
  selectedText,
  selectionContext,
  sliceRuns,
  toMarkdown,
  uid,
  validateDraft,
  wordCount,
} from "./model";
import type { AITarget, Draft, Run, TextSelection } from "./types";

type View = "write" | "markdown" | "preview";
function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export default function App() {
  const notebook = useNotebook(),
    ai = useAI(),
    { draft } = notebook;
  const [view, setView] = useState<View>("write"),
    [focus, setFocus] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("write-on.theme") === "paper"
        ? "paper"
        : "night";
    } catch {
      return "night";
    }
  });
  const [dialog, setDialog] = useState<"lab" | "help" | null>(null),
    [menu, setMenu] = useState(false);
  const [screen, setScreen] = useState<"editor" | "notebook">(() =>
    window.location.hash === "#notebook" ? "notebook" : "editor",
  );
  const editorScroll = useRef(0);
  const [mobile, setMobile] = useState<"alternatives" | "overflow" | null>(
    null,
  );
  const [selection, setSelection] = useState<TextSelection | null>(null),
    [activeId, setActiveId] = useState<string | null>(null);
  const [scope, setScope] = useState("word"),
    [labTarget, setLabTarget] = useState<AITarget | null>(null);
  const [toast, setToast] = useState<{
    text: string;
    action?: () => void;
  } | null>(null);
  const editor = useRef<EditorHandle>(null),
    title = useRef<HTMLInputElement>(null),
    file = useRef<HTMLInputElement>(null);
  function mutate(edit: (draft: Draft) => void, kind?: string) {
    setToast(null);
    notebook.mutate(edit, kind);
  }
  const active = draft.blocks
    .flatMap((b) => b.runs)
    .find((r) => r.id === activeId);
  const alternatives = draft.blocks
    .flatMap((b) => b.runs)
    .filter((r) => r.alternatives);
  const text = draftText(draft),
    words = wordCount(text);
  function notify(text: string, action?: () => void) {
    setToast({ text, action });
  }
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.input = "keyboard";
    const pointer = () => {
      root.dataset.input = "pointer";
    };
    const keyboard = () => {
      root.dataset.input = "keyboard";
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", keyboard, true);
      delete root.dataset.input;
    };
  }, []);
  useEffect(() => {
    document.title =
      screen === "notebook"
        ? "Your notebook — write_better."
        : `${draft.title || "Untitled"} — write_better.`;
  }, [draft.title, screen]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("write-on.theme", theme);
    } catch {
      /* Notebook exposes storage errors separately. */
    }
  }, [theme]);
  useEffect(() => {
    document.body.classList.toggle("focus-mode", focus && screen === "editor");
    return () => document.body.classList.remove("focus-mode");
  }, [focus, screen]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!(e.target as Element).closest(".dropdown, #more-button"))
        setMenu(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  function resetSelection() {
    setSelection(null);
    setActiveId(null);
    setMobile(null);
  }
  function navigate(next: "editor" | "notebook") {
    if (next === "notebook" && screen === "editor")
      editorScroll.current = window.scrollY;
    resetSelection();
    setDialog(null);
    setMenu(false);
    setScreen(next);
    window.location.hash = next === "notebook" ? "notebook" : "write";
  }
  useEffect(() => {
    const changed = () => {
      resetSelection();
      setDialog(null);
      setMenu(false);
      setScreen(window.location.hash === "#notebook" ? "notebook" : "editor");
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    if (!notebook.ready) return;
    window.scrollTo({
      top: screen === "notebook" ? 0 : editorScroll.current,
      behavior: "instant",
    });
    if (screen === "editor") title.current?.focus({ preventScroll: true });
  }, [screen, notebook.ready]);
  function switchView(next: View) {
    setView(next);
    resetSelection();
  }
  function undo(redo = false) {
    resetSelection();
    setToast(null);
    notebook.undo(redo);
  }
  function switchDraft(id: string) {
    resetSelection();
    if (id !== draft.id) notebook.switchDraft(id);
    editorScroll.current = 0;
    navigate("editor");
    setToast(null);
    window.scrollTo({ top: 0 });
  }
  function openRun(id: string) {
    const location = locateRun(notebook.current(), id);
    if (!location) return;
    mutate((d) => {
      const b = d.blocks.find((b) => b.id === location.blockId)!;
      const context = articleContextFor(b, id);
      if (context) attachArticleContext(b, context);
    });
    setView("write");
    setMobile(null);
    setSelection(locateRun(notebook.current(), id));
    setActiveId(id);
  }
  function makeAlternative(target = selection, suggestion?: string) {
    if (
      !target ||
      target.endBlockId ||
      !selectedText(notebook.current(), target).trim()
    ) {
      notify("Select a word, sentence, or one paragraph first.");
      return;
    }
    let id = "";
    mutate((d) => {
      const b = d.blocks.find((b) => b.id === target.blockId)!;
      let offset = 0;
      const existing = b.runs.find((r) => {
        const match =
          offset === target.start &&
          offset + r.text.length === target.end &&
          r.alternatives;
        offset += r.text.length;
        return match;
      });
      const value = existing || createAlternative(b, target.start, target.end);
      id = value.id;
      if (suggestion) {
        const text = contextualWording(value, suggestion);
        if (!value.alternatives!.includes(text)) value.alternatives!.push(text);
      }
    });
    openRun(id);
  }
  function editAlternative(edit: (r: Run) => void) {
    mutate((d) => {
      const r = d.blocks.flatMap((b) => b.runs).find((r) => r.id === activeId);
      if (r?.alternatives) edit(r);
    });
    setSelection(activeId ? locateRun(notebook.current(), activeId) : null);
  }
  function expandScope(value: string) {
    setScope(value);
    let sel = editor.current?.read() || selection;
    if (!sel || sel.endBlockId) {
      notify("Place your cursor in a paragraph first.");
      return;
    }
    const b = draft.blocks.find((b) => b.id === sel!.blockId);
    if (!b) return;
    const text = plain(b);
    if (value === "paragraph")
      sel = { blockId: b.id, start: 0, end: text.length };
    if (value === "word") {
      let start = sel.start,
        end = sel.start;
      while (start > 0 && /[\p{L}\p{N}'’-]/u.test(text[start - 1])) start--;
      while (end < text.length && /[\p{L}\p{N}'’-]/u.test(text[end])) end++;
      sel = { blockId: b.id, start, end };
    }
    if (value === "sentence") {
      const matches = [...text.matchAll(/[^.!?]+[.!?]*/g)];
      const match =
        matches.find((m) => sel!.start < m.index + m[0].length) ||
        matches.at(-1);
      if (match)
        sel = {
          blockId: b.id,
          start: match.index,
          end: match.index + match[0].length,
        };
    }
    setActiveId(null);
    editor.current?.select(sel);
  }
  function dim() {
    if (!selection) return;
    mutate((d) => {
      const first = d.blocks.findIndex((b) => b.id === selection.blockId),
        last = selection.endBlockId
          ? d.blocks.findIndex((b) => b.id === selection.endBlockId)
          : first;
      if (first < 0 || last < first) return;
      const slices = d.blocks.slice(first, last + 1).map((b, i, all) => ({
        b,
        start: i === 0 ? selection.start : 0,
        end: i === all.length - 1 ? selection.end : plain(b).length,
      }));
      const allDim = slices.every((s) =>
        sliceRuns(s.b.runs, s.start, s.end).every((r) => r.dim),
      );
      slices.forEach((s) =>
        replaceRange(
          s.b,
          s.start,
          s.end,
          sliceRuns(s.b.runs, s.start, s.end).map((r) => ({
            ...r,
            dim: !allDim,
          })),
        ),
      );
    });
    resetSelection();
  }
  function stash() {
    if (!selection) return;
    mutate((d) => {
      d.overflow.push({ id: uid(), text: selectedText(d, selection) });
      insertText(d, selection, "");
    });
    resetSelection();
    notify("Stashed in Overflow.", () => undo());
  }
  function getTarget(): AITarget | null {
    if (view !== "write") return null;
    let sel = editor.current?.read() || selection;
    const d = notebook.current(),
      b = d.blocks.find((b) => b.id === sel?.blockId);
    if (!sel || !b || sel.endBlockId) return null;
    if (!selectedText(d, sel).trim())
      sel = { blockId: b.id, start: 0, end: plain(b).length };
    const text = selectedText(d, sel);
    return text
      ? { ...sel, text, docId: d.id, ...selectionContext(d, sel) }
      : null;
  }
  function openLab() {
    setLabTarget(getTarget());
    setActiveId(null);
    setDialog("lab");
  }
  async function askAlternatives() {
    if (!ai.connected) {
      openLab();
      return;
    }
    if (!active?.alternatives || ai.pending) return;
    const d = notebook.current(),
      id = active.id,
      location = locateRun(d, id)!;
    const original = active.text,
      context = selectionContext(d, location),
      docId = d.id;
    try {
      const suggestions = await ai.request({
        text: original,
        mode: "alternatives",
        ...context,
      });
      const current = notebook.current(),
        sel = locateRun(current, id);
      if (
        current.id !== docId ||
        !sel ||
        selectedText(current, sel) !== original ||
        JSON.stringify(selectionContext(current, sel)) !==
          JSON.stringify(context)
      ) {
        notify(
          "The passage changed while AI was working. Ask again for the new wording.",
        );
        return;
      }
      mutate((d) => {
        const r = d.blocks.flatMap((b) => b.runs).find((r) => r.id === id)!;
        r.alternatives = [
          ...new Set([
            ...r.alternatives!,
            ...suggestions.map((s) => contextualWording(r, s)),
          ]),
        ];
      });
      notify("New possibilities added. Your current wording is unchanged.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not get suggestions.",
      );
    }
  }
  function keepSuggestion(text: string, target: AITarget) {
    const current = notebook.current();
    if (
      current.id !== target.docId ||
      selectedText(current, target) !== target.text ||
      JSON.stringify(selectionContext(current, target)) !==
        JSON.stringify({ before: target.before, after: target.after })
    ) {
      notify("The passage changed. Select it again for a fresh revision.");
      return;
    }
    makeAlternative(target, text);
    setDialog(null);
  }
  function exportDraft(json = false) {
    const name =
      (draft.title || "Untitled")
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .trim()
        .slice(0, 100) || "draft";
    download(
      name + (json ? ".write-on.json" : ".md"),
      json ? JSON.stringify({ version: 1, draft }, null, 2) : toMarkdown(draft),
      json ? "application/json" : "text/markdown",
    );
    setMenu(false);
  }
  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const f = event.target.files?.[0];
    event.target.value = "";
    if (!f) return;
    if (f.size > MAX_NOTEBOOK_BYTES) {
      notify("Choose a backup smaller than 16 MB.");
      return;
    }
    try {
      const text = await f.text();
      if (f.name.toLowerCase().endsWith(".json")) {
        const data = JSON.parse(text);
        const imported = data.docs ? validateNotebook(data) : null;
        const drafts = imported?.docs ?? [validateDraft(data.draft)];
        for (const d of [...drafts].reverse()) notebook.add(validateDraft(d));
        for (const d of [...(imported?.deleted ?? [])].reverse())
          notebook.addDeleted(validateDraft(d));
      } else notebook.add(fromMarkdown(text));
      resetSelection();
      notify("Draft imported.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not read that draft.",
      );
    }
  }
  useEffect(() => {
    function keys(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey,
        key = event.key.toLowerCase();
      if (screen === "notebook") {
        if (key === "escape") setMenu(false);
        return;
      }
      if (mod && key === "k") {
        event.preventDefault();
        if (dialog === "lab") setDialog(null);
        else openLab();
      }
      if (mod && key === "f" && event.shiftKey) {
        event.preventDefault();
        setFocus((v) => !v);
      }
      if (mod && key === "s") {
        event.preventDefault();
        notebook.save();
      }
      if (
        mod &&
        (key === "z" || key === "y") &&
        !dialog &&
        !(event.target as Element).closest(".inline-alternatives")
      ) {
        event.preventDefault();
        undo(key === "y" || event.shiftKey);
      }
      if (key === "escape") {
        resetSelection();
        setMenu(false);
      }
    }
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  });
  if (!notebook.ready)
    return (
      <main className="mx-auto max-w-xl py-20" aria-label="Opening notebook">
        <h1 className="mb-4 text-2xl">write_better.</h1>
        <p role="status">
          {notebook.status.replace("Saved to SQLite", "Saved on this computer")}
        </p>
        {notebook.error && (
          <div role="alert" className="mt-5 space-y-4">
            <p>{notebook.error}</p>
            <p>The editor will open once your saved drafts are loaded.</p>
            <button className="primary-button" onClick={notebook.retry}>
              Retry connection
            </button>
          </div>
        )}
      </main>
    );
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <button
            className="wordmark"
            title="Open your drafts"
            onClick={() => navigate("notebook")}
          >
            write<span>_</span>better<span className="brand-dot">.</span>
          </button>
          <a
            className="brand-tagline"
            href="https://x.com/jasonfried/status/2105403067793584590"
            target="_blank"
            rel="noopener noreferrer"
          >
            inspired by Jason Fried
          </a>
        </div>
        <div className="top-center" role="status">
          <span className="status-dot" />
          {notebook.status.replace("Saved to SQLite", "Saved on this computer")}
        </div>
        <nav className="header-actions" aria-label="Workspace">
          {screen === "editor" && (
            <button
              id="focus-button"
              className="text-button"
              aria-pressed={focus}
              onClick={() => setFocus(!focus)}
            >
              <span className="icon">⌗</span>
              <span>Focus</span>
            </button>
          )}
          <button
            className="icon-button"
            aria-label={`Switch to ${theme === "night" ? "paper" : "night"} theme`}
            onClick={() => setTheme(theme === "night" ? "paper" : "night")}
          >
            {theme === "night" ? "☼" : "☾"}
          </button>
          <button
            id="more-button"
            className="icon-button"
            aria-label="Export and help"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            •••
          </button>
        </nav>
        {menu && (
          <div className="dropdown">
            {screen === "editor" && (
              <>
                <button onClick={() => exportDraft()}>
                  Export Markdown <span>.md</span>
                </button>
                <button onClick={() => exportDraft(true)}>
                  Back up this draft <span>.json</span>
                </button>
              </>
            )}
            <button
              onClick={() => {
                download(
                  "write-on-notebook.json",
                  JSON.stringify(notebook.book, null, 2),
                  "application/json",
                );
                setMenu(false);
              }}
            >
              Back up all drafts <span>.json</span>
            </button>
            <button
              onClick={() => {
                file.current?.click();
                setMenu(false);
              }}
            >
              Import a draft <span>↗</span>
            </button>
            <button
              onClick={() => {
                setDialog("help");
                setMenu(false);
              }}
            >
              How it works <span>?</span>
            </button>
          </div>
        )}
      </header>
      {notebook.error && (
        <div
          role="alert"
          className="border-b border-[var(--accent)] px-6 py-3 text-xs"
        >
          {notebook.error}{" "}
          <button
            className="mr-4 underline"
            onClick={
              notebook.conflict
                ? () => {
                    resetSelection();
                    setDialog(null);
                    notebook.recover();
                  }
                : notebook.retry
            }
          >
            {notebook.conflict ? "Keep both versions" : "Retry save"}
          </button>
          <button
            className="underline"
            onClick={() =>
              download(
                "write-on-notebook.json",
                JSON.stringify(notebook.book, null, 2),
                "application/json",
              )
            }
          >
            Export notebook backup
          </button>
        </div>
      )}
      {screen === "notebook" ? (
        <NotebookView
          book={notebook.book}
          onOpen={switchDraft}
          onBack={() => navigate("editor")}
          onNew={() => {
            notebook.add();
            editorScroll.current = 0;
            navigate("editor");
            requestAnimationFrame(() => {
              title.current?.focus();
              title.current?.select();
            });
          }}
          onRemove={(id) => {
            const restore = notebook.remove(id);
            notify(
              "Moved to Recently Deleted. You can restore it anytime.",
              restore,
            );
          }}
          onRestore={(id) => {
            notebook.restore(id);
            notify("Draft restored to your notebook.");
          }}
          onBackup={() =>
            download(
              "write-on-notebook.json",
              JSON.stringify(notebook.book, null, 2),
              "application/json",
            )
          }
        />
      ) : (
        <>
          <div
            className={`workspace ${view !== "write" ? "markdown-workspace" : ""}`}
          >
            <aside
              className={`side-panel alternatives-panel ${mobile === "alternatives" ? "mobile-open" : ""}`}
              aria-label="Alternatives"
            >
              <div className="panel-heading">
                <h2>Alternatives</h2>
                <span className="small-count">
                  {String(alternatives.length).padStart(2, "0")}
                </span>
              </div>
              <p className="panel-intro">
                Compare different wording without losing your original.
              </p>
              <div
                className="scope-switch"
                role="group"
                aria-label="Selection scope"
              >
                {["word", "sentence", "paragraph"].map((value) => (
                  <button
                    key={value}
                    className={scope === value ? "active" : ""}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => expandScope(value)}
                  >
                    {value[0].toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>
              <p className="alt-prompt">
                Select text to try new wording
                <br />
                <strong>right where you’re writing.</strong>
              </p>
              <div className="marked-list">
                {alternatives.length > 0 && (
                  <div className="eyebrow">IN THIS DRAFT</div>
                )}
                {alternatives.map((r) => (
                  <button
                    key={r.id}
                    className={`marked-item ${activeId === r.id ? "current" : ""}`}
                    onClick={() => openRun(r.id)}
                  >
                    {r.text}
                    <span>{r.alternatives!.length} possibilities ↗</span>
                  </button>
                ))}
              </div>
              <div className="panel-footnote">
                <span className="hand-arrow">↳</span>Keep the possibilities.
              </div>
            </aside>
            <main aria-label="Writing workspace">
              <div className="document-meta">
                <span>PERSONAL DRAFT</span>
                <span className="meta-line" />
                <span>
                  {new Date(draft.updated)
                    .toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                    .toUpperCase()}
                </span>
              </div>
              <input
                ref={title}
                className="document-title"
                aria-label="Draft title"
                placeholder="An untitled thought…"
                maxLength={300}
                value={draft.title}
                onChange={(e) =>
                  mutate((d) => {
                    d.title = e.target.value;
                  }, "typing:title")
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && view === "write")
                    editor.current?.select({
                      blockId: draft.blocks[0].id,
                      start: 0,
                      end: 0,
                    });
                }}
              />
              <div
                role="group"
                aria-label="Editor mode"
                className="view-switch mb-2 flex w-fit items-center gap-1 rounded-md border border-[var(--line)] p-1"
              >
                {(["write", "markdown", "preview"] as const).map((mode) => (
                  <button
                    key={mode}
                    aria-pressed={view === mode}
                    onClick={() => switchView(mode)}
                    className={`rounded px-4 py-2 text-[13px] transition-colors ${view === mode ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--muted)] hover:bg-[var(--panel)]"}`}
                  >
                    {mode === "write"
                      ? "Write"
                      : mode === "markdown"
                        ? "Markdown"
                        : "Preview"}
                  </button>
                ))}
              </div>
              <p className="mode-help">
                {view === "write"
                  ? "Write and compare wording. Markdown symbols stay visible here."
                  : view === "markdown"
                    ? "Format your source. Use Write for alternatives, or Preview to read the result."
                    : "Read your formatted draft. Return to Write or Markdown to edit."}
              </p>
              {view === "write" ? (
                <>
                  <WritingEditor
                    key={draft.id}
                    ref={editor}
                    draft={draft}
                    mutate={mutate}
                    activeId={activeId}
                    onSelection={setSelection}
                    onAlternative={openRun}
                    undo={undo}
                  />
                  <button
                    className="new-line"
                    aria-label="Add a paragraph"
                    onClick={() => {
                      const b = block();
                      mutate((d) => {
                        d.blocks.push(b);
                      });
                      requestAnimationFrame(() =>
                        editor.current?.select({
                          blockId: b.id,
                          start: 0,
                          end: 0,
                        }),
                      );
                    }}
                  >
                    + <span>One more thought</span>
                  </button>
                </>
              ) : view === "markdown" ? (
                <MarkdownEditor
                  key={draft.id}
                  source={text}
                  onChange={(source, typing) =>
                    mutate(
                      (d) => applyMarkdownSource(d, source),
                      typing ? "typing:markdown" : "action",
                    )
                  }
                />
              ) : (
                <MarkdownPreview source={text} />
              )}
              <div className="page-end">
                <span />
                <span>Keep going. Or let it rest.</span>
                <span />
              </div>
            </main>
            <aside
              className={`side-panel overflow-panel ${mobile === "overflow" ? "mobile-open" : ""}`}
              aria-label="Overflow"
            >
              <div className="panel-heading">
                <h2>Overflow</h2>
                <button
                  className="icon-button"
                  aria-label="Add an Overflow note"
                  onClick={() => {
                    mutate((d) => {
                      d.overflow.push({ id: uid(), text: "" });
                    });
                    requestAnimationFrame(() => {
                      const notes =
                        document.querySelectorAll<HTMLTextAreaElement>(
                          ".overflow-note textarea",
                        );
                      notes[notes.length - 1]?.focus();
                    });
                  }}
                >
                  +
                </button>
              </div>
              <p className="panel-intro">
                Notes and passages saved outside your draft.
              </p>
              {draft.overflow.map((note) => (
                <section key={note.id} className="overflow-note">
                  <textarea
                    aria-label="Overflow note"
                    value={note.text}
                    onChange={(e) =>
                      mutate((d) => {
                        d.overflow.find((n) => n.id === note.id)!.text =
                          e.target.value;
                      }, `typing:note:${note.id}`)
                    }
                  />
                  <div className="note-actions">
                    <button
                      onClick={() => {
                        mutate((d) => {
                          d.blocks.push(...note.text.split("\n\n").map(block));
                          d.overflow = d.overflow.filter(
                            (n) => n.id !== note.id,
                          );
                        });
                        notify("Added to the end of the draft.", () => undo());
                      }}
                    >
                      Return to draft ↙
                    </button>
                    <button
                      aria-label="Remove note"
                      onClick={() => {
                        mutate((d) => {
                          d.overflow = d.overflow.filter(
                            (n) => n.id !== note.id,
                          );
                        });
                        notify("Note removed.", () => undo());
                      }}
                    >
                      ×
                    </button>
                  </div>
                </section>
              ))}
              <p className="overflow-hint">
                Select a passage and stash it here.
                <br />
                Nothing good has to disappear.
              </p>
            </aside>
          </div>
          <footer className="bottom-bar">
            <div className="footer-left">
              <button
                className="text-button"
                onClick={() => navigate("notebook")}
              >
                <span className="icon">▤</span> Drafts
              </button>
              <span className="footer-divider" />
              <span id="word-count">
                {words} {words === 1 ? "word" : "words"}
              </span>
              <span id="reading-time">
                {Math.max(1, Math.ceil(words / 220))} min read
              </span>
            </div>
            <button
              className="lab-button"
              title="The Lab: writing checks and AI revisions"
              aria-expanded={dialog === "lab"}
              onClick={openLab}
            >
              <span className="lab-icon">⚗</span>The Lab{" "}
              {view === "write" && <span className="keycap">⌘ / Ctrl K</span>}
            </button>
            <div className="footer-right">
              <button
                className="icon-button"
                aria-label="Undo"
                disabled={!notebook.canUndo}
                onClick={() => undo()}
              >
                ↶
              </button>
              <button
                className="icon-button"
                aria-label="Redo"
                disabled={!notebook.canRedo}
                onClick={() => undo(true)}
              >
                ↷
              </button>
              <button
                id="mobile-alts"
                className="text-button"
                onClick={() => {
                  if (view !== "write")
                    notify("Switched to Write to explore wording and notes.");
                  setView("write");
                  setMobile(mobile === "alternatives" ? null : "alternatives");
                }}
              >
                {view === "write" ? "Alternatives" : "Write: alternatives"}
              </button>
              <button
                id="mobile-overflow"
                className="text-button"
                onClick={() => {
                  if (view !== "write")
                    notify("Switched to Write to explore wording and notes.");
                  setView("write");
                  setMobile(mobile === "overflow" ? null : "overflow");
                }}
              >
                {view === "write" ? "Overflow" : "Write: notes"}
              </button>
              <span className="footer-note">A little room to think.</span>
            </div>
          </footer>
        </>
      )}
      {screen === "editor" &&
        view === "write" &&
        !dialog &&
        !activeId &&
        selectedText(draft, selection).trim() && (
          <div
            className="selection-toolbar"
            role="toolbar"
            aria-label="Selected text actions"
            onMouseDown={(e) => e.preventDefault()}
          >
            <span>{wordCount(selectedText(draft, selection))} selected</span>
            <button
              id="make-alternative"
              disabled={Boolean(selection?.endBlockId)}
              onClick={() => makeAlternative()}
            >
              Alternatives ↔
            </button>
            <button
              title="Fade a passage while keeping it in the draft"
              onClick={dim}
            >
              Dim / restore
            </button>
            <button
              title="Move selected text into Overflow notes"
              onClick={stash}
            >
              Move to notes ↗
            </button>
          </div>
        )}
      {screen === "editor" &&
        active?.alternatives &&
        view === "write" &&
        !dialog && (
          <InlineAlternatives
            key={active.id}
            value={active}
            onEdit={editAlternative}
            onClose={() => setActiveId(null)}
            onReturnFocus={() => {
              const location = locateRun(notebook.current(), active.id);
              if (location)
                requestAnimationFrame(() =>
                  editor.current?.select({ ...location, start: location.end }),
                );
            }}
            pending={ai.pending}
            onAsk={() => void askAlternatives()}
          />
        )}
      {dialog === "lab" && (
        <Lab
          draft={draft}
          target={labTarget}
          ai={ai}
          onClose={() => setDialog(null)}
          onFinding={(sel) => {
            setDialog(null);
            setView("write");
            requestAnimationFrame(() => editor.current?.select(sel, true));
          }}
          onKeep={keepSuggestion}
        />
      )}
      {dialog === "help" && (
        <Dialog
          title="Write. Try. Write on."
          eyebrow="MAKE YOURSELF AT HOME"
          onClose={() => setDialog(null)}
        >
          <dl className="help-list">
            <dt>Write and explore</dt>
            <dd>
              Select text in Write, then choose Alternatives. Type new wording
              beside the passage and press Enter. Changing “a dog” to “animal”
              adjusts it to “an animal.” Dim a passage or stash it in Overflow
              to return to later.
            </dd>
            <dt>Give your words structure</dt>
            <dd>
              Open Markdown to edit the source with live preview. Select text
              and use the toolbar for headings, bold, italic, lists, links,
              quotes, code, and tables. Preview shows your formatted body. All
              three views share the same draft.
            </dd>
            <dt>Get a second look</dt>
            <dd>
              The Lab spots long sentences and filler. For AI, select a passage
              in Write and use your ChatGPT subscription through your signed-in
              Codex CLI, or select the separately billed API option.
            </dd>
            <dt>Recover a draft</dt>
            <dd>
              Open Drafts, then Recently Deleted to restore a removed draft.
              Deleted drafts do not expire. Undo and Redo are available at every
              screen size.
            </dd>
            <dt>Keep a copy</dt>
            <dd>
              Markdown exports the title and current wording. JSON backups also
              preserve alternatives, dimmed passages, and Overflow notes. Import
              adds a new draft.
            </dd>
          </dl>
          <div className="shortcuts">
            <span>
              <kbd>Escape, then Tab</kbd>Leave either editor (Shift+Tab goes
              back)
            </span>
            <span>
              <kbd>Tab / Shift+Tab</kbd>Indent / remove indentation
            </span>
            <span>
              <kbd>⌘ / Ctrl B, I, K</kbd>Bold, italic, link in Markdown
            </span>
            <span>
              <kbd>⌘ / Ctrl Z</kbd>Undo
            </span>
            <span>
              <kbd>⌘ / Ctrl K</kbd>The Lab in Write
            </span>
            <span>
              <kbd>⌘ / Ctrl Shift F</kbd>Focus
            </span>
          </div>
        </Dialog>
      )}
      <input
        ref={file}
        type="file"
        hidden
        accept=".md,.txt,.json,text/plain,text/markdown,application/json"
        onChange={(event) => void importFile(event)}
      />
      {toast && (
        <Toast
          message={toast}
          paused={dialog !== null}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  );
}
