import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { ViteDevServer } from "vite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { aiConfig, clearAIStatus, generateSuggestions } from "./ai";
import { createChatGPTConnection } from "./chatgpt-connection";
import { databasePath, getNotebookStore, notebookAPI } from "./notebook-api";

const port = Number(process.env.PORT || 4317);
const root = fileURLToPath(new URL("../dist/", import.meta.url));
let vite: ViteDevServer | undefined;
let aiBusy = false;
const chatGPT = createChatGPTConnection({ onConnected: clearAIStatus });
process.once("exit", () => chatGPT.cancel());

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'${vite ? " 'unsafe-inline'" : ""}; style-src 'self'${vite ? " 'unsafe-inline'" : ""}; connect-src 'self'${vite ? " ws://127.0.0.1:* ws://localhost:*" : ""}; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  );
  // This is a local application: reject DNS rebinding and cross-origin API calls.
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(req.headers.host || ""))
    return reply(res, 403, { error: "Local access only." });
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/api/health" && req.method === "GET") {
    return reply(res, 200, { app: "write-better" });
  }
  if (
    url.pathname === "/api/notebook" ||
    url.pathname === "/api/notebook/import"
  ) {
    await notebookAPI(req, res, getNotebookStore());
    return;
  }
  if (url.pathname === "/api/config" && req.method === "GET") {
    return reply(res, 200, await aiConfig());
  }
  if (url.pathname.startsWith("/api/chatgpt/")) {
    // Login can change local credentials: require a same-origin JSON request.
    // Status also includes a temporary sign-in URL, so reject cross-site reads.
    if (
      req.headers["sec-fetch-site"] === "cross-site" ||
      (req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}`) ||
      (req.method !== "GET" &&
        (req.headers.origin !== `http://${req.headers.host}` ||
          !req.headers["content-type"]?.startsWith("application/json")))
    )
      return reply(res, 403, {
        error: "Open write_better. locally to connect ChatGPT.",
      });
    if (url.pathname === "/api/chatgpt/connection" && req.method === "GET")
      return reply(res, 200, chatGPT.status());
    if (url.pathname === "/api/chatgpt/connect" && req.method === "POST")
      return reply(res, 200, await chatGPT.start());
    if (url.pathname === "/api/chatgpt/cancel" && req.method === "POST")
      return reply(res, 200, chatGPT.cancel());
    return reply(res, 404, { error: "Not found." });
  }
  if (url.pathname === "/api/suggest" && req.method === "POST") {
    if (
      req.headers.origin !== `http://${req.headers.host}` ||
      !req.headers["content-type"]?.startsWith("application/json")
    ) {
      return reply(res, 403, {
        error: "Open write_better. locally to use the Lab.",
      });
    }
    if (aiBusy)
      return reply(res, 429, {
        error: "One suggestion is already in progress. Try again shortly.",
      });
    aiBusy = true;
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 64000) {
          reply(res, 413, {
            error: "Select a shorter passage (up to 12,000 characters).",
          });
          return;
        }
      }
      let input;
      try {
        input = JSON.parse(body);
      } catch {
        return reply(res, 400, { error: "Invalid request." });
      }
      const {
        text,
        mode,
        provider = "codex",
        before = "",
        after = "",
      } = input || {};
      if (
        typeof text !== "string" ||
        !text.trim() ||
        text.length > 12000 ||
        !["alternatives", "trim", "tighten", "half", "proofread"].includes(
          mode,
        ) ||
        !["codex", "api"].includes(provider) ||
        typeof before !== "string" ||
        typeof after !== "string" ||
        before.length > 6000 ||
        after.length > 6000
      ) {
        return reply(res, 400, {
          error: "Select a passage of up to 12,000 characters.",
        });
      }
      return reply(res, 200, {
        suggestions: await generateSuggestions({
          text,
          mode,
          provider,
          before,
          after,
        }),
      });
    } catch (error) {
      return reply(res, 502, {
        error:
          error instanceof Error && error.name === "TimeoutError"
            ? "AI took too long. Your writing is safe; try again."
            : error instanceof Error
              ? error.message
              : "Could not get a usable suggestion. Your writing is unchanged.",
      });
    } finally {
      aiBusy = false;
    }
  }
  if (vite) {
    // Vite's filesystem access is restricted to this project and never serves .env files.
    vite.middlewares(req, res, () => reply(res, 404, { error: "Not found." }));
    return;
  }
  const pathname = url.pathname;
  const file =
    pathname === "/"
      ? "index.html"
      : pathname === "/favicon.svg"
        ? "favicon.svg"
        : /^\/assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(pathname)
          ? pathname.slice(1)
          : null;
  if (req.method !== "GET" || !file)
    return reply(res, 404, { error: "Not found." });
  const type = file.endsWith(".html")
    ? "text/html"
    : file.endsWith(".js")
      ? "text/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : "image/svg+xml";
  try {
    const data = await readFile(join(root, file));
    res.writeHead(200, {
      "Content-Type": `${type}; charset=utf-8`,
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    reply(res, 404, { error: "App build not found. Run npm run build." });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  getNotebookStore();
  console.log(`Notebook database: ${databasePath}`);
  if (process.argv.includes("--dev")) {
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { host: "127.0.0.1" },
        fs: {
          strict: true,
          deny: [
            ".env",
            ".env.*",
            "*.{crt,pem}",
            "**/.git/**",
            "**/data/**",
            "**/*.sqlite*",
            "**/*.db*",
          ],
          allow: [fileURLToPath(new URL("../", import.meta.url))],
        },
      },
      appType: "spa",
    });
  }
  http
    .createServer((req, res) =>
      handle(req, res).catch(() => {
        if (!res.headersSent)
          reply(res, 500, { error: "Unexpected server error." });
        else res.end();
      }),
    )
    .listen(port, "127.0.0.1", () =>
      console.log(`write_better. is ready at http://127.0.0.1:${port}`),
    );
}
