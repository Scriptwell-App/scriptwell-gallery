/*
 * Tests for the gallery tools. Run with `npm test` in tools/.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeScript } from "../analyze.mjs";
import { validateMeta } from "../validate-meta.mjs";
import { checkIconBytes, readPngSize } from "../check-icon.mjs";
import { checkScreenshotBytes, screenshotName } from "../lib/png.mjs";
import { classifyPaths, review, reviewScript, screenshotURL, COMMENT_MARKER } from "../review-pr.mjs";
import { buildIndex } from "../build-index.mjs";
import { core, rules, sha256 } from "../lib/common.mjs";

// The tests use their own copy of a sample script, so removing or changing the
// scripts published in `scripts/` can never break the publish workflow.
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const SAMPLE = path.join(FIXTURES, "scripts", "hello-widget");

const ruleIds = (result) => result.findings.map((f) => f.ruleId);
const hardIds = (result) => result.findings.filter((f) => f.severity === "hard").map((f) => f.ruleId);

const CLEAN = `// @name Clean
// @permissions network
// @widget small
const response = await fetch("https://example.com/data.json");
const data = await response.json();
Script.widget(async () => ({ type: "text", text: String(data.value) }));
`;

function pngHeader(width, height, totalLength = 64) {
  const bytes = Buffer.alloc(totalLength);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const validMeta = (overrides = {}) => ({
  id: "my-script",
  name: "My Script",
  author: "octocat",
  version: "1.0.0",
  description: "Shows a value from example.com.",
  permissions: ["network"],
  minAppVersion: "1.0",
  widgetSizes: ["small"],
  license: "MIT",
  category: "utilities",
  ...overrides,
});

function makeRepo(scripts) {
  const root = mkdtempSync(path.join(os.tmpdir(), "gallery-test-"));
  for (const [id, files] of Object.entries(scripts)) {
    const dir = path.join(root, "scripts", id);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      // "screenshots/small.png" style names create the sub-folder.
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), content);
    }
  }
  return root;
}

const goodFiles = (overrides = {}) => ({
  "script.js": CLEAN,
  "meta.json": JSON.stringify(validMeta()),
  "icon.png": readFileSync(path.join(SAMPLE, "icon.png")),
  ...overrides,
});

// ---------------------------------------------------------------- analyzer

test("a clean script passes with no findings", () => {
  const result = analyzeScript(CLEAN);
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.usedPermissions, ["network"]);
});

test("top-level await and return are valid", () => {
  const result = analyzeScript("const x = await Promise.resolve(1);\nreturn x;\n");
  assert.equal(result.ok, true);
});

test("eval is a hard failure, reported once per line", () => {
  const result = analyzeScript("const x = eval('1 + 1');\n");
  assert.equal(result.ok, false);
  assert.deepEqual(hardIds(result), ["no-eval"]);
});

test("eval through globalThis is caught by the AST pass", () => {
  const result = analyzeScript("globalThis.eval('1');\n(0, eval)('2');\n");
  assert.equal(result.ok, false);
  assert.ok(ruleIds(result).includes("no-eval"));
  assert.ok(ruleIds(result).includes("no-eval-reference"));
});

test("new Function and Function() are hard failures", () => {
  assert.ok(hardIds(analyzeScript("const f = new Function('return 1');\n")).includes("no-new-function"));
  assert.ok(hardIds(analyzeScript("const f = Function('return 1');\n")).includes("no-function-call"));
});

test("dynamic import is a hard failure", () => {
  const result = analyzeScript("const m = await import('https://example.com/x.js');\n");
  assert.equal(result.ok, false);
  assert.ok(hardIds(result).includes("no-dynamic-import"));
});

test("import/export declarations get a clear message", () => {
  const result = analyzeScript("import x from './x.js';\nexport const y = 1;\n");
  assert.equal(result.ok, false);
  assert.ok(hardIds(result).includes("no-modules"));
  assert.ok(!hardIds(result).includes("syntax-error"));
});

test("a script that does not parse is a hard syntax-error with a line", () => {
  const result = analyzeScript("const a = 1;\nconst b = ;\n");
  assert.equal(result.ok, false);
  const finding = result.findings.find((f) => f.ruleId === "syntax-error");
  assert.ok(finding);
  assert.equal(finding.line, 2);
});

test("obfuscation: escapes, hex identifiers, minified lines", () => {
  const escapes = "const s = '" + "\\x41".repeat(80) + "';\n";
  assert.ok(hardIds(analyzeScript(escapes)).includes("heavy-escapes"));

  const hexIds = "var _0x1a2b = 1, _0x3c4d = 2, _0x5e6f = 3, _0x7a8b = 4;\n";
  assert.ok(hardIds(analyzeScript(hexIds)).includes("obfuscator-identifiers"));

  const minified = "var a=1;" + "a=a+1;".repeat(300) + "\n";
  assert.ok(hardIds(analyzeScript(minified)).includes("minified-line"));

  const escapedIdentifier = "\\u0065val('1');\n";
  assert.equal(analyzeScript(escapedIdentifier).ok, false);
});

test("an undeclared permission is a hard failure", () => {
  const source = "// @name X\nconst here = await Location.current();\n";
  const result = analyzeScript(source);
  assert.equal(result.ok, false);
  assert.ok(hardIds(result).includes("undeclared-permission"));
});

test("meta.json permissions override the header", () => {
  const source = "// @permissions network\nawait fetch('https://example.com');\n";
  assert.equal(analyzeScript(source, { declaredPermissions: ["network"] }).ok, true);
  assert.equal(analyzeScript(source, { declaredPermissions: [] }).ok, false);
});

test("soft findings do not fail the script", () => {
  const source = "// @permissions network, clipboard\nawait fetch('https://example.com');\n";
  const result = analyzeScript(source);
  assert.equal(result.ok, true);
  const unused = result.findings.find((f) => f.ruleId === "unused-permission");
  assert.ok(unused);
  assert.equal(unused.severity, "soft");

  // A long but readable multi-line template literal: flagged for review, not rejected.
  const longString = "const s = `" + "some words on a line\n".repeat(120) + "`;\n";
  const long = analyzeScript(longString);
  assert.equal(long.ok, true, JSON.stringify(long.findings));
  assert.ok(long.findings.some((f) => f.ruleId === "long-string-literal" && f.severity === "soft"));
});

test("code inside strings and comments is not flagged", () => {
  const source = "// eval('x') in a comment\nconst s = \"eval('x') and new Function('y')\";\nconst t = `fetch(${1})`;\n";
  const result = analyzeScript(source);
  assert.equal(result.ok, true, JSON.stringify(result.findings));
});

// ------------------------------------------------------------- text filter

test("text filter matches whole words, including simple leetspeak", () => {
  assert.ok(core.checkText("My sh1t script", rules).length > 0);
  assert.deepEqual(core.checkText("Assess the classic bass line", rules), []);
  assert.deepEqual(core.checkText("A weather widget", rules), []);
});

// -------------------------------------------------------------------- icon

test("icon checker reads PNG dimensions", () => {
  assert.deepEqual(readPngSize(pngHeader(512, 512)), { width: 512, height: 512 });
  assert.equal(readPngSize(Buffer.from("not a png at all, definitely not")), null);
});

test("icon checker enforces format, shape, size and weight", () => {
  assert.deepEqual(checkIconBytes(pngHeader(512, 512)), []);
  assert.deepEqual(checkIconBytes(Buffer.from("GIF89a..........................")).map((f) => f.ruleId), ["icon-not-png"]);
  assert.ok(checkIconBytes(pngHeader(512, 256)).some((f) => f.ruleId === "icon-not-square"));
  assert.ok(checkIconBytes(pngHeader(128, 128)).some((f) => f.ruleId === "icon-size"));
  assert.ok(checkIconBytes(pngHeader(2048, 2048)).some((f) => f.ruleId === "icon-size"));
  assert.ok(checkIconBytes(pngHeader(512, 512, 300 * 1024)).some((f) => f.ruleId === "icon-too-large"));
});

test("screenshot checker: names, shape, size and weight", () => {
  assert.equal(screenshotName("small.png"), "small");
  assert.equal(screenshotName("app.png"), "app");
  assert.equal(screenshotName("Small.png"), null);
  assert.equal(screenshotName("small.jpg"), null);
  assert.equal(screenshotName("../small.png"), null);

  assert.deepEqual(checkScreenshotBytes("medium", pngHeader(676, 316)), []);
  assert.deepEqual(checkScreenshotBytes("small", pngHeader(316, 316)), []);
  assert.deepEqual(checkScreenshotBytes("app", pngHeader(780, 2400)), []);
  assert.deepEqual(checkScreenshotBytes("small", pngHeader(676, 316)).map((f) => f.ruleId), ["screenshot-aspect"]);
  assert.deepEqual(checkScreenshotBytes("medium", pngHeader(2000, 935)).map((f) => f.ruleId), ["screenshot-size"]);
  assert.deepEqual(checkScreenshotBytes("app", pngHeader(780, 9000)).map((f) => f.ruleId), ["screenshot-size"]);
  assert.deepEqual(checkScreenshotBytes("small", pngHeader(316, 316, 700 * 1024)).map((f) => f.ruleId), ["screenshot-too-large"]);
  assert.deepEqual(checkScreenshotBytes("small", Buffer.from("not a png")).map((f) => f.ruleId), ["screenshot-not-png"]);
  assert.deepEqual(checkScreenshotBytes("banner", pngHeader(316, 316)).map((f) => f.ruleId), ["screenshot-name"]);
});

test("the sample icon is valid", () => {
  assert.deepEqual(checkIconBytes(readFileSync(path.join(SAMPLE, "icon.png"))), []);
});

// -------------------------------------------------------------------- meta

test("valid meta.json passes", () => {
  const { findings } = validateMeta({ metaText: JSON.stringify(validMeta()), folderId: "my-script", scriptSource: CLEAN });
  assert.deepEqual(findings, []);
});

test("meta.json schema violations are hard", () => {
  const cases = [
    validMeta({ description: "x".repeat(281) }),
    validMeta({ version: "1.0" }),
    validMeta({ permissions: ["network", "nfc"] }),
    validMeta({ author: "not a handle!" }),
    validMeta({ category: "other" }),
    validMeta({ unknownField: true }),
    validMeta({ homepage: "http://insecure.example" }),
    (() => { const m = validMeta(); delete m.license; return m; })(),
  ];
  for (const meta of cases) {
    const { findings } = validateMeta({ metaText: JSON.stringify(meta), folderId: "my-script", scriptSource: CLEAN });
    assert.ok(findings.some((f) => f.ruleId === "meta-schema" && f.severity === "hard"), JSON.stringify(meta));
  }
});

test("meta.json: invalid JSON, id mismatch, objectionable text, permission mismatch", () => {
  assert.equal(validateMeta({ metaText: "{ nope", folderId: "x" }).findings[0].ruleId, "meta-invalid-json");

  const mismatch = validateMeta({ metaText: JSON.stringify(validMeta()), folderId: "other-name", scriptSource: CLEAN });
  assert.ok(mismatch.findings.some((f) => f.ruleId === "id-mismatch"));

  const rude = validateMeta({ metaText: JSON.stringify(validMeta({ name: "Shit Widget" })), folderId: "my-script", scriptSource: CLEAN });
  assert.ok(rude.findings.some((f) => f.ruleId === "objectionable-text" && f.severity === "hard"));

  const perms = validateMeta({ metaText: JSON.stringify(validMeta({ permissions: [] })), folderId: "my-script", scriptSource: CLEAN });
  assert.ok(perms.findings.some((f) => f.ruleId === "permission-mismatch" && f.severity === "hard"));

  const widget = validateMeta({ metaText: JSON.stringify(validMeta({ widgetSizes: ["large"] })), folderId: "my-script", scriptSource: CLEAN });
  assert.ok(widget.findings.some((f) => f.ruleId === "widget-mismatch" && f.severity === "soft"));
});

// ------------------------------------------------------------------ review

test("changed paths are grouped by script folder", () => {
  assert.deepEqual(classifyPaths(["scripts/pic-script/screenshots/small.png", "scripts/pic-script/screenshots/odd.txt"]), { ids: ["pic-script"], outside: [] });
  assert.deepEqual(classifyPaths(["scripts/pic-script/other/small.png"]).outside, ["scripts/pic-script/other/small.png"]);
  const { ids, outside } = classifyPaths([
    "scripts/my-script/script.js",
    "scripts/my-script/meta.json",
    "scripts/other-one/icon.png",
    "scripts/my-script/extra.js",
    "scripts/my-script/nested/file.js",
    "scripts/BadName/script.js",
    "tools/analyze.mjs",
    ".github/workflows/validate.yml",
  ]);
  assert.deepEqual(ids, ["my-script", "other-one"]);
  assert.equal(outside.length, 5);
});

test("the sample script passes a full review", () => {
  const result = reviewScript({ root: FIXTURES, id: "hello-widget" });
  assert.deepEqual(result.findings, []);
  assert.equal(result.sha256, sha256(readFileSync(path.join(SAMPLE, "script.js"))));
});

test("a good submission gets checks-passed", () => {
  const root = makeRepo({ "my-script": goodFiles() });
  const outcome = review({ root, changed: ["scripts/my-script/script.js", "scripts/my-script/meta.json", "scripts/my-script/icon.png"], prAuthor: "octocat" });
  assert.equal(outcome.summary.hard, 0, outcome.markdown);
  assert.equal(outcome.summary.soft, 0, outcome.markdown);
  assert.deepEqual(outcome.summary.labels, ["checks-passed"]);
  assert.ok(outcome.markdown.startsWith(COMMENT_MARKER));
});

test("a bad submission is blocked and labelled", () => {
  const root = makeRepo({ "my-script": goodFiles({ "script.js": CLEAN + "eval('1');\n", "payload.bin": "x" }) });
  const outcome = review({ root, changed: ["scripts/my-script/script.js", "README.md"], prAuthor: "someone-else" });
  assert.ok(outcome.summary.hard >= 3, outcome.markdown); // eval, unexpected file, outside path
  assert.ok(outcome.summary.labels.includes("needs-changes"));
  assert.ok(outcome.summary.labels.includes("needs-careful-review")); // author mismatch
  assert.ok(outcome.summary.outside.includes("README.md"));
});

test("pull requests opened by the submission service's bot skip the author comparison", () => {
  const root = makeRepo({ "my-script": goodFiles() });
  const byBot = review({ root, changed: ["scripts/my-script/script.js", "scripts/my-script/meta.json", "scripts/my-script/icon.png"], prAuthor: "scriptwell-submissions[bot]" });
  assert.ok(!byBot.markdown.includes("author-mismatch"), byBot.markdown);
  const byPerson = review({ root, changed: ["scripts/my-script/script.js", "scripts/my-script/meta.json", "scripts/my-script/icon.png"], prAuthor: "someone-else" });
  assert.ok(byPerson.markdown.includes("author-mismatch"), byPerson.markdown);
});

test("screenshots: known names pass, are listed, and are shown when the head commit is known", () => {
  const root = makeRepo({ "my-script": goodFiles({ "screenshots/small.png": pngHeader(316, 316), "screenshots/app.png": pngHeader(780, 1600) }) });
  const changed = ["scripts/my-script/script.js", "scripts/my-script/meta.json", "scripts/my-script/icon.png", "scripts/my-script/screenshots/small.png", "scripts/my-script/screenshots/app.png"];
  const plain = review({ root, changed, prAuthor: "octocat" });
  assert.equal(plain.summary.hard, 0, plain.markdown);
  assert.deepEqual(plain.summary.scripts[0].screenshots, ["small", "app"]);
  assert.ok(plain.markdown.includes("| Screenshots | `small`, `app` |"));
  assert.ok(!plain.markdown.includes("<img"), "no head commit, no pictures");

  const withHead = review({ root, changed, prAuthor: "octocat", headRepository: "octocat/scriptwell-gallery", headSha: "0123456789abcdef0123456789abcdef01234567" });
  assert.ok(withHead.markdown.includes('<img alt="small" src="https://raw.githubusercontent.com/octocat/scriptwell-gallery/0123456789abcdef0123456789abcdef01234567/scripts/my-script/screenshots/small.png"'));
  assert.equal(screenshotURL({ headRepository: "bad repo", headSha: "abc1234" }, "my-script", "small"), null);
  assert.equal(screenshotURL({ headRepository: "a/b", headSha: "not-a-sha" }, "my-script", "small"), null);
  assert.equal(screenshotURL({ headRepository: "a/b", headSha: "abc1234" }, "my-script", "banner"), null);
});

test("screenshots: unknown names, wrong shapes and symlinks are blocking", () => {
  const root = makeRepo({ "my-script": goodFiles({ "screenshots/small.png": pngHeader(676, 316), "screenshots/banner.png": pngHeader(316, 316) }) });
  symlinkSync(path.join(root, "scripts", "my-script", "icon.png"), path.join(root, "scripts", "my-script", "screenshots", "medium.png"));
  const result = reviewScript({ root, id: "my-script" });
  const ids = result.findings.filter((f) => f.severity === "hard").map((f) => f.ruleId).sort();
  assert.deepEqual(ids, ["invalid-file", "screenshot-aspect", "unexpected-file"]);
  assert.deepEqual(result.screenshots, []);

  // A file where the folder should be.
  const flat = makeRepo({ "my-script": goodFiles({ screenshots: "x" }) });
  assert.ok(reviewScript({ root: flat, id: "my-script" }).findings.some((f) => f.ruleId === "invalid-file"));
});

test("files outside script folders are only soft for maintainers", () => {
  const root = makeRepo({});
  const contributor = review({ root, changed: ["tools/analyze.mjs"], authorAssociation: "CONTRIBUTOR" });
  assert.equal(contributor.summary.hard, 1);
  const owner = review({ root, changed: ["tools/analyze.mjs"], authorAssociation: "OWNER" });
  assert.equal(owner.summary.hard, 0);
  assert.equal(owner.summary.soft, 1);
});

test("symlinks in a submission are rejected, not followed", () => {
  const root = makeRepo({ "my-script": goodFiles() });
  const secret = path.join(root, "secret.txt");
  writeFileSync(secret, "do not read me");
  const readme = path.join(root, "scripts", "my-script", "README.md");
  symlinkSync(secret, readme);
  const result = reviewScript({ root, id: "my-script" });
  assert.ok(result.findings.some((f) => f.ruleId === "invalid-file" && f.severity === "hard"));
});

test("updates: unchanged version and status changes are flagged", () => {
  const base = makeRepo({ "my-script": goodFiles() });
  const head = makeRepo({
    "my-script": goodFiles({
      "script.js": CLEAN + "console.log('changed');\n",
      "meta.json": JSON.stringify(validMeta({ status: "hidden" })),
    }),
  });
  const result = reviewScript({ root: head, id: "my-script", baseRoot: base, prAuthor: "octocat" });
  assert.equal(result.kind, "update");
  const ids = ruleIds(result);
  assert.ok(ids.includes("version-not-bumped"));
  assert.ok(ids.includes("status-changed"));
  assert.ok(result.findings.every((f) => f.severity === "soft"), JSON.stringify(result.findings));

  const byMaintainer = reviewScript({ root: head, id: "my-script", baseRoot: base, prAuthor: "octocat", isMaintainer: true });
  assert.ok(!ruleIds(byMaintainer).includes("status-changed"));
});

test("updates: the author must stay the same as in the first submission", () => {
  const base = makeRepo({ "my-script": goodFiles() });
  const bumped = (overrides) => makeRepo({
    "my-script": goodFiles({
      "script.js": CLEAN + "console.log('changed');\n",
      "meta.json": JSON.stringify(validMeta({ version: "1.0.1", ...overrides })),
    }),
  });

  const same = reviewScript({ root: bumped({}), id: "my-script", baseRoot: base, prAuthor: "octocat" });
  assert.deepEqual(hardIds(same), [], JSON.stringify(same.findings));

  // Case does not count as a different name.
  const recased = reviewScript({ root: bumped({ author: "OctoCat" }), id: "my-script", baseRoot: base, prAuthor: "octocat" });
  assert.deepEqual(hardIds(recased), [], JSON.stringify(recased.findings));

  // The service's bot opens pull requests for app users; the author in meta.json still cannot change.
  const renamed = reviewScript({ root: bumped({ author: "someone-else" }), id: "my-script", baseRoot: base, prAuthor: "scriptwell-submissions[bot]" });
  assert.ok(hardIds(renamed).includes("author-changed"), JSON.stringify(renamed.findings));

  // An update opened from someone else's GitHub account is blocked, even with the original author in meta.json.
  const otherAccount = reviewScript({ root: bumped({}), id: "my-script", baseRoot: base, prAuthor: "someone-else" });
  assert.ok(hardIds(otherAccount).includes("author-mismatch"), JSON.stringify(otherAccount.findings));

  // A maintainer may open an update on the author's behalf, but cannot change the author.
  const byMaintainer = reviewScript({ root: bumped({}), id: "my-script", baseRoot: base, prAuthor: "maintainer", isMaintainer: true });
  assert.deepEqual(hardIds(byMaintainer), [], JSON.stringify(byMaintainer.findings));

  // A new script opened by someone other than the named author is only noted.
  const fresh = reviewScript({ root: base, id: "my-script", prAuthor: "someone-else" });
  assert.ok(ruleIds(fresh).includes("author-mismatch"));
  assert.ok(!hardIds(fresh).includes("author-mismatch"));
});

test("submission text cannot inject markdown into the comment", () => {
  const meta = validMeta({ description: "nice | table `break` @someone <b>bold</b>" });
  const root = makeRepo({ "my-script": goodFiles({ "meta.json": JSON.stringify(meta) }) });
  const outcome = review({ root, changed: ["scripts/my-script/meta.json"], prAuthor: "octocat" });
  const line = outcome.markdown.split("\n").find((l) => l.startsWith("| Description"));
  assert.ok(line.includes("`nice \\| table  break  @someone <b>bold</b>`"), line);
});

// ------------------------------------------------------------------- index

test("index build: contract fields, sorting, hidden handling", () => {
  const root = makeRepo({
    "zeta-script": goodFiles({ "meta.json": JSON.stringify(validMeta({ id: "zeta-script" })), "README.md": "# Zeta\n" }),
    "alpha-script": goodFiles({ "meta.json": JSON.stringify(validMeta({ id: "alpha-script", status: "hidden" })) }),
  });
  const out = path.join(root, "_site");
  const { index, failures } = buildIndex({ root, out, now: new Date("2026-01-02T03:04:05Z") });
  assert.deepEqual(failures, []);
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.generatedAt, "2026-01-02T03:04:05.000Z");
  assert.deepEqual(index.scripts.map((s) => s.id), ["alpha-script", "zeta-script"]);

  const [alpha, zeta] = index.scripts;
  assert.equal(alpha.status, "hidden");
  assert.equal(zeta.status, "public");
  assert.deepEqual(Object.keys(zeta), [
    "id", "name", "author", "version", "description", "permissions", "minAppVersion", "widgetSizes",
    "license", "category", "status", "sha256", "size", "scriptPath", "iconPath", "readmePath", "updatedAt",
    "createdAt", "featured", "blurb", "stars", "installs", "starsURL", "homepage", "screenshots",
  ]);
  assert.deepEqual(zeta.screenshots, {});
  assert.equal(zeta.featured, null);
  assert.equal(zeta.stars, null);
  assert.deepEqual(index.hero, []);
  assert.deepEqual(index.editorsChoice, []);
  assert.equal(zeta.sha256, sha256(Buffer.from(CLEAN)));
  assert.equal(zeta.size, Buffer.byteLength(CLEAN));
  assert.equal(zeta.scriptPath, "scripts/zeta-script/script.js");
  assert.equal(zeta.readmePath, "scripts/zeta-script/README.md");
  assert.equal(alpha.readmePath, null);

  assert.ok(existsSync(path.join(out, "index.json")));
  assert.ok(existsSync(path.join(out, "scripts", "zeta-script", "script.js")));
  assert.ok(!existsSync(path.join(out, "scripts", "alpha-script")), "hidden scripts are not published");
  assert.deepEqual(JSON.parse(readFileSync(path.join(out, "index.json"), "utf8")), index);
});

test("index build publishes screenshots and lists them by name", () => {
  const root = makeRepo({ "pic-script": goodFiles({ "meta.json": JSON.stringify(validMeta({ id: "pic-script" })), "screenshots/small.png": pngHeader(316, 316), "screenshots/app.png": pngHeader(780, 1600) }) });
  const out = path.join(root, "_site");
  const { index, failures } = buildIndex({ root, out });
  assert.deepEqual(failures, []);
  assert.deepEqual(index.scripts[0].screenshots, { small: "scripts/pic-script/screenshots/small.png", app: "scripts/pic-script/screenshots/app.png" });
  assert.ok(existsSync(path.join(out, "scripts", "pic-script", "screenshots", "small.png")));
  assert.ok(existsSync(path.join(out, "scripts", "pic-script", "screenshots", "app.png")));
});

test("index build: featured.json and stats.json feed the front page", () => {
  const root = makeRepo({
    "zeta-script": goodFiles({ "meta.json": JSON.stringify(validMeta({ id: "zeta-script" })) }),
    "alpha-script": goodFiles({ "meta.json": JSON.stringify(validMeta({ id: "alpha-script" })) }),
  });
  writeFileSync(path.join(root, "featured.json"), JSON.stringify({ hero: ["zeta-script"], editorsChoice: ["alpha-script", "zeta-script"], blurbs: { "zeta-script": "The one to try first." } }));
  writeFileSync(path.join(root, "stats.json"), JSON.stringify({ "alpha-script": { stars: 7, starsURL: "https://github.com/o/r/issues/3" }, "zeta-script": { stars: "many" } }));
  const { index, failures } = buildIndex({ root, out: path.join(root, "_site") });
  assert.deepEqual(failures, []);
  const [alpha, zeta] = index.scripts;
  assert.deepEqual(index.hero, ["zeta-script"]);
  assert.deepEqual(index.editorsChoice, ["alpha-script", "zeta-script"]);
  assert.equal(zeta.featured, "hero");
  assert.equal(zeta.blurb, "The one to try first.");
  assert.equal(zeta.stars, null, "a non-numeric star count is ignored");
  assert.equal(alpha.featured, "editorsChoice");
  assert.equal(alpha.stars, 7);
  assert.equal(alpha.starsURL, "https://github.com/o/r/issues/3");
});

test("index build refuses a featured id that has no script", () => {
  const root = makeRepo({ "my-script": goodFiles() });
  writeFileSync(path.join(root, "featured.json"), JSON.stringify({ hero: ["ghost-script"] }));
  const { failures } = buildIndex({ root, out: path.join(root, "_site") });
  assert.ok(failures.some((f) => f.includes("ghost-script")));
});

test("index build refuses to publish a public script with a hard finding", () => {
  const root = makeRepo({ "my-script": goodFiles({ "script.js": CLEAN + "eval('1');\n" }) });
  const out = path.join(root, "_site");
  const { failures } = buildIndex({ root, out });
  assert.ok(failures.length > 0);
  assert.ok(!existsSync(path.join(out, "index.json")));
});

test("the gallery copy of the analyzer is self-consistent", () => {
  // rules.json and analyzer-core.js are synced from the app repository; the
  // rules must reference only rule kinds the core implements.
  const kinds = new Set(["sequence", "identifier", "metric", "permissions"]);
  for (const rule of rules.rules) assert.ok(kinds.has(rule.kind), rule.id);
  for (const api of rules.apis) assert.ok(rules.permissions[api.permission], api.global);
});
