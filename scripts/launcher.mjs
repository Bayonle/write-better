import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = dirname(fileURLToPath(import.meta.url));
const dataDirectory =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "write-better")
    : process.platform === "win32"
      ? join(
          process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
          "write-better",
        )
      : join(
          process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
          "write-better",
        );
const database =
  process.env.WRITE_ON_DB_PATH || join(dataDirectory, "notebook.sqlite");
const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error("PORT must be a number from 1024 to 65535.");
  process.exit(1);
}
const url = `http://127.0.0.1:${port}`;

async function isRunning() {
  try {
    const response = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(500),
    });
    return response.ok && (await response.json()).app === "write-better";
  } catch {
    return false;
  }
}

function openBrowser() {
  console.log(`Open ${url} in your browser.`);
  if (process.env.WRITE_BETTER_NO_OPEN === "1") return;
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  const opener = spawn(command, args, { stdio: "ignore", detached: true });
  opener.on("error", () =>
    console.log("Please open the address above in your browser."),
  );
  opener.unref();
}

if (await isRunning()) {
  console.log(
    "write_better. is already running. Close its existing window before starting an updated version.",
  );
  openBrowser();
} else {
  await mkdir(dirname(database), { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, [join(root, "server", "index.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, WRITE_ON_DB_PATH: database, PORT: String(port) },
  });
  let exited = false;
  child.on("error", (error) => {
    exited = true;
    console.error(`Could not start write_better.: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    exited = true;
    if (code) {
      console.error(
        "Could not keep the app running. Another app may be using port " +
          port +
          ". Your saved drafts are unchanged.",
      );
      process.exitCode = code;
    } else if (!signal) process.exitCode = 0;
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      child.kill();
    });
  }
  process.on("exit", () => {
    if (!exited) child.kill();
  });
  let ready = false;
  for (let attempt = 0; attempt < 100 && !exited; attempt++) {
    if (await isRunning()) {
      ready = true;
      break;
    }
    await delay(100);
  }
  if (ready && !exited) {
    console.log(
      `\nwrite_better.\nDrafts: ${database}\nKeep this window open while writing. Press Ctrl+C here to stop.\n`,
    );
    openBrowser();
  } else if (!exited) {
    console.error(
      "The app did not start in time. Close this window and try again. Your drafts are unchanged.",
    );
    process.exitCode = 1;
    child.kill();
  }
}
