import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMarkdownSource,
  formatMarkdown,
  renderMarkdown,
} from "../src/markdown.ts";
import {
  createAlternative,
  draftText,
  fromMarkdown,
  newDraft,
  plain,
  toMarkdown,
} from "../src/model.ts";

test("Markdown controls wrap selected wording and select placeholders or link destinations", () => {
  const bold = formatMarkdown("A good thought", 2, 6, "bold");
  assert.equal(bold.source, "A **good** thought");
  assert.equal(bold.source.slice(bold.start, bold.end), "good");
  assert.equal(
    formatMarkdown(bold.source, bold.start, bold.end, "bold").source,
    "A good thought",
  );
  const link = formatMarkdown("A thought", 2, 9, "link");
  assert.equal(link.source, "A [thought](https://example.com)");
  assert.equal(link.source.slice(link.start, link.end), "https://example.com");
});
test("block controls apply to complete selected lines and toggle prefixes", () => {
  assert.equal(
    formatMarkdown("First\nSecond\nThird", 0, 12, "number").source,
    "1. First\n2. Second\nThird",
  );
  assert.equal(
    formatMarkdown("First\nSecond", 6, 12, "h2").source,
    "First\n## Second",
  );
  assert.equal(formatMarkdown("## Second", 0, 9, "h2").source, "Second");
  assert.equal(formatMarkdown("Item", 0, 4, "task").source, "- [ ] Item");
  assert.equal(formatMarkdown("- [ ] Item", 0, 10, "task").source, "Item");
});
test("Markdown formatting and unrelated edits retain alternatives, ids, and dimming", () => {
  const d = newDraft("Test", "I saw a dog.\n\nA quiet day.");
  const r = createAlternative(d.blocks[0], 8, 11);
  r.alternatives.push("an animal");
  r.dim = true;
  const formatted = formatMarkdown(draftText(d), 6, 11, "bold");
  applyMarkdownSource(d, formatted.source);
  const mark = d.blocks.flatMap((b) => b.runs).find((item) => item.id === r.id);
  assert.deepEqual(mark.alternatives, ["a dog", "an animal"]);
  assert.equal(mark.dim, true);
  applyMarkdownSource(d, draftText(d) + "\n\n## A new section");
  assert.deepEqual(
    d.blocks[0].runs.find((item) => item.id === r.id).alternatives,
    r.alternatives,
  );
  assert.equal(
    draftText(d),
    "I saw **a dog**.\n\nA quiet day.\n\n## A new section",
  );
});
test("source typing inside an alternative updates only its current choice", () => {
  const d = newDraft("Test", "A good thought.");
  const r = createAlternative(d.blocks[0], 2, 6);
  r.alternatives.push("A fine");
  applyMarkdownSource(d, "A gooood thought.");
  const mark = d.blocks[0].runs.find((item) => item.id === r.id);
  assert.equal(mark.text, "A gooood");
  assert.deepEqual(mark.alternatives, ["A gooood", "A fine"]);
});
test("source roundtrips preserve code indentation, repeated blank lines, and trailing spaces", () => {
  const source = "## Hello\n\n```ts\n  const x = 1;\n\n\n  x;\n```\n\n  ";
  const d = newDraft("Roundtrip");
  applyMarkdownSource(d, source);
  assert.equal(draftText(d), source);
  assert.equal(draftText(fromMarkdown(toMarkdown(d))), source);
  assert.equal(fromMarkdown(toMarkdown(d)).title, "Roundtrip");
  applyMarkdownSource(d, "");
  assert.deepEqual(d.blocks.map(plain), [""]);
});
test("preview renders headings, emphasis, tables, tasks, and fenced code", () => {
  const html = renderMarkdown(
    "## Heading\n\n**Bold** and *italic* and ~~gone~~\n\n- [x] Done\n- [ ] Later\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```",
  );
  for (const pattern of [
    /<h2>Heading<\/h2>/,
    /<strong>Bold<\/strong>/,
    /<em>italic<\/em>/,
    /<s>gone<\/s>/,
    /type="checkbox" disabled aria-label="Complete task" checked/,
    /<table>/,
    /<code class="language-ts">/,
  ])
    assert.match(html, pattern);
});
test("preview escapes raw HTML and rejects script URLs without fetching remote images", () => {
  const html = renderMarkdown(
    "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n\n![remote](https://example.com/track.png)\n\n[good](https://example.com)",
  );
  assert.doesNotMatch(html, /<script|<img|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /Image: remote/);
});

test("repeated Markdown keystrokes keep plain runs compact", () => {
  const d = newDraft("Test", "Original text");
  for (const suffix of ["a", "ab", "abc", "abcd", "abcde"])
    applyMarkdownSource(d, "Original text " + suffix);
  assert.equal(draftText(d), "Original text abcde");
  assert.equal(d.blocks[0].runs.length, 1);
});
