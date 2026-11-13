// @name        Migraine Risk
// @description Pixel-art migraine risk forecast from local Apple Weather (pressure swings, humidity, temperature, storms)
// @icon        brain.head.profile
// @color       #7C3AED
// @permissions location
// @widget      small, medium, large, circular, rectangular, inline
// @version     1.0.0
// @author      scriptwell
// @category    utilities

// ───────────────────────── Settings and helpers

const STALE_MS = 30 * 60 * 1000;
const useF = /-US$/i.test(Script.env.locale);

const LEVELS = [
  { name: "LOW", min: 0, color: "#4ADE80", tip: "Clear skies for your head today." },
  { name: "MODERATE", min: 30, color: "#FACC15", tip: "Stay hydrated and keep your meds handy." },
  { name: "HIGH", min: 55, color: "#FB923C", tip: "Pressure is shifting. Rest your eyes, eat regularly." },
  { name: "VERY HIGH", min: 75, color: "#F87171", tip: "Storm brewing. Plan a quiet, dim, low-stress day." },
];

const levelFor = (score) => [...LEVELS].reverse().find((l) => score >= l.min);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmtTemp = (c) => (useF ? `${Math.round(c * 9 / 5 + 32)}°F` : `${Math.round(c)}°C`);
const fmtDelta = (c) => (useF ? `Δ${Math.round(c * 9 / 5)}°` : `Δ${Math.round(c)}°`);

const BG = Widget.gradient(["#312E81", "#1E1B4B", "#0F0A2E"], { direction: "topLeadingToBottomTrailing" });
const DIM = "#FFFFFF22";
const SOFT = "#FFFFFFAA";

// ───────────────────────── Pixel art

// Draw a sprite from strings. Runs of the same colour become one node to stay under the node limit.
function sprite(rows, palette, px) {
  return Widget.vstack(rows.map((row) => {
    const runs = [];
    let i = 0;
    while (i < row.length) {
      const ch = row[i];
      let j = i;
      while (j < row.length && row[j] === ch) j++;
      runs.push({ ch, n: j - i });
      i = j;
    }
    return Widget.hstack(runs.map((r) => {
      const node = { type: "stack", direction: "horizontal", children: [], frame: { width: r.n * px, height: px } };
      if (palette[r.ch]) node.background = palette[r.ch];
      return node;
    }), { spacing: 0 });
  }), { spacing: 0 });
}

function faceRows(levelIndex) {
  const rows = [
    "....KKKK....",
    "..KKSSSSKK..",
    ".KSSSSSSSSK.",
    ".KSSSSSSSSK.",
    "KSSKSSSSKSSK",
    "KSSKSSSSKSSK",
    "KSSSSSSSSSSK",
    "KSRSSSSSSRSK",
    "KSSKSSSSKSSK",
    ".KSSKKKKSSK.",
    "..KKSSSSKK..",
    "....KKKK....",
  ];
  if (levelIndex === 1) {            // neutral
    rows[8] = "KSSSSSSSSSSK";
  } else if (levelIndex >= 2) {      // frown + sweat drop
    rows[3] = ".KSSSSSSSBK.";
    rows[8] = "KSSSKKKKSSSK";
    rows[9] = ".KSKSSSSKSK.";
  }
  if (levelIndex === 3) {            // > < eyes
    rows[4] = "KSKSSSSSSKSK";
    rows[5] = "KSSKSSSSKSSK";
    rows[6] = "KSKSSSSSSKSK";
  }
  return rows;
}

const BOLT = [
  "..YY.",
  ".YY..",
  "YY...",
  "YYYY.",
  "..YY.",
  ".YY..",
  "YY...",
  "Y....",
];

function mascot(levelIndex, color, px) {
  const face = sprite(faceRows(levelIndex), { K: "#0B0720", S: color, R: "#F472B6", B: "#60A5FA" }, px);
  if (levelIndex < 2) return face;
  const bolt = sprite(BOLT, { Y: "#FDE047" }, Math.max(2, px - 1));
  return Widget.hstack([face, bolt], { spacing: 1, alignment: "top" });
}

function meter(filled, total, color, size, gap) {
  return Widget.hstack(Array.from({ length: total }, (_, i) => ({
    type: "stack", direction: "horizontal", children: [],
    frame: { width: size, height: size },
    background: i < filled ? color : DIM,
  })), { spacing: gap });
}

const mono = (text, props = {}) => Widget.text(text, { design: "monospaced", color: "white", ...props });

// ───────────────────────── Risk model

function assess(current, hourly, today) {
  const series = hourly
    .filter((h) => typeof h.pressure === "number")
    .map((h) => ({ t: new Date(h.date).getTime(), p: h.pressure }));

  // Largest pressure change within any 6-hour window (drops weigh more than rises).
  let bestChange = 0, bestWeight = 0;
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length && series[j].t - series[i].t <= 6 * 3600e3; j++) {
      const d = series[j].p - series[i].p;
      const w = d < 0 ? -d : d * 0.7;
      if (w > bestWeight) { bestWeight = w; bestChange = d; }
    }
  }
  let pressurePts = clamp((bestWeight / 8) * 40, 0, 40);
  if ((current.pressure ?? 1013) < 1005) pressurePts = Math.min(45, pressurePts + 5);

  const humidity = current.humidity ?? 0;
  const humidityPts = clamp(((humidity - 0.6) / 0.35) * 15, 0, 15);

  const high = today?.high ?? current.temperature;
  const low = today?.low ?? current.temperature;
  const range = high - low;
  const swingPts = clamp((range - 6) * 2, 0, 15);
  const heatPts = current.temperature >= 28 ? clamp((current.temperature - 27) * 2, 0, 10) : 0;
  const tempPts = swingPts + heatPts;

  const now = Date.now();
  const next12 = hourly.filter((h) => {
    const t = new Date(h.date).getTime();
    return t >= now - 3600e3 && t <= now + 12 * 3600e3;
  });
  const thunder = [current, ...next12].some((h) => /thunder/i.test(h.condition ?? ""));
  const maxChance = Math.max(0, ...next12.map((h) => h.precipitationChance ?? 0));
  const stormPts = thunder ? 15 : maxChance >= 0.6 ? 7 : maxChance >= 0.3 ? 3 : 0;

  const factors = [
    { label: "PRESS", pts: pressurePts, max: 45, value: `${bestChange > 0 ? "+" : ""}${bestChange.toFixed(1)}hPa` },
    { label: "HUMID", pts: humidityPts, max: 15, value: `${Math.round(humidity * 100)}%` },
    { label: "TEMP", pts: tempPts, max: 25, value: fmtDelta(range) },
    { label: "STORM", pts: stormPts, max: 15, value: thunder ? "⚡" : `${Math.round(maxChance * 100)}%` },
  ];

  const score = Math.round(clamp(pressurePts + humidityPts + tempPts + stormPts, 0, 100));
  return { score, factors, pressureSeries: series.map((s) => Math.round(s.p * 10) / 10) };
}

// ───────────────────────── Data

async function getPlace() {
  try {
    const here = await Location.current({ accuracy: "kilometer" });
    const place = { latitude: here.latitude, longitude: here.longitude };
    Storage.set("place", place);
    return place;
  } catch (error) {
    const saved = Storage.get("place");
    if (saved) return saved;
    throw error;
  }
}

async function refresh() {
  const place = await getPlace();
  const now = Date.now();

  const [current, hourly, daily] = await Promise.all([
    Weather.current(place),
    Weather.hourly(place, { start: new Date(now - 6 * 3600e3), hours: 30 }),
    Weather.daily(place, { days: 1 }),
  ]);

  let credit = Storage.get("credit");
  if (!credit) {
    try { credit = await Weather.attribution(); Storage.set("credit", credit); }
    catch { credit = { text: "Apple Weather", url: "https://weatherkit.apple.com/legal-attribution.html" }; }
  }

  // Place lookups do not work in widgets; refresh the city name elsewhere.
  let city = Storage.get("city");
  if (Script.env.mode !== "widget") {
    try {
      const [p] = await Location.reverseGeocode(place);
      if (p?.city || p?.name) { city = p.city ?? p.name; Storage.set("city", city); }
    } catch { /* keep the old name */ }
  }

  const risk = assess(current, hourly, daily[0]);
  const data = {
    ...risk,
    temperature: current.temperature,
    condition: current.description,
    symbol: current.symbol,
    pressure: current.pressure,
    city: city ?? "Here",
    credit,
    time: Date.now(),
  };
  Storage.set("risk", data);
  return data;
}

// ───────────────────────── Widget pieces

function factorRow(f, compact) {
  const filled = Math.round((f.pts / f.max) * 5);
  const color = filled >= 4 ? "#F87171" : filled >= 2 ? "#FACC15" : "#4ADE80";
  return Widget.hstack([
    mono(f.label, { font: compact ? 10 : 11, weight: "bold", color: SOFT, frame: { width: compact ? 40 : 46, alignment: "leading" } }),
    meter(filled, 5, color, compact ? 6 : 8, 2),
    Widget.spacer(),
    mono(f.value, { font: compact ? 10 : 11, weight: "semibold", lineLimit: 1, minimumScale: 0.6 }),
  ], { spacing: 6 });
}

function scoreBlock(data, level, idx, px, scoreSize) {
  return Widget.hstack([
    mascot(idx, level.color, px),
    Widget.spacer(),
    Widget.vstack([
      mono(String(data.score).padStart(2, "0"), { font: scoreSize, weight: "black", lineLimit: 1, minimumScale: 0.6 }),
      mono("/100", { font: 9, color: SOFT }),
    ], { alignment: "trailing", spacing: 0 }),
  ], { alignment: "top" });
}

function leftColumn(data, level, idx, px) {
  return Widget.vstack([
    scoreBlock(data, level, idx, px, 34),
    Widget.spacer(),
    mono(level.name, { font: 15, weight: "heavy", color: level.color, lineLimit: 1, minimumScale: 0.7 }),
    meter(Math.round(data.score / 10), 10, level.color, 9, 2),
    mono(`${data.city} · ${fmtTemp(data.temperature)}`, { font: 10, color: SOFT, lineLimit: 1, minimumScale: 0.7 }),
  ], { alignment: "leading", spacing: 4 });
}

function credit(data) {
  return mono(data.credit?.text ?? "Apple Weather", { font: 8, color: "#FFFFFF77", url: data.credit?.url, lineLimit: 1 });
}

const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };

function placeholder(family, message) {
  if (family === "inline") return Widget.text("Migraine risk: open Scriptwell");
  if (family === "circular" || family === "rectangular") return Widget.text("Run Migraine Risk", { font: "caption" });
  return Widget.vstack([
    sprite(faceRows(1), { K: "#0B0720", S: "#94A3B8", R: "#F472B6", B: "#60A5FA" }, 4),
    mono(message, { font: 11, align: "center", lineLimit: 3 }),
  ], { spacing: 8, padding: 14, background: BG, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
}

// ───────────────────────── Entry points

Script.widget(async ({ family }) => {
  let data = Storage.get("risk");
  if (!data || Date.now() - data.time > STALE_MS) {
    try { data = await refresh(); }
    catch (error) { Storage.set("lastError", `${new Date().toISOString()} ${error.message}`); }
  }
  if (!data) return placeholder(family, "Open Scriptwell and run Migraine Risk once");

  const level = levelFor(data.score);
  const idx = LEVELS.indexOf(level);
  const top = [...data.factors].sort((a, b) => b.pts / b.max - a.pts / a.max)[0];
  let content;

  if (family === "inline") {
    content = Widget.text(`Migraine ${level.name.toLowerCase()} · ${data.score}`);
  } else if (family === "circular") {
    content = Widget.progress(data.score / 100, { style: "ring", label: String(data.score) });
  } else if (family === "rectangular") {
    content = Widget.vstack([
      Widget.text("MIGRAINE RISK", { font: "caption2", weight: "bold", design: "monospaced" }),
      Widget.text(`${level.name} · ${data.score}`, { font: "headline", design: "monospaced" }),
      Widget.text(`${top.label} ${top.value}`, { font: "caption", design: "monospaced" }),
    ], { alignment: "leading", spacing: 1 });
  } else if (family === "small") {
    content = Widget.vstack([
      leftColumn(data, level, idx, 4),
      credit(data),
    ], { alignment: "leading", spacing: 3, padding: 14, background: BG, frame: fill });
  } else if (family === "medium") {
    content = Widget.hstack([
      Widget.vstack([leftColumn(data, level, idx, 4)], { frame: { width: 128, maxHeight: "infinity" } }),
      Widget.vstack([
        mono("TRIGGERS", { font: 10, weight: "heavy", color: SOFT }),
        ...data.factors.map((f) => factorRow(f, true)),
        Widget.spacer(),
        credit(data),
      ], { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 14, padding: 14, background: BG, frame: fill });
  } else {
    const series = data.pressureSeries ?? [];
    const lo = series.length ? Math.min(...series) : 1000;
    const hi = series.length ? Math.max(...series) : 1020;
    content = Widget.vstack([
      Widget.hstack([
        mascot(idx, level.color, 6),
        Widget.spacer(),
        Widget.vstack([
          mono("MIGRAINE RISK", { font: 11, weight: "heavy", color: SOFT }),
          mono(String(data.score).padStart(2, "0"), { font: 48, weight: "black" }),
          mono(level.name, { font: 16, weight: "heavy", color: level.color }),
        ], { alignment: "trailing", spacing: 0 }),
      ], { alignment: "top" }),
      meter(Math.round(data.score / 5), 20, level.color, 11, 3),
      mono(level.tip, { font: 12, lineLimit: 2 }),
      mono(`PRESSURE −6h → +24h · now ${Math.round(data.pressure ?? 0)} hPa`, { font: 10, weight: "bold", color: SOFT }),
      series.length > 1
        ? Widget.chart(series, { kind: "area", smooth: true, axes: false, color: level.color, range: [lo - 1, hi + 1], frame: { height: 60 } })
        : null,
      ...data.factors.map((f) => factorRow(f, false)),
      Widget.spacer(),
      Widget.hstack([
        mono(`${data.city} · ${fmtTemp(data.temperature)} · ${data.condition}`, { font: 10, color: SOFT, lineLimit: 1, minimumScale: 0.7 }),
        Widget.spacer(),
        credit(data),
      ]),
    ], { alignment: "leading", spacing: 8, padding: 16, background: BG, frame: fill });
  }

  return { content, refreshAfter: 30 * 60 };
});

Script.run(async () => {
  let data;
  try {
    data = await refresh();
  } catch (error) {
    data = Storage.get("risk");
    if (!data) return `Could not load weather: ${error.message}`;
  }
  const level = levelFor(data.score);
  const details = data.factors.map((f) => `${f.label} ${f.value}`).join(", ");
  return `Migraine risk in ${data.city}: ${level.name} (${data.score}/100). ${level.tip} [${details}] — ${data.credit?.text ?? "Apple Weather"}`;
});

Script.background(async () => {
  try { await refresh(); }
  catch (error) { Storage.set("lastError", `${new Date().toISOString()} ${error.message}`); }
});
