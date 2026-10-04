import { useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { Ref } from "react";
import { block, insertText, plain, run, selectedText, uid } from "../model";
import type { Draft, Mutate, TextSelection } from "../types";

export interface EditorHandle {
  select: (selection: TextSelection, scroll?: boolean) => void;
  read: () => TextSelection | null;
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function caretPoint(element: Element, offset: number): [Node, number] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Node | null,
    remaining = offset;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length || 0;
    if (remaining <= length) return [node, remaining];
    remaining -= length;
  }
  return [element, element.childNodes.length];
}
export function WritingEditor({
  draft,
  mutate,
  activeId,
  onSelection,
  onAlternative,
  undo,
  ref,
}: {
  draft: Draft;
  mutate: Mutate;
  activeId: string | null;
  onSelection: (selection: TextSelection | null) => void;
  onAlternative: (id: string) => void;
  undo: (redo?: boolean) => void;
  ref: Ref<EditorHandle>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const pending = useRef<TextSelection | null>(null);
  const composing = useRef(false);
  const tabExit = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const latest = useRef({ draft, mutate, onSelection, onAlternative, undo });
  latest.current = { draft, mutate, onSelection, onAlternative, undo };
  function read(): TextSelection | null {
    const editor = root.current,
      selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    function point(node: Node, offset: number) {
      const el = (
        node instanceof Element ? node : node.parentElement
      )?.closest<HTMLElement>("[data-block]");
      if (!el && node === editor) {
        const child = editor!.children[
          Math.min(offset, editor!.children.length - 1)
        ] as HTMLElement | undefined;
        return child
          ? {
              blockId: child.dataset.block!,
              offset:
                offset >= editor!.children.length
                  ? child.textContent!.length
                  : 0,
            }
          : null;
      }
      if (!el || !editor!.contains(el)) return null;
      const r = document.createRange();
      r.selectNodeContents(el);
      try {
        r.setEnd(node, offset);
      } catch {
        return null;
      }
      return { blockId: el.dataset.block!, offset: r.toString().length };
    }
    let a = point(range.startContainer, range.startOffset),
      z = point(range.endContainer, range.endOffset);
    if (!a || !z) return null;
    const blocks = latest.current.draft.blocks;
    let i = blocks.findIndex((b) => b.id === a!.blockId),
      j = blocks.findIndex((b) => b.id === z!.blockId);
    if (i < 0 || j < 0) return null;
    if (!range.collapsed) {
      while (i < j && a.offset === plain(blocks[i]).length) {
        i++;
        a = { blockId: blocks[i].id, offset: 0 };
      }
      while (j > i && z.offset === 0) {
        j--;
        z = { blockId: blocks[j].id, offset: plain(blocks[j]).length };
      }
    }
    return {
      blockId: a.blockId,
      start: a.offset,
      end: z.offset,
      ...(a.blockId !== z.blockId ? { endBlockId: z.blockId } : {}),
    };
  }
  function select(selection: TextSelection, scroll = false) {
    const children = [...(root.current?.children || [])] as HTMLElement[];
    const a = children.find((el) => el.dataset.block === selection.blockId);
    const z = children.find(
      (el) => el.dataset.block === (selection.endBlockId || selection.blockId),
    );
    if (!a || !z) {
      pending.current = selection;
      return;
    }
    root.current?.focus({ preventScroll: true });
    const range = document.createRange();
    range.setStart(...caretPoint(a, selection.start));
    range.setEnd(...caretPoint(z, selection.end));
    const browserSelection = window.getSelection();
    browserSelection?.removeAllRanges();
    browserSelection?.addRange(range);
    if (scroll) a.scrollIntoView({ block: "center", behavior: "instant" });
    latest.current.onSelection(selection);
  }
  useImperativeHandle(ref, () => ({ select, read }));
  useLayoutEffect(() => {
    if (composing.current) return;
    const editor = root.current!;
    const existing = document.activeElement === editor ? read() : null;
    editor.innerHTML = draft.blocks
      .map(
        (b) =>
          `<p data-block="${escape(b.id)}" data-empty="${!plain(b)}" data-placeholder="Let the thought begin…">${b.runs.map((r) => `<span data-run="${escape(r.id)}" class="${r.alternatives ? "alternative" : ""} ${r.dim ? "dimmed" : ""} ${r.id === activeId ? "selected" : ""}"${r.alternatives ? ' title="Click to explore alternatives"' : ""}>${escape(r.text)}</span>`).join("")}${plain(b) ? "" : "<br>"}</p>`,
      )
      .join("");
    const next = pending.current || existing;
    pending.current = null;
    if (next) select(next);
  }, [draft.blocks, activeId]);
  useLayoutEffect(() => {
    const editor = root.current!;
    function edit(
      selection: TextSelection | null,
      text: string,
      kind = "typing:body",
    ) {
      if (!selection) return;
      latest.current.mutate((d) => {
        pending.current = insertText(d, selection, text);
      }, kind);
    }
    function beforeInput(event: InputEvent) {
      if (
        event.isComposing ||
        composing.current ||
        event.inputType === "insertCompositionText"
      )
        return;
      let selection = read();
      if (!selection) return;
      const type = event.inputType,
        d = latest.current.draft;
      if (["insertText", "insertReplacementText"].includes(type)) {
        event.preventDefault();
        edit(selection, event.data || "");
        return;
      }
      if (type === "insertParagraph" || type === "insertLineBreak") {
        event.preventDefault();
        edit(selection, "\n", "action");
        return;
      }
      if (type === "historyUndo" || type === "historyRedo") {
        event.preventDefault();
        latest.current.undo(type === "historyRedo");
        return;
      }
      if (type.startsWith("delete")) {
        event.preventDefault();
        if (!selection.endBlockId && selection.start === selection.end) {
          const index = d.blocks.findIndex((b) => b.id === selection!.blockId),
            b = d.blocks[index],
            text = plain(b);
          const backward = type.includes("Backward") || type === "deleteByCut";
          if (backward && selection.start === 0 && index > 0)
            selection = {
              blockId: d.blocks[index - 1].id,
              start: plain(d.blocks[index - 1]).length,
              endBlockId: b.id,
              end: 0,
            };
          else if (
            !backward &&
            selection.end === text.length &&
            index < d.blocks.length - 1
          )
            selection = {
              ...selection,
              endBlockId: d.blocks[index + 1].id,
              end: 0,
            };
          else if (type.includes("Word")) {
            if (backward)
              selection.start = text
                .slice(0, selection.start)
                .replace(/\s*\S+\s*$/, "").length;
            else
              selection.end += (text
                .slice(selection.end)
                .match(/^\s*\S+\s*/) || [""])[0].length;
          } else if (type.includes("Line")) {
            if (backward) selection.start = 0;
            else selection.end = text.length;
          } else {
            const boundaries = [
              ...new Intl.Segmenter(undefined, {
                granularity: "grapheme",
              }).segment(text),
            ]
              .map((s) => s.index)
              .concat(text.length);
            if (backward)
              selection.start =
                boundaries.filter((i) => i < selection!.start).at(-1) ?? 0;
            else
              selection.end =
                boundaries.find((i) => i > selection!.end) ?? text.length;
          }
        }
        edit(selection, "");
      } else if (type.startsWith("format") || type === "insertFromDrop")
        event.preventDefault();
    }
    function reconcile() {
      const selection = read(),
        oldRuns = new Map(
          latest.current.draft.blocks
            .flatMap((b) => b.runs)
            .map((r) => [r.id, r]),
        );
      const blocks = [...editor.children].map((el) => {
        const runs = [...el.childNodes]
          .filter((n) => n.nodeName !== "BR")
          .map((n) => {
            const old =
              n instanceof HTMLElement
                ? oldRuns.get(n.dataset.run || "")
                : undefined;
            const text = n.textContent || "";
            if (!old) return run(text);
            const value = structuredClone(old);
            value.text = text;
            if (value.alternatives)
              value.alternatives[value.choice ?? 0] = text;
            return value;
          });
        return {
          id: (el as HTMLElement).dataset.block || uid(),
          runs: runs.length ? runs : [run()],
        };
      });
      if (!blocks.length) blocks.push(block(editor.textContent || ""));
      pending.current = selection;
      latest.current.mutate((d) => {
        d.blocks = blocks;
      }, "typing:body");
    }
    const selectionChange = () => {
      if (composing.current) return;
      const selection = read();
      if (selection) latest.current.onSelection(selection);
    };
    const paste = (e: ClipboardEvent) => {
      e.preventDefault();
      edit(read(), e.clipboardData?.getData("text/plain") || "", "action");
    };
    const cut = (e: ClipboardEvent) => {
      const selection = read(),
        text = selectedText(latest.current.draft, selection);
      if (text) {
        e.preventDefault();
        e.clipboardData?.setData("text/plain", text);
        edit(selection, "", "action");
      }
    };
    const start = () => {
      composing.current = true;
    };
    const end = () => {
      composing.current = false;
      reconcile();
    };
    const input = () => {
      if (!composing.current) reconcile();
    };
    const drop = (e: DragEvent) => e.preventDefault();
    const click = (e: MouseEvent) => {
      const mark = (e.target as Element).closest<HTMLElement>(".alternative");
      if (mark && !window.getSelection()?.toString())
        latest.current.onAlternative(mark.dataset.run!);
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "Escape") {
        tabExit.current = true;
        setLeaving(true);
        return;
      }
      if (e.key === "Shift") return;
      const leave = tabExit.current;
      tabExit.current = false;
      setLeaving(false);
      if (e.key === "Tab" && leave) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const blocks = latest.current.draft.blocks;
        select({
          blockId: blocks[0].id,
          start: 0,
          endBlockId: blocks.at(-1)!.id,
          end: plain(blocks.at(-1)!).length,
        });
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const sel = read();
        if (e.shiftKey && sel) {
          const b = latest.current.draft.blocks.find(
            (b) => b.id === sel.blockId,
          )!;
          const prefix = plain(b).slice(0, sel.start);
          const count = prefix.match(/ {1,2}$/)?.[0].length ?? 0;
          if (count)
            edit(
              {
                ...sel,
                start: sel.start - count,
                end: sel.start,
                endBlockId: undefined,
              },
              "",
            );
        } else edit(sel, "  ");
      }
    };
    editor.addEventListener("beforeinput", beforeInput);
    editor.addEventListener("paste", paste);
    editor.addEventListener("cut", cut);
    editor.addEventListener("compositionstart", start);
    editor.addEventListener("compositionend", end);
    editor.addEventListener("input", input);
    editor.addEventListener("drop", drop);
    editor.addEventListener("click", click);
    editor.addEventListener("keydown", keydown);
    document.addEventListener("selectionchange", selectionChange);
    return () => {
      editor.removeEventListener("beforeinput", beforeInput);
      editor.removeEventListener("paste", paste);
      editor.removeEventListener("cut", cut);
      editor.removeEventListener("compositionstart", start);
      editor.removeEventListener("compositionend", end);
      editor.removeEventListener("input", input);
      editor.removeEventListener("drop", drop);
      editor.removeEventListener("click", click);
      editor.removeEventListener("keydown", keydown);
      document.removeEventListener("selectionchange", selectionChange);
    };
  }, []);
  return (
    <>
      <div
        id="editor"
        ref={root}
        className="editor"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        role="textbox"
        aria-label="Draft body"
        aria-multiline="true"
        aria-describedby="write-keyboard-hint"
        onBlur={() => {
          tabExit.current = false;
          setLeaving(false);
        }}
        onPointerDown={() => {
          tabExit.current = false;
          setLeaving(false);
        }}
      />
      <p
        id="write-keyboard-hint"
        className="editor-keyboard-hint"
        role="status"
      >
        {leaving
          ? "Press Tab to leave the editor, or Shift+Tab to go back."
          : "Tab indents · Shift+Tab removes indentation · Escape, then Tab leaves the editor"}
      </p>
    </>
  );
}
