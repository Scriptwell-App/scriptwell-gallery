// @name        CI Board
// @description GitHub Actions status for the repositories you choose, with alerts when a workflow turns red; talks to api.github.com with a personal access token you enter once
// @permissions network, notifications
// @widget      small, medium, large, rectangular, inline
// @icon        checkmark.seal.fill
// @color       #16A34A
// @version     1.0.0
// @author      scriptwell
// @category    developer-tools

// How it works
// • Open the mini-app, add repositories as owner/repo and paste a GitHub personal access token
//   when asked (fine-grained with "Actions: read", or classic with the repo scope). The token is
//   kept in the Keychain and is only ever sent to api.github.com.
// • Each refresh loads the last ten workflow runs of every repository, plus the workflow names,
//   from api.github.com. Nothing else leaves the device.
// • The widget shows the latest run of each workflow, its branch, how long ago it ran and a
//   sparkline of recent run durations. Tapping a row opens that run on GitHub.
// • Background runs keep the board fresh while the app is closed and send a notification when a
//   workflow that was green turns red (and, if you turn it on, when it is green again).
// • Widget parameter: an owner/repo, or just the repository name, to pin one repository.
// • Run the script once in the app before adding the widget so the token and permissions are set.

// ───────────────────────── Constants

const API = "https://api.github.com";
const RUNS_PER_REPO = 10;
const STALE_MS = 10 * 60 * 1000;
const WORKFLOW_NAMES_TTL = 24 * 60 * 60 * 1000;
const MAX_REPOS = 12;
const TIME_LIMITS = { app: 30_000, pwa: 30_000, shortcut: 20_000, background: 15_000, widget: 8_000 };
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

const STATES = {
  success:   { label: "Passing",   color: "green",     hex: "#22C55E", symbol: "checkmark.circle.fill",      fallback: "✅", rank: 0 },
  cancelled: { label: "Cancelled", color: "gray",      hex: "#94A3B8", symbol: "minus.circle.fill",          fallback: "⛔️", rank: 1 },
  running:   { label: "Running",   color: "blue",      hex: "#3B82F6", symbol: "clock.fill",                 fallback: "⏳", rank: 2 },
  attention: { label: "Waiting",   color: "orange",    hex: "#F97316", symbol: "exclamationmark.triangle.fill", fallback: "⚠️", rank: 3 },
  failure:   { label: "Failing",   color: "red",       hex: "#EF4444", symbol: "xmark.circle.fill",          fallback: "❌", rank: 4 },
  none:      { label: "No runs",   color: "secondary", hex: "#94A3B8", symbol: "circle.dashed",              fallback: "◌", rank: -1 },
};

const TILE_BG = { light: "#F1F5F9", dark: "#1E293B" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────── Stored state

const repos = () => Storage.get("repos", []);
const board = () => Storage.get("board", {});
const settings = () => ({ notifyFailures: true, notifyRecovery: false, ...Storage.get("settings", {}) });
const saveSettings = (changes) => Storage.set("settings", { ...settings(), ...changes });

const shortName = (name) => name.split("/")[1] ?? name;

function stateOf(run) {
  if (!run) return "none";
  if (run.status !== "completed") return "running";
  if (run.conclusion === "success") return "success";
  if (["failure", "timed_out", "startup_failure"].includes(run.conclusion)) return "failure";
  if (run.conclusion === "action_required") return "attention";
  return "cancelled"; // cancelled, skipped, neutral, stale
}

// The newest run of every workflow in a repository record, newest first.
function latestPerWorkflow(record) {
  const seen = new Set();
  return (record?.runs ?? []).filter((run) => {
    if (seen.has(run.workflowId)) return false;
    seen.add(run.workflowId);
    return true;
  });
}

const worst = (states) => states.reduce((a, b) => (STATES[b].rank > STATES[a].rank ? b : a), "none");
const repoState = (record) => (record?.runs?.length ? worst(latestPerWorkflow(record).map((r) => r.state)) : "none");

// Durations of completed runs, oldest first, for sparklines.
const durations = (record) => (record?.runs ?? []).filter((r) => r.seconds != null).map((r) => r.seconds).reverse();

function fmtDuration(seconds) {
  if (seconds == null) return "–";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}

// Which repository a widget parameter pins: an exact owner/repo, or a repo name.
function pinned(parameter) {
  const wanted = String(parameter ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return repos().find((r) => r.toLowerCase() === wanted) ?? repos().find((r) => shortName(r).toLowerCase() === wanted) ?? null;
}

// ───────────────────────── GitHub

async function token() {
  if (Script.env.mode === "app" || Script.env.mode === "pwa") {
    return Secrets.require("github-token", {
      title: "GitHub personal access token",
      message: "Create one under GitHub › Settings › Developer settings: fine-grained with “Actions: read” on the repositories you watch, or classic with the repo scope. It stays in this device's Keychain and is only sent to api.github.com.",
      placeholder: "github_pat_…",
    });
  }
  const stored = await Secrets.get("github-token");
  if (!stored) throw new Error("Open CI Board in Scriptwell once to enter your GitHub token");
  return stored;
}

async function github(path, accessToken, timeout) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    timeout,
  });
  if (response.status === 401) throw new Error("GitHub rejected the token. Replace it under Settings.");
  if (response.status === 404) throw new Error("Not found. Check the name, and that the token can see this repository.");
  if (response.status === 403 || response.status === 429) throw new Error("GitHub rate limit reached. Try again in a while.");
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  return response.json();
}

async function fetchRepo(name, accessToken, timeout) {
  const previous = board()[name];
  const namesFresh = previous?.workflowNames && Date.now() - (previous.namesTime ?? 0) < WORKFLOW_NAMES_TTL;

  const [runsData, workflowsData] = await Promise.all([
    github(`/repos/${name}/actions/runs?per_page=${RUNS_PER_REPO}`, accessToken, timeout),
    namesFresh ? Promise.resolve(null) : github(`/repos/${name}/actions/workflows?per_page=50`, accessToken, timeout).catch(() => null),
  ]);

  const workflowNames = workflowsData
    ? Object.fromEntries(workflowsData.workflows.map((w) => [String(w.id), w.name]))
    : previous?.workflowNames ?? {};

  const runs = (runsData.workflow_runs ?? []).map((r) => {
    const startedAt = Date.parse(r.run_started_at ?? r.created_at);
    const updatedAt = Date.parse(r.updated_at);
    const completed = r.status === "completed";
    return {
      id: r.id, workflowId: r.workflow_id, number: r.run_number, url: r.html_url, startedAt,
      workflow: workflowNames[String(r.workflow_id)] ?? r.name ?? "Workflow",
      title: r.display_title ?? "", branch: r.head_branch ?? "", event: r.event ?? "", actor: r.actor?.login ?? "",
      state: stateOf(r),
      seconds: completed && updatedAt >= startedAt ? Math.round((updatedAt - startedAt) / 1000) : null,
    };
  });

  return { name, runs, workflowNames, namesTime: workflowsData ? Date.now() : previous?.namesTime ?? 0, time: Date.now(), error: null };
}

// Compares the old and new board and notifies about workflows that broke or recovered.
async function notifyChanges(before, after) {
  const s = settings();
  if (!s.notifyFailures && !s.notifyRecovery) return;
  const notified = new Set(Storage.get("notified", []));
  const fresh = [];

  for (const record of Object.values(after)) {
    const old = before[record.name];
    if (!old || record.error) continue;
    for (const run of latestPerWorkflow(record)) {
      if (run.state === "running" || notified.has(run.id)) continue;
      // The last finished run of the same workflow that we knew about before.
      const prev = old.runs.find((r) => r.workflowId === run.workflowId && r.state !== "running" && r.id !== run.id);
      if (!prev) continue;
      const broke = prev.state === "success" && run.state === "failure";
      const fixed = prev.state === "failure" && run.state === "success";
      if (!((broke && s.notifyFailures) || (fixed && s.notifyRecovery))) continue;
      fresh.push(run.id);
      try {
        await Notification.schedule({
          id: `run-${run.id}`,
          title: broke ? `${record.name} is red` : `${record.name} is green again`,
          body: `${run.workflow} on ${run.branch}${run.title ? ` · ${run.title}` : ""}`,
          sound: broke,
        });
      } catch (error) {
        console.warn("Could not notify:", error.message);
      }
    }
  }
  if (fresh.length) Storage.set("notified", [...notified, ...fresh].slice(-200));
}

// Loads every repository (or one), keeps old data for the ones that fail, and notifies about changes.
async function refresh(only) {
  const names = only ? [only] : repos();
  if (names.length === 0) return board();
  const limit = TIME_LIMITS[Script.env.mode] ?? 20_000;
  const timeout = Math.min(8000, limit - 2500);
  const accessToken = await token();
  const current = board();

  const results = await Promise.all(names.map((name) =>
    fetchRepo(name, accessToken, timeout).catch((error) => ({
      ...(current[name] ?? { name, runs: [], workflowNames: {}, time: 0 }),
      error: error.message,
      errorTime: Date.now(),
    }))));

  const next = { ...current };
  for (const record of results) next[record.name] = record;
  for (const key of Object.keys(next)) if (!repos().includes(key)) delete next[key];

  Storage.set("board", next);
  Storage.set("boardTime", Date.now());
  if (Script.env.mode !== "widget") await notifyChanges(current, next);
  return next;
}

function summaryLine() {
  const records = repos().map((r) => board()[r]).filter(Boolean);
  const latest = records.flatMap(latestPerWorkflow);
  const count = (state) => latest.filter((r) => r.state === state).length;
  return { total: latest.length, passing: count("success"), failing: count("failure"), running: count("running"), records };
}

// ───────────────────────── Run and background

Script.run(async () => {
  if (repos().length === 0) return "No repositories yet. Open CI Board's mini-app and add some as owner/repo.";
  try {
    await refresh();
  } catch (error) {
    if (!Storage.get("boardTime")) return `Could not load: ${error.message}`;
  }
  const { passing, failing, running, total, records } = summaryLine();
  const red = records.flatMap((rec) => latestPerWorkflow(rec).filter((r) => r.state === "failure").map((r) => `${shortName(rec.name)} › ${r.workflow} (${r.branch})`));
  return `${passing} of ${total} workflows passing, ${failing} failing, ${running} running.${red.length ? ` Red: ${red.join(", ")}.` : ""}`;
});

Script.background(async () => {
  try { await refresh(); }
  catch (error) { Storage.set("lastError", { message: error.message, time: Date.now() }); }
});

// ───────────────────────── Widget pieces

const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };

const stateIcon = (state, size = 14) => Widget.symbol(STATES[state].symbol, { size, color: STATES[state].color, fallback: STATES[state].fallback });

function sparkline(record, width = 54, height = 18) {
  const values = durations(record);
  if (values.length < 2) return Widget.spacer(width);
  const color = STATES[repoState(record)].color;
  return Widget.chart(values, { kind: "bar", axes: false, color: color === "secondary" ? "gray" : color, frame: { width, height } });
}

// One workflow run: icon, name, branch, time, duration. Tapping opens the run on GitHub.
function runRow(run, { compact = false } = {}) {
  return Widget.hstack([
    stateIcon(run.state, compact ? 12 : 14),
    Widget.vstack([
      Widget.text(run.workflow, { font: compact ? "caption" : "footnote", weight: "semibold", lineLimit: 1 }),
      Widget.hstack([
        Widget.symbol("arrow.triangle.branch", { size: 9, color: "secondary", fallback: "⑂" }),
        Widget.text(run.branch, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
        Widget.text("·", { font: "caption2", color: "secondary" }),
        Widget.date(run.startedAt, { style: "relative", font: "caption2", color: "secondary" }),
      ], { spacing: 3 }),
    ], { alignment: "leading", spacing: 1 }),
    Widget.spacer(),
    Widget.text(run.state === "running" ? "running" : fmtDuration(run.seconds), { font: "caption2", weight: "medium", color: "secondary", design: "monospaced" }),
  ], { spacing: 6, url: run.url });
}

// One repository line for the medium board: overall state, name, newest workflow, sparkline.
function repoRow(record) {
  const latest = latestPerWorkflow(record)[0];
  const state = repoState(record);
  return Widget.hstack([
    stateIcon(state, 16),
    Widget.vstack([
      Widget.text(shortName(record.name), { font: "footnote", weight: "semibold", lineLimit: 1 }),
      latest
        ? Widget.hstack([
            Widget.text(`${latest.workflow} · ${latest.branch}`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
            Widget.date(latest.startedAt, { style: "relative", font: "caption2", color: "secondary" }),
          ], { spacing: 4 })
        : Widget.text(record.error ?? "No runs yet", { font: "caption2", color: record.error ? "orange" : "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 1 }),
    Widget.spacer(),
    sparkline(record),
  ], { spacing: 8, url: latest?.url });
}

function repoCard(record, maxRows) {
  const state = repoState(record);
  return Widget.vstack([
    Widget.hstack([
      stateIcon(state, 14),
      Widget.text(record.name, { font: "footnote", weight: "bold", lineLimit: 1, minimumScale: 0.7 }),
      Widget.spacer(),
      record.error ? Widget.symbol("wifi.exclamationmark", { size: 11, color: "orange", fallback: "⚠️" }) : null,
      sparkline(record, 60, 16),
    ], { spacing: 6 }),
    ...latestPerWorkflow(record).slice(0, maxRows).map((run) => runRow(run, { compact: true })),
    record.runs.length === 0 ? Widget.text(record.error ?? "No workflow runs yet", { font: "caption2", color: "secondary", lineLimit: 2 }) : null,
  ], { alignment: "leading", spacing: 4, padding: 8, background: TILE_BG, cornerRadius: 10, frame: { maxWidth: "infinity", alignment: "leading" } });
}

function footer() {
  const time = Storage.get("boardTime");
  const error = Storage.get("lastError");
  return Widget.hstack([
    error && error.time > (time ?? 0) ? Widget.symbol("exclamationmark.triangle.fill", { size: 9, color: "orange", fallback: "⚠️" }) : null,
    Widget.text("Updated", { font: "caption2", color: "secondary" }),
    time ? Widget.date(time, { style: "relative", font: "caption2", color: "secondary" }) : Widget.text("never", { font: "caption2", color: "secondary" }),
  ], { spacing: 3 });
}

function emptyWidget(family, message) {
  if (family === "inline") return Widget.text(`CI Board: ${message}`);
  if (family === "rectangular") return Widget.text(message, { font: "caption" });
  return Widget.vstack([
    Widget.symbol("checkmark.seal.fill", { size: 26, color: "green", fallback: "✅" }),
    Widget.text(message, { font: "caption", color: "secondary", align: "center", lineLimit: 3 }),
  ], { spacing: 6, url: APP_LINK });
}

// ───────────────────────── Widget

Script.widget(async ({ family, parameter }) => {
  if (repos().length === 0) return emptyWidget(family, "Open the mini-app and add a repository");

  const age = Date.now() - (Storage.get("boardTime") ?? 0);
  if (age > STALE_MS && !Script.env.lowPowerMode) {
    try { await refresh(); }
    catch (error) { Storage.set("lastError", { message: error.message, time: Date.now() }); }
  }
  if (!Storage.get("boardTime")) return emptyWidget(family, Storage.get("lastError")?.message ?? "Run CI Board once in the app");

  const pin = pinned(parameter);
  const records = (pin ? [pin] : repos()).map((r) => board()[r]).filter(Boolean);
  if (records.length === 0) return emptyWidget(family, pin ? `${shortName(pin)} has not loaded yet` : "Nothing loaded yet");
  const { passing, failing, running, total } = summaryLine();
  const overall = worst(records.map(repoState));
  const problems = records.flatMap((rec) => latestPerWorkflow(rec).filter((r) => r.state === "failure").map((r) => ({ ...r, repo: shortName(rec.name) })));
  let content;

  if (family === "inline") {
    content = pin
      ? Widget.text(`${shortName(pin)}: ${STATES[repoState(records[0])].label.toLowerCase()}`)
      : Widget.text(failing ? `CI: ${failing} failing · ${passing} passing` : `CI: all ${passing} passing`);
  } else if (family === "rectangular") {
    const first = problems[0];
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol(STATES[overall].symbol, { size: 12, fallback: STATES[overall].fallback }),
        Widget.text(pin ? shortName(pin) : "CI Board", { font: "headline", lineLimit: 1 }),
      ], { spacing: 4 }),
      Widget.text(pin
        ? latestPerWorkflow(records[0]).slice(0, 2).map((r) => `${r.workflow}: ${STATES[r.state].label.toLowerCase()}`).join(" · ")
        : `${passing} passing · ${failing} failing${running ? ` · ${running} running` : ""}`, { font: "caption", lineLimit: 1, minimumScale: 0.7 }),
      Widget.text(first ? `${first.repo} › ${first.workflow} (${first.branch})` : "All green", { font: "caption2", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 1 });
  } else if (family === "small") {
    const rows = pin ? latestPerWorkflow(records[0]).slice(0, 3) : problems.slice(0, 2);
    content = Widget.vstack([
      Widget.hstack([
        stateIcon(overall, 22),
        Widget.spacer(),
        sparkline(pin ? records[0] : records.sort((a, b) => STATES[repoState(b)].rank - STATES[repoState(a)].rank)[0], 50, 20),
      ]),
      Widget.text(pin ? shortName(pin) : (failing ? `${failing} failing` : "All green"), { font: "headline", lineLimit: 1, minimumScale: 0.7 }),
      Widget.text(pin ? STATES[overall].label : `${passing} of ${total} workflows passing`, { font: "caption2", color: "secondary", lineLimit: 1 }),
      ...rows.map((run) => Widget.hstack([
        stateIcon(run.state, 10),
        Widget.text(pin ? run.workflow : `${run.repo} › ${run.workflow}`, { font: "caption2", lineLimit: 1, minimumScale: 0.7 }),
      ], { spacing: 3, url: run.url })),
      Widget.spacer(),
      footer(),
    ], { alignment: "leading", spacing: 3, url: APP_LINK, frame: fill });
  } else if (family === "medium") {
    content = pin
      ? Widget.vstack([
          Widget.hstack([
            stateIcon(overall, 16),
            Widget.text(pin, { font: "headline", lineLimit: 1, minimumScale: 0.7 }),
            Widget.spacer(),
            sparkline(records[0], 70, 20),
          ], { spacing: 6 }),
          ...latestPerWorkflow(records[0]).slice(0, 3).map((run) => runRow(run)),
          records[0].runs.length === 0 ? Widget.text(records[0].error ?? "No workflow runs yet", { font: "caption", color: "secondary" }) : null,
          Widget.spacer(),
          footer(),
        ], { alignment: "leading", spacing: 5, url: APP_LINK, frame: fill })
      : Widget.vstack([
          ...records.slice(0, 4).map(repoRow),
          Widget.spacer(),
          Widget.hstack([
            Widget.text(failing ? `${failing} failing · ${passing} passing` : `All ${passing} workflows passing`, { font: "caption2", weight: "semibold", color: failing ? "red" : "green" }),
            Widget.spacer(),
            footer(),
          ]),
        ], { alignment: "leading", spacing: 6, url: APP_LINK, frame: fill });
  } else {
    const shown = records.slice(0, pin ? 1 : 5);
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("checkmark.seal.fill", { size: 16, color: failing ? "red" : "green", fallback: "✅" }),
        Widget.text(pin ? "Pinned repository" : "CI Board", { font: "headline" }),
        Widget.spacer(),
        Widget.text(failing ? `${failing} failing · ${passing} passing` : `all ${passing} passing`, { font: "caption", weight: "semibold", color: failing ? "red" : "green" }),
      ], { spacing: 6 }),
      ...shown.map((record) => repoCard(record, pin ? 8 : Math.max(1, Math.floor(10 / shown.length)))),
      records.length > shown.length ? Widget.text(`+ ${records.length - shown.length} more in the app`, { font: "caption2", color: "secondary" }) : null,
      Widget.spacer(),
      footer(),
    ], { alignment: "leading", spacing: 6, url: APP_LINK, frame: fill });
  }

  return { content, refreshAfter: 15 * 60 };
});

// ───────────────────────── Mini-app actions

const page = () => Storage.get("ui.page", "board");

Script.action("page", ({ value }) => Storage.set("ui.page", value));

Script.action("refresh", async () => {
  try {
    await refresh();
    Storage.remove("lastError");
    await UI.haptic("success");
  } catch (error) {
    Storage.set("lastError", { message: error.message, time: Date.now() });
    await UI.haptic("error");
  }
});

Script.action("add", async ({ value }) => {
  const name = String(value ?? "").trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
  if (!name) return;
  if (!REPO_PATTERN.test(name)) return UI.alert({ title: "Not a repository", message: "Type it as owner/repo, for example swiftlang/swift." });
  if (repos().some((r) => r.toLowerCase() === name.toLowerCase())) return UI.alert("That repository is already on the board.");
  if (repos().length >= MAX_REPOS) return UI.alert(`The board holds up to ${MAX_REPOS} repositories.`);
  Storage.set("repos", [...repos(), name]);
  try { await refresh(name); }
  catch (error) { Storage.set("lastError", { message: error.message, time: Date.now() }); }
});

Script.action("remove", async ({ name }) => {
  const choice = await UI.alert({ title: `Remove ${name}?`, buttons: ["Cancel", "Remove"] });
  if (choice !== 1) return;
  Storage.set("repos", repos().filter((r) => r !== name));
  const next = board();
  delete next[name];
  Storage.set("board", next);
  if (Storage.get("ui.repo") === name) Storage.remove("ui.repo");
});

Script.action("open", ({ name }) => Storage.set("ui.repo", name));
Script.action("back", () => Storage.remove("ui.repo"));
Script.action("setting", ({ key, isOn }) => saveSettings({ [key]: isOn }));

Script.action("replaceToken", async () => {
  const choice = await UI.alert({ title: "Replace the GitHub token?", message: "The stored token is forgotten and you are asked for a new one.", buttons: ["Cancel", "Replace"] });
  if (choice !== 1) return;
  await Secrets.remove("github-token");
  try { await refresh(); } catch (error) { Storage.set("lastError", { message: error.message, time: Date.now() }); }
});

Script.action("link", ({ url }) => UI.openURL(url));

// ───────────────────────── Mini-app screens

function repoDetail(name) {
  const record = board()[name];
  const runs = record?.runs ?? [];
  const chart = runs.filter((r) => r.seconds != null).reverse();
  return Widget.vstack([
    Widget.hstack([
      Widget.button(Widget.label("Board", "chevron.left"), "back", null, { style: "plain" }),
      Widget.spacer(),
      Widget.button("Open on GitHub", "link", { url: `https://github.com/${name}/actions` }, { style: "bordered" }),
    ]),
    Widget.hstack([
      stateIcon(repoState(record), 22),
      Widget.text(name, { font: "title3", weight: "bold", lineLimit: 1, minimumScale: 0.6 }),
    ], { spacing: 8 }),
    record?.error ? Widget.text(record.error, { font: "footnote", color: "orange" }) : null,
    chart.length >= 2
      ? Widget.card([
          Widget.chart(chart.map((r) => ({ x: `#${r.number}`, y: Math.round(r.seconds / 6) / 10 })), { kind: "bar", color: STATES[repoState(record)].color === "secondary" ? "gray" : STATES[repoState(record)].color, frame: { height: 150 } }),
          Widget.text(`Minutes per run · average ${fmtDuration(Math.round(chart.reduce((s, r) => s + r.seconds, 0) / chart.length))}`, { font: "caption2", color: "secondary" }),
        ], { title: "Run durations", symbol: "timer", color: "blue" })
      : null,
    Widget.list(runs.map((run) => ({
      title: `${run.workflow} #${run.number}`,
      subtitle: [run.branch, run.event, run.actor].filter(Boolean).join(" · "),
      symbol: STATES[run.state].symbol,
      color: STATES[run.state].color,
      detail: run.state === "running" ? "running" : fmtDuration(run.seconds),
      url: run.url,
    })), { title: `Last ${runs.length} runs` }),
    runs.length === 0 ? Widget.text("No workflow runs yet.", { color: "secondary" }) : null,
    Widget.button("Remove from board", "remove", { name }, { style: "bordered", color: "red" }),
  ], { alignment: "leading", spacing: 14 });
}

function boardPage() {
  const records = repos().map((r) => board()[r]);
  const { passing, failing, running, total } = summaryLine();
  if (repos().length === 0) {
    return Widget.vstack([
      Widget.symbol("checkmark.seal.fill", { size: 56, color: "green", fallback: "✅" }),
      Widget.text("Add a repository under Repos to start the board.", { color: "secondary", align: "center" }),
    ], { spacing: 14, padding: 20, frame: { maxWidth: "infinity" } });
  }
  return Widget.vstack([
    Widget.hstack([
      Widget.vstack([
        Widget.text(failing ? `${failing} failing` : "All green", { font: "title2", weight: "bold", color: failing ? "red" : "green" }),
        Widget.text(`${passing} of ${total} workflows passing${running ? `, ${running} running` : ""}`, { font: "footnote", color: "secondary" }),
      ], { alignment: "leading", spacing: 2 }),
      Widget.spacer(),
      Widget.button(Widget.label("Refresh", "arrow.clockwise"), "refresh", null, { style: "bordered" }),
    ]),
    footer(),
    ...records.map((record, i) => record
      ? Widget.vstack([
          Widget.button(Widget.hstack([
            stateIcon(repoState(record), 16),
            Widget.text(record.name, { font: "headline", lineLimit: 1, minimumScale: 0.7 }),
            Widget.spacer(),
            sparkline(record, 64, 18),
            Widget.symbol("chevron.right", { size: 11, color: "secondary", fallback: "›" }),
          ], { spacing: 8 }), "open", { name: record.name }, { style: "plain" }),
          ...latestPerWorkflow(record).slice(0, 4).map((run) => runRow(run)),
          record.runs.length === 0 ? Widget.text(record.error ?? "No workflow runs yet", { font: "caption", color: record.error ? "orange" : "secondary" }) : null,
        ], { alignment: "leading", spacing: 8, padding: 12, background: TILE_BG, cornerRadius: 14 })
      : Widget.text(`${repos()[i]}: not loaded yet`, { font: "footnote", color: "secondary" })),
  ], { alignment: "leading", spacing: 12 });
}

function reposPage() {
  return Widget.vstack([
    Widget.textField("owner/repo", "", "add", null, { label: "Add a repository", keyboard: "url" }),
    Widget.text(`${repos().length} of ${MAX_REPOS} · tap Return to add`, { font: "caption2", color: "secondary" }),
    ...repos().map((name) => Widget.hstack([
      stateIcon(repoState(board()[name]), 14),
      Widget.text(name, { font: "body", lineLimit: 1, minimumScale: 0.7 }),
      Widget.spacer(),
      Widget.button(Widget.symbol("trash", { size: 16, color: "red", fallback: "🗑" }), "remove", { name }, { style: "plain" }),
    ], { spacing: 8, padding: { horizontal: 12, vertical: 8 }, background: TILE_BG, cornerRadius: 10 })),
    repos().length === 0 ? Widget.text("Nothing here yet. Private repositories work when the token can read them.", { font: "footnote", color: "secondary" }) : null,
  ], { alignment: "leading", spacing: 10 });
}

function settingsPage() {
  const s = settings();
  return Widget.vstack([
    Widget.card([
      Widget.toggle("When a workflow turns red", s.notifyFailures, "setting", { key: "notifyFailures" }, { color: "red" }),
      Widget.toggle("When it is green again", s.notifyRecovery, "setting", { key: "notifyRecovery" }, { color: "green" }),
      Widget.text("Checks happen in background runs, a few times a day, and whenever the board refreshes. Each run is announced once.", { font: "caption", color: "secondary" }),
    ], { title: "Notifications", symbol: "bell.badge.fill", color: "orange" }),
    Widget.card([
      Widget.text("The token lives in the Keychain and is only sent to api.github.com.", { font: "footnote", color: "secondary" }),
      Widget.button("Replace token", "replaceToken", null, { style: "bordered" }),
    ], { title: "GitHub token", symbol: "key.fill", color: "blue" }),
    Widget.text(`${Storage.get("notified", []).length} alerts sent so far.`, { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 14 });
}

let loadedOnce = false;

Script.ui(async () => {
  if (!loadedOnce) {
    loadedOnce = true;
    if (repos().length && Date.now() - (Storage.get("boardTime") ?? 0) > STALE_MS) {
      try { await refresh(); } catch (error) { Storage.set("lastError", { message: error.message, time: Date.now() }); }
    }
  }
  const error = Storage.get("lastError");
  const detail = Storage.get("ui.repo");
  if (detail && repos().includes(detail)) {
    return { title: shortName(detail), content: Widget.vstack([repoDetail(detail)], { padding: 16 }) };
  }
  const current = page();
  return {
    title: "CI Board",
    content: Widget.vstack([
      Widget.picker([
        { label: "Board", value: "board" }, { label: "Repos", value: "repos" }, { label: "Settings", value: "settings" },
      ], current, "page", null, { style: "segmented" }),
      error ? Widget.text(`⚠️ ${error.message}`, { font: "footnote", color: "orange" }) : null,
      current === "repos" ? reposPage() : current === "settings" ? settingsPage() : boardPage(),
    ], { alignment: "leading", spacing: 16, padding: 16 }),
  };
});
