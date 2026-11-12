#!/usr/bin/env node
/*
 * Build the published gallery: _site/index.json plus the script files.
 *
 *   node tools/build-index.mjs [--root <repo>] [--out <dir>]
 *
 * - Re-validates every script. A public script with a hard finding fails the
 *   build, so nothing unreviewed or broken is ever published.
 * - Hidden scripts stay in index.json with "status": "hidden" (so the app can
 *   flag copies people already installed) but their files are not published.
 * - The app verifies each download against the sha256 recorded here.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isMain, parseArgs, escapeHtml, TOOLS_DIR } from "./lib/common.mjs";
import { review } from "./review-pr.mjs";

export const SCHEMA_VERSION = 1;

function lastCommitDate(root, relativeFolder, fallback) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", relativeFolder], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || fallback;
  } catch {
    return fallback;
  }
}

function firstCommitDate(root, relativeFolder, fallback) {
  try {
    const out = execFileSync("git", ["log", "--diff-filter=A", "--format=%cI", "--", `${relativeFolder}/script.js`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().split("\n").filter(Boolean);
    return out.length ? out[out.length - 1] : fallback;
  } catch {
    return fallback;
  }
}

/** featured.json: the maintainers' picks for the front page. Missing file means nothing is featured. */
export function readFeatured(root) {
  const file = path.join(root, "featured.json");
  if (!existsSync(file)) return { hero: [], editorsChoice: [], blurbs: {} };
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const ids = (list) => (Array.isArray(list) ? list.filter((id) => typeof id === "string") : []);
  return { hero: ids(raw.hero), editorsChoice: ids(raw.editorsChoice), blurbs: raw.blurbs && typeof raw.blurbs === "object" ? raw.blurbs : {} };
}

/** stats.json: stars (and later installs) per script, written by the stars workflow. */
export function readStats(root) {
  const file = path.join(root, "stats.json");
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, "utf8")) || {}; } catch { return {}; }
}

/** One index.json entry. Field names are a contract with the app; do not rename. */
export function indexEntry(result, updatedAt, hasReadme, extras = {}) {
  const meta = result.meta;
  const folder = `scripts/${result.id}`;
  const featured = extras.featured || { hero: [], editorsChoice: [], blurbs: {} };
  const stats = (extras.stats && extras.stats[meta.id]) || {};
  const featuredAs = featured.hero.includes(meta.id) ? "hero" : featured.editorsChoice.includes(meta.id) ? "editorsChoice" : null;
  return {
    id: meta.id,
    name: meta.name,
    author: meta.author,
    version: meta.version,
    description: meta.description,
    permissions: meta.permissions,
    minAppVersion: meta.minAppVersion,
    widgetSizes: meta.widgetSizes,
    license: meta.license || "MIT",
    category: meta.category,
    status: meta.status === "hidden" ? "hidden" : "public",
    sha256: result.sha256,
    size: result.size,
    scriptPath: `${folder}/script.js`,
    iconPath: `${folder}/icon.png`,
    readmePath: hasReadme ? `${folder}/README.md` : null,
    updatedAt,
    createdAt: extras.createdAt || updatedAt,
    featured: featuredAs,
    blurb: typeof featured.blurbs[meta.id] === "string" ? featured.blurbs[meta.id].slice(0, 140) : null,
    stars: Number.isInteger(stats.stars) ? stats.stars : null,
    installs: Number.isInteger(stats.installs) ? stats.installs : null,
    starsURL: typeof stats.starsURL === "string" && stats.starsURL.startsWith("https://github.com/") ? stats.starsURL : null,
    homepage: meta.homepage || null,
  };
}

function renderHtml(entries, repository) {
  const guidelines = repository ? `https://github.com/${repository}/blob/main/GUIDELINES.md` : "GUIDELINES.md";
  const rows = entries
    .filter((entry) => entry.status === "public")
    .map((entry) => `      <li><strong>${escapeHtml(entry.name)}</strong> ${escapeHtml(entry.version)} by ${escapeHtml(entry.author)}<br>${escapeHtml(entry.description)}</li>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Scriptwell Gallery</title>
    <style>
      body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
      li { margin-bottom: 1rem; }
    </style>
  </head>
  <body>
    <h1>Scriptwell Gallery</h1>
    <p>Reviewed community scripts for the Scriptwell app. Browse and install them from the Gallery tab in the app.</p>
    <p><a href="${escapeHtml(guidelines)}">Gallery guidelines</a> · <a href="index.json">index.json</a></p>
    <ul>
${rows}
    </ul>
  </body>
</html>
`;
}

/**
 * @returns {{ index: object, failures: string[] }}
 */
export function buildIndex({ root, out, now = new Date() }) {
  // `out` is deleted and recreated, so it must never be the repo or contain it.
  const relative = path.relative(out, root);
  if (relative === "" || !relative.startsWith("..")) throw new Error(`--out (${out}) must not be the repository root or a parent of it.`);

  const outcome = review({ root, all: true });
  const failures = [];
  const entries = [];
  const generatedAt = now.toISOString();
  const featured = readFeatured(root);
  const stats = readStats(root);
  for (const id of [...featured.hero, ...featured.editorsChoice]) {
    if (!outcome.results.some((r) => r.id === id)) failures.push(`featured.json names "${id}", which is not in scripts/`);
  }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const result of outcome.results) {
    const hidden = result.meta && result.meta.status === "hidden";
    const hard = result.findings.filter((f) => f.severity === "hard");

    if (hard.length > 0) {
      if (hidden && result.meta && result.sha256) {
        // A hidden script may fail newer rules; that must not block publishing.
        console.warn(`hidden script ${result.id} has ${hard.length} hard finding(s); keeping it hidden.`);
      } else {
        for (const finding of hard) failures.push(`${result.id}: ${finding.ruleId}: ${finding.message}`);
        continue;
      }
    }
    if (!result.meta || !result.sha256) {
      failures.push(`${result.id}: missing meta.json or script.js`);
      continue;
    }

    const folder = path.join(root, "scripts", result.id);
    const hasReadme = existsSync(path.join(folder, "README.md"));
    const updatedAt = lastCommitDate(root, `scripts/${result.id}`, generatedAt);
    entries.push(indexEntry(result, updatedAt, hasReadme, { featured, stats, createdAt: firstCommitDate(root, `scripts/${result.id}`, updatedAt) }));

    if (!hidden) {
      const target = path.join(out, "scripts", result.id);
      mkdirSync(target, { recursive: true });
      for (const name of ["script.js", "meta.json", "icon.png", "README.md"]) {
        if (existsSync(path.join(folder, name))) copyFileSync(path.join(folder, name), path.join(target, name));
      }
    }
  }

  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const published = new Set(entries.filter((e) => e.status === "public").map((e) => e.id));
  const index = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    hero: featured.hero.filter((id) => published.has(id)),
    editorsChoice: featured.editorsChoice.filter((id) => published.has(id)),
    scripts: entries,
  };

  if (failures.length === 0) {
    writeFileSync(path.join(out, "index.json"), JSON.stringify(index, null, 2) + "\n");
    writeFileSync(path.join(out, "index.html"), renderHtml(entries, process.env.GITHUB_REPOSITORY));
    writeFileSync(path.join(out, ".nojekyll"), "");
    const guidelines = path.join(root, "GUIDELINES.md");
    if (existsSync(guidelines)) copyFileSync(guidelines, path.join(out, "GUIDELINES.md"));
  }
  return { index, failures };
}

function main() {
  const { options } = parseArgs(process.argv.slice(2));
  const root = path.resolve(options.root || path.join(TOOLS_DIR, ".."));
  const out = path.resolve(options.out || path.join(root, "_site"));
  const { index, failures } = buildIndex({ root, out });

  if (failures.length > 0) {
    console.error("Refusing to publish. Fix these first:");
    for (const failure of failures) console.error("  " + failure);
    process.exit(1);
  }
  const visible = index.scripts.filter((entry) => entry.status === "public").length;
  console.log(`Wrote ${path.join(out, "index.json")}: ${visible} public, ${index.scripts.length - visible} hidden.`);
}

if (isMain(import.meta.url)) main();
