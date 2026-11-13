// @name        Recovery Score
// @description A 0–100 readiness score from Apple Health: last night's HRV, resting heart rate, breathing rate and sleep compared with your own 14-day baseline. Stays on the device; not medical advice.
// @permissions health
// @widget      small, medium, large, circular, rectangular, inline
// @icon        bolt.heart.fill
// @color       #0D9488
// @version     1.0.0
// @author      scriptwell
// @category    health-fitness

// How it works
// • Reads heart rate variability, resting heart rate, respiratory rate and sleep from Apple Health
//   when you open the mini-app, run the script, or iOS gives it a background refresh. Nothing is
//   sent anywhere: there is no network permission.
// • Each metric is compared with your own previous 14 nights (a z-score): higher HRV and lower
//   resting heart rate score better, breathing that drifts from usual scores worse, and sleep is
//   measured against your goal (7.5 h by default). The parts are weighted and clamped to 0–100.
// • Needs at least three nights of data for a baseline; an Apple Watch or another sleep tracker
//   that writes to Health gives the best results. Open the mini-app once to approve Health access.
// • Widgets read the last computed score from Storage; the Lock Screen ring shows the number.
// • This is a wellbeing summary for your own curiosity, not a diagnosis or medical advice.

// ───────────────────────── Constants

const DAY = 86_400_000;
const BASELINE_DAYS = 14;
const MIN_BASELINE = 3;
const FRESH_MS = 30 * 60 * 1000;

const METRICS = [
  { key: "hrv", type: "heartRateVariability", label: "HRV", unit: "ms", symbol: "waveform.path.ecg", weight: 0.35, direction: 1, floor: 3, digits: 0 },
  { key: "rhr", type: "restingHeartRate", label: "Resting HR", unit: "bpm", symbol: "heart.fill", weight: 0.25, direction: -1, floor: 1.5, digits: 0 },
  { key: "rr", type: "respiratoryRate", label: "Breathing", unit: "/min", symbol: "lungs.fill", weight: 0.10, direction: 0, floor: 0.4, digits: 1 },
  { key: "sleep", type: null, label: "Sleep", unit: "h", symbol: "bed.double.fill", weight: 0.30, direction: 1, floor: 20, digits: 1 },
];

const BANDS = [
  { min: 67, name: "Primed", color: "green", hex: "#22C55E", tip: "Your body looks well recovered. A harder session or a long day should sit fine." },
  { min: 34, name: "Steady", color: "orange", hex: "#F59E0B", tip: "About usual. Train or work as planned and keep an eye on sleep tonight." },
  { min: 0, name: "Rest up", color: "red", hex: "#EF4444", tip: "Several signals are off your baseline. Favour an easy day, fluids and an early night." },
];
const bandFor = (score) => BANDS.find((b) => score >= b.min) ?? BANDS[2];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length); };
const fmt = (n, digits = 0) => Number(n).toLocaleString(Script.env.locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const hours = (minutes) => `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, "0")}m`;
const dayKey = (date = new Date()) => date.toLocaleDateString("en-CA");

// Night bucketing: everything after 20:00 belongs to the following day, so last night's
// readings and this morning's resting heart rate land in "today".
const nightKey = (iso) => dayKey(new Date(new Date(iso).getTime() + 4 * 3_600_000));

const settings = () => ({ sleepGoal: 7.5, ...Storage.get("settings", {}) });

// ───────────────────────── Reading Health

function withTimeout(promise, ms, label) {
  if (ms == null) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not answer in time`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// No timer of our own on the first app run: iOS's Health sheet may be up and that wait is not counted.
function budget() {
  if (Script.env.mode === "background") return 3_000;
  if (Script.env.mode === "shortcut") return 4_000;
  return Storage.get("healthReady", false) ? 10_000 : null;
}

function bucketMeans(samples) {
  const buckets = {};
  for (const s of samples) {
    if (typeof s.value !== "number") continue;
    const key = nightKey(s.end ?? s.start);
    (buckets[key] ??= []).push(s.value);
  }
  return Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, mean(v)]));
}

function sleepMinutesByNight(stages) {
  const asleep = {}, inBed = {};
  for (const s of stages) {
    const key = nightKey(s.end ?? s.start);
    if (s.stage === "inBed") inBed[key] = (inBed[key] ?? 0) + s.minutes;
    else if (s.stage !== "awake") asleep[key] = (asleep[key] ?? 0) + s.minutes;
  }
  // Trackers that only write "in bed" still get a number, from that.
  return { ...inBed, ...asleep };
}

async function sync() {
  const ms = budget();
  try {
    if (!(await withTimeout(Health.available(), ms, "Health"))) throw new Error("Health is not available on this device");
    const start = new Date(Date.now() - (BASELINE_DAYS + 2) * DAY);
    const byDay = {};

    for (const m of METRICS) {
      let nights = {};
      try {
        if (m.type) {
          const samples = await withTimeout(Health.samples(m.type, { start, limit: 3000 }), ms, m.label);
          nights = bucketMeans(samples);
        } else {
          const stages = await withTimeout(Health.sleep({ start }), ms, "Sleep");
          nights = sleepMinutesByNight(stages);
        }
      } catch (error) {
        console.warn(`${m.label}: ${error.message}`);
        continue; // one missing metric should not sink the whole score
      }
      for (const [day, value] of Object.entries(nights)) (byDay[day] ??= {})[m.key] = Number(value.toFixed(2));
    }

    if (Object.keys(byDay).length === 0) throw new Error("No HRV, heart rate, breathing or sleep data in Health for the last two weeks");
    Storage.set("days", byDay);
    Storage.set("healthReady", true);
    Storage.remove("lastError");
    compute();
    return true;
  } catch (error) {
    const hint = Script.env.mode === "app" || Storage.get("healthReady", false) ? "" : ` Open ${Script.name} once to allow Health.`;
    Storage.set("lastError", `${error.message}.${hint}`);
    return false;
  }
}

// ───────────────────────── Scoring

function compute() {
  const days = Storage.get("days", {});
  const today = dayKey();
  const { sleepGoal } = settings();
  const past = Object.keys(days).filter((d) => d < today).sort().slice(-BASELINE_DAYS);
  const parts = [];

  for (const m of METRICS) {
    const value = days[today]?.[m.key] ?? null;
    const history = past.map((d) => days[d]?.[m.key]).filter((v) => typeof v === "number");
    const baseline = history.length ? mean(history) : null;
    const part = { key: m.key, label: m.label, symbol: m.symbol, unit: m.unit, value, baseline, nights: history.length, score: null, delta: null, pct: null, text: "" };

    if (value == null) {
      part.text = m.key === "sleep" ? "No sleep recorded for last night" : `No ${m.label} reading since last night`;
    } else if (m.key === "sleep") {
      const goalMin = sleepGoal * 60;
      part.score = clamp((value / goalMin) * 100, 0, 100);
      part.delta = value - goalMin;
      part.pct = baseline ? ((value - baseline) / baseline) * 100 : null;
      part.text = `${hours(value)} of your ${fmt(sleepGoal, 1)} h goal${baseline ? `, ${Math.abs(part.pct) < 1 ? "about your usual" : `${fmt(Math.abs(part.pct))}% ${part.pct > 0 ? "more" : "less"} than usual`}` : ""}`;
    } else if (history.length < MIN_BASELINE) {
      part.text = `${fmt(value, m.digits)} ${m.unit} · baseline needs ${MIN_BASELINE - history.length} more night${MIN_BASELINE - history.length === 1 ? "" : "s"}`;
    } else {
      const spread = Math.max(sd(history), m.floor, baseline * 0.04);
      const z = (value - baseline) / spread;
      part.delta = value - baseline;
      part.pct = ((value - baseline) / baseline) * 100;
      if (m.direction === 0) part.score = clamp(92 - 25 * Math.abs(z), 0, 100);
      else part.score = clamp(65 + 20 * z * m.direction, 0, 100);
      const dir = part.pct > 0 ? "above" : "below";
      part.text = Math.abs(part.pct) < 1
        ? `${fmt(value, m.digits)} ${m.unit}, right on your usual`
        : `${fmt(value, m.digits)} ${m.unit}, ${fmt(Math.abs(part.pct))}% ${dir} your usual ${fmt(baseline, m.digits)}`;
    }
    parts.push(part);
  }

  const scored = parts.filter((p) => p.score != null);
  const weightSum = scored.reduce((a, p) => a + METRICS.find((m) => m.key === p.key).weight, 0);
  const score = scored.length && weightSum > 0
    ? Math.round(scored.reduce((a, p) => a + p.score * METRICS.find((m) => m.key === p.key).weight, 0) / weightSum)
    : null;

  const result = { day: today, time: Date.now(), score, parts, baselineNights: past.length };
  Storage.set("today", result);

  if (score != null) {
    const scores = Storage.get("scores", {});
    scores[today] = score;
    const cutoff = dayKey(new Date(Date.now() - 60 * DAY));
    for (const d of Object.keys(scores)) if (d < cutoff) delete scores[d];
    Storage.set("scores", scores);
  }
  return result;
}

function scoreSeries(daysBack = 14) {
  const scores = Storage.get("scores", {});
  const out = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * DAY);
    const key = dayKey(date);
    if (scores[key] != null) out.push({ x: date.toLocaleDateString(Script.env.locale, { weekday: "short", day: "numeric" }), y: scores[key] });
  }
  return out;
}

// ───────────────────────── Entry points: run and background

Script.run(async () => {
  await sync();
  const t = Storage.get("today");
  const error = Storage.get("lastError");
  if (!t || t.score == null) return error ?? "Not enough data for a score yet. Check back after a few nights.";
  const band = bandFor(t.score);
  return `Recovery ${t.score} of 100, ${band.name.toLowerCase()}. ${t.parts.filter((p) => p.value != null).map((p) => `${p.label}: ${p.text}`).join(". ")}. Not medical advice.`;
});

Script.background(sync);

// ───────────────────────── Widget pieces

const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const TILE_BG = { light: "#F0FDFA", dark: "#132524" };
const DIM = { light: "#E2E8F0", dark: "#1E293B" };

const arrowFor = (p) => {
  if (p.pct == null || Math.abs(p.pct) < 1) return { symbol: "equal", text: "=", color: "secondary" };
  const good = p.key === "rr" ? false : (p.pct > 0) === (p.key !== "rhr");
  return { symbol: p.pct > 0 ? "arrow.up.right" : "arrow.down.right", text: p.pct > 0 ? "↗" : "↘", color: good ? "green" : p.key === "rr" ? "orange" : "red" };
};

const partColor = (p) => (p.score == null ? "secondary" : p.score >= 67 ? "green" : p.score >= 34 ? "orange" : "red");
const shortValue = (p) => (p.value == null ? "–" : p.key === "sleep" ? hours(p.value) : `${fmt(p.value, p.key === "rr" ? 1 : 0)} ${p.unit}`);
const pctText = (p) => (p.pct == null ? "" : `${p.pct > 0 ? "+" : "−"}${fmt(Math.abs(p.pct))}%`);

function ring(score, size) {
  const band = bandFor(score);
  return Widget.progress(score / 100, { style: "ring", color: band.color, label: String(score), frame: { width: size, height: size } });
}

function compactRow(p) {
  const arrow = arrowFor(p);
  return Widget.hstack([
    Widget.symbol(p.symbol, { size: 11, color: partColor(p), fallback: "•", frame: { width: 16 } }),
    Widget.text(p.label, { font: "caption2", color: "secondary", lineLimit: 1 }),
    Widget.spacer(),
    Widget.text(shortValue(p), { font: "caption", weight: "semibold", design: "rounded", lineLimit: 1 }),
    Widget.symbol(arrow.symbol, { size: 9, color: arrow.color, fallback: arrow.text, frame: { width: 12 } }),
  ], { spacing: 3 });
}

function fullRow(p) {
  const arrow = arrowFor(p);
  return Widget.hstack([
    Widget.symbol(p.symbol, { size: 14, color: partColor(p), fallback: "•", frame: { width: 22 } }),
    Widget.vstack([
      Widget.hstack([
        Widget.text(p.label, { font: "subheadline", weight: "medium" }),
        Widget.spacer(),
        Widget.text(shortValue(p), { font: "subheadline", weight: "bold", design: "rounded" }),
        p.pct != null ? Widget.text(pctText(p), { font: "caption2", weight: "semibold", color: arrow.color }) : null,
      ], { spacing: 4 }),
      Widget.text(p.text, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.8 }),
    ], { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", alignment: "leading" } }),
  ], { spacing: 6, padding: { horizontal: 8, vertical: 5 }, background: TILE_BG, cornerRadius: 9 });
}

function emptyWidget(family) {
  const error = Storage.get("lastError");
  if (family === "inline") return Widget.text("Recovery: open the app to sync");
  if (family === "circular") return Widget.progress(0, { style: "ring", label: "–" });
  return Widget.vstack([
    Widget.symbol("heart.text.square.fill", { size: 24, color: "teal", fallback: "💚" }),
    Widget.text(error ?? "Open Recovery Score once to read Health.", { font: "caption", color: "secondary", align: "center", lineLimit: 4, minimumScale: 0.7 }),
  ], { spacing: 6, url: APP_LINK });
}

// ───────────────────────── Widget

Script.widget(({ family }) => {
  const t = Storage.get("today");
  if (!t || t.score == null) return { content: emptyWidget(family), refreshAfter: 30 * 60 };
  const band = bandFor(t.score);
  const parts = t.parts;
  const stale = t.day !== dayKey();
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  let content;

  switch (family) {
    case "inline":
      content = Widget.text(`Recovery ${t.score} · ${band.name}${stale ? " (yesterday)" : ""}`);
      break;

    case "circular":
      content = Widget.progress(t.score / 100, { style: "ring", label: String(t.score) });
      break;

    case "rectangular":
      content = Widget.vstack([
        Widget.hstack([
          Widget.symbol("heart.text.square.fill", { size: 12, fallback: "💚" }),
          Widget.text(`Recovery ${t.score}`, { font: "headline", lineLimit: 1 }),
          Widget.spacer(),
          Widget.text(band.name, { font: "caption", weight: "semibold" }),
        ], { spacing: 4 }),
        Widget.progress(t.score / 100),
        Widget.text(parts.filter((p) => p.value != null).map((p) => `${p.label === "Resting HR" ? "RHR" : p.label} ${p.key === "sleep" ? hours(p.value) : pctText(p) || "="}`).join(" · "), { font: "caption2", lineLimit: 1, minimumScale: 0.7 }),
      ], { alignment: "leading", spacing: 2 });
      break;

    case "small":
      content = Widget.vstack([
        Widget.hstack([
          Widget.text("RECOVERY", { font: "caption2", weight: "bold", color: "secondary" }),
          Widget.spacer(),
          stale ? Widget.symbol("clock", { size: 10, color: "secondary", fallback: "🕓" }) : null,
        ]),
        Widget.spacer(),
        Widget.hstack([Widget.spacer(), ring(t.score, 74), Widget.spacer()]),
        Widget.spacer(),
        Widget.text(band.name, { font: "headline", color: band.color, align: "center", frame: { maxWidth: "infinity" } }),
        Widget.text(`vs your ${t.baselineNights}-night baseline`, { font: "caption2", color: "secondary", align: "center", lineLimit: 1, minimumScale: 0.7, frame: { maxWidth: "infinity" } }),
      ], { alignment: "leading", spacing: 2, url: APP_LINK, frame: fill });
      break;

    case "medium":
      content = Widget.hstack([
        Widget.vstack([
          ring(t.score, 78),
          Widget.text(band.name, { font: "subheadline", weight: "semibold", color: band.color }),
          Widget.date(t.time, { style: "relative", font: "caption2", color: "secondary" }),
        ], { spacing: 4, frame: { width: 104 } }),
        Widget.vstack([
          Widget.text("Compared with your usual", { font: "caption2", weight: "semibold", color: "secondary" }),
          ...parts.map(compactRow),
        ], { alignment: "leading", spacing: 5, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" } }),
      ], { spacing: 10, url: APP_LINK, frame: fill });
      break;

    default: { // large
      const series = scoreSeries(14);
      content = Widget.vstack([
        Widget.hstack([
          ring(t.score, 72),
          Widget.vstack([
            Widget.text(band.name, { font: "title3", weight: "bold", color: band.color }),
            Widget.text(band.tip, { font: "caption", color: "secondary", lineLimit: 3 }),
            Widget.date(t.time, { style: "relative", font: "caption2", color: "secondary" }),
          ], { alignment: "leading", spacing: 2 }),
        ], { spacing: 12, alignment: "center" }),
        ...parts.map(fullRow),
        Widget.text("Last 14 days", { font: "caption2", weight: "semibold", color: "secondary" }),
        series.length >= 2
          ? Widget.chart(series.map((d) => ({ x: d.x, y: d.y })), { kind: "bar", axes: false, color: band.color, range: [0, 100], frame: { height: 46 } })
          : Widget.text("The trend appears after a couple of days.", { font: "caption2", color: "secondary" }),
        Widget.spacer(),
        Widget.text("For curiosity, not medical advice.", { font: "caption2", color: "secondary" }),
      ], { alignment: "leading", spacing: 6, url: APP_LINK, frame: fill });
    }
  }

  return { content, refreshAfter: 30 * 60 };
});

// ───────────────────────── Mini-app

let syncedOnce = false;

Script.action("sync", async () => { await sync(); });
Script.action("goal", ({ value }) => { Storage.set("settings", { ...settings(), sleepGoal: value }); compute(); });
Script.action("clear", async () => {
  const choice = await UI.alert({ title: "Clear score history?", message: "Health data itself is untouched.", buttons: ["Cancel", "Clear"] });
  if (choice === 1) { Storage.remove("scores"); Storage.remove("today"); Storage.remove("days"); }
});

function gauge(t) {
  const band = bandFor(t.score);
  return Widget.zstack([
    Widget.chart([{ x: "Score", y: t.score }, { x: "Rest", y: 100 - t.score }], { kind: "donut", axes: false, colors: [band.hex, "#94A3B840"], frame: { height: 230 } }),
    Widget.vstack([
      Widget.text(t.score, { font: 60, weight: "bold", design: "rounded", color: band.color }),
      Widget.text(band.name, { font: "headline", color: "secondary" }),
    ], { spacing: 0 }),
  ], { alignment: "center" });
}

function contributorCard(p) {
  const arrow = arrowFor(p);
  return Widget.hstack([
    Widget.symbol(p.symbol, { size: 22, color: partColor(p), fallback: "•", frame: { width: 30 } }),
    Widget.vstack([
      Widget.hstack([
        Widget.text(p.label, { font: "subheadline", weight: "semibold" }),
        Widget.spacer(),
        Widget.text(shortValue(p), { font: "subheadline", weight: "bold", design: "rounded" }),
        p.pct != null ? Widget.hstack([
          Widget.symbol(arrow.symbol, { size: 10, color: arrow.color, fallback: arrow.text }),
          Widget.text(pctText(p), { font: "caption", weight: "semibold", color: arrow.color }),
        ], { spacing: 2 }) : null,
      ], { spacing: 6 }),
      Widget.text(p.text, { font: "caption", color: "secondary" }),
      p.score != null ? Widget.progress(p.score / 100, { color: partColor(p) }) : null,
    ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", alignment: "leading" } }),
  ], { spacing: 10, padding: 12, background: TILE_BG, cornerRadius: 14 });
}

Script.ui(async () => {
  const t0 = Storage.get("today");
  if (!syncedOnce && (!t0 || Date.now() - t0.time > FRESH_MS)) {
    syncedOnce = true;
    await sync(); // first time, iOS may show the Health permission sheet here
  }
  const t = Storage.get("today");
  const error = Storage.get("lastError");
  const { sleepGoal } = settings();
  const series = scoreSeries(14);

  const controls = Widget.vstack([
    Widget.stepper(`Sleep goal: ${fmt(sleepGoal, 1)} h`, sleepGoal, "goal", null, { min: 5, max: 10, step: 0.5 }),
    Widget.hstack([
      Widget.button("Sync Health", "sync", null, { style: "prominent", color: "teal" }),
      Widget.button("Clear history", "clear", null, { style: "bordered", color: "red" }),
    ], { spacing: 10 }),
    t ? Widget.hstack([Widget.text("Last synced", { font: "caption", color: "secondary" }), Widget.date(t.time, { style: "relative", font: "caption", color: "secondary" })], { spacing: 4 }) : null,
    error ? Widget.text(`Health: ${error}`, { font: "caption", color: "red" }) : null,
  ], { alignment: "leading", spacing: 12 });

  const disclaimer = Widget.text("Recovery Score is a summary of your own Health data for curiosity and planning. It is not a medical device, does not diagnose anything and is not medical advice. If you feel unwell, talk to a clinician.", { font: "caption2", color: "secondary" });

  if (!t || t.score == null) {
    return {
      title: "Recovery",
      content: Widget.vstack([
        Widget.symbol("heart.text.square.fill", { size: 56, color: "teal", fallback: "💚" }),
        Widget.text(t ? "Not enough data yet" : "Reading Health…", { font: "title2", weight: "bold" }),
        Widget.text(t ? "A score needs last night's HRV, resting heart rate, breathing rate or sleep, plus a few earlier nights for a baseline. An Apple Watch worn to bed records all four." : "Allow the Health data types when iOS asks.", { color: "secondary", align: "center" }),
        t ? Widget.vstack(t.parts.map((p) => Widget.text(`${p.label}: ${p.text}`, { font: "caption", color: "secondary" })), { alignment: "leading", spacing: 2 }) : null,
        controls,
        disclaimer,
      ], { spacing: 16, padding: 20 }),
    };
  }

  const band = bandFor(t.score);
  return {
    title: "Recovery",
    content: Widget.vstack([
      gauge(t),
      Widget.text(band.tip, { font: "subheadline", align: "center", padding: { horizontal: 8 } }),
      Widget.text(`Compared with your previous ${t.baselineNights} night${t.baselineNights === 1 ? "" : "s"}`, { font: "caption", color: "secondary", align: "center" }),
      Widget.divider(),
      Widget.text("What moved it", { font: "headline" }),
      ...t.parts.map(contributorCard),
      Widget.divider(),
      Widget.text("Last 14 days", { font: "headline" }),
      series.length >= 2
        ? Widget.chart(series, { kind: "line", smooth: true, color: band.hex, range: [0, 100], frame: { height: 180 } })
        : Widget.text("The trend line appears once there are scores on two or more days.", { font: "footnote", color: "secondary" }),
      Widget.text("Weights: HRV 35%, sleep 30%, resting heart rate 25%, breathing 10%. Missing metrics are left out and the rest re-weighted.", { font: "caption2", color: "secondary" }),
      Widget.divider(),
      controls,
      disclaimer,
    ], { alignment: "leading", spacing: 14, padding: 18 }),
  };
});
