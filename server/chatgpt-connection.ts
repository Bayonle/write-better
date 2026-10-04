import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { tmpdir } from "node:os";
import type { ChatGPTConnection } from "../src/types";
import { codexBinary, codexEnvironment } from "./codex";

interface RPCResult {
  account?: { type?: string } | null;
  loginId?: string;
  authUrl?: string;
}

export function isChatGPTLoginURL(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["auth.openai.com", "auth0.openai.com", "chatgpt.com"].includes(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}

// A deliberately small authentication-only client. No RPC methods come from the browser.
export function createChatGPTConnection({
  launch = () =>
    spawn(codexBinary(), ["app-server", "--stdio"], {
      env: codexEnvironment(),
      cwd: tmpdir(),
      stdio: "pipe",
    }),
  onConnected = () => {},
  requestTimeout = 15000,
  loginTimeout = 10 * 60 * 1000,
}: {
  launch?: () => ChildProcessWithoutNullStreams;
  onConnected?: () => void;
  requestTimeout?: number;
  loginTimeout?: number;
} = {}) {
  let state: ChatGPTConnection = { status: "idle" };
  let active: { stop: () => void } | undefined;
  let starting: Promise<ChatGPTConnection> | undefined;

  function start() {
    if (starting) return starting;
    if (state.status === "waiting") return Promise.resolve(state);
    const operation = run();
    starting = operation;
    void operation.finally(() => {
      if (starting === operation) starting = undefined;
    });
    return operation;
  }

  async function run(): Promise<ChatGPTConnection> {
    state = { status: "starting" };
    let child: ChildProcessWithoutNullStreams;
    try {
      child = launch();
    } catch (error) {
      state = {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not start ChatGPT sign-in. Try again.",
      };
      return state;
    }
    let sequence = 0,
      buffer = "",
      loginId: string | undefined;
    const pending = new Map<
      number,
      {
        method: string;
        resolve: (value: RPCResult) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();
    const session = { stop: () => finish({ status: "idle" }) };
    active = session;
    const expiry = setTimeout(
      () =>
        finish({
          status: "error",
          message: "Sign-in expired. Connect ChatGPT again when you’re ready.",
        }),
      loginTimeout,
    );
    expiry.unref();
    function finish(next: ChatGPTConnection) {
      if (active !== session) return;
      active = undefined;
      state = next;
      clearTimeout(expiry);
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error("Sign-in stopped."));
      }
      pending.clear();
      child.kill();
      if (next.status === "connected") onConnected();
    }
    function send(message: object) {
      child.stdin.write(JSON.stringify(message) + "\n");
    }
    function request(method: string, params: object) {
      return new Promise<RPCResult>((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Sign-in did not respond. Please try again."));
        }, requestTimeout);
        pending.set(id, { method, resolve, reject, timer });
        send({ id, method, params });
      });
    }
    const fail = () =>
      finish({
        status: "error",
        message:
          "Could not finish ChatGPT sign-in. Check your connection and try again.",
      });
    child.on("error", fail);
    child.on("exit", fail);
    child.stdin.on("error", fail);
    // Never forward diagnostic output or authentication tokens to the browser/logs.
    child.stderr.resume();
    child.stdout.on("data", (chunk) => {
      if (active !== session) return;
      buffer += chunk.toString();
      if (buffer.length > 512000) return fail();
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          const item = pending.get(message.id);
          if (item) {
            pending.delete(message.id);
            clearTimeout(item.timer);
            if (message.error)
              item.reject(
                new Error(
                  "Could not start sign-in. Close any other pending ChatGPT sign-in and try again.",
                ),
              );
            else {
              // A completion notification can arrive in the same stdout chunk.
              if (
                item.method === "account/login/start" &&
                typeof message.result?.loginId === "string" &&
                isChatGPTLoginURL(message.result.authUrl)
              )
                loginId = message.result.loginId;
              item.resolve(message.result);
            }
          } else if (
            message.method === "account/login/completed" &&
            loginId &&
            message.params?.loginId === loginId
          ) {
            if (message.params.success === true)
              finish({ status: "connected" });
            else fail();
          }
        } catch {
          fail();
        }
      }
    });
    try {
      await request("initialize", {
        clientInfo: {
          name: "write_better",
          title: "write_better.",
          version: "0.2.0",
        },
      });
      if (active !== session) return state;
      send({ method: "initialized", params: {} });
      const account = await request("account/read", { refreshToken: false });
      if (active !== session) return state;
      if (account?.account?.type === "chatgpt") {
        finish({ status: "connected" });
        return state;
      }
      const login = await request("account/login/start", { type: "chatgpt" });
      if (active !== session) return state;
      if (
        typeof login?.loginId !== "string" ||
        !isChatGPTLoginURL(login.authUrl)
      )
        throw new Error(
          "ChatGPT returned an unexpected sign-in address. Please try again.",
        );
      loginId = login.loginId;
      state = { status: "waiting", authUrl: login.authUrl };
    } catch (error) {
      if (active === session)
        finish({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not start sign-in. Try again.",
        });
    }
    return state;
  }

  return {
    start,
    status: () => state,
    cancel: () => {
      active?.stop();
      return state;
    },
  };
}
