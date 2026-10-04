import { useMemo, useRef, useState } from "react";
import { formatMarkdown, renderMarkdown } from "../markdown";
import type { Format } from "../markdown";

export function MarkdownPreview({ source }: { source: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return (
    <article
      className="markdown-preview"
      aria-label="Markdown preview"
      dangerouslySetInnerHTML={{
        __html:
          html ||
          '<p class="preview-empty">Your words will take shape here.</p>',
      }}
    />
  );
}
const controls: { kind: Format; label: string; text: string }[] = [
  { kind: "h1", label: "Heading 1", text: "H1" },
  { kind: "h2", label: "Heading 2", text: "H2" },
  { kind: "h3", label: "Heading 3", text: "H3" },
  { kind: "bold", label: "Bold (⌘/Ctrl B)", text: "B" },
  { kind: "italic", label: "Italic (⌘/Ctrl I)", text: "I" },
  { kind: "strike", label: "Strikethrough", text: "S̶" },
  { kind: "bullet", label: "Bullet list", text: "• List" },
  { kind: "number", label: "Numbered list", text: "1. List" },
  { kind: "task", label: "Task list", text: "Tasks" },
  { kind: "quote", label: "Blockquote", text: "Quote" },
  { kind: "link", label: "Link (⌘/Ctrl K)", text: "↗ Link" },
  { kind: "code", label: "Inline code", text: "</>" },
  { kind: "fence", label: "Code block", text: "{ }" },
  { kind: "table", label: "Table", text: "Table" },
  { kind: "rule", label: "Horizontal rule", text: "Rule" },
];
export function MarkdownEditor({
  source,
  onChange,
}: {
  source: string;
  onChange: (source: string, typing?: boolean) => void;
}) {
  const [mobilePreview, setMobilePreview] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const tabExit = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const selection = useRef({ start: 0, end: 0 });
  function format(kind: Format) {
    const { start, end } = selection.current;
    const result = formatMarkdown(source, start, end, kind);
    onChange(result.source);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(result.start, result.end);
      selection.current = result;
    });
  }
  return (
    <section aria-label="Markdown editor">
      <div
        role="toolbar"
        aria-label="Markdown formatting"
        className="markdown-toolbar flex flex-wrap items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--panel)] p-2"
      >
        <div className="format-group" role="group" aria-label="Text style">
          {controls
            .filter((c) => ["bold", "italic", "link"].includes(c.kind))
            .map((control) => (
              <button
                key={control.kind}
                type="button"
                title={control.label}
                aria-label={control.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => format(control.kind)}
              >
                {control.text}
              </button>
            ))}
        </div>
        {(
          [
            ["Headings", ["h1", "h2", "h3"]],
            ["Lists", ["bullet", "number", "task"]],
            ["Insert", ["quote", "code", "fence", "table", "rule", "strike"]],
          ] as const
        ).map(([label, kinds]) => (
          <label className="format-select" key={label}>
            <span className="sr-only">{label}</span>
            <select
              aria-label={label}
              value=""
              onChange={(e) => {
                if (e.target.value) format(e.target.value as Format);
              }}
            >
              <option value="" disabled>
                {label}
              </option>
              {controls
                .filter((c) => (kinds as readonly string[]).includes(c.kind))
                .map((c) => (
                  <option key={c.kind} value={c.kind}>
                    {c.label}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
      <div
        className="mobile-preview-switch"
        role="group"
        aria-label="Markdown pane"
      >
        <button
          aria-pressed={!mobilePreview}
          onClick={() => setMobilePreview(false)}
        >
          Source
        </button>
        <button
          aria-pressed={mobilePreview}
          onClick={() => setMobilePreview(true)}
        >
          Preview
        </button>
      </div>
      <div
        className={`markdown-panes mt-5 grid min-w-0 gap-8 lg:grid-cols-2 ${mobilePreview ? "show-preview" : "show-source"}`}
      >
        <div className="source-pane min-w-0">
          <label
            htmlFor="markdown-source"
            className="mb-4 block text-xs tracking-[.16em] text-[var(--muted)]"
          >
            MARKDOWN SOURCE
          </label>
          <textarea
            id="markdown-source"
            ref={input}
            value={source}
            spellCheck
            aria-describedby="markdown-keyboard-hint"
            onBlur={() => {
              tabExit.current = false;
              setLeaving(false);
            }}
            onPointerDown={() => {
              tabExit.current = false;
              setLeaving(false);
            }}
            aria-label="Markdown source"
            className="markdown-source w-full resize-y bg-transparent text-[15px] leading-7"
            placeholder="## A thought worth following…"
            onChange={(event) => onChange(event.target.value, true)}
            onSelect={(event) => {
              selection.current = {
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd,
              };
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                tabExit.current = true;
                setLeaving(true);
                return;
              }
              if (event.key === "Shift") return;
              const leave = tabExit.current;
              tabExit.current = false;
              setLeaving(false);
              if (event.key === "Tab" && leave) return;
              if (
                (event.metaKey || event.ctrlKey) &&
                ["b", "i", "k"].includes(event.key.toLowerCase())
              ) {
                event.preventDefault();
                event.stopPropagation();
                format(
                  ({ b: "bold", i: "italic", k: "link" } as const)[
                    event.key.toLowerCase() as "b" | "i" | "k"
                  ],
                );
              }
              if (event.key === "Tab") {
                event.preventDefault();
                const el = event.currentTarget,
                  start = el.selectionStart,
                  end = el.selectionEnd;
                const count = event.shiftKey
                  ? (source.slice(0, start).match(/ {1,2}$/)?.[0].length ?? 0)
                  : 0;
                const next = event.shiftKey
                  ? source.slice(0, start - count) + source.slice(start)
                  : source.slice(0, start) + "  " + source.slice(end);
                const caret = event.shiftKey ? start - count : start + 2;
                onChange(next);
                requestAnimationFrame(() => {
                  el.setSelectionRange(caret, caret);
                  selection.current = { start: caret, end: caret };
                });
              }
            }}
          />
        </div>
        <div className="preview-pane min-w-0 border-t border-[var(--line)] pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <div className="mb-4 text-xs tracking-[.16em] text-[var(--muted)]">
            LIVE PREVIEW
          </div>
          <MarkdownPreview source={source} />
        </div>
      </div>
      <p
        id="markdown-keyboard-hint"
        className="editor-keyboard-hint"
        role="status"
      >
        {leaving
          ? "Press Tab to leave the editor, or Shift+Tab to go back."
          : "Tab indents · Shift+Tab removes indentation · Escape, then Tab leaves the editor"}
      </p>
      <p className="mode-help">
        Select text to format it. Use Write to explore inline alternatives. The
        title above becomes the first heading when you export.
      </p>
    </section>
  );
}
