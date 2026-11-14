/*
 * Text of the pull request the Worker opens. Everything that came from the
 * submission is rendered as inline code, so a submission cannot add links,
 * images or @mentions to the gallery's pull requests.
 */
import { SCREENSHOT_NAMES } from "../../tools/lib/png.mjs";
import { code, plain } from "./util.js";

export const MARKER = "<!-- scriptwell-app-submission -->";
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,49}$/;

/** The screenshot names present in `files`, in the gallery's order. */
export function screenshotNames(files) {
  const present = Object.keys(files || {}).map((key) => /^screenshots\/([A-Za-z]+)\.png$/.exec(key)).filter(Boolean).map((m) => m[1]);
  return SCREENSHOT_NAMES.filter((name) => present.includes(name));
}

/**
 * The pictures, loaded from the submit/<id> branch. Repository and id are
 * validated and the names come from a fixed list, so nothing in the URL was
 * chosen freely by the submission. CI adds the same pictures pinned to the commit.
 */
export function screenshotSection({ meta, files, repository }) {
  const names = screenshotNames(files);
  if (names.length === 0) return ["## Screenshots", "", "None were sent. The reviewer can ask for some, or run the script.", ""];
  const lines = ["## Screenshots", ""];
  lines.push(`Captured in the app by the author, who confirmed they show nothing personal: ${names.map((n) => code(n, 20)).join(", ")}.`, "");
  if (REPO_PATTERN.test(String(repository || "")) && ID_PATTERN.test(String(meta.id))) {
    const base = `https://raw.githubusercontent.com/${repository}/submit/${meta.id}/scripts/${meta.id}/screenshots`;
    lines.push(names.map((name) => `<img alt="${name}" src="${base}/${name}.png" width="${name === "app" ? 220 : 260}">`).join(" "), "");
  }
  return lines;
}

export function pullRequestTitle(meta, isUpdate) {
  return `${isUpdate ? "Update" : "Submit"} ${plain(meta.name, 50)} ${plain(meta.version, 20)}`;
}

export function commitMessage(meta, isUpdate) {
  return `${isUpdate ? "Update" : "Add"} ${plain(meta.id, 50)} ${plain(meta.version, 20)}\n\nSubmitted from the Scriptwell app by ${plain(meta.author, 39)}.`;
}

function findingLines(findings) {
  const soft = findings.filter((f) => f.severity === "soft");
  if (soft.length === 0) return ["- No soft findings. CI runs the full checks again on this pull request."];
  return soft.map((f) => `- ${code(f.ruleId, 40)}${f.line ? ` (line ${Number(f.line) || 0})` : ""}: ${code(f.message, 300)}`);
}

const UNVERIFIED_NOTE =
  "> **Unverified install.** Apple DeviceCheck did not vouch for the copy of the app this came from: it is sideloaded, self-built, or not the app at all. The gallery checks ran as usual; review the script with that in mind.";

export function pullRequestBody({ meta, app, findings, analysis, isUpdate, files = {}, repository, verified = true }) {
  const used = analysis && Array.isArray(analysis.usedPermissions) ? analysis.usedPermissions : [];
  const lines = [
    MARKER,
    `Submitted from the Scriptwell app (version ${code(app && app.version, 20)}) on behalf of ${code(meta.author, 39)}.`,
    "",
    ...(verified ? [] : [UNVERIFIED_NOTE, ""]),
    "The author has **no GitHub account attached** to this pull request. They see its state in the app and can push a new version from the app, which updates this branch and adds a comment here. Questions asked here may go unanswered; a blocking problem is best handled by closing with a short reason, which the app shows them.",
    "",
    "## What the script does",
    "",
    code(meta.description, 280),
    "",
    "## Permissions and network",
    "",
    `- Declared: ${meta.permissions.length ? meta.permissions.map((p) => code(p, 20)).join(", ") : "none"}`,
    `- Used (analyzer): ${used.length ? used.map((p) => code(p, 20)).join(", ") : "none"}`,
    `- Category: ${code(meta.category, 30)} · Licence: ${code(meta.license, 40)} · Widgets: ${meta.widgetSizes.length ? meta.widgetSizes.map((w) => code(w, 20)).join(", ") : "none"}`,
    "",
    ...screenshotSection({ meta, files, repository }),
    "## Checks run before this pull request was opened",
    "",
    ...findingLines(findings),
    "",
    "## Checklist",
    "",
    `- [x] This pull request only adds or changes files in one folder: ${code(`scripts/${meta.id}/`, 60)}`,
    "- [x] The folder has `script.js`, `meta.json` and `icon.png` (optionally `README.md` and `screenshots/`), and nothing else",
    "- [x] `meta.json` `id` equals the folder name",
    "- [x] `permissions` in `meta.json` matches the `// @permissions` line in `script.js`",
    "- [x] No hard findings from the analyzer, the schema, the word filter or the icon check",
    "- [x] The author confirmed in the app that they wrote the script or may publish it under the licence in `meta.json`, and that they read the guidelines",
    isUpdate ? "- [x] This is an update; the version was checked by the app" : "- [ ] For an update: version bumped (not applicable, new script)",
  ];
  return lines.join("\n") + "\n";
}

export function updateComment({ meta, app, findings, verified = true }) {
  return [
    MARKER,
    `A new version of this submission arrived from the Scriptwell app (version ${code(app && app.version, 20)}): ${code(meta.version, 20)}. The branch was updated; CI runs again.`,
    "",
    ...(verified ? [] : [UNVERIFIED_NOTE, ""]),
    ...findingLines(findings),
  ].join("\n") + "\n";
}
