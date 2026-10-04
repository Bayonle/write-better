import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrompt,
  parseSuggestions,
  generateSuggestions,
} from "../server/ai.ts";

test("suggestion prompts contain bounded passage context as data", () => {
  const prompt = buildPrompt({
    text: "a dog",
    mode: "alternatives",
    before: "I saw ",
    after: " sleeping.",
  });
  assert.match(prompt, /"selected_text":"a dog"/);
  assert.match(prompt, /"before":"I saw "/);
  assert.match(prompt, /"after":" sleeping\."/);
  assert.match(prompt, /never repeat before or after/);
  assert.match(prompt, /Do not use tools/);
});
test("AI output parsing rejects malformed results and deduplicates valid suggestions", () => {
  assert.deepEqual(
    parseSuggestions('{"suggestions":[" an animal ","an animal","a puppy"]}'),
    ["an animal", "a puppy"],
  );
  for (const result of [
    "{}",
    '{"suggestions":[]}',
    '{"suggestions":[42]}',
    '{"suggestions":[""]}',
    "not JSON",
  ])
    assert.throws(() => parseSuggestions(result));
});
test("unrecognised AI providers and actions fail without starting a process or request", async () => {
  await assert.rejects(
    generateSuggestions({
      provider: "unknown",
      mode: "alternatives",
      text: "a dog",
    }),
    /valid AI source/,
  );
  await assert.rejects(
    generateSuggestions({ provider: "codex", mode: "execute", text: "a dog" }),
    /valid AI source/,
  );
});
