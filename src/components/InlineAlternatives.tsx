import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { chooseAlternative, contextualWording } from "../model";
import type { Run } from "../types";
export function InlineAlternatives({
  value,
  onEdit,
  onClose,
  onReturnFocus: anchorFocus,
  onAsk,
  pending,
}: {
  value: Run;
  onEdit: (edit: (run: Run) => void) => void;
  onClose: () => void;
  onReturnFocus: () => void;
  onAsk: () => void;
  pending: boolean;
}) {
  const [text, setText] = useState("");
  const root = useRef<HTMLElement>(null),
    list = useRef<HTMLOListElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    const anchor = [
      ...document.querySelectorAll<HTMLElement>("#editor [data-run]"),
    ].find((el) => el.dataset.run === value.id);
    const paragraph = anchor?.closest<HTMLElement>("[data-block]");
    const panel = root.current;
    if (!anchor || !paragraph || !panel) return;

    // Reserve real document space, outside the editable text. The panel never
    // flips over the passage or covers the paragraph that follows it.
    const previousMargin = paragraph.style.marginBottom;
    const baseMargin =
      parseFloat(getComputedStyle(paragraph).marginBottom) || 0;
    function position() {
      const rect = paragraph!.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? innerHeight;
      panel!.style.width = `${Math.min(520, rect.width, innerWidth - 24)}px`;
      panel!.style.maxHeight = `${Math.max(320, Math.min(500, viewportHeight * 0.65))}px`;
      const height = panel!.getBoundingClientRect().height;
      paragraph!.style.marginBottom = `${baseMargin + height + 24}px`;
      panel!.style.left = `${rect.left + scrollX}px`;
      panel!.style.top = `${rect.bottom + scrollY + 12}px`;
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(paragraph);
    observer.observe(panel);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);

    // Bring both the paragraph and its chooser into view when they fit. For a
    // very long paragraph, prioritize the selected line; normal scrolling still
    // reaches the chooser without any text being obscured.
    const frame = requestAnimationFrame(() => {
      position();
      const top = (window.visualViewport?.offsetTop ?? 0) + 20;
      const footerTop =
        document.querySelector(".bottom-bar")?.getBoundingClientRect().top ??
        innerHeight;
      const bottom =
        Math.min(
          footerTop,
          (window.visualViewport?.offsetTop ?? 0) +
            (window.visualViewport?.height ?? innerHeight),
        ) - 16;
      const passage = paragraph.getBoundingClientRect();
      const chooser = panel.getBoundingClientRect();
      let delta = 0;
      if (chooser.bottom - passage.top <= bottom - top) {
        if (chooser.bottom > bottom) delta = chooser.bottom - bottom;
        if (passage.top - delta < top) delta = passage.top - top;
      } else {
        const selected = anchor.getBoundingClientRect();
        if (selected.bottom > bottom) delta = selected.bottom - bottom;
        if (selected.top - delta < top) delta = selected.top - top;
      }
      if (delta) window.scrollBy({ top: delta, behavior: "instant" });
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      paragraph.style.marginBottom = previousMargin;
    };
  }, [value]);
  useLayoutEffect(() => {
    const selected = list.current?.querySelector<HTMLElement>(".active");
    if (!selected || !list.current) return;
    const row = selected.getBoundingClientRect(),
      box = list.current.getBoundingClientRect();
    if (row.top < box.top) list.current.scrollTop += row.top - box.top;
    else if (row.bottom > box.bottom)
      list.current.scrollTop += row.bottom - box.bottom;
  }, [value.choice, value.alternatives?.length]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        !(event.target as Element).closest(
          ".inline-alternatives, .alternative, .marked-item, #make-alternative",
        )
      )
        onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [onClose]);
  function add() {
    if (!text.trim()) return;
    if (text.trim() === "??") {
      setText("");
      onAsk();
      return;
    }
    onEdit((r) => {
      const wording = contextualWording(r, text);
      if (!r.alternatives!.includes(wording)) r.alternatives!.push(wording);
      chooseAlternative(r, r.alternatives!.indexOf(wording));
    });
    setText("");
    input.current?.focus({ preventScroll: true });
  }
  return (
    <section
      ref={root}
      className="inline-alternatives"
      role="dialog"
      aria-label="Inline alternatives"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
          anchorFocus();
        }
      }}
    >
      <div className="inline-heading">
        <span>TRY ANOTHER WAY</span>
        <button
          className="icon-button"
          aria-label="Close alternatives"
          onClick={() => {
            onClose();
            anchorFocus();
          }}
        >
          ×
        </button>
      </div>
      <ol ref={list} className="alt-list">
        {value.alternatives!.map((choice, i) => (
          <li
            key={i}
            className={`alt-choice ${value.choice === i ? "active" : ""}`}
          >
            <button
              aria-pressed={value.choice === i}
              onClick={() => onEdit((r) => chooseAlternative(r, i))}
            >
              {choice}
              <span className="choice-meta">
                {i ? `Alternative ${i}` : "Original"}
                {value.choice === i ? " · in the draft" : ""}
              </span>
            </button>
            {i > 0 && (
              <button
                className="choice-remove"
                aria-label={`Remove alternative ${i}`}
                onClick={() =>
                  onEdit((r) => {
                    r.alternatives!.splice(i, 1);
                    const current = r.choice ?? 0;
                    chooseAlternative(
                      r,
                      current === i ? 0 : current > i ? current - 1 : current,
                    );
                  })
                }
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ol>
      <form
        className="alt-input"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <textarea
          ref={input}
          aria-label="New alternative"
          placeholder={
            value.article
              ? "Try animal, hour, university…"
              : "Another way to say it…"
          }
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              add();
            }
          }}
        />
        <button className="icon-button" aria-label="Add alternative">
          ↵
        </button>
      </form>
      <p className="inline-hint">
        {value.article
          ? "a / an adjusts with your wording."
          : "Enter to add · Shift Enter for a new line"}
      </p>
      <div className="alt-actions">
        <button disabled={pending} onClick={onAsk}>
          {pending ? "Thinking…" : "✧ Ask AI"}
        </button>
        <details className="wording-options">
          <summary>More</summary>
          <button
            onClick={() => {
              onEdit((r) => {
                delete r.alternatives;
                delete r.choice;
                delete r.article;
              });
              onClose();
            }}
          >
            Keep this wording only
          </button>
        </details>
        <div className="alt-navigation">
          <button
            aria-label="Previous alternative"
            onClick={() =>
              onEdit((r) => chooseAlternative(r, (r.choice ?? 0) - 1))
            }
          >
            ←
          </button>
          <button
            aria-label="Next alternative"
            onClick={() =>
              onEdit((r) => chooseAlternative(r, (r.choice ?? 0) + 1))
            }
          >
            →
          </button>
        </div>
      </div>
    </section>
  );
}
