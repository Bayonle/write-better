import type { Run, Block, Draft, TextSelection } from "./types";

export const uid = () => crypto.randomUUID();
export const run = (text = "", extra: Partial<Run> = {}): Run => ({
  id: uid(),
  text,
  ...extra,
});
export const block = (text = ""): Block => ({ id: uid(), runs: [run(text)] });
export const plain = (b: Block) => b.runs.map((r) => r.text).join("");
export const draftText = (d: Draft) => d.blocks.map(plain).join("\n\n");
export const wordCount = (text: string) => (text.match(/\S+/gu) || []).length;

// English a/an is based on sound. Cover common exceptions; this is not a full grammar engine.
export function indefiniteArticle(text: string) {
  const word = (text
    .trim()
    .replace(/^["'“‘(]+/u, "")
    .match(/^[\p{L}\d-]+/u) || [""])[0];
  if (/^(honest|honou?r|hour|heir)/i.test(word)) return "an";
  if (
    /^(one(?!ir)|once|uni(?:corn|form|que|t|on|vers|lateral)|u(?:ser|se|sual|til|tens)|eu|ewe|ubiq)/i.test(
      word,
    )
  )
    return "a";
  if (/^(8|11|18)(\D|$)/.test(word)) return "an";
  if (
    /^[A-Z]{2,}$/.test(word) &&
    !["NASA", "NATO", "UNESCO", "UNICEF", "OPEC"].includes(word)
  )
    return /^[AEFHILMNORSX]/.test(word) ? "an" : "a";
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
export function contextualWording(r: Run, text: string) {
  text = text.trim();
  if (!r.article || !text) return text;
  const article = text.match(/^(a|an)\s+/i);
  if (
    !article &&
    /^(the|this|that|these|those|my|your|our|their|his|her|its|some|any|no|each|every|another)\b/i.test(
      text,
    )
  )
    return text;
  const phrase = article ? text.slice(article[0].length) : text;
  let prefix = indefiniteArticle(phrase);
  if (/^[A-Z]/.test(r.alternatives![0]))
    prefix = prefix[0].toUpperCase() + prefix.slice(1);
  return `${prefix} ${phrase}`;
}
export function createAlternative(b: Block, start: number, end: number) {
  const text = plain(b);
  let article = false;
  const preceding = text.slice(0, start).match(/\b(a|an)\s+$/i);
  const selected = text.slice(start, end);
  if (preceding && !/^(a|an|the)\s+/i.test(selected)) {
    const proposedStart = start - preceding[0].length;
    // Don't absorb a neighbouring alternative and silently discard its choices.
    let offset = 0;
    const overlaps = b.runs.some((r) => {
      const from = offset;
      offset += r.text.length;
      return r.alternatives && from < start && offset > proposedStart;
    });
    if (!overlaps) {
      start = proposedStart;
      article = true;
    }
  }
  const phrase = text.slice(start, end);
  if (
    /^(a|an)\s+\S+/i.test(phrase) &&
    !/[.!?\n]/.test(phrase) &&
    wordCount(phrase) <= 6
  )
    article = true;
  const original = text.slice(start, end),
    value = run(original, { alternatives: [original], choice: 0, article });
  replaceRange(b, start, end, [value]);
  return value;
}
export function chooseAlternative(r: Run, index: number) {
  r.choice = (index + r.alternatives!.length) % r.alternatives!.length;
  r.text =
    r.choice === 0
      ? r.alternatives![0]
      : contextualWording(r, r.alternatives![r.choice ?? 0]);
  r.alternatives![r.choice ?? 0] = r.text;
}
export function articleContextFor(b: Block, id: string) {
  let start = 0;
  const r = b.runs.find((item) => {
    if (item.id === id) return true;
    start += item.text.length;
    return false;
  });
  if (!r?.alternatives || r.article) return null;
  const prefix = plain(b)
    .slice(0, start)
    .match(/\b(a|an)\s+$/i);
  if (!prefix) return null;
  const from = start - prefix[0].length;
  let offset = 0;
  if (
    b.runs.some((item) => {
      const begin = offset;
      offset += item.text.length;
      return item.alternatives && begin < start && offset > from;
    })
  )
    return null;
  return { start: from, end: start + r.text.length, prefix: prefix[0], r };
}
export function attachArticleContext(
  b: Block,
  context: NonNullable<ReturnType<typeof articleContextFor>>,
) {
  const { r, prefix, start, end } = context;
  const original = prefix + r.alternatives![0];
  const updated = {
    ...r,
    article: true,
    alternatives: [original, ...r.alternatives!.slice(1)],
  };
  updated.alternatives = updated.alternatives.map((text) =>
    contextualWording(updated, text),
  );
  updated.text = updated.alternatives[updated.choice ?? 0];
  replaceRange(b, start, end, [updated]);
  return updated;
}

export function compactRuns(runs: Run[]) {
  const result: Run[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const previous = result.at(-1);
    if (
      previous &&
      !previous.alternatives &&
      !r.alternatives &&
      Boolean(previous.dim) === Boolean(r.dim)
    )
      previous.text += r.text;
    else result.push(r);
  }
  return result.length ? result : [run()];
}

// Slicing part of an alternative detaches that fragment; intact alternatives survive.
export function sliceRuns(runs: Run[], start: number, end: number) {
  const result: Run[] = [];
  let offset = 0;
  for (const r of runs) {
    const a = Math.max(0, start - offset),
      z = Math.min(r.text.length, end - offset);
    if (z > a)
      result.push(
        a === 0 && z === r.text.length
          ? structuredClone(r)
          : run(r.text.slice(a, z), { dim: Boolean(r.dim) }),
      );
    offset += r.text.length;
  }
  return result;
}
export function replaceRange(
  b: Block,
  start: number,
  end: number,
  replacement: Run[],
) {
  const length = plain(b).length;
  if (start < 0 || end < start || end > length)
    throw new Error("Invalid selection");
  b.runs = compactRuns([
    ...sliceRuns(b.runs, 0, start),
    ...replacement,
    ...sliceRuns(b.runs, end, length),
  ]);
  return b;
}
export function insertText(
  draft: Draft,
  selection: TextSelection,
  text: string,
) {
  const index = draft.blocks.findIndex((b) => b.id === selection.blockId);
  if (index < 0) return null;
  const b = draft.blocks[index];
  if (!selection.endBlockId && !text.includes("\n")) {
    let offset = 0;
    for (const r of b.runs) {
      const end = offset + r.text.length;
      if (
        r.alternatives &&
        selection.start >= offset &&
        selection.end <= end &&
        (selection.start !== selection.end ||
          (selection.start > offset && selection.start < end))
      ) {
        const value =
          r.text.slice(0, selection.start - offset) +
          text +
          r.text.slice(selection.end - offset);
        if (value) {
          r.text = value;
          r.alternatives![r.choice ?? 0] = value;
          return {
            blockId: b.id,
            start: selection.start + text.length,
            end: selection.start + text.length,
          };
        }
      }
      offset = end;
    }
  }
  if (selection.endBlockId && selection.endBlockId !== selection.blockId) {
    const endIndex = draft.blocks.findIndex(
      (item) => item.id === selection.endBlockId,
    );
    if (endIndex < index) throw new Error("Invalid selection");
    const tail = sliceRuns(
      draft.blocks[endIndex].runs,
      selection.end,
      plain(draft.blocks[endIndex]).length,
    );
    b.runs = [...sliceRuns(b.runs, 0, selection.start), ...tail];
    if (!b.runs.length) b.runs = [run()];
    draft.blocks.splice(index + 1, endIndex - index);
    selection = { blockId: b.id, start: selection.start, end: selection.start };
  }
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const before = sliceRuns(b.runs, 0, selection.start);
  const after = sliceRuns(b.runs, selection.end, plain(b).length);
  if (lines.length === 1) {
    b.runs = compactRuns([...before, run(lines[0]), ...after]);
    return {
      blockId: b.id,
      start: selection.start + text.length,
      end: selection.start + text.length,
    };
  }
  const replacements = lines.map((line, i) => ({
    id: i === 0 ? b.id : uid(),
    runs: compactRuns([
      ...(i === 0 ? before : []),
      run(line),
      ...(i === lines.length - 1 ? after : []),
    ]),
  }));
  draft.blocks.splice(index, 1, ...replacements);
  return {
    blockId: replacements.at(-1)!.id,
    start: lines.at(-1)!.length,
    end: lines.at(-1)!.length,
  };
}
export function newDraft(title = "Untitled", text = ""): Draft {
  return {
    id: uid(),
    title,
    blocks: text.split("\n\n").map(block),
    overflow: [],
    updated: Date.now(),
  };
}
export function sampleDraft() {
  const d = newDraft(
    "A little room to think",
    "The best ideas rarely arrive fully formed. They need a little room to breathe, a few wrong turns, and the freedom to become something unexpected.\n\nI used to think that writing was about finding the right words. Now I think it’s about staying with a thought long enough to discover what I actually mean.\n\nSome sentences are stepping stones. You need them to get somewhere, even if they don’t belong in the finished piece. Keep them close. You might come back.\n\nSo here’s to the unfinished thought. The second version. The word you haven’t found yet.\n\nLeave a little room.",
  );
  const first = plain(d.blocks[0]);
  const start = first.indexOf("a little room to breathe");
  replaceRange(d.blocks[0], start, start + "a little room to breathe".length, [
    run("a little room to breathe", {
      alternatives: [
        "a little room to breathe",
        "time to find their shape",
        "space to surprise you",
      ],
      choice: 0,
    }),
  ]);
  const second = plain(d.blocks[1]);
  const s = second.indexOf("staying with a thought");
  replaceRange(d.blocks[1], s, s + "staying with a thought".length, [
    run("staying with a thought", {
      alternatives: [
        "staying with a thought",
        "following your curiosity",
        "paying closer attention",
      ],
      choice: 0,
    }),
  ]);
  d.overflow.push({
    id: uid(),
    text: "An idea for later: the things we cross out are part of the work, too.",
  });
  return d;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
export function validateDraft(data: unknown): Draft {
  if (
    !record(data) ||
    typeof data.title !== "string" ||
    !Array.isArray(data.blocks) ||
    !data.blocks.length ||
    data.blocks.length > 5000 ||
    !Array.isArray(data.overflow)
  )
    throw new Error("This is not a write_better. backup.");
  const d = newDraft(data.title.slice(0, 300));
  d.blocks = data.blocks.map((b: unknown) => {
    if (!record(b) || !Array.isArray(b.runs) || !b.runs.length)
      throw new Error("Invalid draft paragraphs.");
    return {
      id: uid(),
      runs: b.runs.map((r: unknown) => {
        if (!record(r) || typeof r.text !== "string")
          throw new Error("Invalid draft text.");
        const value = run(r.text, { dim: Boolean(r.dim) });
        if (r.alternatives !== undefined) {
          if (
            !Array.isArray(r.alternatives) ||
            !r.alternatives.length ||
            !r.alternatives.every((a: unknown) => typeof a === "string") ||
            typeof r.choice !== "number" ||
            !Number.isInteger(r.choice) ||
            r.choice < 0 ||
            r.choice >= r.alternatives.length ||
            r.alternatives[r.choice] !== r.text
          )
            throw new Error("Invalid alternatives.");
          value.alternatives = [...r.alternatives];
          value.choice = r.choice;
          value.article = Boolean(r.article);
        }
        return value;
      }),
    };
  });
  d.overflow = data.overflow.map((item: unknown) => {
    if (!record(item) || typeof item.text !== "string")
      throw new Error("Invalid overflow.");
    return { id: uid(), text: item.text };
  });
  return d;
}

export function fromMarkdown(text: string) {
  const normalized = text.replace(/\r\n?/g, "\n");
  const heading = normalized.match(/^# ([^\n]*)(?:\n\n|\n|$)/);
  // Export adds exactly one terminal newline; preserve all other code indentation/spacing.
  const body = heading ? normalized.slice(heading[0].length) : normalized;
  return newDraft(
    heading ? heading[1] : "Imported draft",
    body.endsWith("\n") ? body.slice(0, -1) : body,
  );
}
export function toMarkdown(d: Draft) {
  return `# ${d.title}\n\n${draftText(d)}\n`;
}

export function inspectDraft(d: Draft, kind: "long" | "filler") {
  const findings = [];
  for (const b of d.blocks) {
    const text = plain(b);
    if (kind === "long") {
      for (const match of text.matchAll(/[^.!?]+[.!?]*/g)) {
        const count = wordCount(match[0]);
        if (count > 28)
          findings.push({
            blockId: b.id,
            start: match.index,
            end: match.index + match[0].length,
            text: match[0].trim(),
            reason: `${count} words · try a natural pause`,
          });
      }
    } else {
      for (const match of text.matchAll(
        /\b(very|really|just|perhaps|basically|actually|in order to|a little bit|I think|sort of|kind of)\b/gi,
      ))
        findings.push({
          blockId: b.id,
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
          reason: "Possible filler · keep it if it carries your voice",
        });
    }
  }
  return findings;
}

export function locateRun(draft: Draft, id: string): TextSelection | null {
  for (const b of draft.blocks) {
    let start = 0;
    for (const r of b.runs) {
      if (r.id === id)
        return { blockId: b.id, start, end: start + r.text.length };
      start += r.text.length;
    }
  }
  return null;
}
export function selectedText(
  draft: Draft,
  selection: TextSelection | null,
): string {
  if (!selection) return "";
  const first = draft.blocks.findIndex((b) => b.id === selection.blockId);
  const last = selection.endBlockId
    ? draft.blocks.findIndex((b) => b.id === selection.endBlockId)
    : first;
  if (first < 0 || last < first) return "";
  return draft.blocks
    .slice(first, last + 1)
    .map((b, i, all) =>
      plain(b).slice(
        i === 0 ? selection.start : 0,
        i === all.length - 1 ? selection.end : undefined,
      ),
    )
    .join("\n\n");
}
export function selectionContext(draft: Draft, selection: TextSelection) {
  const text = plain(draft.blocks.find((b) => b.id === selection.blockId)!);
  return {
    before: text.slice(0, selection.start).slice(-6000),
    after: text.slice(selection.end).slice(0, 6000),
  };
}
