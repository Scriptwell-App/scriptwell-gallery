#!/usr/bin/env node
/*
 * Check one icon.
 *
 *   node tools/check-icon.mjs scripts/<id>/icon.png
 *
 * Requires: PNG, square, 256–1024 px per side, at most 200 KB.
 * No dependencies: only the PNG signature and IHDR chunk are read.
 *
 * Exit code: 1 if the icon is rejected, otherwise 0.
 */
import { readFileSync } from "node:fs";
import { isMain } from "./lib/common.mjs";
import { checkIconBytes, readPngSize, ICON_LIMITS } from "./lib/png.mjs";

export { checkIconBytes, readPngSize, ICON_LIMITS };

/** @returns findings for the icon at `filePath` */
export function checkIconFile(filePath) {
  return checkIconBytes(readFileSync(filePath));
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node tools/check-icon.mjs scripts/<id>/icon.png");
    process.exit(2);
  }
  const findings = checkIconFile(file);
  console.log(`${file}: ${findings.length === 0 ? "OK" : "FAILED"}`);
  for (const finding of findings) console.log(`  [${finding.severity}] ${finding.ruleId}: ${finding.message}`);
  process.exit(findings.length === 0 ? 0 : 1);
}

if (isMain(import.meta.url)) main();
