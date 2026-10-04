import MarkdownIt from "markdown-it";
import { diffChars } from "diff";
import { compactRuns, draftText, plain, run, uid, sliceRuns } from "./model";
import type { Draft, Run } from "./types";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});
markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  tokens[index].attrSet("rel", "noopener noreferrer");
  tokens[index].attrSet("target", "_blank");
  return self.renderToken(tokens, index, options);
};
// Images are explicit links: opening a draft never fetches a tracking image.
markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index];
  const source = String(token.attrGet("src") || "");
  const label = markdown.utils.escapeHtml(token.content || "Image");
  return markdown.validateLink(source)
    ? `<a href="${markdown.utils.escapeHtml(source)}" target="_blank" rel="noopener noreferrer">Image: ${label} ↗</a>`
    : label;
};
markdown.core.ruler.after("inline", "task_lists", (state) => {
  for (let i = 2; i < state.tokens.length; i++) {
    const token = state.tokens[i];
    if (
      token.type !== "inline" ||
      state.tokens[i - 1].type !== "paragraph_open" ||
      state.tokens[i - 2].type !== "list_item_open"
    )
      continue;
    const first = token.children?.[0];
    const match =
      first?.type === "text" && first.content.match(/^\[([ xX])\] /);
    if (match && first) {
      first.content = first.content.slice(4);
      const checkbox = new state.Token("html_inline", "", 0);
      checkbox.content = `<input type="checkbox" disabled aria-label="${match[1] === " " ? "Incomplete" : "Complete"} task"${match[1] === " " ? "" : " checked"}> `;
      token.children!.unshift(checkbox);
    }
  }
});
export const renderMarkdown = (source: string) => markdown.render(source);

/** Map unchanged spans through source edits, keeping their alternatives and dimming. */
export function applyMarkdownSource(draft: Draft, source: string) {
  const before = draftText(draft);
  if (before === source) return;
  const oldRuns: Run[] = draft.blocks.flatMap((b, i) => [
    ...(i ? [run("\n\n")] : []),
    ...b.runs,
  ]);
  const changes = diffChars(before, source, { timeout: 40 });
  let oldOffset = 0;
  let mapped: Run[] = [];
  if (changes) {
    for (const part of changes) {
      if (part.added) mapped.push(run(part.value));
      else {
        if (!part.removed)
          mapped.push(
            ...sliceRuns(oldRuns, oldOffset, oldOffset + part.value.length),
          );
        oldOffset += part.value.length;
      }
    }
  }
  // Edits contained within an alternative update its active wording, as in Write mode.
  let prefix = 0,
    suffix = 0;
  while (
    prefix < before.length &&
    prefix < source.length &&
    before[prefix] === source[prefix]
  )
    prefix++;
  while (
    suffix < before.length - prefix &&
    suffix < source.length - prefix &&
    before[before.length - 1 - suffix] === source[source.length - 1 - suffix]
  )
    suffix++;
  if (!changes)
    mapped = [
      ...sliceRuns(oldRuns, 0, prefix),
      run(source.slice(prefix, source.length - suffix)),
      ...sliceRuns(oldRuns, before.length - suffix, before.length),
    ];
  let offset = 0;
  for (const r of oldRuns) {
    const end = offset + r.text.length;
    if (r.alternatives && prefix > offset && before.length - suffix < end) {
      const newEnd = end + source.length - before.length;
      const text = source.slice(offset, newEnd);
      if (text && !text.includes("\n\n")) {
        const updated = structuredClone(r);
        updated.text = text;
        updated.alternatives![updated.choice ?? 0] = text;
        mapped = [
          ...sliceRuns(mapped, 0, offset),
          updated,
          ...sliceRuns(mapped, newEnd, source.length),
        ];
      }
      break;
    }
    offset = end;
  }
  offset = 0;
  draft.blocks = source.split("\n\n").map((text, i) => {
    const runs = sliceRuns(mapped, offset, offset + text.length);
    offset += text.length + 2;
    const previous = draft.blocks[i];
    return {
      id: previous && plain(previous) === text ? previous.id : uid(),
      runs: compactRuns(runs),
    };
  });
}

export type Format =
  | "h1"
  | "h2"
  | "h3"
  | "bold"
  | "italic"
  | "strike"
  | "bullet"
  | "number"
  | "task"
  | "quote"
  | "link"
  | "code"
  | "fence"
  | "table"
  | "rule";
export function formatMarkdown(
  source: string,
  start: number,
  end: number,
  kind: Format,
) {
  let text = source.slice(start, end),
    from = start,
    to = end,
    selectionStart = start,
    selectionEnd = end;
  const wrap = (marker: string, placeholder: string) => {
    if (
      text.startsWith(marker) &&
      text.endsWith(marker) &&
      text.length > marker.length * 2
    ) {
      text = text.slice(marker.length, -marker.length);
      selectionEnd = start + text.length;
    } else if (
      source.slice(start - marker.length, start) === marker &&
      source.slice(end, end + marker.length) === marker
    ) {
      from -= marker.length;
      to += marker.length;
      selectionStart = from;
      selectionEnd = from + text.length;
    } else {
      text ||= placeholder;
      selectionStart = start + marker.length;
      selectionEnd = selectionStart + text.length;
      text = marker + text + marker;
    }
  };
  if (kind === "bold") wrap("**", "bold text");
  else if (kind === "italic") wrap("*", "italic text");
  else if (kind === "strike") wrap("~~", "struck text");
  else if (kind === "code") wrap("`", "code");
  else if (kind === "link") {
    text = `[${text || "link text"}](https://example.com)`;
    selectionStart = start + text.indexOf("https://");
    selectionEnd = start + text.length - 1;
  } else if (["fence", "table", "rule"].includes(kind)) {
    const body =
      kind === "fence"
        ? `\`\`\`\n${text || "code here"}\n\`\`\``
        : kind === "table"
          ? "| Column | Column |\n| --- | --- |\n| Text | Text |"
          : "---";
    const lead =
      start && !source.slice(0, start).endsWith("\n\n") ? "\n\n" : "";
    const tail =
      end < source.length && !source.slice(end).startsWith("\n\n")
        ? "\n\n"
        : "";
    text = lead + body + tail;
    selectionStart = start + lead.length + (kind === "fence" ? 4 : 0);
    selectionEnd =
      selectionStart +
      (kind === "fence"
        ? (source.slice(start, end) || "code here").length
        : body.length);
  } else {
    from = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    if (start === 0) from = 0;
    to = source.indexOf("\n", Math.max(start, end - 1));
    if (to < 0) to = source.length;
    const lines = source.slice(from, to).split("\n");
    const marker =
      kind === "h1"
        ? "# "
        : kind === "h2"
          ? "## "
          : kind === "h3"
            ? "### "
            : kind === "bullet"
              ? "- "
              : kind === "task"
                ? "- [ ] "
                : kind === "quote"
                  ? "> "
                  : "1. ";
    const already = lines.every((line) =>
      kind === "number" ? /^\d+\. /.test(line) : line.startsWith(marker),
    );
    text = lines
      .map((line, i) => {
        if (already)
          return line.replace(
            kind === "number"
              ? /^\d+\. /
              : new RegExp("^" + marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
            "",
          );
        const clean = line.replace(
          /^(#{1,6} |[-*+] (?:\[[ xX]\] )?|\d+\. |> )/,
          "",
        );
        return (kind === "number" ? `${i + 1}. ` : marker) + clean;
      })
      .join("\n");
    selectionStart = from;
    selectionEnd = from + text.length;
  }
  return {
    source: source.slice(0, from) + text + source.slice(to),
    start: selectionStart,
    end: selectionEnd,
  };
}
