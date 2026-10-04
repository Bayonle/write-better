import { build } from "esbuild";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const name = `write-better-${process.platform}-${process.arch}`;
const destination = resolve(root, "release", name);
await rm(destination, { recursive: true, force: true });
await mkdir(join(destination, "server"), { recursive: true });
await mkdir(join(destination, "runtime"), { recursive: true });
await build({
  entryPoints: [join(root, "server", "index.ts")],
  outfile: join(destination, "server", "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["vite"],
});
await cp(join(root, "dist"), join(destination, "dist"), { recursive: true });
await copyFile(
  join(root, "scripts", "launcher.mjs"),
  join(destination, "launcher.mjs"),
);
await copyFile(join(root, "LICENSE"), join(destination, "LICENSE"));
// Only the runtime binary is included; no developer files, drafts, or credentials.
const binary = join(
  destination,
  "runtime",
  process.platform === "win32" ? "node.exe" : "node",
);
await copyFile(process.execPath, binary);
await chmod(binary, 0o755);
const licenseResponse = await fetch(
  `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`,
);
if (!licenseResponse.ok)
  throw new Error("Could not download the bundled Node.js license.");
await writeFile(
  join(destination, "runtime", "LICENSE"),
  await licenseResponse.text(),
);
if (process.platform === "win32") {
  await writeFile(
    join(destination, "Start write_better.bat"),
    '@echo off\r\ncd /d "%~dp0"\r\n"runtime\\node.exe" "launcher.mjs"\r\nif errorlevel 1 pause\r\n',
  );
} else {
  const launcher = join(
    destination,
    process.platform === "darwin"
      ? "Start write_better.command"
      : "Start write_better.sh",
  );
  await writeFile(
    launcher,
    '#!/bin/sh\ncd "$(dirname "$0")" || exit 1\n./runtime/node launcher.mjs\nresult=$?\nif [ "$result" -ne 0 ]; then\n  printf "Press Enter to close…"\n  read answer\nfi\nexit "$result"\n',
  );
  await chmod(launcher, 0o755);
}
await writeFile(
  join(destination, "START HERE.txt"),
  `write_better. ${version}\ninspired by Jason Fried\n\n1. Extract the whole ZIP. Keep its files together.\n2. Move the folder somewhere you want to keep it.\n3. Double-click Start write_better. A browser window opens.\n4. Keep the launcher window open while writing. Press Ctrl+C in it to stop.\n\nNo Node.js installation, account, or API key is needed to write.\nAI is optional and needs separate setup; see the project README.\n\nDrafts live outside this folder, in your user account's application data:\nMac: ~/Library/Application Support/write-better/notebook.sqlite\nWindows: %LOCALAPPDATA%\\write-better\\notebook.sqlite\nLinux: ~/.local/share/write-better/notebook.sqlite (or XDG_DATA_HOME)\n\nUse Export notebook backup in the app to keep another copy.\nTo update: stop the old app, extract the new download, and use its Start file.\nDeleting the downloaded app folder does not delete your drafts.\n\nThese initial builds are unsigned. Your operating system may block a downloaded launcher.\nIf it does, see the download instructions in the README before deciding whether to allow it.\n\nHelp and source: https://github.com/Bayonle/write-better\n`,
);
console.log(`Packaged ${destination}`);
