// @name        BP Log
// @description A blood pressure log that reads systolic, diastolic and heart rate from Apple Health (or your own entries), charts them against common reference ranges, compares mornings with evenings, and exports a CSV for your doctor. Everything stays on the device
// @permissions health
// @widget      small, medium, large, rectangular
// @icon        heart.text.square.fill
// @color       #DC2626
// @version     1.0.0
// @author      scriptwell
// @category    medical

// How it works
// • Reads the last 90 days of systolic, diastolic and heart-rate samples from Apple Health, pairs them
//   into readings, and merges in entries you type yourself (kept in manual.json). Nothing is sent anywhere:
//   there is no network permission, and Health data never leaves the device.
// • Open the mini-app once so iOS can ask for Health access; after that the script runs in the background
//   and the widget reads a cached copy (Health itself is not available inside a widget).
// • Charts: systolic and diastolic over time with the common reference lines (normal below 120/80, elevated,
//   stage 1 from 130/80, stage 2 from 140/90, as in the widely used AHA categories), morning against
//   evening averages, weekly averages and pulse pressure. The labels are reference ranges, not a diagnosis.
// • Export: a CSV of every reading, saved with the Files picker or handed to the share sheet.
// • This is a log, not medical advice. Talk to a clinician about what your readings mean.

// ───────────────────────── Constants

const DAY = 86_400_000;
const HISTORY_DAYS = 90;
const MAX_READINGS = 600;
const MANUAL_FILE = "manual.json";
const SYS_COLOR = "#DC2626";
const DIA_COLOR = "#2563EB";
const TILE = { light: "#F8FAFC", dark: "#1E293B" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const NOTE = "A log, not medical advice. Categories follow common reference ranges and are not a diagnosis.";

// The widely used AHA categories. Tested in order: the first match wins, so 125/85 is stage 1, not elevated.
const CATEGORIES = [
  { key: "normal", label: "Normal", short: "Normal", color: "#16A34A", test: (s, d) => s < 120 && d < 80, range: "below 120 / 80" },
  { key: "elevated", label: "Elevated", short: "Elevated", color: "#CA8A04", test: (s, d) => s < 130 && d < 80, range: "120–129 / below 80" },
  { key: "stage1", label: "Stage 1 range", short: "Stage 1", color: "#EA580C", test: (s, d) => s < 140 && d < 90, range: "130–139 / 80–89" },
  { key: "stage2", label: "Stage 2 range", short: "Stage 2", color: "#DC2626", test: (s, d) => s < 180 && d < 120, range: "140 or more / 90 or more" },
  { key: "high", label: "Above 180 / 120", short: "Very high", color: "#7F1D1D", test: () => true, range: "above 180 / 120" },
];
const categoryOf = (s, d) => CATEGORIES.find((c) => c.test(s, d));

// ───────────────────────── Readings

const readings = () => Storage.get("readings", []);
const latest = () => readings().at(-1) ?? null;
const since = (days, list = readings()) => list.filter((r) => r.t >= Date.now() - days * DAY);
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const round = (v) => (v == null ? null : Math.round(v));
const fmt = (r) => `${round(r.s)}/${round(r.d)}`;
const settings = () => ({ alsoHealth: false, range: 30, ...Storage.get("settings", {}) });

async function manualEntries() {
  try { return (await Files.exists(MANUAL_FILE)) ? await Files.readJSON(MANUAL_FILE) : []; } catch { return []; }
}

// Systolic and diastolic samples recorded within a minute of each other make one reading;
// a heart-rate sample within ten minutes becomes its pulse.
function pair(systolic, diastolic, heart) {
  const at = (sample) => new Date(sample.start).getTime();
  const dia = diastolic.map((x) => ({ t: at(x), v: x.value, used: false }));
  const hr = heart.map((x) => ({ t: at(x), v: x.value }));
  const nearest = (list, t, window) => {
    let best = null;
    for (const item of list) {
      if (item.used) continue;
      const gap = Math.abs(item.t - t);
      if (gap <= window && (!best || gap < Math.abs(best.t - t))) best = item;
    }
    return best;
  };
  const out = [];
  for (const sample of systolic) {
    const t = at(sample);
    const match = nearest(dia, t, 60_000);
    if (!match) continue;
    match.used = true;
    const pulse = nearest(hr, t, 10 * 60_000);
    out.push({ t, s: sample.value, d: match.v, p: pulse ? Math.round(pulse.v) : null, src: "health", from: sample.source ?? null });
  }
  return out;
}

async function sync() {
  const start = new Date(Date.now() - HISTORY_DAYS * DAY);
  let fromHealth = [];
  try {
    if (!(await Health.available())) throw new Error("Health is not available on this device");
    // One type at a time, so the first-run permission sheets do not trip over each other.
    const systolic = await Health.samples("systolic", { start, limit: 1000 });
    const diastolic = await Health.samples("diastolic", { start, limit: 1000 });
    let heart = [];
    try { heart = await Health.samples("heartRate", { start, limit: 3000 }); } catch { heart = []; }
    fromHealth = pair(systolic, diastolic, heart);
    Storage.remove("lastError");
  } catch (error) {
    Storage.set("lastError", error.message);
  }
  const manual = (await manualEntries()).map((e) => ({ ...e, src: "manual" }));
  const merged = [...fromHealth, ...manual]
    .filter((r) => r.t >= start.getTime())
    .sort((a, b) => a.t - b.t)
    .slice(-MAX_READINGS);
  Storage.set("readings", merged);
  Storage.set("synced", Date.now());
  Storage.set("healthCount", fromHealth.length);
  return merged;
}

// ───────────────────────── Statistics

function average(list) {
  if (!list.length) return null;
  return { s: mean(list.map((r) => r.s)), d: mean(list.map((r) => r.d)), p: mean(list.filter((r) => r.p).map((r) => r.p)), n: list.length };
}

function stats() {
  const all = readings();
  const now = Date.now();
  const last7 = since(7, all);
  const prev7 = all.filter((r) => r.t >= now - 14 * DAY && r.t < now - 7 * DAY);
  const month = since(30, all);
  const hour = (r) => new Date(r.t).getHours();
  const weeks = [];
  for (let w = 12; w >= 0; w--) {
    const bucket = all.filter((r) => r.t >= now - (w + 1) * 7 * DAY && r.t < now - w * 7 * DAY);
    if (bucket.length) weeks.push({ label: w === 0 ? "This week" : `${w}w ago`, w, ...average(bucket) });
  }
  const pp = month.map((r) => r.s - r.d);
  return {
    latest: latest(),
    week: average(last7),
    previous: average(prev7),
    morning: average(month.filter((r) => hour(r) < 12)),
    evening: average(month.filter((r) => hour(r) >= 17)),
    pulsePressure: { latest: latest() ? latest().s - latest().d : null, average: mean(pp) },
    weeks,
    count: all.length,
  };
}

const sparkValues = (key, days = 14) => since(days).map((r) => r[key]);

// ───────────────────────── Run and background

Script.run(async () => {
  const list = await sync();
  if (!list.length) return `No readings in the last ${HISTORY_DAYS} days. ${Storage.get("lastError") ?? "Add one in the BP Log mini-app."}`;
  const s = stats();
  const c = categoryOf(s.latest.s, s.latest.d);
  const parts = [`Latest ${fmt(s.latest)} mmHg (${c.label.toLowerCase()}, a common reference range)${s.latest.p ? `, pulse ${s.latest.p}` : ""}.`];
  if (s.week) parts.push(`7-day average ${round(s.week.s)}/${round(s.week.d)} over ${s.week.n} readings.`);
  parts.push("This is a log, not medical advice.");
  return parts.join(" ");
});

Script.background(async () => { await sync(); });

// ───────────────────────── Widget pieces

function spark(key, color, height, { kind = "line", days = 14 } = {}) {
  const values = sparkValues(key, days);
  if (values.length < 2) return Widget.text("14-day trend appears after two readings", { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 });
  return Widget.chart(values, { kind, axes: false, smooth: true, color, frame: { height } });
}

function twoSeries(days, { axes = false, height = 60, smooth = true } = {}) {
  const now = Date.now();
  const list = since(days);
  if (list.length < 2) return Widget.text("Not enough readings yet.", { font: "caption2", color: "secondary" });
  const x = (r) => Number(((r.t - now) / DAY).toFixed(2));
  return Widget.chart([
    ...list.map((r) => ({ x: x(r), y: r.s, series: "Systolic" })),
    ...list.map((r) => ({ x: x(r), y: r.d, series: "Diastolic" })),
  ], { kind: "line", smooth, axes, colors: [SYS_COLOR, DIA_COLOR], frame: { height } });
}

function chip(text, color, font = "caption2") {
  return Widget.text(text, { font, weight: "bold", color: "white", padding: { horizontal: 6, vertical: 2 }, background: color, cornerRadius: 6, lineLimit: 1 });
}

function bigReading(r, size) {
  const c = categoryOf(r.s, r.d);
  return Widget.vstack([
    Widget.hstack([
      Widget.text(fmt(r), { font: size, weight: "bold", design: "rounded", color: c.color, lineLimit: 1, minimumScale: 0.5 }),
      Widget.text("mmHg", { font: "caption2", color: "secondary", padding: { bottom: 4 } }),
    ], { spacing: 4, alignment: "bottom" }),
    Widget.hstack([
      chip(c.short, c.color),
      r.p ? Widget.label(`${r.p}`, "heart.fill", { color: "pink" }) : null,
      Widget.date(r.t, { style: "relative", font: "caption2", color: "secondary" }),
    ], { spacing: 6 }),
  ], { alignment: "leading", spacing: 4 });
}

function statLine(label, value, color = "primary") {
  return Widget.hstack([
    Widget.text(label, { font: "caption2", color: "secondary" }),
    Widget.spacer(),
    Widget.text(value, { font: "caption", weight: "semibold", color, lineLimit: 1 }),
  ]);
}

const avgText = (a) => (a ? `${round(a.s)}/${round(a.d)}` : "–");

function placeholder(family) {
  const error = Storage.get("lastError");
  if (family === "rectangular") return Widget.vstack([
    Widget.text("BP LOG", { font: "caption2", weight: "bold" }),
    Widget.text("Open BP Log to sync or add a reading", { font: "caption", lineLimit: 2 }),
  ], { alignment: "leading", spacing: 2 });
  return Widget.vstack([
    Widget.symbol("heart.text.square.fill", { size: 26, color: "red", fallback: "❤️" }),
    Widget.text(error ? error : "Open BP Log once to read Apple Health, or add a reading by hand.", { font: "caption2", color: "secondary", align: "center", lineLimit: 4 }),
  ], { spacing: 6, url: APP_LINK });
}

// ───────────────────────── Widget

Script.widget(({ family }) => {
  const r = latest();
  if (!r) return { content: placeholder(family), refreshAfter: 30 * 60 };
  const s = stats();
  const c = categoryOf(r.s, r.d);
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  let content;

  if (family === "rectangular") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.text(`BP ${fmt(r)}`, { font: "headline", lineLimit: 1 }),
        Widget.text(c.short, { font: "caption2", weight: "semibold" }),
        Widget.spacer(),
        Widget.date(r.t, { style: "relative", font: "caption2" }),
      ], { spacing: 4, alignment: "bottom" }),
      spark("s", "primary", 22),
    ], { alignment: "leading", spacing: 2 });
  } else if (family === "small") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("heart.text.square.fill", { size: 12, color: "red", fallback: "❤️" }),
        Widget.text("BLOOD PRESSURE", { font: "caption2", weight: "bold", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
      ], { spacing: 4 }),
      bigReading(r, 30),
      Widget.spacer(),
      Widget.text("14 days · systolic", { font: "caption2", color: "secondary" }),
      spark("s", c.color, 30, { kind: "area" }),
    ], { alignment: "leading", spacing: 3, padding: 12, url: APP_LINK, frame: fill });
  } else if (family === "medium") {
    content = Widget.hstack([
      Widget.vstack([
        Widget.text("BLOOD PRESSURE", { font: "caption2", weight: "bold", color: "secondary", lineLimit: 1 }),
        bigReading(r, 32),
        Widget.spacer(),
        statLine("7-day avg", avgText(s.week)),
        statLine("Pulse pressure", s.pulsePressure.latest != null ? `${s.pulsePressure.latest}` : "–"),
      ], { alignment: "leading", spacing: 3, frame: { width: 128, maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack([
        Widget.hstack([
          Widget.text("14 days", { font: "caption2", color: "secondary" }),
          Widget.spacer(),
          Widget.label("Sys", "circle.fill", { color: SYS_COLOR }),
          Widget.label("Dia", "circle.fill", { color: DIA_COLOR }),
        ], { spacing: 6 }),
        twoSeries(14, { height: 92 }),
      ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 12, padding: 12, url: APP_LINK, frame: fill });
  } else {
    const tile = (label, value, color) => Widget.vstack([
      Widget.text(label, { font: "caption2", color: "secondary", lineLimit: 1 }),
      Widget.text(value, { font: "subheadline", weight: "bold", design: "rounded", color: color ?? "primary", lineLimit: 1, minimumScale: 0.7 }),
    ], { alignment: "leading", spacing: 1, padding: 8, background: TILE, cornerRadius: 10, frame: { maxWidth: "infinity", alignment: "leading" } });
    content = Widget.vstack([
      Widget.hstack([
        bigReading(r, 34),
        Widget.spacer(),
        Widget.vstack([
          Widget.text("7-DAY AVERAGE", { font: "caption2", weight: "bold", color: "secondary" }),
          Widget.text(avgText(s.week), { font: "title3", weight: "bold", design: "rounded", color: s.week ? categoryOf(s.week.s, s.week.d).color : "secondary" }),
          Widget.text(s.previous ? `was ${avgText(s.previous)}` : "no earlier week", { font: "caption2", color: "secondary" }),
        ], { alignment: "trailing", spacing: 1 }),
      ], { alignment: "top" }),
      twoSeries(30, { axes: true, height: 128 }),
      Widget.hstack([
        tile("Morning", avgText(s.morning), s.morning ? categoryOf(s.morning.s, s.morning.d).color : null),
        tile("Evening", avgText(s.evening), s.evening ? categoryOf(s.evening.s, s.evening.d).color : null),
        tile("Pulse pressure", s.pulsePressure.average != null ? `${round(s.pulsePressure.average)} avg` : "–"),
      ], { spacing: 6 }),
      Widget.spacer(),
      Widget.text(`${s.count} readings · 30 days charted · ${NOTE}`, { font: "caption2", color: "secondary", lineLimit: 2, minimumScale: 0.7 }),
    ], { alignment: "leading", spacing: 8, padding: 14, url: APP_LINK, frame: fill });
  }
  return { content, refreshAfter: 60 * 60 };
});

// ───────────────────────── Mini-app actions

const blankDraft = () => ({ s: "", d: "", p: "", at: new Date().toISOString(), note: "" });
const draft = () => Storage.get("draft") ?? blankDraft();

Script.action("page", ({ value }) => Storage.set("page", value));
Script.action("range", ({ value }) => Storage.set("settings", { ...settings(), range: value }));
Script.action("alsoHealth", ({ isOn }) => Storage.set("settings", { ...settings(), alsoHealth: isOn }));
Script.action("field", ({ field, value }) => Storage.set("draft", { ...draft(), [field]: value }));
Script.action("sync", async () => { await sync(); await UI.haptic("light"); });

Script.action("add", async () => {
  const d = draft();
  const s = Number(String(d.s).replace(",", "."));
  const dia = Number(String(d.d).replace(",", "."));
  const p = d.p ? Number(String(d.p).replace(",", ".")) : null;
  if (!(s >= 50 && s <= 260) || !(dia >= 30 && dia <= 160) || dia >= s) {
    await UI.alert({ title: "Check the numbers", message: "Systolic should be between 50 and 260, diastolic between 30 and 160, and systolic higher than diastolic." });
    return;
  }
  const t = new Date(d.at).getTime() || Date.now();
  const entry = { t, s, d: dia, p: p && p >= 25 && p <= 250 ? Math.round(p) : null, note: String(d.note ?? "").trim() };
  await Files.writeJSON(MANUAL_FILE, [...(await manualEntries()), entry].sort((a, b) => a.t - b.t).slice(-2000));
  if (settings().alsoHealth) {
    try {
      await Health.save("systolic", s, { at: new Date(t) });
      await Health.save("diastolic", dia, { at: new Date(t) });
    } catch (error) {
      await UI.alert({ title: "Saved here, not in Health", message: error.message });
    }
  }
  Storage.set("draft", { ...blankDraft(), at: new Date().toISOString() });
  await sync();
  await UI.haptic("success");
});

Script.action("removeManual", async ({ t }) => {
  const choice = await UI.alert({ title: "Remove this entry?", message: "Only the entry typed here is removed; nothing changes in Apple Health.", buttons: ["Cancel", "Remove"] });
  if (choice !== 1) return;
  await Files.writeJSON(MANUAL_FILE, (await manualEntries()).filter((e) => e.t !== t));
  await sync();
});

async function writeCsv() {
  const rows = readings().map((r) => {
    const when = new Date(r.t);
    const c = categoryOf(r.s, r.d);
    return [when.toLocaleDateString("en-CA"), when.toTimeString().slice(0, 5), round(r.s), round(r.d), r.p ?? "", round(r.s - r.d), c.short, r.src, r.note ?? ""]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
  });
  const header = "date,time,systolic_mmHg,diastolic_mmHg,pulse_bpm,pulse_pressure,reference_category,source,note";
  await Files.write("exports/bp-log.csv", [header, ...rows].join("\n"));
  return `bp-log-${new Date().toLocaleDateString("en-CA")}.csv`;
}

Script.action("exportCsv", async () => {
  const name = await writeCsv();
  await Files.export("exports/bp-log.csv", { name });
});

Script.action("shareCsv", async () => {
  await writeCsv();
  await UI.share({ file: "exports/bp-log.csv" });
});

// ───────────────────────── Mini-app pieces

function referenceChart(key, days) {
  const now = Date.now();
  const list = since(days);
  if (list.length < 2) return Widget.text("Not enough readings yet.", { font: "footnote", color: "secondary" });
  const x = (r) => Number(((r.t - now) / DAY).toFixed(2));
  const first = x(list[0]), last = x(list.at(-1));
  const lines = key === "s" ? [[120, "Normal"], [130, "Stage 1"], [140, "Stage 2"]] : [[80, "Stage 1"], [90, "Stage 2"]];
  const lineColors = key === "s" ? ["#16A34A99", "#EA580C99", "#DC262699"] : ["#EA580C99", "#DC262699"];
  return Widget.chart([
    ...list.map((r) => ({ x: x(r), y: r[key], series: key === "s" ? "Systolic" : "Diastolic" })),
    ...lines.flatMap(([y, label]) => [{ x: first, y, series: label }, { x: last, y, series: label }]),
  ], { kind: "line", smooth: false, colors: [key === "s" ? SYS_COLOR : DIA_COLOR, ...lineColors], frame: { height: 220 } });
}

function bandLegend() {
  return Widget.vstack([
    ...CATEGORIES.slice(0, 4).map((c) => Widget.hstack([
      { type: "stack", direction: "horizontal", children: [], background: c.color, cornerRadius: 3, frame: { width: 10, height: 10 } },
      Widget.text(c.label, { font: "caption", weight: "semibold", frame: { width: 96, alignment: "leading" } }),
      Widget.text(c.range, { font: "caption", color: "secondary" }),
    ], { spacing: 8 })),
    Widget.text("Common reference ranges (AHA), not a diagnosis. Stage 1 and 2 are met by either number.", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 4 });
}

function overviewPage() {
  const s = stats();
  const r = s.latest;
  const range = settings().range;
  const error = Storage.get("lastError");
  const synced = Storage.get("synced");
  if (!r) {
    return Widget.vstack([
      Widget.symbol("heart.text.square.fill", { size: 52, color: "red", fallback: "❤️" }),
      Widget.text("No readings yet", { font: "title2", weight: "semibold" }),
      Widget.text(error ? `Apple Health: ${error}` : "Nothing in Apple Health for the last 90 days. Add a reading under Add, or sync again after your cuff has written to Health.", { color: "secondary", align: "center" }),
      Widget.button("Sync Apple Health", "sync", null, { style: "prominent", color: "red" }),
      Widget.text(NOTE, { font: "caption2", color: "secondary", align: "center" }),
    ], { spacing: 14, padding: 20 });
  }
  const c = categoryOf(r.s, r.d);
  const delta = s.week && s.previous ? round(s.week.s - s.previous.s) : null;
  const pairRow = (label, a) => Widget.hstack([
    Widget.text(label, { font: "subheadline" }),
    Widget.spacer(),
    a ? chip(categoryOf(a.s, a.d).short, categoryOf(a.s, a.d).color) : null,
    Widget.text(a ? `${avgText(a)} · ${a.n} readings` : "no readings", { font: "subheadline", weight: "semibold", color: a ? "primary" : "secondary" }),
  ], { spacing: 8 });

  return Widget.vstack([
    Widget.vstack([
      Widget.hstack([
        bigReading(r, 44),
        Widget.spacer(),
        Widget.vstack([
          Widget.text("7-day avg", { font: "caption", color: "secondary" }),
          Widget.text(avgText(s.week), { font: "title2", weight: "bold", design: "rounded" }),
          delta != null ? Widget.text(`${delta > 0 ? "+" : ""}${delta} systolic vs last week`, { font: "caption2", color: delta > 0 ? "orange" : "green" }) : null,
        ], { alignment: "trailing", spacing: 1 }),
      ], { alignment: "top" }),
      Widget.text(`${c.label} · ${c.range} mmHg · ${r.src === "manual" ? "typed here" : r.from ?? "Apple Health"}`, { font: "caption", color: "secondary" }),
    ], { alignment: "leading", spacing: 8, padding: 14, background: TILE, cornerRadius: 14 }),
    error ? Widget.text(`Apple Health: ${error}`, { font: "caption", color: "orange" }) : null,
    Widget.card([
      Widget.picker([{ label: "30 days", value: 30 }, { label: "90 days", value: 90 }], range, "range", null, { style: "segmented" }),
      Widget.tabs([
        { title: "Both", symbol: "waveform.path.ecg", content: twoSeries(range, { axes: true, height: 220, smooth: false }) },
        { title: "Systolic", content: referenceChart("s", range) },
        { title: "Diastolic", content: referenceChart("d", range) },
      ], { selected: 0 }),
      bandLegend(),
    ], { title: "Over time", subtitle: "Days ago along the bottom", symbol: "chart.xyaxis.line", color: "red" }),
    Widget.card([
      pairRow("Morning (before noon)", s.morning),
      pairRow("Evening (after 5 pm)", s.evening),
      s.morning && s.evening ? Widget.chart([
        { x: "Morning", y: round(s.morning.s), series: "Systolic" }, { x: "Evening", y: round(s.evening.s), series: "Systolic" },
        { x: "Morning", y: round(s.morning.d), series: "Diastolic" }, { x: "Evening", y: round(s.evening.d), series: "Diastolic" },
      ], { colors: [SYS_COLOR, DIA_COLOR], frame: { height: 160 } }) : null,
    ], { title: "Morning and evening", subtitle: "Averages over 30 days", symbol: "sun.and.horizon.fill", color: "orange" }),
    Widget.card([
      s.weeks.length > 1 ? Widget.chart([
        ...s.weeks.map((w) => ({ x: w.label, y: round(w.s), series: "Systolic" })),
        ...s.weeks.map((w) => ({ x: w.label, y: round(w.d), series: "Diastolic" })),
      ], { kind: "line", colors: [SYS_COLOR, DIA_COLOR], frame: { height: 180 } }) : Widget.text("Weekly averages appear after two weeks of readings.", { font: "footnote", color: "secondary" }),
      Widget.hstack([
        Widget.text("Pulse pressure", { font: "subheadline" }),
        Widget.spacer(),
        Widget.text(`${s.pulsePressure.latest} now · ${round(s.pulsePressure.average)} average`, { font: "subheadline", weight: "semibold" }),
      ]),
      Widget.text("Pulse pressure is systolic minus diastolic.", { font: "caption2", color: "secondary" }),
    ], { title: "Weekly averages", subtitle: "Up to 13 weeks", symbol: "calendar", color: "blue" }),
    Widget.card([
      Widget.text(`${s.count} readings in the last ${HISTORY_DAYS} days (${Storage.get("healthCount", 0)} from Apple Health). Columns: date, time, systolic, diastolic, pulse, pulse pressure, reference category, source, note.`, { font: "footnote", color: "secondary" }),
      Widget.hstack([
        Widget.button("Save CSV…", "exportCsv", null, { style: "prominent", color: "red" }),
        Widget.button("Share", "shareCsv", null, { style: "bordered" }),
        Widget.button("Sync", "sync", null, { style: "bordered" }),
      ], { spacing: 8 }),
      synced ? Widget.hstack([Widget.text("Health synced", { font: "caption2", color: "secondary" }), Widget.date(synced, { style: "relative", font: "caption2", color: "secondary" })], { spacing: 4 }) : null,
    ], { title: "For your doctor", symbol: "square.and.arrow.up.fill", color: "gray" }),
    Widget.text(`${NOTE} Your data stays on this device.`, { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 14 });
}

function addPage(manual) {
  const d = draft();
  return Widget.vstack([
    Widget.card([
      Widget.hstack([
        Widget.textField("120", d.s, "field", { field: "s" }, { label: "Systolic", keyboard: "number" }),
        Widget.textField("80", d.d, "field", { field: "d" }, { label: "Diastolic", keyboard: "number" }),
        Widget.textField("70", d.p, "field", { field: "p" }, { label: "Pulse", keyboard: "number" }),
      ], { spacing: 10 }),
      Widget.datePicker(d.at, "field", { field: "at" }, { label: "Taken", mode: "dateTime" }),
      Widget.textField("After a walk, left arm, seated…", d.note, "field", { field: "note" }, { label: "Note" }),
      Widget.toggle("Also write to Apple Health", settings().alsoHealth, "alsoHealth", null, { color: "red" }),
      Widget.button("Add reading", "add", null, { style: "prominent", color: "red" }),
    ], { title: "New reading", subtitle: "mmHg and beats per minute", symbol: "plus.circle.fill", color: "red" }),
    manual.length ? Widget.card(manual.slice(-15).reverse().map((e) => Widget.hstack([
      { type: "stack", direction: "horizontal", children: [], background: categoryOf(e.s, e.d).color, cornerRadius: 5, frame: { width: 10, height: 10 } },
      Widget.vstack([
        Widget.text(`${fmt(e)}${e.p ? ` · ${e.p} bpm` : ""}`, { font: "subheadline", weight: "semibold" }),
        Widget.hstack([Widget.date(e.t, { style: "date", font: "caption2", color: "secondary" }), Widget.date(e.t, { style: "time", font: "caption2", color: "secondary" }), e.note ? Widget.text(`· ${e.note}`, { font: "caption2", color: "secondary", lineLimit: 1 }) : null], { spacing: 4 }),
      ], { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", alignment: "leading" } }),
      Widget.button(Widget.symbol("trash", { size: 16, color: "red", fallback: "🗑" }), "removeManual", { t: e.t }, { style: "plain" }),
    ], { spacing: 10 })), { title: "Typed here", subtitle: `${manual.length} entries in manual.json`, symbol: "pencil", color: "gray" }) : null,
  ], { alignment: "leading", spacing: 14 });
}

function readingsPage() {
  const list = readings().slice(-40).reverse();
  if (!list.length) return Widget.text("No readings yet.", { color: "secondary", align: "center", padding: 24 });
  return Widget.list(list.map((r) => {
    const c = categoryOf(r.s, r.d);
    const when = new Date(r.t);
    return {
      title: `${fmt(r)} mmHg${r.p ? ` · ${r.p} bpm` : ""}`,
      subtitle: `${when.toLocaleString(Script.env.locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${r.note ? ` · ${r.note}` : ""}`,
      detail: c.short,
      symbol: r.src === "manual" ? "pencil.circle.fill" : "heart.circle.fill",
      color: c.color,
    };
  }), { title: `Last ${list.length} readings` });
}

// ───────────────────────── Mini-app

let syncedOnce = false;

Script.ui(async () => {
  if (!syncedOnce) {
    syncedOnce = true;
    await sync(); // may show the Health permission sheets the first time
  }
  const page = Storage.get("page", "overview");
  const manual = page === "add" ? await manualEntries() : [];
  const body = page === "add" ? addPage(manual) : page === "readings" ? readingsPage() : overviewPage();
  return {
    title: "BP Log",
    content: Widget.vstack([
      Widget.picker([
        { label: "Overview", value: "overview" },
        { label: "Readings", value: "readings" },
        { label: "Add", value: "add" },
      ], page, "page", null, { style: "segmented" }),
      body,
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});
