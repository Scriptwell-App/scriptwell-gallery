#!/usr/bin/env node
/*
 * Review a submission: run every check on each changed script folder and
 * write a summary for the pull request.
 *
 *   node tools/review-pr.mjs --root <checkout of PR head> --changed <file> [options]
 *   node tools/review-pr.mjs --root . --all
 *
 * Options
 *   --root <dir>                 checkout to review (PR head). Its files are only read, never executed.
 *   --changed <file>             changed paths: a JSON array, or one path per line
 *   --all                        review every folder under scripts/ instead
 *   --base-root <dir>            checkout of the base branch, to detect updates (optional)
 *   --pr-author <login>          GitHub login of the PR author (optional)
 *   --author-association <a>     OWNER | MEMBER | COLLABORATOR | CONTRIBUTOR | ... (optional)
 *   --out <dir>                  where to write review.md and review.json (default: .)
 *
 * Exit code: 1 if there is any hard finding, otherwise 0.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  core, rules, isMain, parseArgs, sha256, readRegularFile, decodeText, code, sortFindings,
  ID_PATTERN, SCRIPT_FILES, REQUIRED_FILES,
} from "./lib/common.mjs";
import { analyzeScript } from "./analyze.mjs";
import { validateMeta } from "./validate-meta.mjs";
import { checkIconBytes } from "./lib/png.mjs";

export const COMMENT_MARKER = "<!-- scriptwell-gallery-review -->";
const MAINTAINER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const MAX_BYTES = { "script.js": 1024 * 1024, "meta.json": 16 * 1024, "icon.png": 4 * 1024 * 1024, "README.md": 64 * 1024 };
const MAX_COMMENT_LENGTH = 60000;

/**
 * Split changed paths into script folders and everything else.
 * @returns {{ ids: string[], outside: string[] }}
 */
export function classifyPaths(paths) {
  const ids = new Set();
  const outside = [];
  for (const raw of paths) {
    const changed = String(raw).trim();
    if (changed === "") continue;
    const match = /^scripts\/([^/]+)\/([^/]+)$/.exec(changed);
    if (match && ID_PATTERN.test(match[1]) && SCRIPT_FILES.includes(match[2])) ids.add(match[1]);
    else outside.push(changed);
  }
  return { ids: [...ids].sort(), outside };
}

function readBaseMeta(baseRoot, id) {
  if (!baseRoot) return null;
  const file = readRegularFile(path.join(baseRoot, "scripts", id, "meta.json"), MAX_BYTES["meta.json"]);
  if (!file.buffer) return null;
  try {
    const meta = JSON.parse(file.buffer.toString("utf8"));
    return meta && typeof meta === "object" ? meta : null;
  } catch {
    return null;
  }
}

/**
 * Run every check on scripts/<id>/ under `root`.
 * @returns {{ id, kind: "new"|"update"|"removed", meta, findings, analysis, sha256, size }}
 */
export function reviewScript({ root, id, baseRoot, prAuthor, isMaintainer = false }) {
  const dir = path.join(root, "scripts", id);
  const findings = [];
  const add = (ruleId, severity, message, line = 0) => findings.push({ ruleId, severity, message, line, column: 0 });
  const baseMeta = readBaseMeta(baseRoot, id);
  const result = { id, kind: baseMeta ? "update" : "new", meta: null, findings, analysis: null, sha256: null, size: 0 };

  if (!ID_PATTERN.test(id)) {
    add("invalid-folder-name", "hard", "Folder names must be 3-50 characters: lowercase letters, digits and hyphens.");
    return result;
  }
  if (!existsSync(dir)) {
    result.kind = "removed";
    add("script-removed", "soft", "This change removes the script. To take a script down, prefer setting \"status\": \"hidden\" in meta.json.");
    return result;
  }
  if (!lstatSync(dir).isDirectory()) {
    add("invalid-file", "hard", "The script folder is not a regular directory (symlinks are not allowed).");
    return result;
  }

  // Only the four known files may exist in a script folder.
  for (const entry of readdirSync(dir)) {
    if (!SCRIPT_FILES.includes(entry)) add("unexpected-file", "hard", `Unexpected entry in the script folder: ${entry}. Allowed: ${SCRIPT_FILES.join(", ")}.`);
  }

  const files = {};
  for (const name of SCRIPT_FILES) {
    const file = readRegularFile(path.join(dir, name), MAX_BYTES[name]);
    if (file.missing) {
      if (REQUIRED_FILES.includes(name)) add("missing-file", "hard", `${name} is missing.`);
    } else if (file.problem) {
      add("invalid-file", "hard", `${name} ${file.problem}.`);
    } else {
      files[name] = file.buffer;
    }
  }

  let source = null;
  if (files["script.js"]) {
    const decoded = decodeText(files["script.js"]);
    if (decoded.problem) add("invalid-file", "hard", `script.js ${decoded.problem}.`);
    else source = decoded.text;
    result.sha256 = sha256(files["script.js"]);
    result.size = files["script.js"].length;
  }

  if (files["meta.json"]) {
    const decoded = decodeText(files["meta.json"]);
    if (decoded.problem) {
      add("invalid-file", "hard", `meta.json ${decoded.problem}.`);
    } else {
      const validated = validateMeta({ metaText: decoded.text, folderId: id, scriptSource: source ?? undefined });
      result.meta = validated.meta;
      findings.push(...validated.findings);
    }
  }

  if (source !== null) {
    const declared = result.meta && Array.isArray(result.meta.permissions)
      ? result.meta.permissions.filter((p) => typeof p === "string")
      : undefined;
    result.analysis = analyzeScript(source, { declaredPermissions: declared });
    findings.push(...result.analysis.findings);
  }

  if (files["icon.png"]) findings.push(...checkIconBytes(files["icon.png"]));

  if (files["README.md"]) {
    const decoded = decodeText(files["README.md"]);
    if (decoded.problem) add("invalid-file", "hard", `README.md ${decoded.problem}.`);
    else if (core.checkText(decoded.text, rules).length > 0) add("readme-text", "soft", "README.md contains words from the text filter. Read it before approving.");
  }

  const meta = result.meta;
  if (meta && typeof meta.author === "string") {
    if (prAuthor && meta.author.toLowerCase() !== String(prAuthor).toLowerCase() && !isMaintainer) {
      add("author-mismatch", "soft", `meta.json author is "${meta.author}" but the pull request was opened by "${prAuthor}".`);
    }
    if (baseMeta && typeof baseMeta.author === "string" && baseMeta.author.toLowerCase() !== meta.author.toLowerCase()) {
      add("author-changed", "soft", `The author changes from "${baseMeta.author}" to "${meta.author}".`);
    }
  }
  if (meta && baseMeta) {
    const before = baseMeta.status || "public";
    const after = meta.status || "public";
    if (before !== after && !isMaintainer) {
      add("status-changed", "soft", `status changes from "${before}" to "${after}". Only maintainers should change status.`);
    }
    const baseScript = readRegularFile(path.join(baseRoot, "scripts", id, "script.js"), MAX_BYTES["script.js"]);
    const scriptChanged = baseScript.buffer && files["script.js"] && !baseScript.buffer.equals(files["script.js"]);
    if (scriptChanged && baseMeta.version === meta.version) {
      add("version-not-bumped", "soft", `script.js changed but the version is still ${meta.version}. The app only offers an update when the version changes.`);
    }
    const added = Array.isArray(meta.permissions) && Array.isArray(baseMeta.permissions)
      ? meta.permissions.filter((p) => !baseMeta.permissions.includes(p))
      : [];
    if (added.length > 0) {
      add("permissions-added", "soft", `This update adds permissions: ${added.join(", ")}. Users will be asked to approve them again.`);
    }
  } else if (meta && !baseMeta && meta.status === "hidden" && !isMaintainer) {
    add("status-changed", "soft", "A new submission sets status to \"hidden\". Only maintainers should set status.");
  }

  result.findings = sortFindings(findings);
  return result;
}

/** Inline code for a table cell: a "|" would otherwise end the cell, even inside code. */
function cell(value, maxLength) {
  return code(value, maxLength).replace(/\|/g, "\\|");
}

function findingLine(finding) {
  const where = finding.line > 0 ? ` (line ${finding.line})` : "";
  return `- ${code(finding.ruleId, 60)}${where}: ${code(finding.message, 400)}`;
}

/** Build the pull request comment. All submission-controlled text is rendered as inline code. */
export function renderMarkdown({ results, outside, outsideSeverity }) {
  const all = results.flatMap((r) => r.findings);
  let hard = all.filter((f) => f.severity === "hard").length;
  let soft = all.filter((f) => f.severity === "soft").length;
  if (outside.length > 0) {
    if (outsideSeverity === "hard") hard += outside.length;
    else soft += outside.length;
  }

  const lines = [COMMENT_MARKER];
  if (hard > 0) lines.push(`## Gallery checks: ❌ ${hard} blocking, ${soft} to review`);
  else if (soft > 0) lines.push(`## Gallery checks: ⚠️ ${soft} to review, nothing blocking`);
  else lines.push("## Gallery checks: ✅ passed");
  lines.push("");

  if (results.length === 0 && outside.length === 0) lines.push("No script changes found in this pull request.", "");

  for (const result of results) {
    const meta = result.meta || {};
    const title = result.kind === "removed" ? "removed" : result.kind === "update" ? "update" : "new submission";
    lines.push(`### ${code(result.id, 60)} — ${title}`, "");
    if (result.kind !== "removed") {
      const analysis = result.analysis;
      const list = (items) => (Array.isArray(items) && items.length > 0 ? items.map((item) => cell(item, 30)).join(", ") : "none");
      lines.push("| | |", "|---|---|");
      lines.push(`| Name | ${cell(meta.name, 60)} |`);
      lines.push(`| Author / version | ${cell(meta.author, 40)} / ${cell(meta.version, 20)} |`);
      lines.push(`| Description | ${cell(meta.description, 300)} |`);
      lines.push(`| Permissions declared | ${list(meta.permissions)} |`);
      lines.push(`| Permissions used | ${analysis ? list(analysis.usedPermissions) : "—"} |`);
      lines.push(`| Widget sizes | ${list(meta.widgetSizes)} |`);
      if (analysis) {
        const m = analysis.metrics;
        lines.push(`| Size | ${m.sourceBytes} chars, ${m.lineCount} lines, longest code line ${m.maxCodeLineLength}, longest string ${m.maxStringLiteralLength} |`);
      }
      lines.push(`| SHA-256 | ${cell(result.sha256, 80)} |`, "");
    }
    const hardFindings = result.findings.filter((f) => f.severity === "hard");
    const softFindings = result.findings.filter((f) => f.severity === "soft");
    if (hardFindings.length > 0) lines.push("**Blocking**", "", ...hardFindings.map(findingLine), "");
    if (softFindings.length > 0) lines.push("**Needs a look**", "", ...softFindings.map(findingLine), "");
    if (result.findings.length === 0) lines.push("No findings.", "");
  }

  if (outside.length > 0) {
    lines.push("### Files outside a script folder", "");
    lines.push(
      outsideSeverity === "hard"
        ? "**Blocking.** A submission may only touch `scripts/<id>/{script.js, meta.json, icon.png, README.md}`:"
        : "Maintainer change to non-script files. Review it as code:",
      "",
    );
    for (const changed of outside.slice(0, 50)) lines.push(`- ${code(changed, 200)}`);
    if (outside.length > 50) lines.push(`- …and ${outside.length - 50} more`);
    lines.push("");
  }

  if (results.some((r) => r.kind !== "removed")) {
    lines.push(
      "### Reviewer checklist",
      "",
      "- [ ] Read `script.js` top to bottom. It does what the description says and nothing else.",
      "- [ ] Every declared permission is needed, and every network host is expected for this script.",
      "- [ ] Name, description, icon and README follow GUIDELINES.md.",
      "- [ ] Everything under \"Needs a look\" has an innocent explanation.",
      "",
    );
  }

  let text = lines.join("\n");
  if (text.length > MAX_COMMENT_LENGTH) text = text.slice(0, MAX_COMMENT_LENGTH) + "\n\n…truncated. See the workflow log for the full report.\n";
  return { text, hard, soft };
}

function readChangedPaths(file) {
  const text = readFileSync(file, "utf8");
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Not JSON: one path per line.
  }
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Review a whole change set. Shared by the CLI and by build-index. */
export function review({ root, changed, all = false, baseRoot, prAuthor, authorAssociation }) {
  const isMaintainer = MAINTAINER_ASSOCIATIONS.has(String(authorAssociation || "").toUpperCase());
  let ids;
  let outside = [];
  if (all) {
    const scriptsDir = path.join(root, "scripts");
    ids = existsSync(scriptsDir)
      ? readdirSync(scriptsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
      : [];
  } else {
    ({ ids, outside } = classifyPaths(changed || []));
  }
  const results = ids.map((id) => reviewScript({ root, id, baseRoot, prAuthor, isMaintainer }));
  const outsideSeverity = isMaintainer ? "soft" : "hard";
  const rendered = renderMarkdown({ results, outside, outsideSeverity });

  const labels = [];
  if (rendered.hard > 0) labels.push("needs-changes");
  if (rendered.soft > 0) labels.push("needs-careful-review");
  if (labels.length === 0) labels.push("checks-passed");

  return {
    markdown: rendered.text,
    summary: {
      hard: rendered.hard,
      soft: rendered.soft,
      labels,
      outside,
      scripts: results.map((r) => ({
        id: r.id,
        kind: r.kind,
        hard: r.findings.filter((f) => f.severity === "hard").length,
        soft: r.findings.filter((f) => f.severity === "soft").length,
        sha256: r.sha256,
      })),
    },
    results,
  };
}

function main() {
  const { options } = parseArgs(process.argv.slice(2), ["all"]);
  if (!options.root || (!options.all && !options.changed)) {
    console.error("Usage: node tools/review-pr.mjs --root <dir> (--changed <file> | --all) [--base-root <dir>] [--pr-author <login>] [--author-association <a>] [--out <dir>]");
    process.exit(2);
  }
  const outcome = review({
    root: path.resolve(options.root),
    changed: options.all ? [] : readChangedPaths(options.changed),
    all: Boolean(options.all),
    baseRoot: options["base-root"] ? path.resolve(options["base-root"]) : undefined,
    prAuthor: options["pr-author"] || undefined,
    authorAssociation: options["author-association"] || undefined,
  });

  const outDir = path.resolve(options.out || ".");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "review.md"), outcome.markdown);
  writeFileSync(path.join(outDir, "review.json"), JSON.stringify(outcome.summary, null, 2) + "\n");

  console.log(outcome.markdown.replace(COMMENT_MARKER + "\n", ""));
  process.exit(outcome.summary.hard > 0 ? 1 : 0);
}

if (isMain(import.meta.url)) main();
