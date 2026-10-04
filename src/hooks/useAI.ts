import { useEffect, useRef, useState } from "react";
import type { AIConfig, AIInput, ChatGPTConnection, Provider } from "../types";
export function useAI() {
  const [provider, setProvider] = useState<Provider>(() => {
    try {
      return localStorage.getItem("write-on.ai-provider") === "api"
        ? "api"
        : "codex";
    } catch {
      return "codex";
    }
  });
  const [config, setConfig] = useState<AIConfig | null>(null);
  const [connecting, setConnecting] = useState(false),
    [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [connection, setConnection] = useState<ChatGPTConnection>({
    status: "idle",
  });
  const loginBusy = useRef(false);
  const loginAttempt = useRef(0);
  async function connect() {
    setConnecting(true);
    try {
      const response = await fetch("/api/config", {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error();
      setConfig(await response.json());
    } catch {
      setConfig(null);
    } finally {
      setConnecting(false);
    }
  }
  useEffect(() => {
    void connect();
    const controller = new AbortController();
    void fetch("/api/chatgpt/connection", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((status) => {
        if (!controller.signal.aborted && !loginBusy.current)
          setConnection(status);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (connection.status !== "waiting" && connection.status !== "starting")
      return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch("/api/chatgpt/connection", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        });
        if (!response.ok) throw new Error();
        const status: ChatGPTConnection = await response.json();
        if (stopped) return;
        setConnection(status);
        if (status.status === "connected") void connect();
        if (status.status === "waiting" || status.status === "starting")
          timer = setTimeout(poll, 1200);
      } catch {
        if (!stopped)
          setConnection({
            status: "error",
            message:
              "The connection check stopped. Try Connect ChatGPT again to continue.",
          });
      }
    }
    timer = setTimeout(poll, 1200);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [connection.status]);
  async function signIn() {
    if (loginBusy.current) return;
    loginBusy.current = true;
    const attempt = ++loginAttempt.current;
    // Open during the click so browsers don't block the later OAuth navigation.
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setConnection({ status: "starting" });
    try {
      const response = await fetch("/api/chatgpt/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error();
      const status: ChatGPTConnection = await response.json();
      if (attempt !== loginAttempt.current) {
        popup?.close();
        return;
      }
      setConnection(status);
      if (status.status === "waiting") {
        if (popup && !popup.closed) popup.location.href = status.authUrl;
      } else {
        popup?.close();
        if (status.status === "connected") await connect();
      }
    } catch {
      popup?.close();
      if (attempt === loginAttempt.current)
        setConnection({
          status: "error",
          message:
            "Could not start ChatGPT sign-in. Check that the app is running and try again.",
        });
    } finally {
      loginBusy.current = false;
    }
  }
  async function cancelSignIn() {
    ++loginAttempt.current;
    try {
      const response = await fetch("/api/chatgpt/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error();
      setConnection(await response.json());
    } catch {
      setConnection({
        status: "error",
        message:
          "Could not cancel sign-in. Close the sign-in tab; the request will expire automatically.",
      });
    }
  }
  async function request(input: Omit<AIInput, "provider">): Promise<string[]> {
    if (busy.current) throw new Error("One suggestion is already in progress.");
    busy.current = true;
    setPending(true);
    try {
      const response = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, provider }),
        signal: AbortSignal.timeout(100000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not get suggestions.");
      if (
        !Array.isArray(result.suggestions) ||
        !result.suggestions.every((item: unknown) => typeof item === "string")
      )
        throw new Error("Invalid suggestions.");
      return result.suggestions;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return {
    provider,
    chooseProvider: (value: Provider) => {
      setProvider(value);
      try {
        localStorage.setItem("write-on.ai-provider", value);
      } catch {
        /* UI remains usable without storage. */
      }
    },
    connected: Boolean(config?.providers[provider]),
    connecting,
    connection,
    signIn,
    cancelSignIn,
    pending,
    connect,
    request,
  };
}
export type AI = ReturnType<typeof useAI>;
