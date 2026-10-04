import test from "node:test";
import assert from "node:assert/strict";
import {
  run,
  block,
  plain,
  replaceRange,
  insertText,
  newDraft,
  sampleDraft,
  validateDraft,
  fromMarkdown,
  toMarkdown,
  inspectDraft,
  createAlternative,
  contextualWording,
  chooseAlternative,
  indefiniteArticle,
  articleContextFor,
  attachArticleContext,
} from "../src/model.ts";

test("changing a selected phrase preserves text and other alternatives", () => {
  const b = block("One good thought leads to another.");
  const alt = run("good", { alternatives: ["good", "small"], choice: 0 });
  replaceRange(b, 4, 8, [alt]);
  replaceRange(b, 9, 16, [run("idea")]);
  assert.equal(plain(b), "One good idea leads to another.");
  assert.equal(b.runs[1].id, alt.id);
  assert.deepEqual(b.runs[1].alternatives, ["good", "small"]);
});
test("typing within an alternative updates that choice and preserves the other choices", () => {
  const d = newDraft("Test", "");
  d.blocks[0].runs = [
    run("a "),
    run("good thought", {
      alternatives: ["good thought", "great idea"],
      choice: 0,
    }),
  ];
  insertText(d, { blockId: d.blocks[0].id, start: 6, end: 6 }, " little");
  assert.equal(plain(d.blocks[0]), "a good little thought");
  assert.deepEqual(d.blocks[0].runs[1].alternatives, [
    "good little thought",
    "great idea",
  ]);
});
test("splitting paragraphs keeps marked text outside the split", () => {
  const d = newDraft("Test");
  const alt = run("world", { alternatives: ["world", "earth"], choice: 0 });
  d.blocks[0].runs = [run("Hello "), alt];
  const next = insertText(
    d,
    { blockId: d.blocks[0].id, start: 6, end: 6 },
    "\n",
  );
  assert.deepEqual(d.blocks.map(plain), ["Hello ", "world"]);
  assert.equal(d.blocks[1].runs.at(-1).id, alt.id);
  assert.equal(next.blockId, d.blocks[1].id);
  assert.equal(next.start, 0);
});
test("paste replaces a selection with multiple paragraphs and preserves its suffix", () => {
  const d = newDraft("Test", "Hello world!");
  const next = insertText(
    d,
    { blockId: d.blocks[0].id, start: 6, end: 11 },
    "first\nsecond",
  );
  assert.deepEqual(d.blocks.map(plain), ["Hello first", "second!"]);
  assert.equal(next.start, 6);
});
test("cross-paragraph replacement preserves outside text", () => {
  const d = newDraft("Test", "First paragraph\n\nMiddle\n\nLast paragraph");
  insertText(
    d,
    { blockId: d.blocks[0].id, start: 6, endBlockId: d.blocks[2].id, end: 4 },
    "new",
  );
  assert.deepEqual(d.blocks.map(plain), ["First new paragraph"]);
});
test("delete all leaves an editable empty block", () => {
  const d = newDraft("Test", "First\n\nLast");
  insertText(
    d,
    { blockId: d.blocks[0].id, start: 0, endBlockId: d.blocks[1].id, end: 4 },
    "",
  );
  assert.equal(d.blocks.length, 1);
  assert.equal(plain(d.blocks[0]), "");
  assert.ok(d.blocks[0].runs.length);
});
test("backup roundtrip retains alternatives, chosen text, dimming and Overflow", () => {
  const d = sampleDraft();
  const r = d.blocks[0].runs.find((r) => r.alternatives);
  r.choice = 2;
  r.text = r.alternatives[2];
  r.dim = true;
  const restored = validateDraft(JSON.parse(JSON.stringify(d)));
  assert.equal(restored.title, d.title);
  assert.deepEqual(restored.blocks.map(plain), d.blocks.map(plain));
  assert.deepEqual(
    restored.blocks[0].runs.find((r) => r.alternatives).alternatives,
    r.alternatives,
  );
  assert.equal(restored.blocks[0].runs.find((r) => r.alternatives).dim, true);
  assert.equal(restored.overflow[0].text, d.overflow[0].text);
  assert.notEqual(restored.id, d.id);
});
test("invalid backups are rejected before replacing user data", () => {
  assert.throws(() =>
    validateDraft({ title: "Bad", blocks: [], overflow: [] }),
  );
  const d = sampleDraft();
  d.blocks[0].runs.find((r) => r.alternatives).choice = 55;
  assert.throws(() => validateDraft(d));
});
test("Markdown export contains current wording; import retains title and text", () => {
  const d = newDraft("My draft", "First paragraph\n\nSecond paragraph");
  const restored = fromMarkdown(toMarkdown(d));
  assert.equal(restored.title, d.title);
  assert.deepEqual(restored.blocks.map(plain), d.blocks.map(plain));
});
test("Lab detects complete filler words and long sentences at the right offsets", () => {
  const d = newDraft(
    "Test",
    `Very good. Unjust wording. ${Array(30).fill("word").join(" ")}.`,
  );
  const filler = inspectDraft(d, "filler");
  assert.equal(filler.length, 1);
  assert.equal(filler[0].text, "Very");
  const findings = inspectDraft(d, "long");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].text, `${Array(30).fill("word").join(" ")}.`);
  assert.equal(
    plain(d.blocks[0]).slice(findings[0].start, findings[0].end).trim(),
    findings[0].text,
  );
});

test("dog to animal includes its preceding article, and switching back restores a dog", () => {
  const b = block("I saw a dog sleeping.");
  const start = plain(b).indexOf("dog");
  const r = createAlternative(b, start, start + 3);
  assert.equal(r.text, "a dog");
  assert.equal(r.article, true);
  r.alternatives.push(contextualWording(r, "animal"));
  chooseAlternative(r, 1);
  assert.equal(plain(b), "I saw an animal sleeping.");
  chooseAlternative(r, 0);
  assert.equal(plain(b), "I saw a dog sleeping.");
});
test("article agreement handles common sound exceptions, initials, quotes and capitals", () => {
  for (const [text, expected] of [
    ["hour", "an"],
    ["honest person", "an"],
    ["university", "a"],
    ["unique idea", "a"],
    ["umbrella", "an"],
    ["European", "a"],
    ["one-off", "a"],
    ["MRI", "an"],
    ["USB", "a"],
    ['"animal"', "an"],
  ])
    assert.equal(indefiniteArticle(text), expected, text);
  const b = block("A dog runs.");
  const r = createAlternative(b, 2, 5);
  assert.equal(contextualWording(r, "animal"), "An animal");
  assert.equal(contextualWording(r, "a hour"), "An hour");
  assert.equal(contextualWording(r, "the animal"), "the animal");
});
test("a neighbouring marked phrase is never swallowed as article context", () => {
  const b = block();
  b.runs = [
    run("It is a ", { alternatives: ["It is a ", "Here is a "], choice: 0 }),
    run("dog."),
  ];
  const r = createAlternative(b, 8, 11);
  assert.equal(r.text, "dog");
  assert.equal(r.article, false);
  assert.equal(b.runs[0].alternatives.length, 2);
});
test("article metadata survives backup and import", () => {
  const d = newDraft("Example", "a dog");
  createAlternative(d.blocks[0], 2, 5);
  const restored = validateDraft(JSON.parse(JSON.stringify(d)));
  const r = restored.blocks[0].runs[0];
  assert.equal(contextualWording(r, "animal"), "an animal");
});
test("existing word alternatives acquire article context without losing choices", () => {
  const b = block();
  const r = run("animal", { alternatives: ["dog", "animal"], choice: 1 });
  b.runs = [run("A "), r, run(".")];
  const updated = attachArticleContext(b, articleContextFor(b, r.id));
  assert.equal(plain(b), "An animal.");
  assert.deepEqual(updated.alternatives, ["A dog", "An animal"]);
  assert.equal(updated.id, r.id);
  chooseAlternative(updated, 0);
  assert.equal(plain(b), "A dog.");
});
test("whole-sentence alternatives are not forced to begin with an article", () => {
  const b = block("A dog ran down the street.");
  const r = createAlternative(b, 0, plain(b).length);
  assert.equal(
    contextualWording(r, "Dogs ran down the street."),
    "Dogs ran down the street.",
  );
});
