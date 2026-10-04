# write_better.

_inspired by [Jason Fried](https://x.com/jasonfried/status/2105403067793584590)_

A quiet place to write, try different wording, and find what you mean. Keep alternatives inside your draft, work in Markdown, and save spare thoughts in Overflow. Your writing stays on your computer.

**[Download write_better.](https://github.com/Bayonle/write-better/releases/latest)** · [Writing guide](docs/GUIDE.md) · [Report a problem](https://github.com/Bayonle/write-better/issues)

## Install

You don't need to install Node.js, use Git, or create an account.

1. **Download** the ZIP for your computer from the link above. Choose a file named `write-better-…zip`, not “Source code.”
2. **Extract the whole ZIP** and move the folder somewhere you want to keep it.
3. **Double-click Start write_better** inside the folder. The app opens in your usual browser.
4. **Keep the launcher window open** while writing. Press Ctrl+C in that window to stop the app.

| Your computer                          | Choose                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Mac with an Apple chip (M1 or newer)   | [Mac — Apple silicon](https://github.com/Bayonle/write-better/releases/latest/download/write-better-darwin-arm64.zip) |
| Mac with an Intel chip                 | [Mac — Intel](https://github.com/Bayonle/write-better/releases/latest/download/write-better-darwin-x64.zip)           |
| Windows with an Intel or AMD processor | [Windows](https://github.com/Bayonle/write-better/releases/latest/download/write-better-win32-x64.zip)                |
| Linux with an Intel or AMD processor   | [Linux](https://github.com/Bayonle/write-better/releases/latest/download/write-better-linux-x64.zip)                  |

On a Mac, **Apple menu → About This Mac** shows your chip. On Windows, right-click the ZIP and choose **Extract All** before opening the `.bat` file. On Linux, run `./Start\ write_better.sh` from the extracted folder if your file manager doesn't run scripts.

**First-run security prompts:** these early downloads are unsigned. macOS may block the `.command` launcher; [Apple explains how to review and allow an app you trust](https://support.apple.com/en-us/102445). Windows may display a downloaded-file or SmartScreen warning. Only approve a download if you trust this repository. A signed installer is not available yet.

If the browser doesn't open, visit **http://127.0.0.1:4317**. If the launcher reports an error, copy its message into a [GitHub issue](https://github.com/Bayonle/write-better/issues), leaving out private draft text and credentials.

## Start writing

- Choose **New draft**, then give it a title and start typing.
- Select a word or sentence and choose **Alternatives**. Add another version without losing the original; compare versions in the sentence itself.
- Switch to **Markdown** for formatting controls, or **Preview** to read the finished text.
- Use **Overflow** to keep passages for later.
- Open **Drafts** to search your notebook. Removed drafts can be restored from **Recently Deleted**.

Writing, formatting, alternatives, and saving work offline. Optional AI suggestions need an internet connection and your own [ChatGPT/Codex sign-in or API key](docs/GUIDE.md#ai-with-your-chatgpt-subscription). AI is never required to use the editor, and nothing is sent to AI until you ask for it.

## Your drafts and backups

Drafts save automatically to a local SQLite database. They aren't synced across devices. Use **Export notebook backup** in the notebook to keep an extra copy; restore it with **… → Import**.

Downloaded bundles store writing separately from the app:

| System  | Draft location                                                      |
| ------- | ------------------------------------------------------------------- |
| Mac     | `~/Library/Application Support/write-better/notebook.sqlite`        |
| Windows | `%LOCALAPPDATA%\write-better\notebook.sqlite`                       |
| Linux   | `~/.local/share/write-better/notebook.sqlite` (or `$XDG_DATA_HOME`) |

**To update:** export a backup, stop the old launcher, download and extract the new version, then open its Start file. It uses the same saved notebook. Deleting the downloaded app folder doesn't delete your writing.

The app runs on `127.0.0.1` for your computer only. It isn't a hosted service or a multi-user server.

## For developers

Requires **Node.js 22.14 or newer** and npm.

```sh
git clone https://github.com/Bayonle/write-better.git
cd write-better
npm ci
npm start
```

Open http://127.0.0.1:4317. Source installs default to `data/write-on.sqlite` in the project (the original filename is retained for compatibility). Copy `.env.example` to `.env` to configure a different database path or optional AI. Never commit `.env` or your notebook.

```sh
npm run dev          # Live frontend updates and local API
npm test             # Type-check, build, and run tests
npm run package      # Bundle this computer's Node runtime and production app
npm run test:package # Test the standalone bundle and restart persistence
```

Built with React, TypeScript, Tailwind CSS, Vite, and SQLite. [Technical details and shortcuts](docs/GUIDE.md).

Version tags (`v*`) trigger Mac, Windows, and Linux builds. Each bundle must pass the test suite and standalone launch/persistence checks before GitHub publishes a release. Bundles include the Node.js runtime and its license, but no local drafts, credentials, or development dependencies.

## License and credit

[MIT](LICENSE). Inspired by Jason Fried's writing demo; an independent project, with no affiliation or endorsement implied.
