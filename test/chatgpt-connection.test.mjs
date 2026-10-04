import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import {
  createChatGPTConnection,
  isChatGPTLoginURL,
} from "../server/chatgpt-connection.ts";

function fixture({
  existing = false,
  url = "https://auth.openai.com/oauth/authorize?state=test",
  silent = false,
  loginError = false,
} = {}) {
  const child = new EventEmitter();
  const requests = [];
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  const emit = (message) => child.stdout.write(JSON.stringify(message) + "\n");
  child.stdin = new Writable({
    write(chunk, _encoding, done) {
      const request = JSON.parse(String(chunk));
      requests.push(request);
      if (request.id && !silent)
        queueMicrotask(() => {
          const result =
            request.method === "account/read"
              ? {
                  account: existing
                    ? { type: "chatgpt", email: "private@example.com" }
                    : null,
                }
              : request.method === "account/login/start"
                ? { loginId: "login-1", authUrl: url }
                : {};
          emit(
            loginError && request.method === "account/login/start"
              ? {
                  id: request.id,
                  error: { message: "private-token-must-not-escape" },
                }
              : { id: request.id, result },
          );
        });
      done();
    },
  });
  let launches = 0,
    connected = 0;
  const connection = createChatGPTConnection({
    launch: () => {
      launches++;
      return child;
    },
    onConnected: () => {
      connected++;
    },
    requestTimeout: 25,
    loginTimeout: 500,
  });
  return {
    child,
    requests,
    emit,
    connection,
    launches: () => launches,
    connected: () => connected,
  };
}

test("browser login initializes the official protocol, reuses pending requests, and completes automatically", async () => {
  const f = fixture();
  try {
    const [first, second] = await Promise.all([
      f.connection.start(),
      f.connection.start(),
    ]);
    assert.equal(first.status, "waiting");
    assert.deepEqual(second, first);
    assert.deepEqual(await f.connection.start(), first);
    assert.equal(f.launches(), 1);
    assert.deepEqual(
      f.requests.map((r) => r.method),
      ["initialize", "initialized", "account/read", "account/login/start"],
    );
    assert.equal(f.requests[3].params.type, "chatgpt");
    f.emit({
      method: "account/login/completed",
      params: { loginId: "wrong-attempt", success: true },
    });
    assert.equal(f.connection.status().status, "waiting");
    f.emit({
      method: "account/login/completed",
      params: { loginId: "login-1", success: true },
    });
    assert.deepEqual(f.connection.status(), { status: "connected" });
    assert.equal(f.connected(), 1);
    assert.equal(f.child.killed, true);
  } finally {
    f.connection.cancel();
  }
});
test("existing ChatGPT sign-in requires no login and exposes no account details", async () => {
  const f = fixture({ existing: true });
  assert.deepEqual(await f.connection.start(), { status: "connected" });
  assert.equal(
    f.requests.some((r) => r.method === "account/login/start"),
    false,
  );
  assert.equal(f.connected(), 1);
  assert.equal(f.child.killed, true);
});
test("cancel closes the pending login and late success cannot reconnect it", async () => {
  const f = fixture();
  await f.connection.start();
  assert.deepEqual(f.connection.cancel(), { status: "idle" });
  f.emit({
    method: "account/login/completed",
    params: { loginId: "login-1", success: true },
  });
  assert.deepEqual(f.connection.status(), { status: "idle" });
  assert.equal(f.child.killed, true);
  assert.equal(f.connected(), 0);
});
test("cancel during initialization cannot start a login afterwards", async () => {
  const f = fixture({ silent: true });
  const starting = f.connection.start();
  f.connection.cancel();
  assert.deepEqual(await starting, { status: "idle" });
  assert.equal(f.requests.length, 1);
});
test("failed and unresponsive helpers stop cleanly without leaking diagnostics", async () => {
  const failed = fixture({ loginError: true });
  const result = await failed.connection.start();
  assert.equal(result.status, "error");
  assert.doesNotMatch(JSON.stringify(result), /private-token/);
  assert.equal(failed.child.killed, true);
  const silent = fixture({ silent: true });
  const timeout = await silent.connection.start();
  assert.equal(timeout.status, "error");
  assert.match(timeout.message, /did not respond/);
  assert.equal(silent.child.killed, true);
});
test("pending login expires and removes its URL", async () => {
  const f = fixture();
  await f.connection.start();
  await delay(550);
  assert.equal(f.connection.status().status, "error");
  assert.match(f.connection.status().message, /expired/);
  assert.equal("authUrl" in f.connection.status(), false);
  assert.equal(f.child.killed, true);
});
test("only HTTPS OpenAI sign-in URLs reach the browser", async () => {
  for (const url of [
    "javascript:alert(1)",
    "http://auth.openai.com/",
    "https://auth.openai.com.evil.test/",
    "https://evil.test/",
    "https://user:pass@auth.openai.com/",
    "https://auth.openai.com:444/",
    null,
  ]) {
    assert.equal(isChatGPTLoginURL(url), false);
  }
  assert.equal(isChatGPTLoginURL("https://chatgpt.com/auth/login"), true);
  const f = fixture({ url: "https://evil.test/" });
  const result = await f.connection.start();
  assert.equal(result.status, "error");
  assert.equal("authUrl" in result, false);
  assert.equal(f.child.killed, true);
});
