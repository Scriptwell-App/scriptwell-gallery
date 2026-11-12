#!/usr/bin/env node
/*
 * Static analysis of one script.
 *
 *   node tools/analyze.mjs <script.js> [--permissions a,b] [--json]
 *
 * 1. Parse with acorn. A script that does not parse is a hard failure.
 * 2. Walk the AST for eval / Function / import() / import-export.
 * 3. Run the shared analyzer core (analyzer/analyzer-core.js + rules.json),
 *    the same code the Scriptwell app runs on imported scripts.
 *
 * Exit code: 1 if there is any hard finding, otherwise 0.
 */
import { readFileSync } from "node:fs";
import * as acorn from "acorn";
import { core, rules, isMain, parseArgs, sortFindings } from "./lib/common.mjs";
import { astFindings } from "./lib/ast-checks.mjs";

// The app runs a script as the body of an async function, so top-level
// `await` and `return` are valid.
const PARSE_OPTIONS = {
  ecmaVersion: "latest",
  sourceType: "script",
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
  locations: true,
};

const RULE_MESSAGES = Object.fromEntries(
  (rules.rules || []).filter((rule) => rule.message).map((rule) => [rule.id, rule.message]),
);

function syntaxFinding(error) {
  return {
    ruleId: "syntax-error",
    severity: "hard",
    message: "Syntax error: " + (error && error.message ? error.message : String(error)),
    line: error && error.loc ? error.loc.line : 0,
    column: error && error.loc ? error.loc.column + 1 : 0,
  };
}

/** @returns hard findings from parsing + AST checks */
export function parseFindings(source) {
  let ast;
  try {
    ast = acorn.parse(source, PARSE_OPTIONS);
  } catch (scriptError) {
    // Give module syntax a clearer message than "unexpected token".
    try {
      const moduleAst = acorn.parse(source, { ...PARSE_OPTIONS, sourceType: "module" });
      const found = astFindings(moduleAst, RULE_MESSAGES);
      if (found.some((f) => f.ruleId === "no-modules")) return found;
    } catch {
      // Not valid as a module either; report the original error.
    }
    return [syntaxFinding(scriptError)];
  }
  return astFindings(ast, RULE_MESSAGES);
}

/**
 * Full analysis of one script.
 * @param options { declaredPermissions?: string[] } — pass meta.json's list for gallery checks
 * @returns the core result plus AST findings:
 *   { ok, findings, metrics, manifest, declaredPermissions, usedPermissions }
 */
export function analyzeScript(source, options = {}) {
  const fromParser = parseFindings(source);
  const result = core.analyze(
    source,
    rules,
    Array.isArray(options.declaredPermissions) ? { declaredPermissions: options.declaredPermissions } : {},
  );

  const seen = new Set(result.findings.map((f) => f.ruleId + ":" + f.line));
  const findings = [...result.findings];
  for (const finding of fromParser) {
    const key = finding.ruleId + ":" + finding.line;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(finding);
  }

  const sorted = sortFindings(findings);
  return { ...result, findings: sorted, ok: !sorted.some((f) => f.severity === "hard") };
}

export function formatFinding(finding) {
  const where = finding.line > 0 ? `line ${finding.line}` : "file";
  return `[${finding.severity}] ${finding.ruleId} (${where}): ${finding.message}`;
}

function main() {
  const { options, positional } = parseArgs(process.argv.slice(2), ["json"]);
  const file = positional[0];
  if (!file) {
    console.error("Usage: node tools/analyze.mjs <script.js> [--permissions a,b] [--json]");
    process.exit(2);
  }
  const source = readFileSync(file, "utf8");
  const declaredPermissions =
    typeof options.permissions === "string"
      ? options.permissions.split(",").map((p) => p.trim()).filter(Boolean)
      : undefined;
  const result = analyzeScript(source, { declaredPermissions });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${file}: ${result.ok ? "OK" : "FAILED"}`);
    console.log(`  declared permissions: ${result.declaredPermissions.join(", ") || "none"}`);
    console.log(`  used permissions:     ${result.usedPermissions.join(", ") || "none"}`);
    for (const finding of result.findings) console.log("  " + formatFinding(finding));
    if (result.findings.length === 0) console.log("  no findings");
  }
  process.exit(result.ok ? 0 : 1);
}

if (isMain(import.meta.url)) main();
