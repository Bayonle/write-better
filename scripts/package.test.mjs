import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

test(
  "download bundle runs without node_modules and keeps drafts across restarts",
  { timeout: 30000 },
  async () => {
    const root = fileURLToPath(
      new URL(
        `../release/write-better-${process.platform}-${process.arch}/`,
        import.meta.url,
      ),
    );
    const binary = join(
      root,
      "runtime",
      process.platform === "win32" ? "node.exe" : "node",
    );
    await access(binary);
    await assert.rejects(access(join(root, "node_modules")));
    await assert.rejects(access(join(root, "data")));
    await assert.rejects(access(join(root, ".env")));
    const temporary = await mkdtemp(join(tmpdir(), "write-better-package-"));
    const codex = join(
      root,
      "runtime",
      "codex",
      "bin",
      process.platform === "win32" ? "codex.exe" : "codex",
    );
    await access(join(root, "runtime", "codex", "LICENSE"));
    await access(join(root, "runtime", "codex", "NOTICE"));
    const version = await promisify(execFile)(codex, ["--version"], {
      env: { ...process.env, PATH: "" },
      timeout: 10000,
    });
    assert.match(version.stdout, /codex-cli 0\.142\.4/);
    const socket = net.createServer().listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const url = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      PORT: String(port),
      WRITE_ON_DB_PATH: join(temporary, "notebook.sqlite"),
      WRITE_BETTER_NO_OPEN: "1",
      CODEX_HOME: join(temporary, "codex"),
    };
    let child;
    let output = "";
    const start = async () => {
      child = spawn(binary, [join(root, "launcher.mjs")], {
        env,
        cwd: temporary,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error(output);
        try {
          const health = await fetch(`${url}/api/health`);
          if (health.ok && (await health.json()).app === "write-better") return;
        } catch {}
        await delay(100);
      }
      throw new Error(`Packaged app failed to start: ${output}`);
    };
    const stop = async () => {
      if (!child || child.exitCode !== null) return;
      // On Windows, taskkill also closes the launched server process.
      const closed = once(child, "exit");
      if (process.platform === "win32") {
        const killer = spawn("taskkill", [
          "/pid",
          String(child.pid),
          "/t",
          "/f",
        ]);
        await once(killer, "exit");
      } else child.kill("SIGTERM");
      await closed;
    };
    try {
      await start();
      assert.match(await (await fetch(url)).text(), /write_better/);
      const snapshot = await (await fetch(`${url}/api/notebook`)).json();
      assert.equal(snapshot.book, null);
      const book = {
        version: 1,
        currentId: "draft",
        docs: [
          {
            id: "draft",
            title: "Package smoke test",
            updated: Date.now(),
            blocks: [
              {
                id: "paragraph",
                runs: [{ id: "wording", text: "A lasting thought." }],
              },
            ],
            overflow: [],
          },
        ],
      };
      const saved = await fetch(`${url}/api/notebook`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Origin: url },
        body: JSON.stringify({ ...snapshot, book }),
      });
      assert.equal(saved.status, 200);
      await stop();
      await start();
      const restored = await (await fetch(`${url}/api/notebook`)).json();
      assert.equal(restored.book.docs[0].title, "Package smoke test");
      assert.equal(
        restored.book.docs[0].blocks[0].runs[0].text,
        "A lasting thought.",
      );
      // Double-launch should reuse the running app and exit cleanly.
      const duplicate = spawn(binary, [join(root, "launcher.mjs")], {
        env,
        cwd: temporary,
        stdio: "ignore",
      });
      const [code] = await once(duplicate, "exit");
      assert.equal(code, 0);
    } finally {
      await stop();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
