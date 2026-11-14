// @name        Barometer
// @description Logs your iPhone's barometer and shows the pressure, its 3-hour tendency in the classic rising and falling words, a dial, a 48-hour chart against Apple Weather's sea-level pressure and a rule-of-thumb outlook, in widgets and a mini-app
// @permissions motion, location
// @widget      small, medium, large, circular, rectangular, inline
// @icon        barometer
// @color       #0EA5E9
// @version     1.0.0
// @author      scriptwelleueue
// @category    weather

// How it works
// • Motion.altitude reads the phone's own barometer. Readings are logged to the script's Files folder
//   (readings.json, 72 hours) on every run, background run and visit to the mini-app. The sensor is not
//   available inside widgets, so widgets show the last reading and the chart from Storage.
// • iOS asks about Motion & Fitness the first time, because the same permission covers the barometer.
// • The mini-app and background runs also fetch Apple Weather's pressure for your location, which is
//   reduced to sea level. The difference to the phone (which measures station pressure at your
//   altitude) becomes a calibration offset, so both lines in the chart line up.
// • Tendency is the change over the last 3 hours, worded the way weather observers do. The outlook is
//   the old barometer rule of thumb, not a forecast.
// • Only your coordinates, rounded to about a kilometre, are sent to Apple Weather. Nothing else leaves
//   the device. For a denser log, add a Shortcuts automation that runs this script every hour.

// ─────────────────────────────────────────── Constants

const HOUR = 3_600_000;
const MINUTE = 60_000;
const LOG_PATH = "readings.json";
const KEEP_HOURS = 72;
const MAX_READINGS = 2000;
const WEATHER_MAX_AGE = 60 * MINUTE;
const READ_GAP = 2 * MINUTE;
const WINDOWS = [12, 24, 48];

const locale = Script.env.locale;
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const TILE_BG = { light: "#F1F5F9", dark: "#1E293B" };
const DIM = { light: "#0F172A12", dark: "#FFFFFF1A" };
const PHONE_HEX = "#0EA5E9";
const WEATHER_HEX = "#F59E0B";

// The classic observer's scale, in hPa over 3 hours.
const TENDENCIES = [
  { max: 0.1, word: "steady", arrow: "→", symbol: "arrow.right", color: "blue", code: 0 },
  { max: 1.6, word: "slowly", arrow: { up: "↗", down: "↘" }, symbol: { up: "arrow.up.right", down: "arrow.down.right" }, code: 1 },
  { max: 3.6, word: "", arrow: { up: "↑", down: "↓" }, symbol: { up: "arrow.up", down: "arrow.down" }, code: 2 },
  { max: 6, word: "quickly", arrow: { up: "⇈", down: "⇊" }, symbol: { up: "arrow.up.to.line", down: "arrow.down.to.line" }, code: 3 },
  { max: Infinity, word: "very rapidly", arrow: { up: "⇈", down: "⇊" }, symbol: { up: "arrow.up.to.line", down: "arrow.down.to.line" }, code: 4 },
];

// Dial zones from 950 to 1050 hPa, as printed on an old aneroid barometer.
const ZONES = [
  { from: 950, to: 980, label: "Stormy", hex: "#7C3AED" },
  { from: 980, to: 1000, label: "Rain", hex: "#3B82F6" },
  { from: 1000, to: 1015, label: "Change", hex: "#EAB308" },
  { from: 1015, to: 1035, label: "Fair", hex: "#22C55E" },
  { from: 1035, to: 1050, label: "Very dry", hex: "#F97316" },
];
const zoneFor = (p) => ZONES.find((z) => p < z.to) ?? ZONES.at(-1);

// ─────────────────────────────────────────── Settings and formatting

const settings = () => ({ display: "auto", window: 24, ...Storage.get("settings", {}) });
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const fmtP = (p, digits = 0) => (p == null ? "–" : p.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }));
const fmtDelta = (d) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;

// ─────────────────────────────────────────── Log in Files

async function loadLog() {
  try {
    return (await Files.exists(LOG_PATH)) ? await Files.readJSON(LOG_PATH) : [];
  } catch {
    return [];
  }
}

async function appendReading(reading) {
  const log = await loadLog();
  const last = log.at(-1);
  if (last && reading.t - last.t < READ_GAP) log.pop();                 // replace a reading taken moments ago
  const cutoff = reading.t - KEEP_HOURS * HOUR;
  const kept = [...log.filter((r) => r.t >= cutoff), reading].slice(-MAX_READINGS);
  await Files.writeJSON(LOG_PATH, kept);
  return kept;
}

function downsample(values, n) {
  if (values.length <= n) return values;
  return Array.from({ length: n }, (_, i) => values[Math.round((i * (values.length - 1)) / (n - 1))]);
}

// ─────────────────────────────────────────── Analysis

// Average pressure around a moment, from readings within ±tolerance.
function around(log, t, tolerance) {
  const near = log.filter((r) => Math.abs(r.t - t) <= tolerance);
  return near.length ? near.reduce((s, r) => s + r.p, 0) / near.length : null;
}

// Change over three hours, scaled from a shorter span when the log is young (at least one hour).
function tendency(log, now = Date.now()) {
  if (log.length < 2) return null;
  const current = around(log, now, 10 * MINUTE) ?? log.at(-1).p;
  let earlier = around(log, now - 3 * HOUR, 20 * MINUTE);
  let span = 3;
  if (earlier == null) {
    const candidates = log.filter((r) => r.t <= now - HOUR && r.t >= now - 4 * HOUR);
    if (!candidates.length) return null;
    const ref = candidates.reduce((a, b) => (Math.abs(b.t - (now - 3 * HOUR)) < Math.abs(a.t - (now - 3 * HOUR)) ? b : a));
    earlier = ref.p;
    span = (now - ref.t) / HOUR;
  }
  const delta = ((current - earlier) * 3) / span;
  const level = TENDENCIES.find((t) => Math.abs(delta) < t.max);
  const dir = delta > 0 ? "up" : "down";
  const base = delta > 0 ? "rising" : "falling";
  const word = level.code === 0 ? "steady" : level.word ? `${base} ${level.word}` : base;
  return {
    delta: round(delta),
    span: round(span),
    word,
    arrow: typeof level.arrow === "string" ? level.arrow : level.arrow[dir],
    symbol: typeof level.symbol === "string" ? level.symbol : level.symbol[dir],
    color: level.code === 0 ? "blue" : delta > 0 ? "green" : level.code >= 3 ? "red" : "orange",
    code: level.code,
    rising: delta > 0,
  };
}

// Median difference between Apple Weather's sea-level pressure and the phone at the same moments.
function calibrationOffset(log, weather) {
  if (!weather) return null;
  const diffs = [];
  for (const h of weather.hourly ?? []) {
    const p = around(log, h.t, 40 * MINUTE);
    if (p != null) diffs.push(h.p - p);
  }
  if (!diffs.length && weather.p != null && log.length) {
    const last = log.at(-1);
    if (weather.t - last.t < 2 * HOUR) diffs.push(weather.p - last.p);
  }
  if (!diffs.length) return null;
  diffs.sort((a, b) => a - b);
  return round(diffs[Math.floor(diffs.length / 2)]);
}

function outlook(trend, seaLevel) {
  const caveat = "A single barometer is a rule of thumb, not a forecast.";
  if (!trend) return { text: "Keep the log running for an hour or more to see a tendency.", caveat, symbol: "hourglass", color: "secondary" };
  const high = seaLevel != null && seaLevel >= 1022;
  const low = seaLevel != null && seaLevel <= 1009;
  if (trend.code === 0) {
    if (high) return { text: "Steady and high: settled, fair weather is likely to continue.", caveat, symbol: "sun.max.fill", color: "yellow" };
    if (low) return { text: "Steady and low: unsettled weather is likely to continue.", caveat, symbol: "cloud.rain.fill", color: "blue" };
    return { text: "Steady: little change expected for now.", caveat, symbol: "cloud.sun.fill", color: "blue" };
  }
  if (trend.rising) {
    if (trend.code === 1) return { text: "Rising slowly: improving, with fair weather on the way.", caveat, symbol: "cloud.sun.fill", color: "green" };
    if (trend.code === 2) return { text: "Rising: skies should clear and the air turn drier.", caveat, symbol: "sun.max.fill", color: "green" };
    return { text: "Rising fast: clearing, but often gusty, and the improvement may not last.", caveat, symbol: "wind", color: "green" };
  }
  if (trend.code === 1) return { text: high ? "Falling slowly from high: still fair, but slowly turning." : "Falling slowly: becoming unsettled over the next day.", caveat, symbol: "cloud.fill", color: "orange" };
  if (trend.code === 2) return { text: "Falling: rain or wind is likely within 12 to 24 hours.", caveat, symbol: "cloud.rain.fill", color: "orange" };
  return { text: "Falling fast: wind and rain are likely within hours, possibly a storm.", caveat, symbol: "cloud.bolt.rain.fill", color: "red" };
}

// ─────────────────────────────────────────── Reading and refreshing

async function getPlace() {
  try {
    const here = await Location.current({ accuracy: "kilometer" });
    const place = { latitude: Number(here.latitude.toFixed(3)), longitude: Number(here.longitude.toFixed(3)) };
    Storage.set("place", place);
    return place;
  } catch (error) {
    const saved = Storage.get("place");
    if (saved) return saved;
    throw error;
  }
}

async function refreshWeather(force = false) {
  const saved = Storage.get("weather");
  if (!force && saved && Date.now() - saved.t < WEATHER_MAX_AGE) return saved;
  const place = await getPlace();
  const [current, hourly] = await Promise.all([
    Weather.current(place),
    Weather.hourly(place, { start: new Date(Date.now() - 48 * HOUR), hours: 49 }),
  ]);
  const data = {
    t: Date.now(),
    p: current.pressure ?? null,
    condition: current.description ?? null,
    symbol: current.symbol ?? null,
    hourly: hourly.filter((h) => typeof h.pressure === "number").map((h) => ({ t: new Date(h.date).getTime(), p: round(h.pressure) })),
    credit: saved?.credit ?? null,
  };
  if (!data.credit) {
    try { data.credit = await Weather.attribution(); } catch { data.credit = { text: "Apple Weather", url: "https://weatherkit.apple.com/legal-attribution.html" }; }
  }
  Storage.set("weather", data);
  return data;
}

// Compact picture for widgets, so they never touch Files or the sensor.
function updateSnapshot(log, weather) {
  const now = Date.now();
  const last = log.at(-1) ?? null;
  const series = downsample(log.filter((r) => r.t >= now - 48 * HOUR), 96).map((r) => ({ t: r.t, p: r.p }));
  const snap = {
    t: now,
    last,
    trend: tendency(log, now),
    offset: calibrationOffset(log, weather),
    series,
    count: log.length,
    oldest: log[0]?.t ?? null,
    weather: weather ? { t: weather.t, p: weather.p, condition: weather.condition, symbol: weather.symbol, hourly: weather.hourly, credit: weather.credit } : null,
  };
  Storage.set("snap", snap);
  return snap;
}

async function refresh({ weather = true } = {}) {
  let log = await loadLog();
  const errors = [];
  try {
    const m = await Motion.altitude();
    log = await appendReading({ t: Date.now(), p: round(m.pressure * 10, 2), a: m.altitude == null ? null : Math.round(m.altitude) });
  } catch (error) {
    errors.push(`Barometer: ${error.message}`);
  }
  let w = Storage.get("weather");
  if (weather) {
    try { w = await refreshWeather(); } catch (error) { errors.push(`Apple Weather: ${error.message}`); }
  }
  const snap = updateSnapshot(log, w);
  Storage.set("lastError", errors.length ? { message: errors.join(" · "), time: Date.now() } : null);
  return snap;
}

const snapshot = () => Storage.get("snap");

// The pressure to show: station, sea level (phone plus offset) or automatic.
function shown(snap) {
  const mode = settings().display;
  const useSea = mode === "sea" || (mode === "auto" && snap.offset != null);
  const offset = useSea && snap.offset != null ? snap.offset : 0;
  return { p: snap.last ? snap.last.p + offset : null, sea: useSea && snap.offset != null, offset };
}

function summaryText(snap) {
  if (!snap?.last) return "No barometer reading yet.";
  const { p, sea } = shown(snap);
  const trend = snap.trend;
  const parts = [`${fmtP(p)} hPa${sea ? " at sea level" : " at the phone"}`];
  if (trend) parts.push(`${trend.word} (${fmtDelta(trend.delta)} hPa in 3 h)`);
  if (snap.weather?.p != null) parts.push(`Apple Weather says ${fmtP(snap.weather.p)} hPa`);
  if (snap.last.a != null) parts.push(`altitude ${snap.last.a} m`);
  return `${parts.join(", ")}. ${outlook(trend, sea ? p : snap.weather?.p ?? null).text}`;
}

// ─────────────────────────────────────────── Entry points: run and background

Script.run(async () => summaryText(await refresh()));

Script.background(async () => {
  await refresh();
  Storage.set("lastBackground", Date.now());
});

// ─────────────────────────────────────────── Widget pieces

function sparkValues(snap, hours, offset) {
  const cutoff = Date.now() - hours * HOUR;
  return downsample(snap.series.filter((s) => s.t >= cutoff), 48).map((s) => round(s.p + offset));
}

function sparkline(values, color, height) {
  if (values.length < 2) return Widget.text("History builds up over a few hours.", { font: "caption2", color: "secondary", frame: { height } });
  const lo = Math.min(...values), hi = Math.max(...values);
  return Widget.chart(values, { kind: "area", smooth: true, axes: false, color, range: [lo - 1, hi + 1], frame: { height } });
}

// A dial from 950 to 1050: twenty coloured segments and a pointer above the current value.
function dial(p, { height = 8, labels = true, zones = true } = {}) {
  const value = Math.max(950, Math.min(1050, p ?? 1013));
  const index = Math.min(19, Math.floor((value - 950) / 5));
  const pointer = Widget.hstack(Array.from({ length: 20 }, (_, i) => Widget.text(i === index ? "▼" : "", {
    font: 9, weight: "bold", align: "center", frame: { maxWidth: "infinity" },
  })), { spacing: 1 });
  const segments = Widget.hstack(Array.from({ length: 20 }, (_, i) => ({
    type: "stack", direction: "horizontal", children: [],
    background: p == null ? DIM : zoneFor(950 + i * 5).hex, cornerRadius: 2,
    opacity: i === index ? 1 : 0.55,
    frame: { maxWidth: "infinity", height },
  })), { spacing: 1 });
  const ticks = labels ? Widget.hstack([950, 975, 1000, 1025, 1050].flatMap((v, i) => [
    i ? Widget.spacer() : null,
    Widget.text(String(v), { font: 8, color: "secondary" }),
  ])) : null;
  const names = zones ? Widget.hstack(ZONES.map((z) => Widget.text(z.label, {
    font: 8, weight: "semibold", color: z.hex, align: "center", lineLimit: 1, minimumScale: 0.6,
    frame: { maxWidth: "infinity" },
  })), { spacing: 2 }) : null;
  return Widget.vstack([pointer, segments, ticks, names], { spacing: 1 });
}

function comparisonChart(snap, hours, offset, { height = 110, axes = true } = {}) {
  const now = Date.now();
  const cutoff = now - hours * HOUR;
  const hoursAgo = (t) => Number(((t - now) / HOUR).toFixed(2));
  const phone = downsample(snap.series.filter((s) => s.t >= cutoff), 96).map((s) => ({ x: hoursAgo(s.t), y: round(s.p + offset), series: "Phone" }));
  const weather = (snap.weather?.hourly ?? []).filter((h) => h.t >= cutoff && h.t <= now + 30 * MINUTE).map((h) => ({ x: hoursAgo(h.t), y: h.p, series: "Apple Weather" }));
  const points = [...phone, ...weather];
  if (points.length < 2) return Widget.text("The chart appears after a few readings.", { font: "caption2", color: "secondary", frame: { height } });
  const ys = points.map((d) => d.y);
  return Widget.chart(points, {
    kind: "line", smooth: true, axes,
    colors: phone.length ? [PHONE_HEX, WEATHER_HEX] : [WEATHER_HEX],
    range: [Math.floor(Math.min(...ys)) - 1, Math.ceil(Math.max(...ys)) + 1],
    frame: { height },
  });
}

function placeholder(family) {
  if (family === "inline") return Widget.text("Barometer: open once");
  if (family === "circular") return Widget.text("Open", { font: "caption" });
  return Widget.vstack([
    Widget.symbol("barometer", { size: 24, color: "cyan", fallback: "🌡" }),
    Widget.text("Open Barometer once to take the first reading", { font: "caption", color: "secondary", align: "center", lineLimit: 3 }),
  ], { spacing: 6, url: APP_LINK });
}

// ─────────────────────────────────────────── Widget

Script.widget(({ family }) => {
  const snap = snapshot();
  if (!snap?.last) return placeholder(family);
  const { p, sea, offset } = shown(snap);
  const trend = snap.trend;
  const arrow = trend?.arrow ?? "·";
  const word = trend?.word ?? "collecting";
  const color = trend?.color ?? "secondary";
  const seaLevel = sea ? p : snap.weather?.p ?? null;
  const view = outlook(trend, seaLevel);
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  let content;

  switch (family) {
    case "inline":
      content = Widget.text(`${fmtP(p)} hPa ${arrow}`);
      break;

    case "circular":
      content = Widget.progress(Math.max(0, Math.min(1, ((p ?? 950) - 950) / 100)), { style: "ring", label: fmtP(p) });
      break;

    case "rectangular":
      content = Widget.vstack([
        Widget.hstack([
          Widget.symbol("barometer", { size: 11, fallback: "🌡" }),
          Widget.text(`${fmtP(p)} hPa ${arrow}`, { font: "headline", lineLimit: 1 }),
        ], { spacing: 3 }),
        Widget.text(trend ? `${word} · ${fmtDelta(trend.delta)} hPa / 3 h` : "tendency after an hour of readings", { font: "caption", lineLimit: 1, minimumScale: 0.7 }),
        sparkline(sparkValues(snap, 24, offset), "primary", 20),
      ], { alignment: "leading", spacing: 1 });
      break;

    case "small":
      content = Widget.vstack([
        Widget.hstack([
          Widget.symbol("barometer", { size: 12, color: "cyan", fallback: "🌡" }),
          Widget.text("Pressure", { font: "caption2", weight: "semibold", color: "secondary" }),
          Widget.spacer(),
          Widget.text(sea ? "sea" : "station", { font: 8, weight: "semibold", color: "secondary" }),
        ], { spacing: 4 }),
        Widget.hstack([
          Widget.text(fmtP(p), { font: 34, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
          Widget.vstack([
            Widget.text(arrow, { font: "title3", weight: "bold", color }),
            Widget.text("hPa", { font: "caption2", color: "secondary" }),
          ], { alignment: "leading", spacing: 0 }),
        ], { spacing: 4, alignment: "bottom" }),
        Widget.text(word, { font: "caption", weight: "semibold", color, lineLimit: 1, minimumScale: 0.7 }),
        Widget.spacer(),
        sparkline(sparkValues(snap, 24, offset), "cyan", 30),
        Widget.hstack([
          Widget.text(trend ? `${fmtDelta(trend.delta)} / 3 h` : "", { font: "caption2", color: "secondary" }),
          Widget.spacer(),
          Widget.text("24 h", { font: "caption2", color: "secondary" }),
        ]),
      ], { alignment: "leading", spacing: 2, url: APP_LINK, frame: fill });
      break;

    case "medium":
      content = Widget.hstack([
        Widget.vstack([
          Widget.hstack([
            Widget.symbol("barometer", { size: 12, color: "cyan", fallback: "🌡" }),
            Widget.text(sea ? "Sea-level pressure" : "Pressure", { font: "caption2", weight: "semibold", color: "secondary", lineLimit: 1 }),
          ], { spacing: 4 }),
          Widget.hstack([
            Widget.text(fmtP(p), { font: 36, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
            Widget.vstack([
              Widget.text(arrow, { font: "title3", weight: "bold", color }),
              Widget.text("hPa", { font: "caption2", color: "secondary" }),
            ], { alignment: "leading", spacing: 0 }),
          ], { spacing: 4, alignment: "bottom" }),
          Widget.text(word, { font: "subheadline", weight: "semibold", color, lineLimit: 1 }),
          Widget.text(trend ? `${fmtDelta(trend.delta)} hPa in 3 h` : "tendency soon", { font: "caption2", color: "secondary" }),
          Widget.spacer(),
          Widget.text(`${zoneFor(seaLevel ?? p).label} on the dial`, { font: "caption2", color: "secondary", lineLimit: 1 }),
        ], { alignment: "leading", spacing: 2, frame: { width: 128, maxHeight: "infinity", alignment: "topLeading" } }),
        Widget.vstack([
          Widget.hstack([
            Widget.text("LAST 24 H", { font: "caption2", weight: "bold", color: "secondary" }),
            Widget.spacer(),
            snap.weather?.p != null ? Widget.text(`Apple Weather ${fmtP(snap.weather.p)}`, { font: "caption2", color: "secondary", lineLimit: 1 }) : null,
          ]),
          sparkline(sparkValues(snap, 24, offset), "cyan", 44),
          Widget.hstack([
            Widget.symbol(view.symbol, { size: 12, color: view.color, fallback: "☁️" }),
            Widget.text(view.text, { font: "caption2", lineLimit: 3, minimumScale: 0.7 }),
          ], { spacing: 5, alignment: "top" }),
        ], { alignment: "leading", spacing: 5, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      ], { spacing: 10, url: APP_LINK, frame: fill });
      break;

    default: { // large and extraLarge
      const hours = 48;
      content = Widget.vstack([
        Widget.hstack([
          Widget.vstack([
            Widget.text(sea ? "SEA-LEVEL PRESSURE" : "STATION PRESSURE", { font: "caption2", weight: "bold", color: "secondary" }),
            Widget.hstack([
              Widget.text(fmtP(p), { font: 40, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
              Widget.vstack([
                Widget.text(arrow, { font: "title2", weight: "bold", color }),
                Widget.text("hPa", { font: "caption", color: "secondary" }),
              ], { alignment: "leading", spacing: 0 }),
            ], { spacing: 6, alignment: "bottom" }),
          ], { alignment: "leading", spacing: 0 }),
          Widget.spacer(),
          Widget.vstack([
            Widget.text(word, { font: "headline", color }),
            Widget.text(trend ? `${fmtDelta(trend.delta)} hPa in 3 h` : "collecting readings", { font: "caption", color: "secondary" }),
            snap.weather?.p != null ? Widget.text(`Apple Weather ${fmtP(snap.weather.p)} hPa`, { font: "caption2", color: "secondary" }) : null,
            snap.last.a != null ? Widget.text(`${snap.last.a} m above sea level`, { font: "caption2", color: "secondary" }) : null,
          ], { alignment: "trailing", spacing: 1 }),
        ], { alignment: "top" }),
        dial(seaLevel ?? p, { height: 7 }),
        Widget.vstack([
          Widget.hstack([
            Widget.text(`LAST ${hours} H`, { font: "caption2", weight: "bold", color: "secondary" }),
            Widget.spacer(),
            Widget.hstack([
              { type: "stack", direction: "horizontal", children: [], background: PHONE_HEX, cornerRadius: 2, frame: { width: 10, height: 4 } },
              Widget.text("phone", { font: 8, color: "secondary" }),
              { type: "stack", direction: "horizontal", children: [], background: WEATHER_HEX, cornerRadius: 2, frame: { width: 10, height: 4 } },
              Widget.text("Apple Weather", { font: 8, color: "secondary" }),
            ], { spacing: 3 }),
          ]),
          comparisonChart(snap, hours, offset, { height: 100, axes: false }),
          Widget.hstack([
            Widget.text(`${hours} h ago`, { font: 8, color: "secondary" }),
            Widget.spacer(),
            Widget.text("now", { font: 8, color: "secondary" }),
          ]),
        ], { alignment: "leading", spacing: 2, padding: 8, background: TILE_BG, cornerRadius: 10 }),
        Widget.hstack([
          Widget.symbol(view.symbol, { size: 16, color: view.color, fallback: "☁️" }),
          Widget.vstack([
            Widget.text(view.text, { font: "caption", weight: "medium", lineLimit: 2 }),
            Widget.text(view.caveat, { font: "caption2", color: "secondary", lineLimit: 1 }),
          ], { alignment: "leading", spacing: 1 }),
        ], { spacing: 8, alignment: "top" }),
        Widget.spacer(),
        Widget.hstack([
          Widget.text("read", { font: "caption2", color: "secondary" }),
          Widget.date(snap.last.t, { style: "relative", font: "caption2", color: "secondary" }),
          Widget.spacer(),
          snap.weather?.credit ? Widget.text(snap.weather.credit.text, { font: "caption2", color: "secondary", url: snap.weather.credit.url }) : null,
        ], { spacing: 3 }),
      ], { alignment: "leading", spacing: 7, url: APP_LINK, frame: fill });
    }
  }

  return { content, refreshAfter: 30 * 60 };
});

// ─────────────────────────────────────────── Mini-app actions

Script.action("read", async () => {
  await refresh();
  await UI.haptic(Storage.get("lastError") ? "error" : "success");
});

Script.action("set", ({ field, value }) => Storage.set("settings", { ...settings(), [field]: value }));

Script.action("share", async () => {
  await UI.share(`Barometer: ${summaryText(snapshot())}`);
});

Script.action("export", async () => {
  const log = await loadLog();
  const lines = ["time,pressure_hpa,altitude_m", ...log.map((r) => `${new Date(r.t).toISOString()},${r.p},${r.a ?? ""}`)];
  await Files.write("exports/pressure.csv", lines.join("\n"));
  await Files.export("exports/pressure.csv", { name: `pressure-${new Date().toLocaleDateString("en-CA")}.csv` });
});

Script.action("clear", async () => {
  const choice = await UI.alert({ title: "Delete the pressure log?", message: "All readings are removed. The widget starts again from the next reading.", buttons: ["Cancel", "Delete"] });
  if (choice === 1) {
    if (await Files.exists(LOG_PATH)) await Files.remove(LOG_PATH);
    Storage.remove("snap");
  }
});

// ─────────────────────────────────────────── Mini-app

Script.ui(async () => {
  let snap = snapshot();
  if (!snap || Date.now() - snap.t > 5 * MINUTE) snap = await refresh();
  const error = Storage.get("lastError");
  const s = settings();

  if (!snap?.last) {
    return {
      title: "Barometer",
      content: Widget.vstack([
        Widget.symbol("barometer", { size: 60, color: "cyan", fallback: "🌡" }),
        Widget.text("No reading yet", { font: "title2", weight: "bold" }),
        Widget.text(error?.message ?? "This device may not have a barometer, or Motion & Fitness access was declined in Settings.", { font: "footnote", color: "secondary", align: "center", lineLimit: 5 }),
        Widget.button("Try again", "read", null, { style: "prominent" }),
      ], { spacing: 14, padding: 24 }),
    };
  }

  const { p, sea, offset } = shown(snap);
  const trend = snap.trend;
  const seaLevel = sea ? p : snap.weather?.p ?? null;
  const view = outlook(trend, seaLevel);
  const zone = zoneFor(seaLevel ?? p);

  const hero = Widget.card([
    Widget.hstack([
      Widget.vstack([
        Widget.hstack([
          Widget.text(fmtP(p, 1), { font: 52, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
          Widget.vstack([
            Widget.text(trend?.arrow ?? "·", { font: "title", weight: "bold", color: trend?.color ?? "secondary" }),
            Widget.text("hPa", { font: "caption", color: "secondary" }),
          ], { alignment: "leading", spacing: 0 }),
        ], { spacing: 6, alignment: "bottom" }),
        Widget.text(trend ? `${trend.word} · ${fmtDelta(trend.delta)} hPa in 3 h${trend.span < 2.9 ? ` (from ${trend.span} h of readings)` : ""}` : "Tendency appears after an hour of readings", { font: "subheadline", weight: "semibold", color: trend?.color ?? "secondary", lineLimit: 2 }),
      ], { alignment: "leading", spacing: 4 }),
      Widget.spacer(),
    ]),
    Widget.hstack([
      Widget.label(sea ? "sea level" : "at the phone", "mappin.and.ellipse", { color: "secondary" }),
      snap.last.a != null ? Widget.label(`${snap.last.a} m`, "mountain.2.fill", { color: "secondary" }) : null,
      Widget.hstack([
        Widget.text("read", { font: "caption", color: "secondary" }),
        Widget.date(snap.last.t, { style: "relative", font: "caption", color: "secondary" }),
      ], { spacing: 3 }),
    ], { spacing: 14 }),
  ], { title: "Pressure", subtitle: `${zone.label} on the dial`, symbol: "barometer", color: "cyan" });

  const compare = Widget.card([
    snap.weather?.p != null ? Widget.hstack([
      snap.weather.symbol ? Widget.symbol(snap.weather.symbol, { size: 22, color: "orange", fallback: "🌤" }) : null,
      Widget.vstack([
        Widget.text(`${fmtP(snap.weather.p, 1)} hPa at sea level`, { font: "headline" }),
        Widget.text(`${snap.weather.condition ?? "Apple Weather"} · updated ${new Date(snap.weather.t).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`, { font: "caption", color: "secondary" }),
      ], { alignment: "leading", spacing: 1 }),
    ], { spacing: 10 }) : Widget.text("Apple Weather pressure is not loaded yet.", { font: "footnote", color: "secondary" }),
    Widget.divider(),
    Widget.text(snap.offset != null
      ? `Calibration offset ${fmtDelta(snap.offset)} hPa: the phone reads lower than sea level by roughly 0.12 hPa per metre of altitude. Adding the offset makes your readings comparable with forecasts.`
      : "The offset is worked out once the phone and Apple Weather overlap for an hour.", { font: "caption", color: "secondary" }),
    Widget.picker([
      { label: "Automatic", value: "auto" }, { label: "Sea level", value: "sea" }, { label: "Station", value: "station" },
    ], s.display, "set", { field: "display" }, { style: "segmented", label: "Show" }),
  ], { title: "Apple Weather comparison", symbol: "cloud.sun.fill", color: "orange" });

  return {
    title: "Barometer",
    content: Widget.vstack([
      hero,
      error ? Widget.hstack([
        Widget.symbol("exclamationmark.triangle.fill", { size: 14, color: "orange", fallback: "⚠️" }),
        Widget.text(error.message, { font: "footnote", color: "orange", lineLimit: 4 }),
      ], { spacing: 6 }) : null,
      Widget.hstack([
        Widget.button("Read now", "read", null, { style: "prominent" }),
        Widget.spacer(),
        Widget.menu("ellipsis.circle", [
          { title: "Share", symbol: "square.and.arrow.up", action: "share" },
          { title: "Export CSV", symbol: "tablecells", action: "export" },
          { title: "Delete log", symbol: "trash", action: "clear", destructive: true },
        ]),
      ]),
      Widget.card([dial(seaLevel ?? p, { height: 14 })], { title: "Dial", subtitle: "950 to 1050 hPa, sea level", symbol: "gauge.with.needle", color: "purple" }),
      Widget.card([
        Widget.hstack([
          Widget.symbol(view.symbol, { size: 30, color: view.color, fallback: "☁️" }),
          Widget.text(view.text, { font: "body", weight: "medium" }),
        ], { spacing: 12 }),
        Widget.text(`${view.caveat} Local weather, altitude changes (a lift, a hill) and open windows all move the needle.`, { font: "caption", color: "secondary" }),
      ], { title: "Outlook", symbol: "text.book.closed.fill", color: view.color }),
      Widget.card([
        Widget.picker(WINDOWS.map((h) => ({ label: `${h} h`, value: h })), s.window, "set", { field: "window" }, { style: "segmented" }),
        comparisonChart(snap, s.window, offset, { height: 220, axes: true }),
        Widget.text(`Hours ago · phone in blue${sea ? " (sea level)" : ""}, Apple Weather in amber`, { font: "caption2", color: "secondary" }),
      ], { title: "Pressure history", symbol: "chart.xyaxis.line", color: "cyan" }),
      compare,
      Widget.list([
        { title: "Readings stored", symbol: "tray.full.fill", detail: `${snap.count} over ${snap.oldest ? `${Math.max(1, Math.round((Date.now() - snap.oldest) / HOUR))} h` : "0 h"}` },
        { title: "Last background run", symbol: "arrow.triangle.2.circlepath", detail: Storage.get("lastBackground") ? new Date(Storage.get("lastBackground")).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "none yet" },
        { title: "Log kept for", symbol: "clock.fill", detail: `${KEEP_HOURS} h` },
      ], { title: "Log" }),
      snap.weather?.credit ? Widget.text(`${snap.weather.credit.text} · sea-level pressure and conditions`, { font: "caption2", color: "secondary", align: "center", url: snap.weather.credit.url }) : null,
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});
