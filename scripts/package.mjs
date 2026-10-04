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
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
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
// Ship OpenAI's pinned component, not the developer's installation or credentials.
const require = createRequire(import.meta.url);
const codexPackage = dirname(
  require.resolve(
    `@openai/codex-${process.platform}-${process.arch}/package.json`,
  ),
);
const architecture = process.arch === "arm64" ? "aarch64" : "x86_64";
const target = {
  darwin: "apple-darwin",
  linux: "unknown-linux-musl",
  win32: "pc-windows-msvc",
}[process.platform];
const codexDestination = join(destination, "runtime", "codex");
await cp(
  join(codexPackage, "vendor", `${architecture}-${target}`),
  codexDestination,
  { recursive: true },
);
const codexVersion = JSON.parse(
  await readFile(require.resolve("@openai/codex/package.json"), "utf8"),
).version;
for (const name of ["LICENSE", "NOTICE"]) {
  const response = await fetch(
    `https://raw.githubusercontent.com/openai/codex/rust-v${codexVersion}/${name}`,
  );
  if (!response.ok) throw new Error(`Could not download the Codex ${name}.`);
  await writeFile(join(codexDestination, name), await response.text());
}
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
  `write_better. ${version}\ninspired by Jason Fried\n\n1. Extract the whole ZIP. Keep its files together.\n2. Move the folder somewhere you want to keep it.\n3. Double-click Start write_better. A browser window opens.\n4. Keep the launcher window open while writing. Press Ctrl+C in it to stop.\n\nNo Node.js installation, account, or API key is needed to write.\nFor optional AI: open The Lab, choose ChatGPT subscription, and click Connect ChatGPT. Sign in on the OpenAI page, then return to the app. No terminal commands or separate installation needed. Your plan’s Codex allowance applies.\n\nDrafts live outside this folder, in your user account's application data:\nMac: ~/Library/Application Support/write-better/notebook.sqlite\nWindows: %LOCALAPPDATA%\\write-better\\notebook.sqlite\nLinux: ~/.local/share/write-better/notebook.sqlite (or XDG_DATA_HOME)\n\nUse Export notebook backup in the app to keep another copy.\nTo update: stop the old app, extract the new download, and use its Start file.\nDeleting the downloaded app folder does not delete your drafts.\n\nThese initial builds are unsigned. Your operating system may block a downloaded launcher.\nIf it does, see the download instructions in the README before deciding whether to allow it.\n\nHelp and source: https://github.com/Bayonle/write-better\n`,
);
console.log(`Packaged ${destination}`);
