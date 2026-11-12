/*
 * Shared helpers for the gallery tools.
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);

/** The shared analyzer core — the same file the app runs in JavaScriptCore. */
export const core = require("../analyzer/analyzer-core.js");
/** The shared rules — the same file the app bundles. */
export const rules = require("../analyzer/rules.json");

export const TOOLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SCHEMA_PATH = path.resolve(TOOLS_DIR, "..", "schema", "meta.schema.json");

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,49}$/;
export const SCRIPT_FILES = ["script.js", "meta.json", "icon.png", "README.md"];
export const REQUIRED_FILES = ["script.js", "meta.json", "icon.png"];

/** True when the module at `metaUrl` is the file Node was started with. */
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

/**
 * Tiny argument parser: `--key value`, `--flag`, and positionals.
 * @param booleans names of flags that take no value
 */
export function parseArgs(argv, booleans = []) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (booleans.includes(key)) options[key] = true;
      else {
        options[key] = argv[i + 1] ?? "";
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { options, positional };
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Read a file only if it is a regular file (not a symlink, not a directory)
 * and no larger than `maxBytes`. Submissions are untrusted: a symlink could
 * otherwise point the tools at files outside the script folder.
 *
 * @returns {{ buffer: Buffer } | { missing: true } | { problem: string }}
 */
export function readRegularFile(filePath, maxBytes) {
  let stat;
  try {
    stat = lstatSync(filePath);
  } catch {
    return { missing: true };
  }
  if (!stat.isFile()) return { problem: "is not a regular file (symlinks and directories are not allowed)" };
  if (stat.size > maxBytes) return { problem: `is ${stat.size} bytes; the limit is ${maxBytes}` };
  return { buffer: readFileSync(filePath) };
}

/** Decode as UTF-8, rejecting NUL bytes and invalid sequences. */
export function decodeText(buffer) {
  if (buffer.includes(0)) return { problem: "contains NUL bytes (binary content)" };
  const text = buffer.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(buffer)) return { problem: "is not valid UTF-8" };
  return { text };
}

/**
 * Render untrusted text safely inside a Markdown comment: as an inline code
 * span, so it cannot inject markup, links or @mentions.
 */
export function code(value, maxLength = 200) {
  let text = String(value ?? "").replace(/[`\r\n\t]+/g, " ").trim();
  if (text.length > maxLength) text = text.slice(0, maxLength - 1) + "…";
  return text === "" ? "—" : "`" + text + "`";
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Hard findings first, then by line. */
export function sortFindings(findings) {
  return [...findings].sort((a, b) =>
    a.severity === b.severity ? (a.line || 0) - (b.line || 0) : a.severity === "hard" ? -1 : 1,
  );
}
