import { useState } from "react";
import { inspectDraft } from "../model";
import { Dialog } from "./Dialog";
import type { AI } from "../hooks/useAI";
import type {
  AIMode,
  AITarget,
  Draft,
  Provider,
  TextSelection,
} from "../types";
export function Lab({
  draft,
  target,
  ai,
  onClose,
  onFinding,
  onKeep,
}: {
  draft: Draft;
  target: AITarget | null;
  ai: AI;
  onClose: () => void;
  onFinding: (selection: TextSelection) => void;
  onKeep: (text: string, target: AITarget) => void;
}) {
  const [findings, setFindings] = useState<ReturnType<
    typeof inspectDraft
  > | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]),
    [message, setMessage] = useState("");
  async function revise(mode: AIMode) {
    if (!target) return;
    setFindings(null);
    setSuggestions([]);
    setMessage("Trying another way to say it…");
    try {
      setSuggestions(
        await ai.request({
          text: target.text,
          mode,
          before: target.before,
          after: target.after,
        }),
      );
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not get suggestions.",
      );
    }
  }
  return (
    <Dialog title="The Lab" eyebrow="A SECOND LOOK" onClose={onClose}>
      <p className="dialog-intro">
        A few ways to see your writing differently.
        <br />
        You make the final call.
      </p>
      <div className="lab-section-label">
        LOOK CLOSER <span>Works offline</span>
      </div>
      {(["long", "filler"] as const).map((kind) => (
        <button
          key={kind}
          className="lab-action"
          onClick={() => {
            setFindings(inspectDraft(draft, kind));
            setSuggestions([]);
            setMessage("");
          }}
        >
          <span>
            <strong>
              {kind === "long"
                ? "Find the long sentences"
                : "Notice hedges & filler"}
            </strong>
            <small>
              {kind === "long"
                ? "A little breathing room goes a long way."
                : "Words that might be doing less than you think."}
            </small>
          </span>
          <span>↗</span>
        </button>
      ))}
      <div className="lab-section-label ai-section">
        TRY ANOTHER TAKE{" "}
        <span
          className={
            !ai.connected || ai.connecting ? "ai-disconnected" : undefined
          }
          role="status"
        >
          {ai.connecting
            ? "Checking connection"
            : ai.connected
              ? ai.provider === "codex"
                ? "ChatGPT connected"
                : "API connected"
              : ai.provider === "codex" && ai.connection.status === "waiting"
                ? "Finish sign-in"
                : ai.provider === "codex" && ai.connection.status === "starting"
                  ? "Opening sign-in"
                  : "Not connected"}
        </span>
      </div>
      <div className="ai-source">
        <label htmlFor="ai-provider">Use</label>
        <select
          id="ai-provider"
          value={ai.provider}
          onChange={(event) =>
            ai.chooseProvider(event.target.value as Provider)
          }
        >
          <option value="codex">ChatGPT subscription</option>
          <option value="api">OpenAI API (separate billing)</option>
        </select>
        {ai.provider === "codex" && !ai.connected ? (
          <button
            className="primary-button"
            disabled={
              ai.connecting ||
              ai.connection.status === "starting" ||
              ai.connection.status === "waiting"
            }
            onClick={() => void ai.signIn()}
          >
            {ai.connection.status === "starting"
              ? "Opening sign-in…"
              : ai.connection.status === "waiting"
                ? "Waiting for sign-in…"
                : "Connect ChatGPT"}
          </button>
        ) : (
          <button disabled={ai.connecting} onClick={() => void ai.connect()}>
            {ai.connecting ? "Checking…" : "Check connection"}
          </button>
        )}
      </div>
      <p className="dialog-note">
        {ai.provider === "codex"
          ? ai.connected
            ? "Uses your ChatGPT plan’s Codex allowance. Your selected text and nearby paragraph context are sent only when you ask."
            : "Sign in with ChatGPT in your browser. No terminal, separate installation, or API key needed. Uses your plan’s Codex allowance."
          : ai.connected
            ? "Uses your API key with separate API billing. Your selected text and nearby paragraph context are sent only when you ask."
            : "Add OPENAI_API_KEY to .env and restart to use the separately billed API option."}
      </p>
      {ai.provider === "codex" && !ai.connected && (
        <div className="chatgpt-connection" aria-live="polite">
          {ai.connection.status === "starting" && (
            <p>Preparing your secure sign-in…</p>
          )}
          {ai.connection.status === "waiting" && (
            <>
              <p>
                Finish signing in on the OpenAI page, then return here. This
                screen updates automatically.
              </p>
              <p className="connection-detail">
                The sign-in page may say Codex. That’s the OpenAI component
                included with write_better.
              </p>
              <div className="connection-actions">
                <a
                  href={ai.connection.authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open sign-in page ↗
                </a>
                <button
                  className="text-button"
                  onClick={() => void ai.cancelSignIn()}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
          {ai.connection.status === "error" && (
            <p role="alert">{ai.connection.message}</p>
          )}
        </div>
      )}
      <div className="ai-target">
        {target?.text ||
          "In Write mode, select a passage or place your cursor in a paragraph to try an AI revision."}
      </div>
      <div className="revision-options">
        {(
          [
            { mode: "proofread", name: "Proofread", detail: "Light touch" },
            { mode: "trim", name: "Slight trim", detail: "~10% shorter" },
            { mode: "tighten", name: "Tighten more", detail: "~25% shorter" },
            { mode: "half", name: "Cut in half", detail: "~50% shorter" },
          ] as const
        ).map((item) => (
          <button
            key={item.mode}
            disabled={!ai.connected || !target || ai.pending}
            onClick={() => void revise(item.mode)}
          >
            {item.name}
            <small>{item.detail}</small>
          </button>
        ))}
      </div>
      <div id="lab-results" aria-live="polite">
        {message && <p className="dialog-note">{message}</p>}
        {findings && (
          <>
            <p className="dialog-note">
              {findings.length
                ? `${findings.length} places to revisit. These are cues, not rules.`
                : "Nothing flagged. Leave the words that feel right."}
            </p>
            {findings.map((f, i) => (
              <button
                className="finding-button"
                key={i}
                onClick={() => onFinding(f)}
              >
                {f.text}
                <small>{f.reason}</small>
              </button>
            ))}
          </>
        )}
        {suggestions.map((text, i) => (
          <div className="suggestion-result" key={i}>
            <p>{text}</p>
            <button onClick={() => target && onKeep(text, target)}>
              Keep as an alternative ↗
            </button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
