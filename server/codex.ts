import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function codexBinary() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const executable = process.platform === "win32" ? "codex.exe" : "codex";
  const bundled = fileURLToPath(
    new URL(`../runtime/codex/bin/${executable}`, import.meta.url),
  );
  if (existsSync(bundled)) return bundled;
  try {
    const require = createRequire(import.meta.url);
    const platformPackage = require.resolve(
      `@openai/codex-${process.platform}-${process.arch}/package.json`,
    );
    const architecture = process.arch === "arm64" ? "aarch64" : "x86_64";
    const platforms: Partial<Record<NodeJS.Platform, string>> = {
      darwin: "apple-darwin",
      linux: "unknown-linux-musl",
      win32: "pc-windows-msvc",
    };
    const platform = platforms[process.platform];
    const binary = join(
      dirname(platformPackage),
      "vendor",
      `${architecture}-${platform}`,
      "bin",
      executable,
    );
    if (existsSync(binary)) return binary;
  } catch {
    /* Report an actionable error through the connection UI. */
  }
  throw new Error(
    "The ChatGPT component is missing. Download and extract a fresh copy of write_better. Your saved drafts will stay on this computer.",
  );
}

export function codexEnvironment() {
  // Only Codex manages credentials. Never accidentally bill an inherited API key.
  return Object.fromEntries(
    [
      "PATH",
      "HOME",
      "USER",
      "LOGNAME",
      "TMPDIR",
      "TEMP",
      "TMP",
      "USERPROFILE",
      "LOCALAPPDATA",
      "APPDATA",
      "SystemRoot",
      "CODEX_HOME",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
    ]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
}
