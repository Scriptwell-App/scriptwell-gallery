/*
 * The same checks the gallery's pull request workflow runs, applied before a
 * pull request exists: schema rules for meta.json, the word filter, the shared
 * analyzer and the icon limits. A submission with a hard finding never reaches
 * GitHub. Pure: no I/O, no environment.
 */
import * as acorn from "acorn";
import core from "../../tools/analyzer/analyzer-core.js";
import rules from "../../tools/analyzer/rules.json" with { type: "json" };
import { astFindings } from "../../tools/lib/ast-checks.mjs";
import { checkIconBytes, checkScreenshotBytes, SCREENSHOT_NAMES } from "../../tools/lib/png.mjs";
import { base64Decode, decoder, encoder } from "./util.js";

export const LIMITS = {
  script: 1024 * 1024,
  readme: 64 * 1024,
  iconBase64: 400 * 1024,
  /** One screenshot, base64: 600 KB of PNG plus the base64 overhead. */
  screenshotBase64: 820 * 1024,
  screenshots: SCREENSHOT_NAMES.length,
  /** Script, icon and up to eight screenshots. */
  body: 8 * 1024 * 1024,
};

// Mirrors schema/meta.schema.json. Keep the two in step.
export const META = {
  order: ["id", "name", "author", "version", "description", "permissions", "minAppVersion", "widgetSizes", "license", "category", "homepage"],
  idPattern: /^[a-z0-9][a-z0-9-]{2,49}$/,
  authorPattern: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,
  versionPattern: /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
  minAppVersionPattern: /^\d+\.\d+(\.\d+)?$/,
  permissions: ["network", "location", "calendar", "reminders", "notifications", "clipboard", "camera", "microphone", "contacts", "health", "cloudai", "bluetooth", "motion"],
  widgetSizes: ["small", "medium", "large", "extraLarge", "circular", "rectangular", "inline"],
  categories: ["books", "business", "developer-tools", "education", "entertainment", "finance", "food-drink", "games", "graphics-design", "health-fitness", "kids", "lifestyle", "magazines-newspapers", "medical", "music", "navigation", "news", "photo-video", "productivity", "reference", "shopping", "social-networking", "sports", "travel", "utilities", "weather"],
};

const PARSE_OPTIONS = { ecmaVersion: "latest", sourceType: "script", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, locations: true };
const RULE_MESSAGES = Object.fromEntries((rules.rules || []).filter((rule) => rule.message).map((rule) => [rule.id, rule.message]));

const sameSet = (a, b) => a.length === b.length && a.every((item) => b.includes(item));

function parseFindings(source) {
  let ast;
  try {
    ast = acorn.parse(source, PARSE_OPTIONS);
  } catch (error) {
    try {
      const found = astFindings(acorn.parse(source, { ...PARSE_OPTIONS, sourceType: "module" }), RULE_MESSAGES);
      if (found.some((f) => f.ruleId === "no-modules")) return found;
    } catch {
      // Not a module either; report the original error.
    }
    return [{ ruleId: "syntax-error", severity: "hard", message: "Syntax error: " + (error && error.message ? error.message : String(error)), line: error && error.loc ? error.loc.line : 0, column: 0 }];
  }
  return astFindings(ast, RULE_MESSAGES);
}

/** Validate `meta` against the schema rules and return the normalized object, or findings. */
export function checkMeta(meta, add) {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
    add("meta-schema", "hard", "meta must be a JSON object.");
    return null;
  }
  for (const key of Object.keys(meta)) {
    if (key === "status") add("meta-schema", "hard", 'meta.json must not set "status"; maintainers use it to hide scripts.');
    else if (!META.order.includes(key)) add("meta-schema", "hard", `meta.json has an unknown field "${key}".`);
  }
  const str = (key, pattern, message) => {
    const value = meta[key];
    if (typeof value !== "string" || !pattern.test(value)) add("meta-schema", "hard", message);
    return typeof value === "string" ? value : "";
  };
  const text = (key, max) => {
    const value = meta[key];
    if (typeof value !== "string" || value.length < 1 || value.length > max) add("meta-schema", "hard", `meta.json ${key} must be 1–${max} characters.`);
    return typeof value === "string" ? value : "";
  };
  const list = (key, allowed) => {
    const value = meta[key];
    if (!Array.isArray(value) || new Set(value).size !== value.length || value.some((item) => !allowed.includes(item))) {
      add("meta-schema", "hard", `meta.json ${key} must be a list without duplicates drawn from: ${allowed.join(", ")}.`);
      return [];
    }
    return value;
  };

  const normalized = {
    id: str("id", META.idPattern, "meta.json id must be 3–50 characters: lowercase letters, digits and hyphens."),
    name: text("name", 50),
    author: str("author", META.authorPattern, "meta.json author must be 1–39 characters: letters, digits and hyphens."),
    version: str("version", META.versionPattern, "meta.json version must look like 1.0.0."),
    description: text("description", 280),
    permissions: list("permissions", META.permissions),
    minAppVersion: str("minAppVersion", META.minAppVersionPattern, "meta.json minAppVersion must look like 1.0 or 1.0.0."),
    widgetSizes: list("widgetSizes", META.widgetSizes),
    license: text("license", 40),
    category: str("category", new RegExp(`^(${META.categories.join("|")})$`), "meta.json category must be one of the App Store categories."),
  };
  if (meta.homepage !== undefined) {
    if (typeof meta.homepage !== "string" || !/^https:\/\/\S+$/.test(meta.homepage) || meta.homepage.length > 200) add("meta-schema", "hard", "meta.json homepage must be an https:// link of at most 200 characters.");
    else normalized.homepage = meta.homepage;
  }
  return normalized;
}

/**
 * @param payload the request body: { meta, script, icon (base64 PNG), readme?, screenshots? }
 *   `screenshots` maps a widget family or "app" to a base64 PNG the app captured.
 * @returns {{ ok: boolean, findings: object[], meta: object|null, files: object, analysis: object|null }}
 *   `files` maps "script.js" | "meta.json" | "icon.png" | "README.md" | "screenshots/<name>.png" to bytes.
 */
export function validateSubmission(payload) {
  const findings = [];
  const add = (ruleId, severity, message, line = 0) => findings.push({ ruleId, severity, message, line, column: 0 });
  const result = () => ({ ok: !findings.some((f) => f.severity === "hard"), findings, meta, files, analysis });
  const files = {};
  let meta = null;
  let analysis = null;

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    add("request", "hard", "The request body must be a JSON object.");
    return result();
  }

  // script.js
  const script = payload.script;
  if (typeof script !== "string" || script.length === 0) add("request", "hard", "script must be a non-empty string.");
  else if (encoder.encode(script).length > LIMITS.script) add("request", "hard", "script.js is larger than 1 MB.");
  else if (script.includes("\u0000")) add("request", "hard", "script.js contains NUL bytes.");
  else files["script.js"] = encoder.encode(script);

  // meta.json
  meta = checkMeta(payload.meta, add);

  // icon.png
  if (typeof payload.icon !== "string" || payload.icon.length === 0) add("request", "hard", "icon must be a base64-encoded PNG.");
  else if (payload.icon.length > LIMITS.iconBase64) add("icon-too-large", "hard", "icon.png is larger than the gallery allows.");
  else {
    try {
      const bytes = base64Decode(payload.icon);
      const iconFindings = checkIconBytes(bytes);
      findings.push(...iconFindings);
      if (iconFindings.length === 0) files["icon.png"] = bytes;
    } catch {
      add("icon-not-png", "hard", "icon is not valid base64.");
    }
  }

  // README.md (optional)
  if (payload.readme !== undefined) {
    if (typeof payload.readme !== "string" || encoder.encode(payload.readme).length > LIMITS.readme) add("request", "hard", "readme must be a string of at most 64 KB.");
    else if (payload.readme.trim() !== "") {
      if (core.checkText(payload.readme, rules).length > 0) add("readme-text", "soft", "README.md contains words from the text filter. Read it before approving.");
      files["README.md"] = encoder.encode(payload.readme.endsWith("\n") ? payload.readme : payload.readme + "\n");
    }
  }

  // screenshots/<name>.png (optional)
  if (payload.screenshots !== undefined) {
    const shots = payload.screenshots;
    if (shots === null || typeof shots !== "object" || Array.isArray(shots)) {
      add("request", "hard", "screenshots must be an object mapping a widget family or \"app\" to a base64 PNG.");
    } else if (Object.keys(shots).length > LIMITS.screenshots) {
      add("request", "hard", `screenshots may hold at most ${LIMITS.screenshots} pictures.`);
    } else {
      for (const [name, value] of Object.entries(shots)) {
        if (!SCREENSHOT_NAMES.includes(name)) {
          add("screenshot-name", "hard", `screenshots has an unknown name "${String(name).slice(0, 40)}". Allowed: ${SCREENSHOT_NAMES.join(", ")}.`);
          continue;
        }
        if (typeof value !== "string" || value.length === 0 || value.length > LIMITS.screenshotBase64) {
          add("screenshot-too-large", "hard", `screenshots/${name}.png is missing or larger than the gallery allows.`);
          continue;
        }
        let bytes;
        try {
          bytes = base64Decode(value);
        } catch {
          add("screenshot-not-png", "hard", `screenshots/${name}.png is not valid base64.`);
          continue;
        }
        const shotFindings = checkScreenshotBytes(name, bytes);
        findings.push(...shotFindings);
        if (shotFindings.length === 0) files[`screenshots/${name}.png`] = bytes;
      }
    }
  }

  if (meta) {
    for (const field of ["name", "description"]) {
      const hits = core.checkText(meta[field], rules);
      if (hits.length > 0) add("objectionable-text", "hard", `The ${field} contains words that are not allowed in the gallery (${hits.length} match${hits.length === 1 ? "" : "es"}).`);
    }
  }

  if (meta && files["script.js"]) {
    const header = core.parseManifest(script);
    const inHeader = header.permissions.map((p) => String(p).toLowerCase());
    if (!sameSet(meta.permissions, inHeader) || !sameSet(inHeader, meta.permissions)) {
      add("permission-mismatch", "hard", `meta.json permissions [${meta.permissions.join(", ")}] must match the script's "// @permissions" line [${inHeader.join(", ")}].`);
    }
    const widgets = header.widget || [];
    if (!sameSet(meta.widgetSizes, widgets) || !sameSet(widgets, meta.widgetSizes)) {
      add("widget-mismatch", "soft", `meta.json widgetSizes [${meta.widgetSizes.join(", ")}] differ from the script's "// @widget" line [${widgets.join(", ")}].`);
    }

    analysis = core.analyze(script, rules, { declaredPermissions: meta.permissions });
    const seen = new Set();
    for (const finding of [...analysis.findings, ...parseFindings(script)]) {
      const key = finding.ruleId + ":" + finding.line;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(finding);
    }
  }

  if (meta && !findings.some((f) => f.severity === "hard")) {
    // Canonical meta.json: schema order, two-space indent, trailing newline.
    const ordered = {};
    for (const key of META.order) if (meta[key] !== undefined) ordered[key] = meta[key];
    files["meta.json"] = encoder.encode(JSON.stringify(ordered, null, 2) + "\n");
  }

  findings.sort((a, b) => (a.severity === b.severity ? (a.line || 0) - (b.line || 0) : a.severity === "hard" ? -1 : 1));
  return result();
}

/** Decode a script file back to text (used by tests and the PR body). */
export function textOf(bytes) {
  return decoder.decode(bytes);
}
