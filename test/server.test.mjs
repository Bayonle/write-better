import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { handle } from "../server/index.ts";

test("local server serves the app without exposing keys or arbitrary files", async () => {
  const server = http.createServer(handle).listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const request = (path, headers = {}) =>
    new Promise((resolve, reject) => {
      http
        .get(
          {
            host: "127.0.0.1",
            port,
            path,
            headers: { host: "127.0.0.1:4317", ...headers },
          },
          (res) => {
            let body = "";
            res.on("data", (c) => (body += c));
            res.on("end", () =>
              resolve({ status: res.statusCode, body, headers: res.headers }),
            );
          },
        )
        .on("error", reject);
    });
  try {
    const home = await request("/");
    assert.equal(home.status, 200);
    assert.match(home.body, /write_better/);
    assert.match(
      home.headers["content-security-policy"],
      /frame-ancestors 'none'/,
    );
    const config = await request("/api/config");
    const settings = JSON.parse(config.body);
    assert.deepEqual(Object.keys(settings), [
      "ai",
      "providers",
      "defaultProvider",
    ]);
    assert.deepEqual(Object.keys(settings.providers), ["codex", "api"]);
    assert.equal(typeof settings.providers.codex, "boolean");
    assert.equal((await request("/.env")).status, 404);
    assert.equal((await request("/../server/index.ts")).status, 404);
    assert.equal(
      (await request("/", { host: "evil.example:4317" })).status,
      403,
    );
    const result = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/api/suggest",
          method: "POST",
          headers: {
            host: "127.0.0.1:4317",
            origin: "https://evil.example",
            "content-type": "application/json",
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end("{}");
    });
    assert.equal(result, 403);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("ChatGPT login endpoints reject cross-origin mutations and status reads", async () => {
  const server = http.createServer(handle).listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const request = (path, method, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path,
          method,
          headers: { host: "127.0.0.1:4317", ...headers },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode, body }));
        },
      );
      req.on("error", reject);
      req.end(method === "POST" ? "{}" : undefined);
    });
  try {
    for (const endpoint of ["connect", "cancel"]) {
      assert.equal(
        (await request(`/api/chatgpt/${endpoint}`, "POST")).status,
        403,
      );
      assert.equal(
        (
          await request(`/api/chatgpt/${endpoint}`, "POST", {
            origin: "https://evil.example",
            "content-type": "application/json",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(`/api/chatgpt/${endpoint}`, "POST", {
            origin: "http://127.0.0.1:4317",
            "content-type": "text/plain",
          })
        ).status,
        403,
      );
      assert.equal(
        (await request(`/api/chatgpt/${endpoint}`, "GET")).status,
        404,
      );
    }
    assert.equal(
      (
        await request("/api/chatgpt/connection", "GET", {
          "sec-fetch-site": "cross-site",
        })
      ).status,
      403,
    );
    const status = await request("/api/chatgpt/connection", "GET");
    assert.equal(status.status, 200);
    assert.deepEqual(JSON.parse(status.body), { status: "idle" });
    const cancelled = await request("/api/chatgpt/cancel", "POST", {
      origin: "http://127.0.0.1:4317",
      "content-type": "application/json",
    });
    assert.deepEqual(JSON.parse(cancelled.body), { status: "idle" });
  } finally {
    server.close();
    await once(server, "close");
  }
});
