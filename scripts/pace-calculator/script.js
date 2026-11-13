// @name        Pace Calculator
// @description Running maths on the device: pace, time and distance for 5K to marathon, Riegel race predictions, even and negative split tables, treadmill conversions, and your recent runs from Apple Health
// @permissions health
// @widget      small, medium
// @icon        stopwatch.fill
// @color       #EA580C
// @version     1.0.0
// @author      va4w
// @category    sports

// How it works
// • Everything is computed on the device; nothing is sent anywhere. Apple Health is only read when you tap "Load from Health", and workout data never leaves the phone.
// • Calculator tab: pick a distance (5K, 10K, half, marathon or custom), type a time or a pace, and it solves for the third value in km and miles. "Save as target" feeds the widget.
// • Splits tab: a split table for the target, even or with a negative split by the percentage you choose. Predict tab: Riegel race-time predictions from a recent result or a Health workout. Treadmill tab: belt speed and incline to pace, with the equivalent flat pace.
// • Widget: small shows the target pace, medium adds the first five splits, the halfway time and the finish.
// • From Siri or Shortcuts, pass text such as "pace for 1:45 half", "10k at 4:30/km", "5k in 22 min" or "predict marathon from 45:00 10k". With no input it reads out the target race.
// • Units follow your locale (miles for US English, kilometres elsewhere) and can be switched at the top of the mini-app.

// ───────────────────────── Constants and helpers

const KM_PER_MI = 1.609344;
const RACES = [
  { key: "5k", label: "5K", km: 5 },
  { key: "10k", label: "10K", km: 10 },
  { key: "half", label: "Half marathon", km: 21.0975 },
  { key: "marathon", label: "Marathon", km: 42.195 },
  { key: "custom", label: "Custom", km: null },
];
const RIEGEL = 1.06;
const ORANGE = "#EA580C";
const TRACK = Widget.gradient([{ light: "#FFF7ED", dark: "#2A1407" }, { light: "#FFEDD5", dark: "#431407" }], { direction: "topToBottom" });
const TILE = { light: "#FFFFFFB3", dark: "#FFFFFF14" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

const unit = () => Storage.get("unit") ?? (/-US$/i.test(Script.env.locale) ? "mi" : "km");
const unitKm = (u = unit()) => (u === "mi" ? KM_PER_MI : 1);
const pad = (n) => String(n).padStart(2, "0");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "–";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
const fmtPace = (secPerUnit) => (Number.isFinite(secPerUnit) && secPerUnit > 0 ? `${Math.floor(secPerUnit / 60)}:${pad(Math.round(secPerUnit % 60) % 60)}` : "–");
const fmtNumber = (n, digits = 1) => n.toLocaleString(Script.env.locale, { maximumFractionDigits: digits });
const fmtDistance = (km, u = unit()) => `${fmtNumber(km / unitKm(u), 2)} ${u}`;

const raceOf = (key) => RACES.find((r) => r.key === key) ?? RACES[1];
const raceLabel = (key, km) => (key === "custom" ? fmtDistance(km) : raceOf(key).label);

// Which race a distance is, within a small tolerance, for labels.
function nearestRace(km) {
  return RACES.find((r) => r.km && Math.abs(r.km - km) < 0.05) ?? null;
}

// ───────────────────────── Parsing text

// "1:45:00", "45:30", "25 min", "1h45", "1h", "90m". `distanceKm` disambiguates "1:45" (hours for a half, minutes for a 5K).
function parseClock(text, distanceKm = null) {
  const t = String(text ?? "").trim().toLowerCase();
  let m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(t);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  m = /^(\d{1,3}):(\d{2})$/.exec(t);
  if (m) {
    const asMinutes = Number(m[1]) * 60 + Number(m[2]);
    const asHours = Number(m[1]) * 3600 + Number(m[2]) * 60;
    if (!distanceKm) return asMinutes;
    const plausible = (sec) => sec / distanceKm >= 120 && sec / distanceKm <= 900; // 2:00 to 15:00 per km
    if (plausible(asMinutes)) return asMinutes;
    if (plausible(asHours)) return asHours;
    return asMinutes;
  }
  m = /^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d{1,2})\s*(?:m|min|minutes?)?)?$/.exec(t);
  if (m) return Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60;
  m = /^(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes)$/.exec(t);
  if (m) return Number(m[1]) * 60;
  m = /^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)$/.exec(t);
  if (m) return Number(m[1]);
  return null;
}

// "4:30", "4:30/km", "7:15 per mile", "4.5 min/km" to seconds per km.
function parsePace(text) {
  const t = String(text ?? "").trim().toLowerCase();
  const m = /^(\d{1,2})(?::(\d{2})|\.(\d+))?\s*(?:min)?\s*(?:\/|per)?\s*(km|k|kilometer|kilometre|mi|mile|miles)?$/.exec(t);
  if (!m) return null;
  const sec = Number(m[1]) * 60 + (m[2] ? Number(m[2]) : m[3] ? Number(`0.${m[3]}`) * 60 : 0);
  const perMile = m[4] ? /^mi/.test(m[4]) : unit() === "mi";
  return perMile ? sec / KM_PER_MI : sec;
}

// "5k", "10 km", "half", "marathon", "13.1 miles" to kilometres.
function parseDistance(text) {
  const t = String(text ?? "").trim().toLowerCase();
  if (/^(half|hm|half[- ]marathon|21k|21\.1k?)$/.test(t)) return 21.0975;
  if (/^(marathon|full|42k|42\.2k?)$/.test(t)) return 42.195;
  const m = /^(\d+(?:\.\d+)?)\s*(km|k|kilometers?|kilometres?|mi|miles?|m|meters?|metres?)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2] ?? "";
  if (/^mi/.test(u)) return n * KM_PER_MI;
  if (/^(m|meters?|metres?)$/.test(u)) return n / 1000;
  return n;
}

// ───────────────────────── Running maths

const paceFor = (km, sec) => sec / km;                   // seconds per km
const timeFor = (km, secPerKm) => km * secPerKm;
const distanceFor = (sec, secPerKm) => sec / secPerKm;
const riegel = (fromKm, fromSec, toKm) => fromSec * (toKm / fromKm) ** RIEGEL;
const speedKmh = (secPerKm) => 3600 / secPerKm;

// Split table. `negative` is the fraction the second half is faster than the first (0.03 = 3%).
function splits(km, sec, u = unit(), negative = 0) {
  const per = unitKm(u);
  const full = Math.floor(km / per + 1e-9);
  const rest = km - full * per;
  const lengths = Array.from({ length: full }, () => per);
  if (rest > 0.01) lengths.push(rest);
  const n = lengths.length;
  // Linear factors symmetric around 1 so the second half averages (1 - X) times the first.
  const a = negative / (2 - negative);
  let factors = lengths.map((_, i) => 1 + 2 * a * (n - 1 - 2 * i) / Math.max(1, n));
  const mean = factors.reduce((s, f) => s + f, 0) / n;
  factors = factors.map((f) => f / mean);
  const basePace = sec / km;
  let cumulative = 0;
  return lengths.map((len, i) => {
    const splitSec = len * basePace * factors[i];
    cumulative += splitSec;
    return { index: i + 1, length: len, splitSec, pace: (splitSec / len) * per, cumulative, partial: len < per - 0.01 };
  });
}

// ───────────────────────── State

const DEFAULT_CALC = { race: "10k", customKm: 15, timeSec: 50 * 60, paceSecKm: 300, solve: "pace" };
const calc = () => ({ ...DEFAULT_CALC, ...Storage.get("calc", {}) });
const saveCalc = (changes) => Storage.set("calc", { ...calc(), ...changes });
const calcKm = (c = calc()) => (c.race === "custom" ? c.customKm : raceOf(c.race).km);

// Resolve the calculator into a consistent { km, sec, pace }.
function solved(c = calc()) {
  const km = calcKm(c);
  if (c.solve === "time") return { km, pace: c.paceSecKm, sec: timeFor(km, c.paceSecKm) };
  if (c.solve === "distance") return { km: distanceFor(c.timeSec, c.paceSecKm), sec: c.timeSec, pace: c.paceSecKm };
  return { km, sec: c.timeSec, pace: paceFor(km, c.timeSec) };
}

const target = () => Storage.get("target");               // { km, sec, label }
const predict = () => ({ race: "10k", customKm: 8, timeSec: 48 * 60, ...Storage.get("predict", {}) });
const treadmill = () => ({ kmh: 10, incline: 1, ...Storage.get("treadmill", {}) });
const splitSettings = () => ({ mode: "even", percent: 3, ...Storage.get("splits", {}) });

// ───────────────────────── Health

async function loadWorkouts() {
  if (!(await Health.available())) throw new Error("Health is not available on this device");
  const start = new Date(Date.now() - 60 * 86_400_000);
  const all = await Health.workouts({ start });
  const runs = all
    .filter((w) => /run/i.test(w.activity ?? "") && (w.distance ?? 0) >= 1000 && (w.duration ?? 0) > 60)
    .map((w) => ({ km: w.distance / 1000, sec: w.duration, when: w.start ?? w.end ?? null }))
    .sort((a, b) => (b.when ? new Date(b.when) : 0) - (a.when ? new Date(a.when) : 0))
    .slice(0, 15);
  const totalKm = runs.reduce((s, r) => s + r.km, 0);
  const totalSec = runs.reduce((s, r) => s + r.sec, 0);
  Storage.set("workouts", { runs, avgPace: totalKm ? totalSec / totalKm : null, time: Date.now() });
  return runs;
}

// ───────────────────────── Actions

let tab = 0;
let notice = null;

Script.action("tab", ({ value }) => { tab = value; });
Script.action("unit", ({ value }) => Storage.set("unit", value));
Script.action("race", ({ value }) => saveCalc({ race: value }));
Script.action("solve", ({ value }) => saveCalc({ solve: value }));
Script.action("customKm", ({ value }) => { const km = parseDistance(value); if (km) saveCalc({ customKm: km, race: "custom" }); });
Script.action("time", ({ value }) => { const sec = parseClock(value, calcKm()); notice = sec ? null : `Could not read “${value}” as a time`; if (sec) saveCalc({ timeSec: sec }); });
Script.action("pace", ({ value }) => { const p = parsePace(value); notice = p ? null : `Could not read “${value}” as a pace`; if (p) saveCalc({ paceSecKm: p }); });
Script.action("saveTarget", () => {
  const s = solved();
  Storage.set("target", { km: s.km, sec: s.sec, label: nearestRace(s.km)?.label ?? fmtDistance(s.km) });
  notice = "Saved as your target race. The widget shows it now.";
});
Script.action("splitMode", ({ value }) => Storage.set("splits", { ...splitSettings(), mode: value }));
Script.action("splitPercent", ({ value }) => Storage.set("splits", { ...splitSettings(), percent: value }));
Script.action("predictRace", ({ value }) => Storage.set("predict", { ...predict(), race: value }));
Script.action("predictCustom", ({ value }) => { const km = parseDistance(value); if (km) Storage.set("predict", { ...predict(), customKm: km, race: "custom" }); });
Script.action("predictTime", ({ value }) => { const p = predict(); const sec = parseClock(value, p.race === "custom" ? p.customKm : raceOf(p.race).km); if (sec) Storage.set("predict", { ...p, timeSec: sec }); });
Script.action("useRun", ({ km, sec }) => Storage.set("predict", { ...predict(), race: "custom", customKm: km, timeSec: sec }));
Script.action("health", async () => {
  try {
    const runs = await loadWorkouts();
    notice = runs.length ? `Loaded ${runs.length} runs from the last 60 days.` : "No runs over 1 km in Health in the last 60 days.";
  } catch (error) {
    notice = `Health: ${error.message}`;
  }
});
Script.action("kmh", ({ value }) => Storage.set("treadmill", { ...treadmill(), kmh: unit() === "mi" ? value * KM_PER_MI : value }));
Script.action("incline", ({ value }) => Storage.set("treadmill", { ...treadmill(), incline: value }));

// ───────────────────────── Mini-app pieces

const u = () => unit();
const perUnit = (secPerKm, which = u()) => secPerKm * unitKm(which);

function stat(label, value, color = "primary") {
  return Widget.vstack([
    Widget.text(label, { font: "caption2", weight: "semibold", color: "secondary" }),
    Widget.text(value, { font: "title3", weight: "bold", design: "rounded", color, lineLimit: 1, minimumScale: 0.6 }),
  ], { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", alignment: "leading" } });
}

function calculatorTab() {
  const c = calc();
  const s = solved(c);
  const other = u() === "km" ? "mi" : "km";
  const solveOptions = [{ label: "Pace", value: "pace" }, { label: "Time", value: "time" }, { label: "Distance", value: "distance" }];
  return Widget.vstack([
    Widget.picker(solveOptions, c.solve, "solve", null, { style: "segmented", label: "Solve for" }),
    c.solve !== "distance" ? Widget.picker(RACES.map((r) => ({ label: r.label, value: r.key })), c.race, "race", null, { style: "segmented" }) : null,
    c.solve !== "distance" && c.race === "custom" ? Widget.textField(`Distance in ${u()}`, fmtNumber(c.customKm / unitKm(), 2), "customKm", null, { label: `Custom distance (${u()})`, keyboard: "decimal" }) : null,
    c.solve !== "time" ? Widget.textField("h:mm:ss or 45 min", fmtTime(c.timeSec), "time", null, { label: "Finish time", keyboard: "default" }) : null,
    c.solve !== "pace" ? Widget.textField(`m:ss per ${u()}`, fmtPace(perUnit(c.paceSecKm)), "pace", null, { label: `Pace per ${u()}`, keyboard: "default" }) : null,
    Widget.card([
      Widget.hstack([
        stat(`Pace /${u()}`, fmtPace(perUnit(s.pace)), ORANGE),
        stat(`Pace /${other}`, fmtPace(perUnit(s.pace, other))),
      ], { spacing: 12 }),
      Widget.hstack([
        stat("Time", fmtTime(s.sec)),
        stat("Distance", fmtDistance(s.km)),
      ], { spacing: 12 }),
      Widget.hstack([
        stat("Speed", `${fmtNumber(speedKmh(s.pace) / unitKm())} ${u() === "mi" ? "mph" : "km/h"}`),
        stat("Halfway", fmtTime(s.sec / 2)),
      ], { spacing: 12 }),
      Widget.button("Save as target race", "saveTarget", null, { style: "prominent", color: ORANGE }),
    ], { title: nearestRace(s.km)?.label ?? "Custom distance", subtitle: "Result", symbol: "stopwatch.fill", color: "orange" }),
  ], { alignment: "leading", spacing: 14 });
}

function splitsTab() {
  const t = target() ?? (() => { const s = solved(); return { km: s.km, sec: s.sec, label: nearestRace(s.km)?.label ?? fmtDistance(s.km) }; })();
  const ss = splitSettings();
  const negative = ss.mode === "negative" ? ss.percent / 100 : 0;
  const table = splits(t.km, t.sec, u(), negative);
  const half = table.find((row) => row.cumulative >= t.sec / 2);
  const rows = table.map((row) => ({
    title: row.partial ? `Finish (${fmtNumber(row.length / unitKm(), 2)} ${u()})` : `${row.index} ${u()}`,
    subtitle: `${fmtPace(row.pace)} /${u()} · split ${fmtTime(row.splitSec)}`,
    detail: fmtTime(row.cumulative),
    symbol: row.partial ? "flag.checkered" : "circle",
    color: "orange",
  }));
  return Widget.vstack([
    Widget.picker([{ label: "Even", value: "even" }, { label: "Negative split", value: "negative" }], ss.mode, "splitMode", null, { style: "segmented" }),
    ss.mode === "negative" ? Widget.slider(ss.percent, "splitPercent", null, { min: 1, max: 10, step: 1, label: `Second half ${ss.percent}% faster`, color: "orange" }) : null,
    Widget.card([
      Widget.hstack([
        stat("Target", t.label, ORANGE),
        stat("Finish", fmtTime(t.sec)),
        stat("Avg pace", `${fmtPace(perUnit(t.sec / t.km))}`),
      ], { spacing: 12 }),
      Widget.text(ss.mode === "negative"
        ? `Start at ${fmtPace(table[0].pace)} and finish at ${fmtPace(table[table.length - 1].pace)} per ${u()}. Halfway in ${fmtTime(t.sec / 2)} would be reached around split ${half?.index ?? "–"}.`
        : `Every ${u()} in ${fmtPace(perUnit(t.sec / t.km))}. Halfway at ${fmtTime(t.sec / 2)}.`, { font: "footnote", color: "secondary" }),
      !target() ? Widget.text("Save a target race in the Calculator tab to pin these splits to the widget.", { font: "caption", color: "orange" }) : null,
    ], { title: "Plan", symbol: "list.number", color: "orange" }),
    Widget.list(rows, { title: `${table.length} splits` }),
  ], { alignment: "leading", spacing: 14 });
}

function predictTab() {
  const p = predict();
  const fromKm = p.race === "custom" ? p.customKm : raceOf(p.race).km;
  const health = Storage.get("workouts");
  const predictions = RACES.filter((r) => r.km).map((r) => ({ ...r, sec: riegel(fromKm, p.timeSec, r.km) }));
  return Widget.vstack([
    Widget.text("Riegel's formula scales a recent race to other distances: T₂ = T₁ × (D₂ ÷ D₁)^1.06. It assumes similar training for the longer distance.", { font: "footnote", color: "secondary" }),
    Widget.picker(RACES.map((r) => ({ label: r.label, value: r.key })), p.race, "predictRace", null, { style: "segmented", label: "Recent result" }),
    p.race === "custom" ? Widget.textField(`Distance in ${u()}`, fmtNumber(p.customKm / unitKm(), 2), "predictCustom", null, { label: `Distance (${u()})`, keyboard: "decimal" }) : null,
    Widget.textField("h:mm:ss", fmtTime(p.timeSec), "predictTime", null, { label: "Time" }),
    Widget.card(predictions.map((r) => Widget.hstack([
      Widget.text(r.label, { font: "subheadline", weight: "medium", frame: { width: 120, alignment: "leading" } }),
      Widget.spacer(),
      Widget.text(fmtPace(perUnit(r.sec / r.km)) + ` /${u()}`, { font: "caption", color: "secondary" }),
      Widget.text(fmtTime(r.sec), { font: "subheadline", weight: "bold", design: "rounded", color: Math.abs(r.km - fromKm) < 0.05 ? "secondary" : ORANGE, frame: { width: 72, alignment: "trailing" } }),
    ], { spacing: 8 })), { title: "Predicted times", subtitle: `from ${fmtDistance(fromKm)} in ${fmtTime(p.timeSec)}`, symbol: "chart.line.uptrend.xyaxis", color: "orange" }),
    Widget.card([
      health?.runs?.length ? Widget.vstack([
        Widget.text(`Average pace over ${health.runs.length} runs: ${fmtPace(perUnit(health.avgPace))} /${u()}. Tap a run to use it as the recent result.`, { font: "footnote", color: "secondary" }),
        Widget.list(health.runs.slice(0, 8).map((r) => ({
          title: `${fmtDistance(r.km)} in ${fmtTime(r.sec)}`,
          subtitle: r.when ? new Date(r.when).toLocaleDateString(Script.env.locale, { weekday: "short", day: "numeric", month: "short" }) : "Recent run",
          detail: `${fmtPace(perUnit(r.sec / r.km))} /${u()}`,
          symbol: "figure.run", color: "orange", args: { km: r.km, sec: r.sec },
        })), { action: "useRun", style: "plain" }),
      ], { alignment: "leading", spacing: 8 }) : Widget.text("Load your running workouts from the last 60 days to pick a real result. Health data stays on this device.", { font: "footnote", color: "secondary" }),
      Widget.hstack([
        Widget.button(health ? "Reload from Health" : "Load from Health", "health", null, { style: "bordered", color: "red" }),
        health?.time ? Widget.date(health.time, { style: "relative", font: "caption2", color: "secondary" }) : null,
      ], { spacing: 10 }),
    ], { title: "Recent runs", symbol: "heart.fill", color: "red" }),
  ], { alignment: "leading", spacing: 14 });
}

function treadmillTab() {
  const t = treadmill();
  const mi = u() === "mi";
  const shownSpeed = t.kmh / unitKm();
  const beltPace = 3600 / t.kmh;                       // s per km on the belt
  const flatKmh = t.kmh * (1 + 4.5 * t.incline / 100); // ACSM running equation: same oxygen cost on the flat
  const flatPace = 3600 / flatKmh;
  const table = (mi ? [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10] : [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]).map((v) => {
    const kmh = v * unitKm();
    return { title: `${fmtNumber(v)} ${mi ? "mph" : "km/h"}`, subtitle: `${fmtNumber(mi ? kmh : kmh / KM_PER_MI)} ${mi ? "km/h" : "mph"}`, detail: `${fmtPace(perUnit(3600 / kmh))} /${u()}`, symbol: "speedometer", color: "orange" };
  });
  return Widget.vstack([
    Widget.slider(Math.round(shownSpeed * 10) / 10, "kmh", null, { min: mi ? 3 : 5, max: mi ? 13 : 21, step: 0.1, label: `Belt speed ${fmtNumber(shownSpeed)} ${mi ? "mph" : "km/h"}`, color: "orange" }),
    Widget.stepper(`Incline ${fmtNumber(t.incline)}%`, t.incline, "incline", null, { min: 0, max: 15, step: 0.5 }),
    Widget.card([
      Widget.hstack([
        stat(`Belt pace /${u()}`, fmtPace(perUnit(beltPace))),
        stat(`Flat equivalent /${u()}`, fmtPace(perUnit(flatPace)), ORANGE),
      ], { spacing: 12 }),
      Widget.hstack([
        stat("Also", `${fmtNumber(mi ? t.kmh : t.kmh / KM_PER_MI)} ${mi ? "km/h" : "mph"}`),
        stat("Flat speed", `${fmtNumber(flatKmh / unitKm())} ${mi ? "mph" : "km/h"}`),
      ], { spacing: 12 }),
      Widget.text("The flat equivalent uses the ACSM running equation: each 1% of incline costs about as much as running 4.5% faster on level ground.", { font: "caption", color: "secondary" }),
    ], { title: "Treadmill", symbol: "figure.run.treadmill", color: "orange" }),
    Widget.list(table, { title: "Speed to pace" }),
  ], { alignment: "leading", spacing: 14 });
}

Script.ui(() => {
  const t = target();
  return {
    title: "Pace Calculator",
    content: Widget.vstack([
      Widget.hstack([
        Widget.picker([{ label: "Kilometres", value: "km" }, { label: "Miles", value: "mi" }], u(), "unit", null, { style: "segmented" }),
      ]),
      t ? Widget.text(`Target: ${t.label} in ${fmtTime(t.sec)} at ${fmtPace(perUnit(t.sec / t.km))} /${u()}`, { font: "caption", weight: "semibold", color: ORANGE }) : null,
      notice ? Widget.text(notice, { font: "footnote", color: notice.startsWith("Could not") || notice.startsWith("Health:") ? "red" : "green" }) : null,
      Widget.tabs([
        { title: "Calc", symbol: "stopwatch", content: calculatorTab() },
        { title: "Splits", symbol: "list.number", content: splitsTab() },
        { title: "Predict", symbol: "chart.line.uptrend.xyaxis", content: predictTab() },
        { title: "Treadmill", symbol: "figure.run.treadmill", content: treadmillTab() },
      ], { selected: tab, action: "tab" }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});

// ───────────────────────── Widget

Script.widget(({ family }) => {
  const t = target();
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  if (!t) {
    return Widget.vstack([
      Widget.symbol("figure.run", { size: 26, color: ORANGE, fallback: "🏃" }),
      Widget.text("Open Pace Calculator and save a target race", { font: "caption", color: "secondary", align: "center", lineLimit: 3 }),
    ], { spacing: 8, padding: 12, background: TRACK, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
  }
  const pace = perUnit(t.sec / t.km);
  const ss = splitSettings();
  const table = splits(t.km, t.sec, u(), ss.mode === "negative" ? ss.percent / 100 : 0);
  const header = Widget.hstack([
    Widget.text("TARGET", { font: "caption2", weight: "bold", color: ORANGE }),
    Widget.spacer(),
    Widget.text(t.label, { font: "caption2", weight: "semibold", color: "secondary", lineLimit: 1 }),
  ]);
  const hero = Widget.vstack([
    Widget.hstack([
      Widget.text(fmtPace(pace), { font: family === "small" ? 40 : 36, weight: "heavy", design: "rounded", lineLimit: 1, minimumScale: 0.5 }),
      Widget.text(`/${u()}`, { font: "caption", weight: "semibold", color: "secondary" }),
    ], { spacing: 3, alignment: "bottom" }),
    Widget.text(`${fmtTime(t.sec)} finish`, { font: "caption", weight: "medium" }),
    Widget.text(`${fmtNumber(speedKmh(t.sec / t.km) / unitKm())} ${u() === "mi" ? "mph" : "km/h"} · ${fmtDistance(t.km)}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
  ], { alignment: "leading", spacing: 2 });

  if (family === "small") {
    return Widget.vstack([header, Widget.spacer(), hero, Widget.spacer(), Widget.text(ss.mode === "negative" ? `Negative split ${ss.percent}%` : "Even splits", { font: "caption2", color: "secondary" })],
      { alignment: "leading", spacing: 4, padding: 12, background: TRACK, url: APP_LINK, frame: fill });
  }

  const firstFive = table.slice(0, 5);
  const rows = firstFive.map((row) => Widget.hstack([
    Widget.text(`${row.index} ${u()}`, { font: "caption", weight: "medium", frame: { width: 36, alignment: "leading" } }),
    Widget.text(fmtPace(row.pace), { font: "caption", color: "secondary", frame: { width: 36, alignment: "trailing" } }),
    Widget.spacer(),
    Widget.text(fmtTime(row.cumulative), { font: "caption", weight: "semibold", design: "rounded" }),
  ], { spacing: 6 }));
  return Widget.hstack([
    Widget.vstack([header, Widget.spacer(), hero, Widget.spacer()], { alignment: "leading", spacing: 4, padding: 10, background: TILE, cornerRadius: 14, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    Widget.vstack([
      Widget.text(ss.mode === "negative" ? `FIRST SPLITS · ${ss.percent}% NEGATIVE` : "FIRST SPLITS · EVEN", { font: "caption2", weight: "bold", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
      ...rows,
      Widget.spacer(),
      Widget.hstack([
        Widget.text("Half", { font: "caption2", color: "secondary" }),
        Widget.text(fmtTime(t.sec / 2), { font: "caption2", weight: "semibold" }),
        Widget.spacer(),
        Widget.text("Finish", { font: "caption2", color: "secondary" }),
        Widget.text(fmtTime(t.sec), { font: "caption2", weight: "semibold", color: ORANGE }),
      ], { spacing: 4 }),
    ], { alignment: "leading", spacing: 3, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
  ], { spacing: 10, padding: 12, background: TRACK, url: APP_LINK, frame: fill });
});

// ───────────────────────── Shortcuts and Siri

const HELP = 'Try: "pace for 1:45 half", "10k at 4:30/km", "5k in 22 min", "predict marathon from 45:00 10k", or "splits for 3:30 marathon".';

function describePace(km, sec) {
  const p = sec / km;
  return `${nearestRace(km)?.label ?? fmtDistance(km)} in ${fmtTime(sec)} is ${fmtPace(p)} per km, ${fmtPace(p * KM_PER_MI)} per mile, ${fmtNumber(speedKmh(p))} km/h.`;
}

Script.run((input) => {
  const text = String(input ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const DIST = "(half marathon|half|hm|marathon|full|\\d+(?:\\.\\d+)?\\s*(?:km|k|mi|miles?|m)\\b)";
  const TIME = "(\\d{1,2}:\\d{2}(?::\\d{2})?|\\d+(?:\\.\\d+)?\\s*(?:h|hours?|hrs?)(?:\\s*\\d{1,2}\\s*(?:m|min)?)?|\\d+(?:\\.\\d+)?\\s*(?:min|mins|minutes))";
  const PACE = "(\\d{1,2}(?::\\d{2}|\\.\\d+)?\\s*(?:min)?\\s*(?:\\/|per)\\s*(?:km|k|mi|mile|miles))";

  if (!text) {
    const t = target();
    return t ? `Your target: ${describePace(t.km, t.sec)}` : `No target race saved yet. ${HELP}`;
  }

  let m = new RegExp(`^predict ${DIST} from ${TIME} ${DIST}$`).exec(text) ?? new RegExp(`^predict ${DIST} from ${DIST} (?:in )?${TIME}$`).exec(text);
  if (m) {
    const toKm = parseDistance(m[1]);
    const fromKm = parseDistance(/^\d/.test(m[2]) && !/^\d+(?::|\s*(?:h|min))/.test(m[2]) ? m[2] : m[3]);
    const sec = parseClock(/^\d/.test(m[2]) && !/^\d+(?::|\s*(?:h|min))/.test(m[2]) ? m[3] : m[2], fromKm);
    if (toKm && fromKm && sec) return `From ${fmtDistance(fromKm, "km")} in ${fmtTime(sec)}, Riegel predicts ${nearestRace(toKm)?.label ?? fmtDistance(toKm, "km")} in ${fmtTime(riegel(fromKm, sec, toKm))} (${fmtPace(riegel(fromKm, sec, toKm) / toKm)} per km).`;
  }

  m = new RegExp(`^(?:splits? for )${TIME} ${DIST}$`).exec(text) ?? new RegExp(`^(?:splits? for )${DIST} (?:in )?${TIME}$`).exec(text);
  if (m) {
    const km = parseDistance(m[1]) ?? parseDistance(m[2]);
    const sec = parseClock(parseDistance(m[1]) ? m[2] : m[1], km);
    if (km && sec) {
      const table = splits(km, sec, "km");
      return `Even kilometre splits for ${fmtTime(sec)}: ${table.slice(0, 5).map((r) => fmtTime(r.cumulative)).join(", ")}… halfway ${fmtTime(sec / 2)}, every km in ${fmtPace(sec / km)}.`;
    }
  }

  m = new RegExp(`^${DIST} (?:at|@) ${PACE}$`).exec(text) ?? new RegExp(`^${PACE} for ${DIST}$`).exec(text);
  if (m) {
    const km = parseDistance(m[1]) ?? parseDistance(m[2]);
    const pace = parsePace(parseDistance(m[1]) ? m[2] : m[1]);
    if (km && pace) return `${nearestRace(km)?.label ?? fmtDistance(km, "km")} at ${fmtPace(pace)} per km (${fmtPace(pace * KM_PER_MI)} per mile) takes ${fmtTime(timeFor(km, pace))}.`;
  }

  m = new RegExp(`^(?:pace for )?${TIME} ${DIST}$`).exec(text) ?? new RegExp(`^(?:pace for )?${DIST} (?:in )?${TIME}$`).exec(text);
  if (m) {
    const km = parseDistance(m[1]) ?? parseDistance(m[2]);
    const sec = parseClock(parseDistance(m[1]) ? m[2] : m[1], km);
    if (km && sec) return describePace(km, sec);
  }

  return `I could not read “${input}”. ${HELP}`;
});
