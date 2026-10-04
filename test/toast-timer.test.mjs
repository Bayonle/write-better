import test from "node:test";
import assert from "node:assert/strict";
import { createToastTimer } from "../src/toast-timer.ts";

test("toasts keep their remaining reading time while hidden or hovered", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let dismissed = 0;
  const timer = createToastTimer(5000, () => dismissed++);
  t.mock.timers.tick(2000);
  timer.pause("hidden");
  timer.pause("hover");
  t.mock.timers.tick(30000);
  timer.resume("hidden");
  t.mock.timers.tick(30000);
  assert.equal(dismissed, 0);
  timer.resume("hover");
  t.mock.timers.tick(2999);
  assert.equal(dismissed, 0);
  t.mock.timers.tick(1);
  assert.equal(dismissed, 1);
  timer.resume("hover");
  t.mock.timers.tick(10000);
  assert.equal(dismissed, 1);
});

test("repeated pause events do not consume time or restart a timer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let dismissed = false;
  const timer = createToastTimer(9000, () => (dismissed = true));
  t.mock.timers.tick(1000);
  timer.pause("focus");
  t.mock.timers.tick(1000);
  timer.pause("focus");
  timer.resume("unrelated");
  timer.resume("focus");
  t.mock.timers.tick(7999);
  assert.equal(dismissed, false);
  t.mock.timers.tick(1);
  assert.equal(dismissed, true);
});

test("replaced and unmounted toast timers cannot dismiss the next message", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let dismissed = 0;
  const old = createToastTimer(5000, () => dismissed++);
  t.mock.timers.tick(1000);
  old.dispose();
  old.pause("hidden");
  old.resume("hidden");
  const current = createToastTimer(5000, () => dismissed++);
  t.mock.timers.tick(4000);
  assert.equal(dismissed, 0);
  current.pause("dialog");
  current.dispose();
  t.mock.timers.tick(10000);
  assert.equal(dismissed, 0);
});
