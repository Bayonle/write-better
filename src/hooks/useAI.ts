import { useEffect, useRef, useState } from "react";
import type { AIConfig, AIInput, Provider } from "../types";
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
  async function connect() {
    setConnecting(true);
    try {
      const response = await fetch("/api/config");
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
  }, []);
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
    pending,
    connect,
    request,
  };
}
export type AI = ReturnType<typeof useAI>;
