#!/usr/bin/env node
/*
 * Validate one meta.json.
 *
 *   node tools/validate-meta.mjs scripts/<id>/meta.json
 *
 * Checks: JSON Schema (schema/meta.schema.json), id == folder name, word
 * filter on name and description, and that the declared permissions / widget
 * sizes agree with the header of the script.js next to it.
 *
 * Exit code: 1 if there is any hard finding, otherwise 0.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { core, rules, isMain, SCHEMA_PATH } from "./lib/common.mjs";

const require = createRequire(import.meta.url);

let cachedValidator = null;
function schemaValidator() {
  if (cachedValidator) return cachedValidator;
  // ajv and ajv-formats are CommonJS; load them the documented CommonJS way.
  const ajvModule = require("ajv/dist/2020");
  const formatsModule = require("ajv-formats");
  const Ajv2020 = ajvModule.default || ajvModule;
  const addFormats = formatsModule.default || formatsModule;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  cachedValidator = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, "utf8")));
  return cachedValidator;
}

const sameSet = (a, b) => a.length === b.length && a.every((item) => b.includes(item));

/**
 * @param input { metaText: string, folderId?: string, scriptSource?: string }
 * @returns { meta: object|null, findings: [{ ruleId, severity, message, line, column }] }
 */
export function validateMeta({ metaText, folderId, scriptSource }) {
  const findings = [];
  const add = (ruleId, severity, message) => findings.push({ ruleId, severity, message, line: 0, column: 0 });

  let meta;
  try {
    meta = JSON.parse(metaText);
  } catch (error) {
    add("meta-invalid-json", "hard", "meta.json is not valid JSON: " + error.message);
    return { meta: null, findings };
  }
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    add("meta-schema", "hard", "meta.json must be a JSON object.");
    return { meta: null, findings };
  }

  const validate = schemaValidator();
  if (!validate(meta)) {
    for (const error of validate.errors || []) {
      const where = error.instancePath ? error.instancePath.replace(/^\//, "").replace(/\//g, ".") : "(root)";
      const extra = error.params && error.params.additionalProperty ? ` ("${error.params.additionalProperty}")` : "";
      add("meta-schema", "hard", `meta.json ${where}: ${error.message}${extra}`);
    }
  }

  if (folderId !== undefined && typeof meta.id === "string" && meta.id !== folderId) {
    add("id-mismatch", "hard", `meta.json id "${meta.id}" must equal the folder name "${folderId}".`);
  }

  for (const field of ["name", "description"]) {
    if (typeof meta[field] !== "string") continue;
    const hits = core.checkText(meta[field], rules);
    if (hits.length > 0) {
      add("objectionable-text", "hard", `The ${field} contains words that are not allowed in the gallery (${hits.length} match${hits.length === 1 ? "" : "es"}).`);
    }
  }

  if (typeof scriptSource === "string") {
    const header = core.parseManifest(scriptSource);
    if (Array.isArray(meta.permissions)) {
      const declared = meta.permissions.map((p) => String(p).toLowerCase());
      const inHeader = header.permissions.map((p) => String(p).toLowerCase());
      if (!sameSet(declared, inHeader) || !sameSet(inHeader, declared)) {
        add(
          "permission-mismatch",
          "hard",
          `meta.json permissions [${declared.join(", ")}] must match the script's "// @permissions" line [${inHeader.join(", ")}].`,
        );
      }
    }
    if (Array.isArray(meta.widgetSizes)) {
      const inHeader = header.widget || [];
      if (!sameSet(meta.widgetSizes, inHeader) || !sameSet(inHeader, meta.widgetSizes)) {
        add(
          "widget-mismatch",
          "soft",
          `meta.json widgetSizes [${meta.widgetSizes.join(", ")}] differ from the script's "// @widget" line [${inHeader.join(", ")}].`,
        );
      }
    }
  }

  return { meta, findings };
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node tools/validate-meta.mjs scripts/<id>/meta.json");
    process.exit(2);
  }
  const folder = path.dirname(path.resolve(file));
  const scriptPath = path.join(folder, "script.js");
  const { findings } = validateMeta({
    metaText: readFileSync(file, "utf8"),
    folderId: path.basename(folder),
    scriptSource: existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : undefined,
  });
  const hard = findings.filter((f) => f.severity === "hard");
  console.log(`${file}: ${hard.length === 0 ? "OK" : "FAILED"}`);
  for (const finding of findings) console.log(`  [${finding.severity}] ${finding.ruleId}: ${finding.message}`);
  process.exit(hard.length === 0 ? 0 : 1);
}

if (isMain(import.meta.url)) main();
