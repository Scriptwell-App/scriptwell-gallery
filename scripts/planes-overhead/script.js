// @name        Planes Overhead
// @description Aircraft flying near you right now from the OpenSky Network's anonymous API at opensky-network.org: a live map, distance and bearing, altitude, speed and heading, a compass helper that tells you where to look, and a pop when a plane enters your 5 km circle
// @permissions location, motion, network
// @widget      small, medium, large
// @icon        airplane
// @color       #2563EB
// @version     1.0.0
// @author      va4w
// @category    travel

// How it works
// • Your location is used to build a bounding box (10–50 km, your choice) that is sent to opensky-network.org; nothing else is sent. Responses are cached for 60 seconds because the anonymous API is rate limited (a few hundred requests a day), and the mini-app says when it is showing cached data.
// • Mini-app: a map with a pin per aircraft, a list sorted by distance with bearing, altitude (feet or metres by locale, switchable), speed (km/h or knots) and heading. Tap a plane, then "Point at it" compares the compass heading with the bearing and tells you how far to turn and how high to look.
// • Auto-refresh re-scans every minute while the mini-app is open and plays a pop when a new aircraft enters the 5 km circle.
// • Widget: how many aircraft are overhead, the closest callsign and its altitude; medium adds the three nearest; large shows the map. Widgets refresh about every ten minutes and fall back to the last scan when offline.
// • Open the mini-app once before adding the widget so location, motion and network access are approved.

// ───────────────────────── Constants and settings

const OPENSKY = "https://opensky-network.org/api/states/all";
const CACHE_MS = 60_000;
const POP_RADIUS_KM = 5;
const FT_PER_M = 3.28084;
const KT_PER_MS = 1.943844;
const BLUE = "#2563EB";
const ORANGE = "#F97316";
const SKY = Widget.gradient([{ light: "#EFF6FF", dark: "#0B1A3A" }, { light: "#DBEAFE", dark: "#12254F" }], { direction: "topToBottom" });
const TILE = { light: "#FFFFFFB3", dark: "#FFFFFF14" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const DIRECTIONS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

const DEFAULTS = {
  radiusKm: 25,
  speedUnit: "kmh",                                      // "kmh" or "kt"
  altUnit: /-(US|GB)$/i.test(Script.env.locale) ? "ft" : "m",
  sound: true,
  auto: false,
};
const settings = () => ({ ...DEFAULTS, ...Storage.get("settings", {}) });
const save = (changes) => Storage.set("settings", { ...settings(), ...changes });
const lastScan = () => Storage.get("scan");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ───────────────────────── Geometry and formatting

function bearing(from, to) {
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  const dLon = rad(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(rad(to.latitude));
  const x = Math.cos(rad(from.latitude)) * Math.sin(rad(to.latitude)) - Math.sin(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const compass = (deg) => DIRECTIONS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

function boundingBox(here, km) {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.max(0.2, Math.cos((here.latitude * Math.PI) / 180)));
  return { lamin: here.latitude - dLat, lamax: here.latitude + dLat, lomin: here.longitude - dLon, lomax: here.longitude + dLon };
}

const n = (v, digits = 0) => v.toLocaleString(Script.env.locale, { maximumFractionDigits: digits });
const fmtAlt = (m, unit = settings().altUnit) => (m == null ? "–" : unit === "ft" ? `${n(Math.round(m * FT_PER_M / 100) * 100)} ft` : `${n(Math.round(m / 10) * 10)} m`);
const fmtSpeed = (ms, unit = settings().speedUnit) => (ms == null ? "–" : unit === "kt" ? `${n(ms * KT_PER_MS)} kt` : `${n(ms * 3.6)} km/h`);
const fmtDist = (km) => (km < 1 ? `${n(km * 1000)} m` : `${n(km, km < 10 ? 1 : 0)} km`);
const fmtHeading = (deg) => (deg == null ? "–" : `${Math.round(deg)}° ${compass(deg)}`);
const trend = (vr) => (vr == null || Math.abs(vr) < 0.5 ? "" : vr > 0 ? " ↗" : " ↘");

// ───────────────────────── OpenSky

// One state vector is an array: 0 icao24, 1 callsign, 2 origin country, 5 longitude, 6 latitude,
// 7 barometric altitude (m), 8 on ground, 9 velocity (m/s), 10 true track, 11 vertical rate, 13 geometric altitude.
function parseStates(states, here, radiusKm) {
  const list = [];
  for (const s of states ?? []) {
    if (!Array.isArray(s) || s[5] == null || s[6] == null) continue;
    const position = { latitude: s[6], longitude: s[5] };
    const distKm = Location.distance(here, position) / 1000;
    if (distKm > radiusKm) continue;
    list.push({
      icao: s[0],
      callsign: (s[1] ?? "").trim() || s[0].toUpperCase(),
      country: s[2] ?? "",
      latitude: s[6],
      longitude: s[5],
      altM: s[7] ?? s[13] ?? null,
      onGround: s[8] === true,
      speedMs: s[9] ?? null,
      track: s[10] ?? null,
      verticalRate: s[11] ?? null,
      distKm,
      bearing: bearing(here, position),
    });
  }
  return list.filter((a) => !a.onGround).sort((a, b) => a.distKm - b.distKm);
}

async function whereAmI() {
  try {
    const fix = await Location.current({ accuracy: "hundredMeters" });
    const here = { latitude: fix.latitude, longitude: fix.longitude, time: Date.now() };
    Storage.set("here", here);
    return here;
  } catch (error) {
    const saved = Storage.get("here");
    if (saved) return saved;
    throw error;
  }
}

// Returns the latest scan, fetching a new one when the cache is older than 60 s (or `force`).
async function scan({ force = false } = {}) {
  const cached = lastScan();
  if (!force && cached && Date.now() - cached.time < CACHE_MS) return cached;
  const here = await whereAmI();
  const { radiusKm } = settings();
  const box = boundingBox(here, radiusKm);
  const url = new URL(OPENSKY);
  for (const [k, v] of Object.entries(box)) url.searchParams.set(k, v.toFixed(4));
  const response = await fetch(url, { timeout: Script.env.mode === "widget" ? 6000 : 10_000 });
  if (response.status === 429) throw new Error("OpenSky is rate limiting anonymous requests; try again in a few minutes");
  if (!response.ok) throw new Error(`OpenSky returned ${response.status}`);
  const data = await response.json();
  const aircraft = parseStates(data.states, here, radiusKm).slice(0, 60);
  const fresh = { time: Date.now(), apiTime: data.time ? data.time * 1000 : null, here, radiusKm, aircraft };
  Storage.set("scan", fresh);
  Storage.set("lastError", null);
  await announceArrivals(fresh);
  return fresh;
}

// Pop when an aircraft that was not inside the 5 km circle last time is inside it now.
async function announceArrivals(result) {
  const insideNow = result.aircraft.filter((a) => a.distKm <= POP_RADIUS_KM).map((a) => a.icao);
  const before = new Set(Storage.get("inside", []));
  const newcomers = insideNow.filter((id) => !before.has(id));
  Storage.set("inside", insideNow);
  if (newcomers.length && Script.env.mode === "app" && settings().sound && Storage.has("inside:seeded")) {
    try { await Sound.play("pop", { volume: 0.6 }); } catch { /* no speaker, no problem */ }
  }
  Storage.set("inside:seeded", true);
}

async function safeScan(options) {
  try {
    return { result: await scan(options), error: null };
  } catch (error) {
    Storage.set("lastError", { message: error.message, time: Date.now() });
    return { result: lastScan(), error: error.message };
  }
}

// ───────────────────────── Actions

let selectedIcao = null;
let pointing = null;
let timer = null;
let lastError = null;

const selected = (result) => result?.aircraft.find((a) => a.icao === selectedIcao) ?? result?.aircraft[0] ?? null;

Script.action("refresh", async () => {
  const { error } = await safeScan({ force: true });
  lastError = error;
  await UI.haptic(error ? "error" : "light");
});

Script.action("radius", async ({ value }) => {
  save({ radiusKm: clamp(Math.round(value / 5) * 5, 10, 50) });
  lastError = (await safeScan({ force: true })).error;
});

Script.action("unit", ({ key, value }) => save({ [key]: value }));
Script.action("sound", ({ isOn }) => save({ sound: isOn }));

Script.action("pick", ({ index, icao }) => {
  const result = lastScan();
  // Map pins: index 0 is you, the rest follow the aircraft list.
  const target = icao ?? (index > 0 ? result?.aircraft[index - 1]?.icao : null);
  if (target) { selectedIcao = target; pointing = null; }
});

Script.action("point", async () => {
  const plane = selected(lastScan());
  if (!plane) return;
  try {
    if (!(await Compass.available())) throw new Error("This device has no compass");
    const reading = await Compass.heading({ timeout: 4000 });
    const turn = ((plane.bearing - reading.heading + 540) % 360) - 180;
    const elevation = plane.altM != null ? (Math.atan2(plane.altM, plane.distKm * 1000) * 180) / Math.PI : null;
    pointing = { icao: plane.icao, heading: reading.heading, accuracy: reading.accuracy, turn, elevation, time: Date.now() };
  } catch (error) {
    pointing = { icao: plane.icao, error: error.message, time: Date.now() };
  }
});

Script.action("auto", ({ isOn }) => {
  save({ auto: isOn });
  if (timer) { clearInterval(timer); timer = null; }
  if (isOn) {
    timer = setInterval(() => { safeScan({ force: true }); }, CACHE_MS);
  }
});

// ───────────────────────── Mini-app pieces

function pins(result) {
  return [
    { title: "You", latitude: result.here.latitude, longitude: result.here.longitude, color: "blue" },
    ...result.aircraft.map((a) => ({ title: a.callsign, latitude: a.latitude, longitude: a.longitude, color: a.icao === selectedIcao ? "red" : "orange" })),
  ];
}

function planeCard(plane) {
  const s = settings();
  const p = pointing?.icao === plane.icao ? pointing : null;
  let guidance = null;
  if (p?.error) {
    guidance = Widget.text(p.error, { font: "footnote", color: "orange" });
  } else if (p) {
    const abs = Math.abs(p.turn);
    const text = abs <= 10 ? "Straight ahead" : `Turn ${p.turn > 0 ? "right" : "left"} ${Math.round(abs)}°`;
    guidance = Widget.hstack([
      Widget.symbol(abs <= 10 ? "arrow.up.circle.fill" : p.turn > 0 ? "arrow.turn.up.right" : "arrow.turn.up.left", { size: 30, color: abs <= 10 ? "green" : ORANGE, fallback: abs <= 10 ? "⬆️" : p.turn > 0 ? "↪️" : "↩️" }),
      Widget.vstack([
        Widget.text(text, { font: "headline" }),
        Widget.text(`You face ${fmtHeading(p.heading)}${p.accuracy == null ? " (compass needs calibrating)" : ""}${p.elevation != null ? ` · look up about ${Math.round(p.elevation)}°` : ""}`, { font: "caption", color: "secondary" }),
      ], { alignment: "leading", spacing: 2 }),
    ], { spacing: 10 });
  }
  const stat = (label, value) => Widget.vstack([
    Widget.text(label, { font: "caption2", weight: "semibold", color: "secondary" }),
    Widget.text(value, { font: "subheadline", weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
  ], { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", alignment: "leading" } });
  return Widget.card([
    Widget.hstack([
      stat("Distance", fmtDist(plane.distKm)),
      stat("Bearing", fmtHeading(plane.bearing)),
      stat("Altitude", `${fmtAlt(plane.altM, s.altUnit)}${trend(plane.verticalRate)}`),
    ], { spacing: 8 }),
    Widget.hstack([
      stat("Speed", fmtSpeed(plane.speedMs, s.speedUnit)),
      stat("Heading", fmtHeading(plane.track)),
      stat("Registered in", plane.country || "–"),
    ], { spacing: 8 }),
    guidance,
    Widget.button(p ? "Point again" : "Point at it", "point", null, { style: "prominent", color: BLUE }),
  ], { title: plane.callsign, subtitle: `ICAO ${plane.icao.toUpperCase()}`, symbol: "airplane", color: "blue" });
}

function planeRows(result) {
  const s = settings();
  return result.aircraft.slice(0, 25).map((a) => ({
    title: a.callsign,
    subtitle: `${fmtAlt(a.altM, s.altUnit)}${trend(a.verticalRate)} · ${fmtSpeed(a.speedMs, s.speedUnit)} · hdg ${fmtHeading(a.track)}`,
    detail: `${fmtDist(a.distKm)} ${compass(a.bearing)}`,
    symbol: a.icao === selectedIcao ? "airplane.circle.fill" : "airplane",
    color: a.icao === selectedIcao ? "red" : a.distKm <= POP_RADIUS_KM ? "orange" : "blue",
    args: { icao: a.icao },
  }));
}

let firstDraw = true;

Script.ui(async () => {
  const s = settings();
  if (firstDraw) {
    firstDraw = false;
    lastError = (await safeScan()).error;
  }
  const result = lastScan();
  const plane = selected(result);
  const age = result ? Date.now() - result.time : null;
  const nearby = result ? result.aircraft.filter((a) => a.distKm <= POP_RADIUS_KM).length : 0;

  const status = result
    ? Widget.hstack([
        Widget.text(`${result.aircraft.length} aircraft within ${result.radiusKm} km`, { font: "headline" }),
        Widget.spacer(),
        Widget.text(age < CACHE_MS ? "live" : "cached", { font: "caption2", weight: "bold", color: age < CACHE_MS ? "green" : "orange" }),
        Widget.date(result.time, { style: "relative", font: "caption2", color: "secondary" }),
      ], { spacing: 4 })
    : Widget.text("No scan yet", { font: "headline" });

  return {
    title: "Planes Overhead",
    content: Widget.vstack([
      status,
      lastError ? Widget.text(`${lastError}. ${result ? "Showing the last scan." : ""}`, { font: "footnote", color: "orange" }) : null,
      Widget.hstack([
        Widget.button("Scan now", "refresh", null, { style: "prominent", color: BLUE }),
        Widget.toggle("Auto", s.auto, "auto", null, { color: BLUE }),
        Widget.toggle("Pop", s.sound, "sound", null, { color: ORANGE }),
      ], { spacing: 12 }),
      Widget.slider(s.radiusKm, "radius", null, { min: 10, max: 50, step: 5, label: `Search radius ${s.radiusKm} km`, color: BLUE }),
      result && result.aircraft.length
        ? Widget.map({ center: result.here, span: result.radiusKm * 2000, pins: pins(result), action: "pick", frame: { height: 300 } })
        : Widget.vstack([
            Widget.symbol("airplane", { size: 44, color: BLUE, fallback: "✈️" }),
            Widget.text(result ? `Nothing airborne within ${result.radiusKm} km right now. Widen the radius or try again in a minute.` : "Scanning…", { align: "center", color: "secondary" }),
          ], { spacing: 10, padding: 24, frame: { maxWidth: "infinity" } }),
      plane ? planeCard(plane) : null,
      result && result.aircraft.length ? Widget.list(planeRows(result), { title: nearby ? `Nearest first · ${nearby} inside ${POP_RADIUS_KM} km` : "Nearest first", action: "pick" }) : null,
      Widget.hstack([
        Widget.picker([{ label: "km/h", value: "kmh" }, { label: "knots", value: "kt" }], s.speedUnit, "unit", { key: "speedUnit" }, { style: "segmented" }),
        Widget.picker([{ label: "feet", value: "ft" }, { label: "metres", value: "m" }], s.altUnit, "unit", { key: "altUnit" }, { style: "segmented" }),
      ], { spacing: 12 }),
      Widget.text("Data: OpenSky Network, anonymous access. Results are cached for 60 seconds; the anonymous API allows a few hundred requests per day, so Auto re-scans once a minute at most.", { font: "caption2", color: "secondary" }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});

// ───────────────────────── Widget

function nearestRow(a, compact) {
  return Widget.hstack([
    Widget.symbol("airplane", { size: 11, color: a.distKm <= POP_RADIUS_KM ? ORANGE : BLUE, fallback: "✈️" }),
    Widget.text(a.callsign, { font: "caption", weight: "semibold", design: "monospaced", lineLimit: 1, frame: { width: compact ? 64 : 76, alignment: "leading" } }),
    Widget.text(fmtAlt(a.altM), { font: "caption2", color: "secondary", lineLimit: 1 }),
    Widget.spacer(),
    Widget.text(`${fmtDist(a.distKm)} ${compass(a.bearing)}`, { font: "caption2", weight: "medium", lineLimit: 1 }),
  ], { spacing: 5 });
}

function countBlock(result, big) {
  const count = result.aircraft.length;
  return Widget.vstack([
    Widget.hstack([
      Widget.text(String(count), { font: big, weight: "heavy", design: "rounded", color: BLUE, lineLimit: 1 }),
      Widget.symbol("airplane", { size: Math.round(big * 0.45), color: BLUE, fallback: "✈️" }),
    ], { spacing: 6, alignment: "center" }),
    Widget.text(count === 1 ? `aircraft within ${result.radiusKm} km` : `aircraft within ${result.radiusKm} km`, { font: "caption2", color: "secondary", lineLimit: 1 }),
  ], { alignment: "leading", spacing: 0 });
}

Script.widget(async ({ family }) => {
  const cachedBefore = lastScan();
  const fresh = cachedBefore && Date.now() - cachedBefore.time < 5 * 60_000;
  if (!fresh && !Script.env.lowPowerMode) await safeScan();
  const result = lastScan();
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const refreshAfter = 10 * 60;

  if (!result) {
    const error = Storage.get("lastError");
    return {
      content: Widget.vstack([
        Widget.symbol("airplane", { size: 26, color: BLUE, fallback: "✈️" }),
        Widget.text(error ? error.message : "Open Planes Overhead once to approve location and network", { font: "caption", color: "secondary", align: "center", lineLimit: 4, minimumScale: 0.7 }),
      ], { spacing: 8, padding: 12, background: SKY, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity" } }),
      refreshAfter,
    };
  }

  const closest = result.aircraft[0] ?? null;
  const stale = Date.now() - result.time > 15 * 60_000;
  const footer = Widget.hstack([
    stale ? Widget.symbol("exclamationmark.triangle.fill", { size: 9, color: "orange", fallback: "⚠️" }) : null,
    Widget.text(stale ? "Last scan" : "Scanned", { font: "caption2", color: "secondary" }),
    Widget.date(result.time, { style: "relative", font: "caption2", color: "secondary" }),
    Widget.spacer(),
    Widget.text("OpenSky", { font: "caption2", color: "secondary" }),
  ], { spacing: 3 });

  let content;
  if (family === "small") {
    content = Widget.vstack([
      Widget.text("OVERHEAD", { font: "caption2", weight: "bold", color: BLUE }),
      Widget.spacer(),
      countBlock(result, 40),
      Widget.spacer(),
      closest ? Widget.vstack([
        Widget.text("Closest", { font: "caption2", color: "secondary" }),
        Widget.text(closest.callsign, { font: "subheadline", weight: "bold", design: "monospaced", lineLimit: 1, minimumScale: 0.7 }),
        Widget.text(`${fmtAlt(closest.altM)} · ${fmtDist(closest.distKm)} ${compass(closest.bearing)}`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
      ], { alignment: "leading", spacing: 1 }) : Widget.text("Clear skies", { font: "caption", color: "secondary" }),
      footer,
    ], { alignment: "leading", spacing: 3, padding: 12, background: SKY, url: APP_LINK, frame: fill });
  } else if (family === "medium") {
    content = Widget.hstack([
      Widget.vstack([
        Widget.text("OVERHEAD", { font: "caption2", weight: "bold", color: BLUE }),
        Widget.spacer(),
        countBlock(result, 40),
        Widget.spacer(),
        closest ? Widget.text(`Closest ${closest.callsign} · ${fmtAlt(closest.altM)}`, { font: "caption2", weight: "medium", lineLimit: 1, minimumScale: 0.7 }) : Widget.text("Clear skies", { font: "caption2", color: "secondary" }),
      ], { alignment: "leading", spacing: 3, padding: 10, background: TILE, cornerRadius: 14, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack([
        Widget.text("NEAREST", { font: "caption2", weight: "bold", color: "secondary" }),
        ...result.aircraft.slice(0, 3).map((a) => nearestRow(a, true)),
        result.aircraft.length === 0 ? Widget.text("Nothing airborne nearby", { font: "caption", color: "secondary" }) : null,
        Widget.spacer(),
        footer,
      ], { alignment: "leading", spacing: 5, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 10, padding: 12, background: SKY, url: APP_LINK, frame: fill });
  } else {
    content = Widget.vstack([
      Widget.hstack([
        countBlock(result, 34),
        Widget.spacer(),
        closest ? Widget.vstack([
          Widget.text(closest.callsign, { font: "headline", design: "monospaced" }),
          Widget.text(`${fmtAlt(closest.altM)} · ${fmtSpeed(closest.speedMs)} · ${fmtDist(closest.distKm)} ${compass(closest.bearing)}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
        ], { alignment: "trailing", spacing: 1 }) : null,
      ], { alignment: "center" }),
      Widget.map({ center: result.here, span: result.radiusKm * 2000, pins: pins(result).slice(0, 40), frame: { height: 150 } }),
      ...result.aircraft.slice(0, 4).map((a) => nearestRow(a, false)),
      Widget.spacer(),
      footer,
    ], { alignment: "leading", spacing: 6, padding: 14, background: SKY, url: APP_LINK, frame: fill });
  }
  return { content, refreshAfter };
});

// ───────────────────────── Run and background

Script.run(async () => {
  const { result, error } = await safeScan({ force: true });
  if (!result) return `Could not scan: ${error}`;
  if (!result.aircraft.length) return `No aircraft airborne within ${result.radiusKm} km of you right now.`;
  const top = result.aircraft.slice(0, 3).map((a) => `${a.callsign} ${fmtDist(a.distKm)} to the ${compass(a.bearing)} at ${fmtAlt(a.altM)}`).join("; ");
  return `${result.aircraft.length} aircraft within ${result.radiusKm} km${error ? " (cached)" : ""}. Nearest: ${top}.`;
});

Script.background(async () => {
  if (!Script.env.lowPowerMode) await safeScan();
});
