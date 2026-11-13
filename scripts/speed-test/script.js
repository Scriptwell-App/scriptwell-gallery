// @name        Speed Test
// @description Measures download speed and latency against Cloudflare's public speed test server (speed.cloudflare.com), keeps a history with charts by test and by hour of day, and shows the last result as a gauge in a widget
// @permissions network
// @widget      small, medium, large
// @icon        speedometer
// @color       #F97316
// @version     1.0.0
// @author      va4w
// @category    utilities

// How it works
// • Tap "Run test" in the mini-app (or run the script from Shortcuts). It sends five tiny requests
//   to speed.cloudflare.com to measure latency and jitter, then downloads test files of 1, 2 and 4 MB
//   and keeps the best download speed. A full test moves about 7 MB; lower the largest file in
//   Settings on a metered connection.
// • The only host contacted is speed.cloudflare.com. It receives nothing but the request for test
//   data; no identifiers, no results.
// • Results are kept in the script's Files folder (history.json) and summarised in Storage for the
//   widget. The widget never runs a test itself because a test takes longer than a widget is allowed;
//   tapping it opens the mini-app.
// • The mini-app redraws when an action finishes, so the result appears when the test is done,
//   usually after 5 to 20 seconds.

// ─────────────────────────────────────────── Constants

const HOST = "https://speed.cloudflare.com/__down";
const SIZES = [1_000_000, 2_000_000, 4_000_000];
const PINGS = 5;
const HISTORY_PATH = "history.json";
const MAX_HISTORY = 300;
const SPARK = 30;
const TIME_LIMITS = { app: 30_000, pwa: 30_000, shortcut: 20_000, background: 15_000, widget: 8_000 };
const TIME_MARGIN = 4_000;

const locale = Script.env.locale;
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const TILE_BG = { light: "#F1F5F9", dark: "#1E293B" };
const DIM = { light: "#0F172A12", dark: "#FFFFFF1A" };
const ACCENT = "#F97316";

const RATINGS = [
  { min: 300, label: "Very fast", color: "purple", hex: "#A855F7" },
  { min: 100, label: "Fast", color: "blue", hex: "#3B82F6" },
  { min: 25, label: "Good", color: "green", hex: "#22C55E" },
  { min: 5, label: "Fair", color: "orange", hex: "#F97316" },
  { min: 0, label: "Slow", color: "red", hex: "#EF4444" },
];
const ratingOf = (mbps) => RATINGS.find((r) => mbps >= r.min) ?? RATINGS.at(-1);

// ─────────────────────────────────────────── Settings and formatting

const DEFAULTS = { maxSize: 4_000_000, unit: "mbps" };
const settings = () => ({ ...DEFAULTS, ...Storage.get("settings", {}) });

function fmtSpeed(mbps, withUnit = true) {
  if (mbps == null) return "–";
  const unit = settings().unit;
  const value = unit === "mbs" ? mbps / 8 : mbps;
  const digits = value < 10 ? 1 : 0;
  const text = value.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  return withUnit ? `${text} ${unitLabel()}` : text;
}

const unitLabel = () => (settings().unit === "mbs" ? "MB/s" : "Mbps");
const fmtMs = (ms) => (ms == null ? "–" : `${ms.toLocaleString(locale, { maximumFractionDigits: ms < 10 ? 1 : 0 })} ms`);
const fmtMB = (bytes) => `${(bytes / 1e6).toLocaleString(locale, { maximumFractionDigits: 0 })} MB`;
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// Gauge position on a log scale: 1 Mbps is near empty, 1000 Mbps fills the ring.
const gaugeFraction = (mbps) => Math.max(0.02, Math.min(1, Math.log10(1 + Math.max(0, mbps)) / 3));

// ─────────────────────────────────────────── History

async function loadHistory() {
  try {
    return (await Files.exists(HISTORY_PATH)) ? await Files.readJSON(HISTORY_PATH) : [];
  } catch {
    return [];
  }
}

// Hour-of-day buckets: count, sum, best and worst download speed.
function hourBuckets(history) {
  const hours = Array.from({ length: 24 }, () => ({ n: 0, sum: 0, best: 0, worst: Infinity }));
  for (const r of history) {
    const h = hours[new Date(r.t).getHours()];
    h.n += 1;
    h.sum += r.mbps;
    h.best = Math.max(h.best, r.mbps);
    h.worst = Math.min(h.worst, r.mbps);
  }
  return hours.map((h) => (h.n ? { n: h.n, avg: round(h.sum / h.n), best: round(h.best), worst: round(h.worst) } : null));
}

async function saveResult(result) {
  const history = [...(await loadHistory()), result].slice(-MAX_HISTORY);
  await Files.writeJSON(HISTORY_PATH, history);
  const recent = history.slice(-SPARK);
  Storage.set("last", result);
  Storage.set("stats", {
    count: history.length,
    best: round(Math.max(...history.map((r) => r.mbps))),
    average: round(history.reduce((s, r) => s + r.mbps, 0) / history.length),
    spark: recent.map((r) => round(r.mbps)),
    latency: recent.map((r) => round(r.ms)),
    hours: hourBuckets(history),
  });
}

// ─────────────────────────────────────────── Measuring

function makeBudget() {
  const end = Date.now() + (TIME_LIMITS[Script.env.mode] ?? 20_000) - TIME_MARGIN;
  return { left: () => end - Date.now() };
}

function testUrl(bytes) {
  const url = new URL(HOST);
  url.searchParams.set("bytes", String(bytes));
  return url;
}

// One round trip: a request for zero bytes, timed with Date.now.
async function ping(timeout) {
  const started = Date.now();
  const response = await fetch(testUrl(0), { timeout });
  if (!response.ok) throw new Error(`${response.status} from speed.cloudflare.com`);
  await response.bytes();
  return Date.now() - started;
}

function latencyStats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
  let jitter = 0;
  for (let i = 1; i < samples.length; i++) jitter += Math.abs(samples[i] - samples[i - 1]);
  jitter = samples.length > 1 ? jitter / (samples.length - 1) : 0;
  return { min: sorted[0], avg, max: sorted.at(-1), jitter };
}

// Downloads one test file. The first round trip is taken off the time so small files are not
// penalised for latency.
async function timedDownload(bytes, timeout, rtt) {
  const started = Date.now();
  const response = await fetch(testUrl(bytes), { timeout });
  if (!response.ok) throw new Error(`${response.status} from speed.cloudflare.com`);
  const body = await response.bytes();
  const elapsed = Date.now() - started;
  const received = body.length || bytes;
  const seconds = Math.max(0.05, (elapsed - Math.min(rtt, elapsed / 2)) / 1000);
  return { bytes: received, elapsed, mbps: (received * 8) / seconds / 1e6 };
}

async function runTest() {
  const budget = makeBudget();
  const pings = [];
  let pingError = null;
  for (let i = 0; i < PINGS; i++) {
    if (budget.left() < 3_000) break;
    try { pings.push(await ping(Math.min(3_000, budget.left()))); } catch (error) { pingError = error; }
  }
  if (pings.length === 0) throw new Error(`speed.cloudflare.com did not answer (${pingError?.message ?? "no reply"}). Check your connection.`);
  const latency = latencyStats(pings);

  const downloads = [];
  let downloadError = null;
  for (const size of SIZES.filter((s) => s <= settings().maxSize)) {
    const left = budget.left();
    if (left < 2_500) break;
    if (downloads.length) {
      // Skip a bigger file when the speed so far says it would not finish in time.
      const best = Math.max(...downloads.map((d) => d.mbps));
      const predicted = ((size * 8) / (best * 1e6)) * 1000 + latency.min;
      if (predicted > left - 1_000) break;
    }
    try {
      downloads.push(await timedDownload(size, Math.min(left - 500, 25_000), latency.min));
    } catch (error) {
      downloadError = error;
      break;
    }
  }
  if (downloads.length === 0) throw new Error(`Download failed: ${downloadError?.message ?? "no data"}`);

  const result = {
    t: Date.now(),
    mbps: round(Math.max(...downloads.map((d) => d.mbps)), 2),
    ms: round(latency.min),
    avgMs: round(latency.avg),
    jitter: round(latency.jitter),
    bytes: downloads.reduce((s, d) => s + d.bytes, 0),
    files: downloads.length,
    device: Script.env.device,
  };
  await saveResult(result);
  Storage.set("lastError", null);
  return result;
}

async function testAndRemember() {
  try {
    return await runTest();
  } catch (error) {
    Storage.set("lastError", { message: error.message ?? String(error), time: Date.now() });
    throw error;
  }
}

function describe(r) {
  return `Download ${fmtSpeed(r.mbps)} (${ratingOf(r.mbps).label.toLowerCase()}), latency ${fmtMs(r.ms)}, jitter ${fmtMs(r.jitter)}, ${fmtMB(r.bytes)} moved.`;
}

// ─────────────────────────────────────────── Entry point: run (Shortcuts, Siri, ▶)

Script.run(async () => {
  try {
    return describe(await testAndRemember());
  } catch (error) {
    return `Speed test failed: ${error.message}`;
  }
});

// ─────────────────────────────────────────── Widget pieces

function gauge(mbps, size) {
  const rating = ratingOf(mbps);
  return Widget.progress(gaugeFraction(mbps), { style: "ring", color: rating.color, label: fmtSpeed(mbps, false), frame: { width: size, height: size } });
}

function badge(mbps) {
  const rating = ratingOf(mbps);
  return Widget.text(rating.label, {
    font: "caption2", weight: "bold", color: rating.color, lineLimit: 1,
    padding: { horizontal: 6, vertical: 2 }, background: { light: `${rating.hex}26`, dark: `${rating.hex}40` }, cornerRadius: 6,
  });
}

function sparkline(values, color, height, kind = "line") {
  if (!values || values.length < 2) {
    return Widget.text("History builds up with each test.", { font: "caption2", color: "secondary", frame: { height } });
  }
  return Widget.chart(values, { kind, axes: false, smooth: true, color, frame: { height } });
}

function stat(title, value, color = "primary") {
  return Widget.vstack([
    Widget.text(title, { font: "caption2", color: "secondary", lineLimit: 1 }),
    Widget.text(value, { font: "subheadline", weight: "bold", design: "rounded", color, lineLimit: 1, minimumScale: 0.6 }),
  ], { alignment: "leading", spacing: 1, padding: { horizontal: 8, vertical: 6 }, background: TILE_BG, cornerRadius: 10, frame: { maxWidth: "infinity", alignment: "leading" } });
}

// 24 cells, two rows of twelve, tinted by the average speed in that hour relative to the best hour.
function hourGrid(hours, { showLabels = true, height = 18 } = {}) {
  const top = Math.max(1, ...hours.filter(Boolean).map((h) => h.avg));
  const cell = (h, i) => {
    const alpha = h ? Math.round(40 + 215 * (h.avg / top)).toString(16).padStart(2, "0") : null;
    return Widget.vstack([
      showLabels ? Widget.text(String(i), { font: 8, weight: "semibold", color: h && h.avg / top > 0.55 ? "white" : "secondary", lineLimit: 1, minimumScale: 0.5 }) : null,
    ], { background: h ? `${ACCENT}${alpha}` : DIM, cornerRadius: 4, frame: { maxWidth: "infinity", height } });
  };
  return Widget.vstack([
    Widget.hstack(hours.slice(0, 12).map(cell), { spacing: 2 }),
    Widget.hstack(hours.slice(12).map((h, i) => cell(h, i + 12)), { spacing: 2 }),
  ], { spacing: 2 });
}

function emptyWidget(family) {
  return Widget.vstack([
    Widget.symbol("speedometer", { size: family === "small" ? 28 : 36, color: "orange", fallback: "⏱" }),
    Widget.text("No test yet", { font: "headline" }),
    Widget.text("Tap to open and run one", { font: "caption", color: "secondary", align: "center" }),
  ], { spacing: 6, url: APP_LINK });
}

// ─────────────────────────────────────────── Widget

Script.widget(({ family }) => {
  const last = Storage.get("last");
  const stats = Storage.get("stats");
  if (!last || !stats) return { content: emptyWidget(family), refreshAfter: 60 * 60 };
  const rating = ratingOf(last.mbps);
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  let content;

  if (family === "small") {
    content = Widget.vstack([
      Widget.hstack([
        gauge(last.mbps, 64),
        Widget.spacer(),
        Widget.vstack([
          badge(last.mbps),
          Widget.text(unitLabel(), { font: "caption2", color: "secondary" }),
        ], { alignment: "trailing", spacing: 4 }),
      ], { alignment: "top" }),
      Widget.text(`${fmtMs(last.ms)} latency`, { font: "caption", weight: "medium", lineLimit: 1 }),
      sparkline(stats.spark, rating.color, 26),
      Widget.hstack([
        Widget.text("tested", { font: "caption2", color: "secondary" }),
        Widget.date(last.t, { style: "relative", font: "caption2", color: "secondary" }),
      ], { spacing: 3 }),
    ], { alignment: "leading", spacing: 4, url: APP_LINK, frame: fill });
  } else if (family === "medium") {
    content = Widget.hstack([
      Widget.vstack([
        gauge(last.mbps, 84),
        Widget.text(unitLabel(), { font: "caption2", color: "secondary" }),
      ], { spacing: 2 }),
      Widget.vstack([
        Widget.hstack([
          Widget.text("Download", { font: "headline" }),
          Widget.spacer(),
          badge(last.mbps),
        ]),
        Widget.text(`Latency ${fmtMs(last.ms)} · jitter ${fmtMs(last.jitter)}`, { font: "caption", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
        sparkline(stats.spark, rating.color, 34, "area"),
        Widget.hstack([
          Widget.text(`Best ${fmtSpeed(stats.best)} · ${stats.count} test${stats.count === 1 ? "" : "s"}`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
          Widget.spacer(),
          Widget.date(last.t, { style: "relative", font: "caption2", color: "secondary" }),
        ]),
      ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 14, url: APP_LINK, frame: fill });
  } else {
    const points = stats.spark.map((y, i) => ({ x: i - stats.spark.length + 1, y }));
    content = Widget.vstack([
      Widget.hstack([
        Widget.text("Speed Test", { font: "headline" }),
        Widget.spacer(),
        Widget.text("tested", { font: "caption2", color: "secondary" }),
        Widget.date(last.t, { style: "relative", font: "caption2", color: "secondary" }),
      ], { spacing: 3 }),
      Widget.hstack([
        Widget.vstack([
          gauge(last.mbps, 92),
          Widget.text(unitLabel(), { font: "caption2", color: "secondary" }),
        ], { spacing: 2 }),
        Widget.vstack([
          Widget.hstack([stat("Latency", fmtMs(last.ms)), stat("Jitter", fmtMs(last.jitter))], { spacing: 6 }),
          Widget.hstack([stat("Best", fmtSpeed(stats.best), "green"), stat("Average", fmtSpeed(stats.average))], { spacing: 6 }),
          Widget.hstack([badge(last.mbps), Widget.text(`${stats.count} test${stats.count === 1 ? "" : "s"} on record`, { font: "caption2", color: "secondary" })], { spacing: 6 }),
        ], { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", alignment: "leading" } }),
      ], { spacing: 12, alignment: "center" }),
      Widget.vstack([
        Widget.text(`Last ${stats.spark.length} tests · ${unitLabel()}`, { font: "caption", weight: "semibold", color: "secondary" }),
        points.length >= 2
          ? Widget.chart(points, { kind: "bar", color: rating.color, frame: { height: 96 } })
          : sparkline(stats.spark, rating.color, 96),
      ], { alignment: "leading", spacing: 3 }),
      Widget.vstack([
        Widget.text("Average by hour of day", { font: "caption", weight: "semibold", color: "secondary" }),
        hourGrid(stats.hours, { height: 16 }),
      ], { alignment: "leading", spacing: 3 }),
      Widget.spacer(),
      Widget.text("Tap to run a new test", { font: "caption2", color: "secondary" }),
    ], { alignment: "leading", spacing: 8, url: APP_LINK, frame: fill });
  }

  return { content, refreshAfter: 60 * 60 };
});

// ─────────────────────────────────────────── Mini-app actions

Script.action("test", async () => {
  try {
    await testAndRemember();
    await UI.haptic("success");
  } catch {
    await UI.haptic("error");
  }
});

Script.action("set", ({ field, value }) => Storage.set("settings", { ...settings(), [field]: value }));

Script.action("share", async () => {
  const last = Storage.get("last");
  if (last) await UI.share(`Speed test on ${last.device}: ${describe(last)} (${new Date(last.t).toLocaleString(locale)})`);
});

Script.action("export", async () => {
  const history = await loadHistory();
  const lines = ["time,download_mbps,latency_ms,avg_latency_ms,jitter_ms,bytes,device"];
  for (const r of history) lines.push([new Date(r.t).toISOString(), r.mbps, r.ms, r.avgMs, r.jitter, r.bytes, r.device].join(","));
  await Files.write("exports/speed-tests.csv", lines.join("\n"));
  await Files.export("exports/speed-tests.csv", { name: `speed-tests-${new Date().toLocaleDateString("en-CA")}.csv` });
});

Script.action("clear", async () => {
  const choice = await UI.alert({ title: "Delete all results?", message: "The history, charts and widget start again from the next test.", buttons: ["Cancel", "Delete"] });
  if (choice === 1) {
    if (await Files.exists(HISTORY_PATH)) await Files.remove(HISTORY_PATH);
    Storage.remove("last");
    Storage.remove("stats");
  }
});

// ─────────────────────────────────────────── Mini-app pieces

function heroCard(last) {
  if (!last) {
    return Widget.card([
      Widget.vstack([
        Widget.symbol("speedometer", { size: 56, color: "orange", fallback: "⏱" }),
        Widget.text("No test yet", { font: "title3", weight: "semibold" }),
        Widget.text("Run one to see your download speed and latency.", { font: "footnote", color: "secondary", align: "center" }),
      ], { spacing: 8, frame: { maxWidth: "infinity" } }),
    ], { title: "Download", symbol: "arrow.down.circle.fill", color: "orange" });
  }
  const rating = ratingOf(last.mbps);
  return Widget.card([
    Widget.hstack([
      gauge(last.mbps, 120),
      Widget.vstack([
        Widget.text(unitLabel(), { font: "caption", color: "secondary" }),
        badge(last.mbps),
        Widget.label(`${fmtMs(last.ms)} latency`, "timer", { color: "blue" }),
        Widget.label(`${fmtMs(last.jitter)} jitter`, "waveform.path", { color: "purple" }),
        Widget.label(`${fmtMB(last.bytes)} in ${last.files} file${last.files === 1 ? "" : "s"}`, "arrow.down.circle", { color: "secondary" }),
        Widget.hstack([
          Widget.text("Tested", { font: "caption", color: "secondary" }),
          Widget.date(last.t, { style: "relative", font: "caption", color: "secondary" }),
        ], { spacing: 3 }),
      ], { alignment: "leading", spacing: 5 }),
      Widget.spacer(),
    ], { spacing: 18, alignment: "center" }),
  ], { title: "Download", symbol: "arrow.down.circle.fill", color: rating.color });
}

function testsChart(stats) {
  if (!stats || stats.spark.length < 2) return Widget.text("Run a few tests to see a chart.", { font: "footnote", color: "secondary", padding: 12 });
  const n = stats.spark.length;
  return Widget.vstack([
    Widget.chart(stats.spark.map((y, i) => ({ x: i - n + 1, y })), { kind: "bar", color: "orange", frame: { height: 200 } }),
    Widget.text(`Tests ago (0 is the latest) · ${unitLabel()}`, { font: "caption2", color: "secondary" }),
  ], { spacing: 4 });
}

function latencyChart(stats) {
  if (!stats || stats.latency.length < 2) return Widget.text("Run a few tests to see a chart.", { font: "footnote", color: "secondary", padding: 12 });
  const n = stats.latency.length;
  return Widget.vstack([
    Widget.chart(stats.latency.map((y, i) => ({ x: i - n + 1, y })), { kind: "line", smooth: true, color: "blue", frame: { height: 200 } }),
    Widget.text("Tests ago (0 is the latest) · ms", { font: "caption2", color: "secondary" }),
  ], { spacing: 4 });
}

function hourPane(stats) {
  if (!stats) return Widget.text("Run a few tests at different times of day.", { font: "footnote", color: "secondary", padding: 12 });
  const withData = stats.hours.map((h, hour) => (h ? { ...h, hour } : null)).filter(Boolean);
  const best = withData.length ? withData.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
  const worst = withData.length ? withData.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;
  const hh = (h) => `${String(h).padStart(2, "0")}:00`;
  return Widget.vstack([
    hourGrid(stats.hours, { height: 34 }),
    Widget.text("Darker is faster. Numbers are the hour of day; grey hours have no tests yet.", { font: "caption2", color: "secondary" }),
    best ? Widget.label(`Best hour ${hh(best.hour)} · ${fmtSpeed(best.avg)} average over ${best.n}`, "hare.fill", { color: "green" }) : null,
    worst && worst.hour !== best.hour ? Widget.label(`Slowest hour ${hh(worst.hour)} · ${fmtSpeed(worst.avg)} average over ${worst.n}`, "tortoise.fill", { color: "red" }) : null,
  ], { alignment: "leading", spacing: 8 });
}

// ─────────────────────────────────────────── Mini-app

Script.ui(() => {
  const last = Storage.get("last");
  const stats = Storage.get("stats");
  const error = Storage.get("lastError");
  const s = settings();
  const total = SIZES.filter((x) => x <= s.maxSize).reduce((a, b) => a + b, 0);

  return {
    title: "Speed Test",
    content: Widget.vstack([
      heroCard(last),
      error && (!last || error.time > last.t)
        ? Widget.hstack([
            Widget.symbol("exclamationmark.triangle.fill", { size: 14, color: "orange", fallback: "⚠️" }),
            Widget.text(error.message, { font: "footnote", color: "orange", lineLimit: 3 }),
          ], { spacing: 6 })
        : null,
      Widget.hstack([
        Widget.button("Run test", "test", null, { style: "prominent", color: "orange" }),
        Widget.text(`about ${fmtMB(total)}, 5–20 s`, { font: "caption", color: "secondary" }),
        Widget.spacer(),
        Widget.menu("ellipsis.circle", [
          { title: "Share last result", symbol: "square.and.arrow.up", action: "share" },
          { title: "Export CSV", symbol: "tablecells", action: "export" },
          { title: "Delete history", symbol: "trash", action: "clear", destructive: true },
        ]),
      ], { spacing: 10 }),

      stats ? Widget.hstack([
        stat("Best", fmtSpeed(stats.best), "green"),
        stat("Average", fmtSpeed(stats.average)),
        stat("Tests", stats.count.toLocaleString(locale)),
      ], { spacing: 8 }) : null,

      Widget.tabs([
        { title: "Speed", symbol: "chart.bar.fill", content: testsChart(stats) },
        { title: "Latency", symbol: "timer", content: latencyChart(stats) },
        { title: "By hour", symbol: "clock.fill", content: hourPane(stats) },
      ], { selected: 0 }),

      Widget.card([
        Widget.picker([
          { label: "1 MB", value: 1_000_000 }, { label: "2 MB", value: 2_000_000 }, { label: "4 MB", value: 4_000_000 },
        ], s.maxSize, "set", { field: "maxSize" }, { style: "segmented", label: "Largest file" }),
        Widget.picker([
          { label: "Mbps", value: "mbps" }, { label: "MB/s", value: "mbs" },
        ], s.unit, "set", { field: "unit" }, { style: "segmented", label: "Unit" }),
        Widget.text("Smaller files finish sooner and use less data, but measure fast connections less accurately.", { font: "caption2", color: "secondary" }),
      ], { title: "Settings", symbol: "gearshape.fill", color: "gray" }),

      Widget.text("The only server contacted is speed.cloudflare.com, Cloudflare's public speed test. It receives a request for test bytes and nothing else; results stay on this device.", { font: "caption2", color: "secondary", align: "center" }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});
