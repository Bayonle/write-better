# Writing and developer guide

A local writing app inspired by Jason Fried’s demo. Keep alternative words, sentences, and paragraphs attached to your draft; dim passages; and save spare thoughts in Overflow.

## Run from source

Requires Node.js 22.14 or newer (uses the built-in `node:sqlite` module).

```sh
npm install
npm start
```

Open http://127.0.0.1:4317. The server creates `data/write-on.sqlite` automatically. No separate database service or credentials are needed.

## Write

- Select text and choose **Alternatives**. An editor opens below the paragraph, making space without covering the text: type your alternative and press Enter. Click an underlined passage to revisit it; choose a version or use the arrows in the inline editor. The sidebar is a list of marked passages.
- When an immediately preceding **a/an** belongs to the selection, it becomes part of the alternative. Selecting **dog** in **a dog** and entering **animal** produces **an animal**. Switching back restores **a dog**. Common sound exceptions such as **an hour** and **a university** work offline. This is English article assistance, not a full grammar engine; for broader agreement or rewrites, select the whole sentence and use AI.
- Use **Word**, **Sentence**, or **Paragraph** to expand a cursor selection. Alternatives belong to one paragraph; multi-paragraph selections can be dimmed or stashed.
- Select text and choose **Dim / restore** to quiet a passage, or **Move to notes** to move it into Overflow. **Return to draft** moves a note to the end of the draft.
- Open **The Lab** to find sentences over 28 words or common filler phrases. These are local heuristics, not judgments of writing quality.
- Open **Drafts** (or the wordmark) for the full notebook view. Search titles and draft text, browse recent writing, create drafts, and restore Recently Deleted drafts. Browser Back returns between the notebook and editor. Click a draft’s title in the editor to rename it.
- Use the menu to import Markdown, plain text, or a write_better. JSON backup. Use **Markdown** to edit source with a formatting toolbar and live preview; **Preview** shows the rendered body. **Write** keeps the text editable with inline alternatives. All views share the same draft.

Drafts save to SQLite on edits, including titles, Markdown, alternatives, selected wording, dimming, Overflow, order, and the open draft. **Saved on this computer** means the server confirmed the transaction. Clearing browser site data no longer removes confirmed drafts; another browser connected to the same local server can open them.

**Back up this draft** exports one full draft as JSON; **Back up all drafts** exports the notebook. Both can be imported through the menu. Markdown exports only the title and current wording. Imports add drafts rather than replacing existing ones.

## Persistence and migration

- Source-install default database: `data/write-on.sqlite`, relative to the project, regardless of the shell's working directory. Set `WRITE_ON_DB_PATH` in `.env` to use another absolute path.
- The `notebook` table contains the complete document model as JSON plus a revision and database identity; saves run in atomic SQLite transactions with WAL journaling and full synchronization. The `imports` table records completed migrations/recoveries so retries do not duplicate or resurrect deleted drafts.
- On the first visit, existing `write-on.v1` browser data is imported. The old browser copy is kept untouched. If another notebook already exists, missing drafts are added and conflicting drafts become recovered copies.
- Browser storage retains pending, unacknowledged edits under `write-on.sqlite.pending.*`. Saves are serialized; failures show **Retry save**. Reloading or opening another tab can recover pending work. Do not clear browser data before a save is confirmed.
- A stale window cannot overwrite a newer save. **Keep both versions** preserves changed local drafts as recovered copies where needed; pending deletions do not remove newer saved drafts. Reload to see another window’s latest notebook; there is no live collaboration.
- Theme and AI provider preferences remain browser-local. Undo/redo remains session-local. The notebook database does not contain Codex credentials or API keys.
- Save/import requests have a 16 MB payload limit. The database and its journal files are excluded from Git and blocked from web file serving.

For a file backup, stop the server and copy the entire `data/` directory, including any journal files. The JSON backup menu works while the server is running. Restoring a file backup requires stopping the server before replacing that directory. SQLite is local persistence, not cloud sync.

Undo/redo covers editing actions in the current open draft; history resets when switching drafts or reloading. Use a draft’s **Actions → Move to Recently Deleted** to remove it from the active list. **Drafts → Recently Deleted → Restore** recovers it, even after reloading or restarting. Recently Deleted has no automatic expiry and is included in notebook JSON backups. The temporary Undo toast is an additional shortcut. Undo and Redo stay visible on mobile.

## Markdown controls

Select text in **Markdown**, then use Bold, Italic, or Link directly, or open the **Headings**, **Lists**, and **Insert** controls for more formatting. On smaller screens, use **Source / Preview** to switch panes; wider screens show both side by side. Bold, italic, and link also have ⌘/Ctrl B, I, and K shortcuts. The title remains separate and exports as the first Markdown heading.

Markdown source preserves indentation and blank lines. Unchanged alternatives survive source edits, including wrapping a marked phrase in formatting. Editing inside a phrase updates its active wording; replacing or splitting the phrase can detach its alternatives, with Undo available. JSON remains the complete backup format.

Preview supports CommonMark plus tables, strikethrough, and task lists. Raw HTML is escaped. Images appear as links so imported drafts do not fetch remote images automatically. Task completion is edited with `[ ]` / `[x]` in the source.

## Development

React + TypeScript (strict mode), Tailwind CSS, Vite, and a local TypeScript Node server. `src/components` contains the writing editor, Markdown editor/preview, inline alternatives, dialogs, and Lab. `src/model.ts` owns the document model; `src/markdown.ts` handles formatting and source synchronization. `server/` contains the loopback API and Codex integration.

```sh
npm run dev     # React hot reload and API, both on port 4317
npm run build   # Type-check and create dist/
npm run format # Format source and tests
```

Stop the existing server before starting another on the same port. `npm start` builds and serves the production app. Every browser connected to this server uses the same SQLite notebook. Development and production use the same database unless `WRITE_ON_DB_PATH` is overridden.

## AI with your ChatGPT subscription

Install the official Codex CLI if needed, then run `codex login` and sign in with ChatGPT. Open **The Lab → Use → ChatGPT subscription (via Codex)**. Click **Reconnect** after signing in. An existing CLI ChatGPT sign-in is detected automatically. No API key is required for this option; requests use your ChatGPT/Codex allowance and are subject to its limits.

This is a local integration with the official CLI's [saved authentication](https://learn.chatgpt.com/docs/non-interactive-mode), not a new website OAuth registration. The app does not read or copy authentication tokens. Suggestion requests run in a temporary empty directory with a read-only sandbox, user configuration ignored, shell/browser/app/plugin tools disabled, and ephemeral sessions. The CLI's own authentication remains in its normal location. The CLI must support `exec --ignore-user-config --ephemeral --output-schema` (tested with 0.142.4). `CODEX_BIN` and `CODEX_MODEL` are optional overrides.

## Optional API key

Copy `.env.example` to `.env`, set `OPENAI_API_KEY`, and restart the server. The default model is `gpt-5-mini`; change `OPENAI_MODEL` if needed. API usage is billed to that key.

Choose **OpenAI API (separate billing)** in The Lab to use this option. The app never falls back from subscription to API billing automatically.

For either source, **Ask AI** (or entering `??` in the inline alternatives field) adds suggestions while keeping current wording. The Lab can proofread or shorten a selected passage. You review a revision before adding it as an alternative. The selected passage and up to 6,000 characters on either side within its paragraph are sent to OpenAI only when an AI action is clicked. The rest of your notebook is not included. API keys remain on the local server; API requests use `store: false` with the [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses).

The app binds only to `127.0.0.1`. Do not expose this personal server publicly: it is not a hosted, multi-user application.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| ⌘ / Ctrl K | Insert link in Markdown; open the Lab in Write |
| ⌘ / Ctrl B / I | Bold / italic in Markdown |
| ⌘ / Ctrl Z | Undo |
| ⌘ / Ctrl Shift Z | Redo |
| ⌘ / Ctrl Shift F | Focus mode |
| ⌘ / Ctrl S | Save locally |
| Tab / Shift+Tab | Insert two spaces / remove up to two preceding spaces in either editor |
| Escape, then Tab | Leave either editor; Escape then Shift+Tab moves backward |
| Escape | Close dialogs and mobile side panels |

## Check

```sh
npm test
npm run check
```

Tests cover the document model, alternatives, article agreement, Markdown formatting and rendering, safe imports, AI validation, local server access restrictions, SQLite reopen durability, persistent Recently Deleted and restoration, browser migration, queued writes, interrupted-save recovery, and multi-window conflicts. `npm test` includes a production build and strict TypeScript checking.
