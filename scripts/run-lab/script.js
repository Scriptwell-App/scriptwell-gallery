// @name        Run Lab
// @description Your last 90 days of running from Apple Health: weekly distance, pace trend, longest run, 5k and 10k bests and VO₂max, plus the best hour to run today from Apple Weather for where you are. Health data stays on the device.
// @permissions health, location
// @widget      small, medium, large, rectangular
// @icon        figure.run
// @color       #EA580C
// @version     1.0.0
// @author      scriptwell
// @category    health-fitness

// How it works
// • Reads running workouts (and VO₂max, if present) from Apple Health when you open the mini-app,
//   run the script, or iOS gives it a background refresh. Health data never leaves the device.
// • Weekly distance, pace trend, longest run and 5k/10k personal bests (runs within 2% of the
//   distance) are worked out on the device. Pace is min/km or min/mi from your locale; change it in Settings.
// • "Good run window" scores each of the next 12 hours by temperature, rain chance, wind and UV. Only the
//   mini-app asks for your location and Apple Weather (coordinates go to Apple's weather service);
//   the result is cached so widgets never fetch anything.
// • Open the mini-app once to approve Health and Location before adding a widget.
// • Widget: this week vs last week and the next good window; the large size adds the charts.

// ───────────────────────── Constants and settings

const DAY = 86_400_000;
const RANGE_DAYS = 90;
const WEEKS = 12;
const WEATHER_FRESH_MS = 60 * 60 * 1000;
const MILE = 1609.344;

const settings = () => ({ units: "auto", weeklyGoalKm: 20, ...Storage.get("settings", {}) });

function useMiles() {
  const { units } = settings();
  if (units === "mi") return true;
  if (units === "km") return false;
  return /-(US|GB|LR|MM)$/i.test(Script.env.locale);
}

const unitLabel = () => (useMiles() ? "mi" : "km");
const unitMetres = () => (useMiles() ? MILE : 1000);
const toUnits = (metres) => metres / unitMetres();
const fmtNum = (n, digits = 1) => Number(n).toLocaleString(Script.env.locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const fmtDist = (metres, digits = 1) => `${fmtNum(toUnits(metres), digits)} ${unitLabel()}`;
const dayKey = (date = new Date()) => date.toLocaleDateString("en-CA");

function fmtPace(secondsPerUnit) {
  if (!Number.isFinite(secondsPerUnit) || secondsPerUnit <= 0) return "–";
  const m = Math.floor(secondsPerUnit / 60);
  const s = Math.round(secondsPerUnit % 60);
  return `${m}:${String(s).padStart(2, "0")} /${unitLabel()}`;
}

function fmtDuration(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.round(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const shortDate = (iso) => new Date(iso).toLocaleDateString(Script.env.locale, { day: "numeric", month: "short" });
const hourLabel = (iso) => new Date(iso).toLocaleTimeString(Script.env.locale, { hour: "2-digit", minute: "2-digit" });

// ───────────────────────── Health

function withTimeout(promise, ms, label) {
  if (ms == null) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not answer in time`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function budget() {
  if (Script.env.mode === "background") return 5_000;
  if (Script.env.mode === "shortcut") return 6_000;
  return Storage.get("healthReady", false) ? 12_000 : null; // first run: iOS's Health sheet may be up
}

async function sync() {
  const ms = budget();
  try {
    if (!(await withTimeout(Health.available(), ms, "Health"))) throw new Error("Health is not available on this device");
    const start = new Date(Date.now() - RANGE_DAYS * DAY);
    const workouts = await withTimeout(Health.workouts({ start, limit: 1000 }), ms, "Workouts");
    const runs = workouts
      .filter((w) => /run/i.test(w.activity) && w.duration > 60)
      .map((w) => ({ start: w.start, duration: Math.round(w.duration), distance: Math.round(w.distance ?? 0), energy: w.energy == null ? null : Math.round(w.energy) }))
      .sort((a, b) => new Date(a.start) - new Date(b.start));
    Storage.set("runs", runs);

    try {
      const vo2 = await withTimeout(Health.summary("vo2Max", { start }), ms, "VO₂max");
      Storage.set("vo2", vo2.count ? { average: vo2.average, max: vo2.max, count: vo2.count } : null);
    } catch (error) {
      console.warn(`VO₂max: ${error.message}`); // optional
    }

    Storage.set("synced", Date.now());
    Storage.set("healthReady", true);
    Storage.remove("lastError");
    return true;
  } catch (error) {
    const hint = Script.env.mode === "app" || Storage.get("healthReady", false) ? "" : ` Open ${Script.name} once to allow Health.`;
    Storage.set("lastError", `${error.message}.${hint}`);
    return false;
  }
}

// ───────────────────────── Analysis

const runs = () => Storage.get("runs", []);

function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function weekly(count = WEEKS) {
  const thisMonday = mondayOf(new Date());
  const weeks = Array.from({ length: count }, (_, i) => {
    const startDate = new Date(thisMonday.getTime() - (count - 1 - i) * 7 * DAY);
    return { start: startDate, distance: 0, runs: 0, duration: 0 };
  });
  for (const r of runs()) {
    const monday = mondayOf(new Date(r.start)).getTime();
    const week = weeks.find((w) => w.start.getTime() === monday);
    if (week) { week.distance += r.distance; week.runs += 1; week.duration += r.duration; }
  }
  return weeks;
}

const paceOf = (r) => (r.distance > 0 ? r.duration / toUnits(r.distance) : null); // seconds per km or mile

function paceSeries() {
  return runs().filter((r) => r.distance >= 1000).map((r) => ({ x: shortDate(r.start), y: Number((paceOf(r) / 60).toFixed(2)), date: r.start }));
}

function bestFor(target) {
  const near = runs().filter((r) => Math.abs(r.distance - target) <= target * 0.02);
  if (!near.length) return null;
  return near.reduce((a, b) => (b.duration < a.duration ? b : a));
}

function stats() {
  const list = runs();
  const weeks = weekly();
  const thisWeek = weeks[weeks.length - 1];
  const lastWeek = weeks[weeks.length - 2];
  const change = lastWeek?.distance ? ((thisWeek.distance - lastWeek.distance) / lastWeek.distance) * 100 : null;
  const longest = list.length ? list.reduce((a, b) => (b.distance > a.distance ? b : a)) : null;
  const total = list.reduce((a, r) => a + r.distance, 0);
  const time = list.reduce((a, r) => a + r.duration, 0);
  const recent = list.slice(-5).filter((r) => r.distance > 0);
  const recentPace = recent.length ? recent.reduce((a, r) => a + r.duration, 0) / toUnits(recent.reduce((a, r) => a + r.distance, 0)) : null;
  return { weeks, thisWeek, lastWeek, change, longest, total, time, count: list.length, recentPace, best5: bestFor(5000), best10: bestFor(10_000), vo2: Storage.get("vo2") };
}

// ───────────────────────── Weather window (mini-app only)

function scoreHour(h) {
  const temp = h.apparentTemperature ?? h.temperature;
  let score = 100;
  if (temp != null) {
    if (temp < 8) score -= (8 - temp) * 4;
    else if (temp > 16) score -= (temp - 16) * 5;
  }
  score -= (h.precipitationChance ?? 0) * 60;
  if ((h.precipitation ?? 0) > 0.5) score -= 15;
  if ((h.windSpeed ?? 0) > 15) score -= ((h.windSpeed ?? 0) - 15) * 1.5;
  if ((h.uvIndex ?? 0) > 5) score -= ((h.uvIndex ?? 0) - 5) * 6;
  const hour = new Date(h.date).getHours();
  if (hour >= 22 || hour < 5) score -= 15; // dark and quiet
  if (/thunder/i.test(h.condition ?? "")) score -= 50;
  return clamp(Math.round(score), 0, 100);
}

const windowLabel = (score) => (score >= 75 ? "Great" : score >= 50 ? "Fair" : "Poor");
const windowColor = (score) => (score >= 75 ? "green" : score >= 50 ? "orange" : "red");

async function refreshWeather() {
  try {
    const here = await Location.current({ accuracy: "kilometer" });
    const place = { latitude: here.latitude, longitude: here.longitude };
    const [hourly, credit] = await Promise.all([Weather.hourly(place, { hours: 12 }), Weather.attribution()]);
    const hours = hourly.map((h) => ({
      date: h.date, score: scoreHour(h),
      temp: h.apparentTemperature ?? h.temperature, pop: h.precipitationChance ?? 0,
      wind: h.windSpeed ?? 0, uv: h.uvIndex ?? 0, symbol: h.symbol ?? "cloud", description: h.description ?? h.condition ?? "",
    }));
    const best = hours.reduce((a, b) => (b.score > a.score ? b : a), hours[0]);
    Storage.set("windows", { time: Date.now(), place, hours, best, credit });
    Storage.remove("weatherError");
  } catch (error) {
    Storage.set("weatherError", error.message);
  }
}

function currentWindows() {
  const w = Storage.get("windows");
  if (!w) return null;
  const upcoming = w.hours.filter((h) => new Date(h.date).getTime() > Date.now() - 3_600_000);
  if (!upcoming.length) return { ...w, hours: [], best: null, expired: true };
  const best = upcoming.reduce((a, b) => (b.score > a.score ? b : a), upcoming[0]);
  return { ...w, hours: upcoming, best, expired: false };
}

function windowText(w) {
  if (!w?.best) return null;
  const b = w.best;
  return `${hourLabel(b.date)} · ${Math.round(b.temp)}° · ${Math.round(b.pop * 100)}% rain · ${windowLabel(b.score)}`;
}

// ───────────────────────── Run and background

Script.run(async () => {
  await sync();
  const error = Storage.get("lastError");
  if (error) return `Could not read Health: ${error}`;
  const s = stats();
  if (!s.count) return "No running workouts in the last 90 days.";
  const w = currentWindows();
  return `This week ${fmtDist(s.thisWeek.distance)}${s.change != null ? ` (${s.change >= 0 ? "+" : ""}${Math.round(s.change)}% vs last week)` : ""}. Longest run ${fmtDist(s.longest.distance)}. Recent pace ${fmtPace(s.recentPace)}.${w?.best ? ` Best run window ${windowText(w)}.` : ""}`;
});

Script.background(sync);

// ───────────────────────── Widget

const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const TILE_BG = { light: "#FFF7ED", dark: "#2A1A10" };
const ACCENT = "#EA580C";

function changeBadge(change, font = "caption2") {
  if (change == null) return Widget.text("first week", { font, color: "secondary" });
  const up = change >= 0;
  return Widget.hstack([
    Widget.symbol(up ? "arrow.up.right" : "arrow.down.right", { size: 9, color: up ? "green" : "orange", fallback: up ? "↗" : "↘" }),
    Widget.text(`${Math.abs(Math.round(change))}% vs last week`, { font, weight: "semibold", color: up ? "green" : "orange", lineLimit: 1, minimumScale: 0.7 }),
  ], { spacing: 2 });
}

function weeklyChart(weeks, height, axes = false) {
  return Widget.chart(weeks.map((w) => ({ x: shortDate(w.start), y: Number(toUnits(w.distance).toFixed(1)) })), { kind: "bar", color: ACCENT, axes, frame: { height } });
}

function windowLine(w, font = "caption2") {
  if (!w?.best) {
    return Widget.text(w?.expired ? "Open Run Lab for today's run window" : "Open Run Lab for a run window", { font, color: "secondary", lineLimit: 1, minimumScale: 0.7 });
  }
  return Widget.hstack([
    Widget.symbol(w.best.symbol, { size: 11, color: windowColor(w.best.score), fallback: "🌤" }),
    Widget.text(`Run at ${hourLabel(w.best.date)} · ${Math.round(w.best.temp)}° · ${Math.round(w.best.pop * 100)}% rain`, { font, lineLimit: 1, minimumScale: 0.7 }),
  ], { spacing: 4 });
}

function emptyWidget(family) {
  const error = Storage.get("lastError");
  return Widget.vstack([
    Widget.symbol("figure.run", { size: family === "rectangular" ? 16 : 26, color: "orange", fallback: "🏃" }),
    Widget.text(error ?? "Open Run Lab once to read your runs.", { font: "caption", color: "secondary", align: "center", lineLimit: 3, minimumScale: 0.7 }),
  ], { spacing: 6, url: APP_LINK });
}

Script.widget(({ family }) => {
  if (!Storage.get("synced")) return { content: emptyWidget(family), refreshAfter: 30 * 60 };
  const s = stats();
  const w = currentWindows();
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  let content;

  switch (family) {
    case "rectangular":
      content = Widget.vstack([
        Widget.hstack([
          Widget.symbol("figure.run", { size: 12, fallback: "🏃" }),
          Widget.text(`This week ${fmtDist(s.thisWeek.distance)}`, { font: "headline", lineLimit: 1, minimumScale: 0.7 }),
        ], { spacing: 4 }),
        Widget.text(s.change == null ? `${s.thisWeek.runs} run${s.thisWeek.runs === 1 ? "" : "s"}` : `${s.change >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(s.change))}% vs last week · ${s.thisWeek.runs} run${s.thisWeek.runs === 1 ? "" : "s"}`, { font: "caption", lineLimit: 1 }),
        Widget.text(w?.best ? `Best hour ${hourLabel(w.best.date)} · ${Math.round(w.best.temp)}°` : `Recent pace ${fmtPace(s.recentPace)}`, { font: "caption2", lineLimit: 1 }),
      ], { alignment: "leading", spacing: 1 });
      break;

    case "small":
      content = Widget.vstack([
        Widget.hstack([
          Widget.symbol("figure.run", { size: 12, color: "orange", fallback: "🏃" }),
          Widget.text("THIS WEEK", { font: "caption2", weight: "bold", color: "secondary" }),
        ], { spacing: 4 }),
        Widget.hstack([
          Widget.text(fmtNum(toUnits(s.thisWeek.distance)), { font: 36, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.5 }),
          Widget.text(unitLabel(), { font: "caption", weight: "medium", color: "secondary" }),
        ], { spacing: 3, alignment: "bottom" }),
        changeBadge(s.change),
        weeklyChart(s.weeks.slice(-8), 30),
        Widget.spacer(),
        windowLine(w),
      ], { alignment: "leading", spacing: 3, url: APP_LINK, frame: fill });
      break;

    case "medium":
      content = Widget.hstack([
        Widget.vstack([
          Widget.text("THIS WEEK", { font: "caption2", weight: "bold", color: "secondary" }),
          Widget.hstack([
            Widget.text(fmtNum(toUnits(s.thisWeek.distance)), { font: 34, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.5 }),
            Widget.text(unitLabel(), { font: "caption", weight: "medium", color: "secondary" }),
          ], { spacing: 3, alignment: "bottom" }),
          changeBadge(s.change),
          Widget.spacer(),
          Widget.text(`Last week ${fmtDist(s.lastWeek?.distance ?? 0)}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
          Widget.text(`Pace ${fmtPace(s.recentPace)}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
        ], { alignment: "leading", spacing: 2, padding: 10, background: TILE_BG, cornerRadius: 14, frame: { width: 132, maxHeight: "infinity", alignment: "topLeading" } }),
        Widget.vstack([
          Widget.text(`Last ${WEEKS} weeks`, { font: "caption2", weight: "semibold", color: "secondary" }),
          weeklyChart(s.weeks, 60),
          Widget.spacer(),
          windowLine(w, "caption"),
        ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      ], { spacing: 10, url: APP_LINK, frame: fill });
      break;

    default: { // large
      const pace = paceSeries().slice(-20);
      const record = (label, value, sub) => Widget.vstack([
        Widget.text(label, { font: "caption2", color: "secondary" }),
        Widget.text(value, { font: "subheadline", weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
        Widget.text(sub, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.6 }),
      ], { alignment: "leading", spacing: 1, padding: 8, background: TILE_BG, cornerRadius: 10, frame: { maxWidth: "infinity", alignment: "leading" } });

      content = Widget.vstack([
        Widget.hstack([
          Widget.vstack([
            Widget.text("THIS WEEK", { font: "caption2", weight: "bold", color: "secondary" }),
            Widget.text(fmtDist(s.thisWeek.distance), { font: "title2", weight: "bold", design: "rounded" }),
            changeBadge(s.change),
          ], { alignment: "leading", spacing: 1 }),
          Widget.spacer(),
          Widget.vstack([
            Widget.text("LAST WEEK", { font: "caption2", weight: "bold", color: "secondary" }),
            Widget.text(fmtDist(s.lastWeek?.distance ?? 0), { font: "title3", weight: "semibold", design: "rounded" }),
            Widget.text(`${s.count} runs in 90 days`, { font: "caption2", color: "secondary" }),
          ], { alignment: "trailing", spacing: 1 }),
        ]),
        Widget.text(`Weekly distance (${unitLabel()})`, { font: "caption2", weight: "semibold", color: "secondary" }),
        weeklyChart(s.weeks, 70),
        Widget.text(`Pace, last ${pace.length} runs (min/${unitLabel()})`, { font: "caption2", weight: "semibold", color: "secondary" }),
        pace.length >= 2
          ? Widget.chart(pace.map((p) => ({ x: p.x, y: p.y })), { kind: "line", smooth: true, color: "#0EA5E9", axes: false, frame: { height: 44 } })
          : Widget.text("Two or more runs are needed for a trend.", { font: "caption2", color: "secondary" }),
        Widget.hstack([
          record("Longest", s.longest ? fmtDist(s.longest.distance) : "–", s.longest ? shortDate(s.longest.start) : ""),
          record("5k best", s.best5 ? fmtDuration(s.best5.duration) : "–", s.best5 ? shortDate(s.best5.start) : "none within 2%"),
          record("10k best", s.best10 ? fmtDuration(s.best10.duration) : "–", s.best10 ? shortDate(s.best10.start) : "none within 2%"),
        ], { spacing: 6 }),
        Widget.spacer(),
        windowLine(w, "caption"),
      ], { alignment: "leading", spacing: 5, url: APP_LINK, frame: fill });
    }
  }
  return { content, refreshAfter: 30 * 60 };
});

// ───────────────────────── Mini-app

let openedOnce = false;

Script.action("sync", async () => { await sync(); });
Script.action("weather", refreshWeather);
Script.action("units", ({ value }) => Storage.set("settings", { ...settings(), units: value }));
Script.action("goal", ({ value }) => Storage.set("settings", { ...settings(), weeklyGoalKm: value }));

function overviewPane(s, w) {
  const goalMetres = settings().weeklyGoalKm * 1000;
  const weatherError = Storage.get("weatherError");
  return Widget.vstack([
    Widget.card([
      Widget.hstack([
        Widget.text(fmtDist(s.thisWeek.distance), { font: "largeTitle", weight: "bold", design: "rounded" }),
        Widget.spacer(),
        changeBadge(s.change, "subheadline"),
      ], { alignment: "bottom" }),
      Widget.progress(clamp(s.thisWeek.distance / goalMetres, 0, 1), { color: "orange" }),
      Widget.text(`${Math.round(clamp(s.thisWeek.distance / goalMetres, 0, 1) * 100)}% of your ${fmtDist(goalMetres, 0)} weekly goal · ${s.thisWeek.runs} run${s.thisWeek.runs === 1 ? "" : "s"} · ${fmtDuration(s.thisWeek.duration)}`, { font: "caption", color: "secondary" }),
      Widget.text(`Last week ${fmtDist(s.lastWeek?.distance ?? 0)} in ${s.lastWeek?.runs ?? 0} run${s.lastWeek?.runs === 1 ? "" : "s"} · recent pace ${fmtPace(s.recentPace)}`, { font: "caption", color: "secondary" }),
    ], { title: "This week", symbol: "figure.run", color: "orange" }),
    Widget.card([
      w?.hours?.length
        ? Widget.vstack([
            Widget.hstack([
              Widget.symbol(w.best.symbol, { size: 28, color: windowColor(w.best.score), fallback: "🌤" }),
              Widget.vstack([
                Widget.text(`${hourLabel(w.best.date)} · ${windowLabel(w.best.score)} (${w.best.score})`, { font: "headline" }),
                Widget.text(`${Math.round(w.best.temp)}° feels like · ${Math.round(w.best.pop * 100)}% rain · wind ${Math.round(w.best.wind)} km/h · UV ${Math.round(w.best.uv)}`, { font: "caption", color: "secondary" }),
              ], { alignment: "leading", spacing: 2 }),
            ], { spacing: 10 }),
            Widget.chart(w.hours.map((h) => ({ x: hourLabel(h.date), y: h.score })), { kind: "bar", color: "orange", range: [0, 100], frame: { height: 150 } }),
            Widget.list(w.hours.filter((h) => h !== w.best).sort((a, b) => b.score - a.score).slice(0, 3).map((h) => ({
              title: hourLabel(h.date), subtitle: `${Math.round(h.temp)}° · ${Math.round(h.pop * 100)}% rain · wind ${Math.round(h.wind)} km/h`,
              symbol: h.symbol, color: windowColor(h.score), detail: `${windowLabel(h.score)} ${h.score}`,
            })), { title: "Also good", style: "plain" }),
            Widget.hstack([
              Widget.text("Updated", { font: "caption2", color: "secondary" }),
              Widget.date(w.time, { style: "relative", font: "caption2", color: "secondary" }),
              Widget.spacer(),
              Widget.text(w.credit?.text ?? "Apple Weather", { font: "caption2", color: "secondary", url: w.credit?.url }),
            ], { spacing: 4 }),
          ], { alignment: "leading", spacing: 10 })
        : Widget.text(weatherError ? `Weather: ${weatherError}` : "Tap Refresh to score the next 12 hours for where you are.", { font: "footnote", color: weatherError ? "red" : "secondary" }),
      Widget.button("Refresh window", "weather", null, { style: "bordered" }),
    ], { title: "Good run window", subtitle: "Next 12 hours, from Apple Weather", symbol: "cloud.sun.fill", color: "blue" }),
  ], { alignment: "leading", spacing: 14 });
}

function trendsPane(s) {
  const pace = paceSeries();
  return Widget.vstack([
    Widget.text(`Weekly distance, last ${WEEKS} weeks (${unitLabel()})`, { font: "headline" }),
    weeklyChart(s.weeks, 200, true),
    Widget.text(`Pace per run (min/${unitLabel()}, lower is faster)`, { font: "headline" }),
    pace.length >= 2
      ? Widget.chart(pace.map((p) => ({ x: p.x, y: p.y })), { kind: "line", smooth: true, color: "#0EA5E9", frame: { height: 200 } })
      : Widget.text("Two or more runs of at least 1 km are needed for a pace trend.", { font: "footnote", color: "secondary" }),
    Widget.list(runs().slice(-8).reverse().map((r) => ({
      title: `${fmtDist(r.distance)} · ${fmtDuration(r.duration)}`, subtitle: shortDate(r.start), symbol: "figure.run", color: "orange", detail: fmtPace(paceOf(r)),
    })), { title: "Recent runs" }),
  ], { alignment: "leading", spacing: 12 });
}

function recordsPane(s) {
  const row = (title, value, sub, symbol) => ({ title, subtitle: sub, symbol, color: "orange", detail: value });
  return Widget.vstack([
    Widget.list([
      row("Longest run", s.longest ? fmtDist(s.longest.distance) : "–", s.longest ? `${shortDate(s.longest.start)} · ${fmtDuration(s.longest.duration)}` : "No runs yet", "arrow.left.and.right"),
      row("5k best", s.best5 ? fmtDuration(s.best5.duration) : "–", s.best5 ? `${shortDate(s.best5.start)} · ${fmtPace(paceOf(s.best5))}` : "No run within 2% of 5 km", "5.circle.fill"),
      row("10k best", s.best10 ? fmtDuration(s.best10.duration) : "–", s.best10 ? `${shortDate(s.best10.start)} · ${fmtPace(paceOf(s.best10))}` : "No run within 2% of 10 km", "10.circle.fill"),
      row("VO₂max", s.vo2 ? fmtNum(s.vo2.average, 1) : "–", s.vo2 ? `ml/kg/min · average of ${s.vo2.count} reading${s.vo2.count === 1 ? "" : "s"} · best ${fmtNum(s.vo2.max, 1)}` : "No readings in Health for 90 days", "lungs.fill"),
    ], { title: "Personal bests, last 90 days" }),
    Widget.list([
      row("Runs", String(s.count), "in the last 90 days", "number"),
      row("Distance", fmtDist(s.total), `${fmtDist(s.count ? s.total / s.count : 0)} per run`, "road.lanes"),
      row("Time", fmtDuration(s.time), `${fmtDuration(s.count ? s.time / s.count : 0)} per run`, "clock"),
      row("Energy", `${Math.round(runs().reduce((a, r) => a + (r.energy ?? 0), 0)).toLocaleString(Script.env.locale)} kcal`, "active energy", "flame.fill"),
    ], { title: "Totals" }),
  ], { alignment: "leading", spacing: 12 });
}

function settingsPane() {
  const s = settings();
  const error = Storage.get("lastError");
  return Widget.vstack([
    Widget.picker([{ label: "From locale", value: "auto" }, { label: "Kilometres", value: "km" }, { label: "Miles", value: "mi" }], s.units, "units", null, { style: "segmented", label: "Units" }),
    Widget.stepper(`Weekly goal: ${s.weeklyGoalKm} km`, s.weeklyGoalKm, "goal", null, { min: 5, max: 150, step: 5 }),
    Widget.button("Sync Health now", "sync", null, { style: "prominent", color: "orange" }),
    Storage.get("synced") ? Widget.hstack([Widget.text("Last synced", { font: "caption", color: "secondary" }), Widget.date(Storage.get("synced"), { style: "relative", font: "caption", color: "secondary" })], { spacing: 4 }) : null,
    error ? Widget.text(`Health: ${error}`, { font: "caption", color: "red" }) : null,
    Widget.divider(),
    Widget.text("Health workouts and VO₂max stay on this device. Only the run-window feature uses your location, and only to ask Apple Weather for a forecast. Personal bests use runs whose distance is within 2% of 5 km or 10 km.", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 14 });
}

Script.ui(async () => {
  if (!openedOnce) {
    openedOnce = true;
    if (!Storage.get("synced") || Date.now() - Storage.get("synced") > 15 * 60 * 1000) await sync();
    const w = Storage.get("windows");
    if (!w || Date.now() - w.time > WEATHER_FRESH_MS) await refreshWeather();
  }
  const s = stats();
  const w = currentWindows();

  if (!Storage.get("synced") || !s.count) {
    return {
      title: "Run Lab",
      content: Widget.vstack([
        Widget.symbol("figure.run", { size: 56, color: "orange", fallback: "🏃" }),
        Widget.text(Storage.get("synced") ? "No runs in the last 90 days" : "Reading Health…", { font: "title2", weight: "bold" }),
        Widget.text(Storage.get("synced") ? "Running workouts recorded by Apple Watch or another app that writes to Health will show up here." : "Allow Workouts when iOS asks.", { color: "secondary", align: "center" }),
        settingsPane(),
      ], { spacing: 16, padding: 20 }),
    };
  }

  return {
    title: "Run Lab",
    content: Widget.vstack([
      Widget.tabs([
        { title: "Today", symbol: "sun.max.fill", content: overviewPane(s, w) },
        { title: "Trends", symbol: "chart.xyaxis.line", content: trendsPane(s) },
        { title: "Records", symbol: "trophy.fill", content: recordsPane(s) },
        { title: "Settings", symbol: "gearshape.fill", content: settingsPane() },
      ], { selected: 0 }),
    ], { alignment: "leading", spacing: 16, padding: 16 }),
  };
});
