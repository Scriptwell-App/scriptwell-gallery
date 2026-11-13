// @name        Package Watch
// @description Tracks versions and daily downloads of npm, PyPI and crates.io packages, charts the last 30 days and notifies you of new releases; contacts registry.npmjs.org, api.npmjs.org, pypi.org, pypistats.org and crates.io, with an optional on-device AI summary of npm READMEs
// @permissions network, notifications
// @widget      small, medium, large
// @icon        shippingbox.fill
// @color       #F97316
// @version     1.0.0
// @author      va4w
// @category    developer-tools

// How it works
// • Add packages in the mini-app, choosing npm, PyPI or crates.io. Only the package names you type
//   are sent, to the public registries: registry.npmjs.org and api.npmjs.org, pypi.org and
//   pypistats.org, crates.io (with a descriptive User-Agent, as crates.io asks). No key is needed.
// • Each package shows its latest version, the release date, the last 30 days of downloads and a
//   trend arrow comparing the last seven days with the seven before.
// • Background runs refresh everything while the app is closed and send a notification when a
//   package publishes a new version (each version is announced once).
// • When Apple Intelligence is available, the start of an npm package's README is summarised
//   on-device into two sentences; otherwise the registry description is shown.
// • Widget parameter: a package name (or "pypi:requests") to feature one package.
// • Run the script once in the app before adding the widget so the permissions are approved.

// ───────────────────────── Constants

const USER_AGENT = "Scriptwell Package Watch (gallery script; iOS widget)";
const STALE_MS = 3 * 60 * 60 * 1000;
const MAX_PACKAGES = 10;
const TIME_LIMITS = { app: 30_000, pwa: 30_000, shortcut: 20_000, background: 15_000, widget: 8_000 };

const ECOSYSTEMS = {
  npm:    { label: "npm",       hex: "#CB3837", page: (n) => `https://www.npmjs.com/package/${n}` },
  pypi:   { label: "PyPI",      hex: "#3775A9", page: (n) => `https://pypi.org/project/${n}/` },
  crates: { label: "crates.io", hex: "#E6B450", page: (n) => `https://crates.io/crates/${n}` },
};
const SERIES_COLORS = ["orange", "blue", "green", "purple", "pink", "teal"];
const TILE_BG = { light: "#F1F5F9", dark: "#1E293B" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────── Stored state

const packages = () => Storage.get("packages", []);
const data = () => Storage.get("data", {});
const settings = () => ({ notify: true, ...Storage.get("settings", {}) });
const keyOf = (p) => `${p.eco}:${p.name}`;
const record = (p) => data()[keyOf(p)];

const compact = (n) => {
  if (n == null) return "–";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
};
const full = (n) => (n == null ? "–" : Math.round(n).toLocaleString(Script.env.locale));

// Last seven days against the seven before, as a ratio (0.12 = up 12 %). Null without enough data.
function trendOf(daily) {
  if (!daily || daily.length < 14) return null;
  const last = daily.slice(-7).reduce((s, d) => s + d.n, 0);
  const before = daily.slice(-14, -7).reduce((s, d) => s + d.n, 0);
  if (before === 0) return null;
  return (last - before) / before;
}

function trendLook(trend) {
  if (trend == null) return { arrow: "→", color: "secondary", text: "no trend yet" };
  if (trend > 0.05) return { arrow: "↑", color: "green", text: `up ${Math.round(trend * 100)}% week on week` };
  if (trend < -0.05) return { arrow: "↓", color: "red", text: `down ${Math.round(-trend * 100)}% week on week` };
  return { arrow: "→", color: "secondary", text: "flat week on week" };
}

const perDay = (r) => (r?.daily?.length ? r.daily.reduce((s, d) => s + d.n, 0) / r.daily.length : null);

function featured(parameter) {
  const wanted = String(parameter ?? "").trim().toLowerCase();
  const list = packages();
  if (!wanted) return list[0] ?? null;
  return list.find((p) => keyOf(p).toLowerCase() === wanted) ?? list.find((p) => p.name.toLowerCase() === wanted) ?? list[0] ?? null;
}

// ───────────────────────── Registries

async function getJSON(url, timeout, headers = {}) {
  const response = await fetch(url, { timeout, headers: { Accept: "application/json", ...headers } });
  if (response.status === 404) throw new Error("Not found on the registry");
  if (response.status === 429) throw new Error("Rate limited, try later");
  if (!response.ok) throw new Error(`Registry returned ${response.status}`);
  return response.json();
}

// A rough plain-text version of a Markdown README, for the on-device summary.
function plainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_>`|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchNpm(name, timeout, light) {
  const encoded = name.replace("/", "%2F");
  let meta = null;
  if (!light) {
    // The full document carries release times and the README, but for big packages it can be too large to load.
    try {
      const doc = await getJSON(`https://registry.npmjs.org/${encoded}`, timeout);
      const version = doc["dist-tags"]?.latest;
      meta = { version, releasedAt: doc.time?.[version] ?? null, description: doc.description ?? "", readme: typeof doc.readme === "string" ? doc.readme : "" };
    } catch (error) {
      console.warn(`Full npm document for ${name} unavailable:`, error.message);
    }
  }
  if (!meta) {
    const latest = await getJSON(`https://registry.npmjs.org/${encoded}/latest`, timeout);
    meta = { version: latest.version, releasedAt: null, description: latest.description ?? "", readme: typeof latest.readme === "string" ? latest.readme : "" };
  }
  const range = await getJSON(`https://api.npmjs.org/downloads/range/last-month/${name}`, timeout);
  return { ...meta, daily: (range.downloads ?? []).map((d) => ({ day: d.day, n: d.downloads })) };
}

async function fetchPyPI(name, timeout, light, previous) {
  const normalized = name.toLowerCase().replace(/[-_.]+/g, "-");
  let meta = { version: previous?.version ?? null, releasedAt: previous?.releasedAt ?? null, description: previous?.description ?? "" };
  if (!light || !meta.version) {
    try {
      const doc = await getJSON(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, timeout);
      meta = { version: doc.info?.version ?? null, releasedAt: doc.urls?.[0]?.upload_time_iso_8601 ?? null, description: doc.info?.summary ?? "" };
    } catch (error) {
      // Projects with thousands of releases have a JSON document too big to load; the releases feed is small.
      const response = await fetch(`https://pypi.org/rss/project/${normalized}/releases.xml`, { timeout });
      if (!response.ok) throw error;
      const xml = await response.text();
      const item = /<item>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<pubDate>([^<]+)<\/pubDate>/.exec(xml);
      if (!item) throw error;
      meta = { ...meta, version: item[1].trim(), releasedAt: new Date(item[2].trim()).toISOString() };
    }
  }
  const [recent, overall] = await Promise.all([
    getJSON(`https://pypistats.org/api/packages/${normalized}/recent`, timeout),
    getJSON(`https://pypistats.org/api/packages/${normalized}/overall?mirrors=false`, timeout).catch(() => null),
  ]);
  const daily = (overall?.data ?? []).filter((d) => d.category === "without_mirrors").map((d) => ({ day: d.date, n: d.downloads })).slice(-30);
  return { ...meta, daily, monthFallback: recent?.data?.last_month ?? null };
}

async function fetchCrates(name, timeout) {
  const headers = { "User-Agent": USER_AGENT };
  const base = `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`;
  const doc = await getJSON(base, timeout, headers);
  const crate = doc.crate;
  const version = crate.max_stable_version ?? crate.newest_version;
  const newest = (doc.versions ?? []).find((v) => v.num === version);
  let daily = [];
  try {
    const downloads = await getJSON(`${base}/downloads`, timeout, headers);
    const byDay = {};
    for (const row of downloads.version_downloads ?? []) byDay[row.date] = (byDay[row.date] ?? 0) + row.downloads;
    for (const row of downloads.meta?.extra_downloads ?? []) byDay[row.date] = (byDay[row.date] ?? 0) + row.downloads;
    daily = Object.keys(byDay).sort().slice(-30).map((day) => ({ day, n: byDay[day] }));
  } catch (error) {
    console.warn(`No daily downloads for ${name}:`, error.message);
  }
  return { version, releasedAt: newest?.created_at ?? crate.updated_at ?? null, description: crate.description ?? "", daily, monthFallback: crate.recent_downloads ?? null };
}

function fetchPackage(p, timeout, light, previous) {
  if (p.eco === "npm") return fetchNpm(p.name, timeout, light);
  if (p.eco === "pypi") return fetchPyPI(p.name, timeout, light, previous);
  return fetchCrates(p.name, timeout);
}

// ───────────────────────── Refresh, releases and notifications

async function announce(rec, oldVersion) {
  const log = Storage.get("releases", []);
  if (!log.some((e) => e.key === rec.key && e.version === rec.version)) {
    Storage.set("releases", [{ key: rec.key, name: rec.name, eco: rec.eco, version: rec.version, from: oldVersion, at: Date.now() }, ...log].slice(0, 40));
  }
  if (!settings().notify || Script.env.mode === "widget") return;
  try {
    await Notification.schedule({
      id: `ver-${rec.key}-${rec.version}`, // the same id twice replaces instead of repeating
      title: `${rec.name} ${rec.version}`,
      body: `New ${ECOSYSTEMS[rec.eco].label} release, up from ${oldVersion}.`,
    });
  } catch (error) {
    console.warn("Could not notify:", error.message);
  }
}

async function summarize(rec, readme) {
  try {
    const text = plainText(readme).slice(0, 6000);
    if (text.length < 200) return null;
    const summary = await AI.summarize(text, { sentences: 2 });
    return summary?.trim() || null;
  } catch (error) {
    console.warn(`Summary failed for ${rec.name}:`, error.message);
    return null;
  }
}

async function refresh({ light = false, only = null } = {}) {
  const list = only ? packages().filter((p) => keyOf(p) === only) : packages();
  if (list.length === 0) return;
  const limit = TIME_LIMITS[Script.env.mode] ?? 20_000;
  const timeout = Math.min(8000, limit - 2500);
  const current = data();
  const next = { ...current };
  const readmes = {};

  await Promise.all(list.map(async (p) => {
    const key = keyOf(p);
    const previous = current[key];
    try {
      const fresh = await fetchPackage(p, timeout, light, previous);
      const { readme, monthFallback, ...rest } = fresh;
      const rec = {
        ...p, key, ...rest,
        releasedAt: rest.releasedAt ?? (previous?.version === rest.version ? previous?.releasedAt ?? null : null),
        month: rest.daily.length ? rest.daily.reduce((s, d) => s + d.n, 0) : monthFallback,
        trend: trendOf(rest.daily),
        summary: previous?.summary ?? null,
        summaryVersion: previous?.summaryVersion ?? null,
        time: Date.now(),
        error: null,
      };
      if (readme) readmes[key] = readme;
      next[key] = rec;
      if (previous?.version && rec.version && previous.version !== rec.version) await announce(rec, previous.version);
    } catch (error) {
      next[key] = { ...(previous ?? { ...p, key, daily: [] }), error: error.message, errorTime: Date.now() };
    }
  }));

  // On-device summaries, one at a time, only in the app and only for versions not summarised yet.
  if (Script.env.mode === "app" && Object.keys(readmes).length) {
    const status = await AI.availability().catch(() => ({ available: false }));
    if (status.available) {
      for (const [key, readme] of Object.entries(readmes)) {
        const rec = next[key];
        if (rec.summaryVersion === rec.version) continue;
        const summary = await summarize(rec, readme);
        next[key] = { ...rec, summary, summaryVersion: rec.version };
      }
    }
  }

  for (const key of Object.keys(next)) if (!packages().some((p) => keyOf(p) === key)) delete next[key];
  Storage.set("data", next);
  Storage.set("dataTime", Date.now());
}

async function refreshSafely(options) {
  try {
    await refresh(options);
    Storage.remove("lastError");
    return true;
  } catch (error) {
    Storage.set("lastError", { message: error.message, time: Date.now() });
    return false;
  }
}

// ───────────────────────── Run and background

Script.run(async () => {
  if (packages().length === 0) return "No packages yet. Open Package Watch's mini-app to add some.";
  await refreshSafely();
  return packages().map((p) => {
    const r = record(p);
    if (!r?.version) return `${p.name}: ${r?.error ?? "not loaded"}`;
    return `${p.name} ${r.version} · ${full(perDay(r))}/day ${trendLook(r.trend).arrow}`;
  }).join("\n");
});

Script.background(() => refreshSafely());

// ───────────────────────── Widget pieces

const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };

const ecoBadge = (eco, font = 9) => Widget.text(ECOSYSTEMS[eco].label, {
  font, weight: "bold", color: "white", lineLimit: 1,
  padding: { horizontal: 5, vertical: 1 }, background: ECOSYSTEMS[eco].hex, cornerRadius: 5,
});

function sparkline(r, color, { width, height = 20, kind = "line" } = {}) {
  const values = (r?.daily ?? []).map((d) => d.n);
  if (values.length < 2) return width ? Widget.spacer(width) : Widget.text("downloads build up", { font: "caption2", color: "secondary" });
  return Widget.chart(values, { kind, axes: false, smooth: true, color, frame: width ? { width, height } : { height } });
}

function packageRow(p, i, { showSpark = true } = {}) {
  const r = record(p);
  const look = trendLook(r?.trend);
  return Widget.hstack([
    ecoBadge(p.eco),
    Widget.vstack([
      Widget.text(p.name, { font: "footnote", weight: "semibold", lineLimit: 1, minimumScale: 0.7 }),
      Widget.text(r?.version ? `v${r.version}` : r?.error ?? "loading…", { font: "caption2", color: r?.error ? "orange" : "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 0 }),
    Widget.spacer(),
    showSpark ? sparkline(r, SERIES_COLORS[i % SERIES_COLORS.length], { width: 54, height: 18 }) : null,
    Widget.vstack([
      Widget.text(compact(perDay(r)), { font: "footnote", weight: "bold", design: "rounded", lineLimit: 1 }),
      Widget.text("per day", { font: "caption2", color: "secondary" }),
    ], { alignment: "trailing", spacing: 0, frame: { width: 46, alignment: "trailing" } }),
    Widget.text(look.arrow, { font: "headline", weight: "bold", color: look.color, frame: { width: 14 } }),
  ], { spacing: 6, url: ECOSYSTEMS[p.eco].page(p.name) });
}

function footer() {
  const time = Storage.get("dataTime");
  return Widget.hstack([
    Widget.text("Updated", { font: "caption2", color: "secondary" }),
    time ? Widget.date(time, { style: "relative", font: "caption2", color: "secondary" }) : Widget.text("never", { font: "caption2", color: "secondary" }),
  ], { spacing: 3 });
}

// Every package's last 30 days on one chart, indexed to its own average so sizes are comparable.
function indexedChart(list, height) {
  const points = [];
  list.forEach((p) => {
    const r = record(p);
    const mean = perDay(r);
    if (!mean || r.daily.length < 2) return;
    r.daily.slice(-30).forEach((d) => points.push({ x: d.day.slice(5), y: Math.round((d.n / mean) * 100), series: p.name }));
  });
  if (points.length === 0) return Widget.text("Charts appear once downloads have loaded.", { font: "caption", color: "secondary" });
  return Widget.chart(points, { kind: "line", smooth: true, colors: SERIES_COLORS, frame: { height } });
}

function emptyWidget(message) {
  return Widget.vstack([
    Widget.symbol("shippingbox.fill", { size: 26, color: "orange", fallback: "📦" }),
    Widget.text(message, { font: "caption", color: "secondary", align: "center", lineLimit: 3 }),
  ], { spacing: 6, url: APP_LINK });
}

// ───────────────────────── Widget

Script.widget(async ({ family, parameter }) => {
  if (packages().length === 0) return emptyWidget("Open the mini-app and add a package");
  if (Date.now() - (Storage.get("dataTime") ?? 0) > STALE_MS && !Script.env.lowPowerMode) await refreshSafely({ light: true });
  if (!Storage.get("dataTime")) return emptyWidget(Storage.get("lastError")?.message ?? "Run Package Watch once in the app");

  const list = packages();
  let content;

  if (family === "small") {
    const p = featured(parameter);
    const r = record(p);
    const look = trendLook(r?.trend);
    content = Widget.vstack([
      Widget.hstack([ecoBadge(p.eco), Widget.spacer(), Widget.text(look.arrow, { font: "title3", weight: "bold", color: look.color })]),
      Widget.text(p.name, { font: "headline", lineLimit: 1, minimumScale: 0.6 }),
      Widget.text(r?.version ? `v${r.version}` : r?.error ?? "loading…", { font: "caption", color: r?.error ? "orange" : "secondary", lineLimit: 1 }),
      Widget.spacer(),
      Widget.text(compact(perDay(r)), { font: 30, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
      Widget.text("downloads per day", { font: "caption2", color: "secondary" }),
      sparkline(r, look.color === "secondary" ? "orange" : look.color, { height: 26, kind: "area" }),
    ], { alignment: "leading", spacing: 2, url: APP_LINK, frame: fill });
  } else if (family === "medium") {
    content = Widget.vstack([
      ...list.slice(0, 4).map((p, i) => packageRow(p, i)),
      Widget.spacer(),
      Widget.hstack([Widget.text(`${list.length} package${list.length === 1 ? "" : "s"} · 30-day average per day`, { font: "caption2", color: "secondary" }), Widget.spacer(), footer()]),
    ], { alignment: "leading", spacing: 7, url: APP_LINK, frame: fill });
  } else {
    const shown = list.slice(0, 6);
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("shippingbox.fill", { size: 15, color: "orange", fallback: "📦" }),
        Widget.text("Package Watch", { font: "headline" }),
        Widget.spacer(),
        footer(),
      ], { spacing: 6 }),
      ...shown.map((p, i) => packageRow(p, i, { showSpark: false })),
      Widget.divider(),
      indexedChart(shown, 118),
      Widget.text("Daily downloads, 30 days, each package indexed to its own average (100)", { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
    ], { alignment: "leading", spacing: 6, url: APP_LINK, frame: fill });
  }

  return { content, refreshAfter: 60 * 60 };
});

// ───────────────────────── Mini-app actions

Script.action("page", ({ value }) => Storage.set("ui.page", value));
Script.action("eco", ({ value }) => Storage.set("ui.eco", value));
Script.action("open", ({ key }) => Storage.set("ui.pkg", key));
Script.action("back", () => Storage.remove("ui.pkg"));
Script.action("notify", ({ isOn }) => Storage.set("settings", { ...settings(), notify: isOn }));
Script.action("link", ({ url }) => UI.openURL(url));

Script.action("refresh", async (args) => {
  const key = args?.key ?? null;
  await UI.haptic((await refreshSafely(key ? { only: key } : undefined)) ? "success" : "error");
});

Script.action("add", async ({ value }) => {
  const eco = Storage.get("ui.eco", "npm");
  const name = String(value ?? "").trim();
  if (!name) return;
  const valid = eco === "npm" ? /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i : /^[A-Za-z0-9][\w.-]*$/;
  if (!valid.test(name)) return UI.alert({ title: "Not a package name", message: `“${name}” does not look like a ${ECOSYSTEMS[eco].label} package.` });
  if (packages().some((p) => keyOf(p) === keyOf({ eco, name }))) return UI.alert("That package is already on the list.");
  if (packages().length >= MAX_PACKAGES) return UI.alert(`Package Watch holds up to ${MAX_PACKAGES} packages.`);
  Storage.set("packages", [...packages(), { eco, name }]);
  await refreshSafely({ only: keyOf({ eco, name }) });
  const r = data()[keyOf({ eco, name })];
  if (r?.error) await UI.alert({ title: `Could not load ${name}`, message: r.error });
  else Storage.set("ui.page", "packages");
});

Script.action("remove", async ({ key }) => {
  const p = packages().find((x) => keyOf(x) === key);
  const choice = await UI.alert({ title: `Stop watching ${p?.name ?? key}?`, buttons: ["Cancel", "Remove"] });
  if (choice !== 1) return;
  Storage.set("packages", packages().filter((x) => keyOf(x) !== key));
  const next = data();
  delete next[key];
  Storage.set("data", next);
  Storage.remove("ui.pkg");
});

// ───────────────────────── Mini-app screens

const statTile = (label, value, color) => Widget.vstack([
  Widget.text(label, { font: "caption2", color: "secondary" }),
  Widget.text(value, { font: "title3", weight: "bold", design: "rounded", color, lineLimit: 1, minimumScale: 0.6 }),
], { alignment: "leading", spacing: 2, padding: 10, background: TILE_BG, cornerRadius: 12, frame: { maxWidth: "infinity", alignment: "leading" } });

function detailPage(key) {
  const p = packages().find((x) => keyOf(x) === key);
  const r = record(p);
  const look = trendLook(r?.trend);
  const daily = r?.daily ?? [];
  return Widget.vstack([
    Widget.hstack([
      Widget.button(Widget.label("Packages", "chevron.left"), "back", null, { style: "plain" }),
      Widget.spacer(),
      Widget.button(Widget.label("Refresh", "arrow.clockwise"), "refresh", { key }, { style: "bordered" }),
    ]),
    Widget.hstack([ecoBadge(p.eco, 11), Widget.text(p.name, { font: "title2", weight: "bold", lineLimit: 1, minimumScale: 0.5 })], { spacing: 8 }),
    r?.error ? Widget.text(`⚠️ ${r.error}`, { font: "footnote", color: "orange" }) : null,
    Widget.hstack([
      statTile("Latest version", r?.version ?? "–", "primary"),
      statTile("30 days", compact(r?.month), "primary"),
      statTile("Trend", `${look.arrow} ${r?.trend == null ? "–" : `${Math.round(Math.abs(r.trend) * 100)}%`}`, look.color),
    ], { spacing: 8 }),
    r?.releasedAt
      ? Widget.hstack([
          Widget.symbol("calendar", { size: 13, color: "secondary", fallback: "📅" }),
          Widget.text("Released", { font: "footnote", color: "secondary" }),
          Widget.date(r.releasedAt, { style: "date", font: "footnote" }),
          Widget.text("·", { font: "footnote", color: "secondary" }),
          Widget.date(r.releasedAt, { style: "relative", font: "footnote", color: "secondary" }),
        ], { spacing: 4 })
      : null,
    Widget.card([
      daily.length >= 2
        ? Widget.chart(daily.slice(-30).map((d) => ({ x: d.day.slice(5), y: d.n })), { kind: "bar", color: look.color === "secondary" ? "orange" : look.color, frame: { height: 200 } })
        : Widget.text("No daily download history yet.", { color: "secondary" }),
      Widget.text(`${full(perDay(r))} per day on average · ${look.text}`, { font: "caption", color: "secondary" }),
    ], { title: "Downloads, last 30 days", symbol: "chart.bar.fill", color: "orange" }),
    (r?.summary || r?.description)
      ? Widget.card([
          Widget.text(r.summary || r.description, { font: "callout" }),
          r.summary ? Widget.text("Summarised on-device from the README", { font: "caption2", color: "secondary" }) : null,
        ], { title: "About", symbol: r?.summary ? "sparkles" : "text.alignleft", color: "purple" })
      : null,
    Widget.hstack([
      Widget.button(`Open on ${ECOSYSTEMS[p.eco].label}`, "link", { url: ECOSYSTEMS[p.eco].page(p.name) }, { style: "prominent" }),
      Widget.button("Remove", "remove", { key }, { style: "bordered", color: "red" }),
    ], { spacing: 10 }),
  ], { alignment: "leading", spacing: 14 });
}

function packagesPage() {
  const list = packages();
  if (list.length === 0) {
    return Widget.vstack([
      Widget.symbol("shippingbox.fill", { size: 56, color: "orange", fallback: "📦" }),
      Widget.text("Nothing watched yet. Use Add to follow your first package.", { color: "secondary", align: "center" }),
    ], { spacing: 14, padding: 20, frame: { maxWidth: "infinity" } });
  }
  return Widget.vstack([
    Widget.hstack([footer(), Widget.spacer(), Widget.button(Widget.label("Refresh all", "arrow.clockwise"), "refresh", null, { style: "bordered" })]),
    ...list.map((p, i) => {
      const r = record(p);
      const look = trendLook(r?.trend);
      return Widget.button(Widget.hstack([
        ecoBadge(p.eco, 10),
        Widget.vstack([
          Widget.text(p.name, { font: "headline", lineLimit: 1, minimumScale: 0.7 }),
          Widget.text(r?.version ? `v${r.version}${r.releasedAt ? ` · ${new Date(r.releasedAt).toLocaleDateString(Script.env.locale, { day: "numeric", month: "short" })}` : ""}` : r?.error ?? "loading…", { font: "caption", color: r?.error ? "orange" : "secondary", lineLimit: 1 }),
        ], { alignment: "leading", spacing: 1 }),
        Widget.spacer(),
        sparkline(r, SERIES_COLORS[i % SERIES_COLORS.length], { width: 70, height: 24 }),
        Widget.vstack([
          Widget.text(compact(perDay(r)), { font: "headline", design: "rounded" }),
          Widget.text(`${look.arrow} per day`, { font: "caption2", color: look.color }),
        ], { alignment: "trailing", spacing: 1, frame: { width: 60, alignment: "trailing" } }),
      ], { spacing: 10, padding: 12, background: TILE_BG, cornerRadius: 14 }), "open", { key: keyOf(p) }, { style: "plain" });
    }),
    list.length >= 2 ? Widget.card([
      indexedChart(list.slice(0, 6), 200),
      Widget.text("Each package indexed to its own 30-day average = 100", { font: "caption2", color: "secondary" }),
    ], { title: "Side by side", symbol: "chart.xyaxis.line", color: "blue" }) : null,
  ], { alignment: "leading", spacing: 12 });
}

function addPage() {
  const eco = Storage.get("ui.eco", "npm");
  const hints = { npm: "react, @types/node", pypi: "requests, numpy", crates: "serde, tokio" };
  const releases = Storage.get("releases", []);
  return Widget.vstack([
    Widget.picker(Object.entries(ECOSYSTEMS).map(([value, e]) => ({ label: e.label, value })), eco, "eco", null, { style: "segmented", label: "Registry" }),
    Widget.textField(`for example ${hints[eco]}`, "", "add", null, { label: "Package name", keyboard: "url" }),
    Widget.text(`${packages().length} of ${MAX_PACKAGES} · tap Return to add`, { font: "caption2", color: "secondary" }),
    Widget.divider(),
    Widget.toggle("Notify me about new versions", settings().notify, "notify", null, { color: "orange" }),
    Widget.text("Versions are checked in background runs a few times a day and whenever you refresh.", { font: "caption", color: "secondary" }),
    releases.length ? Widget.list(releases.slice(0, 15).map((e) => ({
      title: `${e.name} ${e.version}`,
      subtitle: `${ECOSYSTEMS[e.eco]?.label ?? e.eco} · was ${e.from} · ${new Date(e.at).toLocaleDateString(Script.env.locale, { day: "numeric", month: "short" })}`,
      symbol: "arrow.up.circle.fill", color: "orange",
      url: ECOSYSTEMS[e.eco]?.page(e.name),
    })), { title: "Recent releases" }) : null,
  ], { alignment: "leading", spacing: 12 });
}

let loadedOnce = false;

Script.ui(async () => {
  if (!loadedOnce) {
    loadedOnce = true;
    if (packages().length && Date.now() - (Storage.get("dataTime") ?? 0) > STALE_MS) await refreshSafely();
  }
  const selected = Storage.get("ui.pkg");
  if (selected && packages().some((p) => keyOf(p) === selected)) {
    return { title: selected.split(":")[1], content: Widget.vstack([detailPage(selected)], { padding: 16 }) };
  }
  const page = Storage.get("ui.page", "packages");
  const error = Storage.get("lastError");
  return {
    title: "Package Watch",
    content: Widget.vstack([
      Widget.picker([{ label: "Packages", value: "packages" }, { label: "Add", value: "add" }], page, "page", null, { style: "segmented" }),
      error ? Widget.text(`⚠️ ${error.message}`, { font: "footnote", color: "orange" }) : null,
      page === "add" ? addPage() : packagesPage(),
    ], { alignment: "leading", spacing: 16, padding: 16 }),
  };
});
