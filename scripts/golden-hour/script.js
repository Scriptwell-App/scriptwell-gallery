// @name        Golden Hour
// @description Golden hour and blue hour for where you are: a live countdown, a light-quality strip for the day built from Apple Weather cloud and UV forecasts, sunrise, sunset and day length, in every widget size and a mini-app
// @permissions location
// @widget      small, medium, large, circular, rectangular, inline
// @icon        sun.horizon.fill
// @color       #F59E0B
// @version     1.0.0
// @author      va4w
// @category    weather

// How it works
// • Run it once in the app (or open the mini-app). It takes a coarse location fix and asks Apple Weather
//   for sunrise and sunset (yesterday, today, tomorrow) and the hourly cloud cover and UV index.
//   The answer is cached in Storage; background runs and the mini-app refresh it every few hours.
// • Golden hour is worked out from the sun's elevation (−4° to 6°) and blue hour from −6° to −4°,
//   using a standard solar-position formula on the device, so widgets never call Weather themselves.
// • Each daylight hour gets a light-quality score: low sun scores high, thin or broken cloud helps,
//   overcast and strong UV hurt. The strip in the widgets and the mini-app shows the day at a glance.
// • Only your coordinates (rounded to about a kilometre) go to Apple Weather and Apple's geocoder
//   for the place name. Nothing else leaves the device.

// ─────────────────────────────────────────── Constants

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MINUTE = 60_000;
const STALE_MS = 3 * HOUR;
const RAD = Math.PI / 180;
const SUN_EDGE = -0.833;            // elevation of sunrise and sunset, allowing for refraction

const BANDS = {
  classic: { label: "Classic", low: -4, high: 6 },
  wide: { label: "Wide", low: -6, high: 10 },
};
const BLUE_LOW = -6;

const locale = Script.env.locale;
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const SKY = {
  gold: Widget.gradient(["#F59E0B", "#DB2777", "#4C1D95"], { direction: "topLeadingToBottomTrailing" }),
  day: Widget.gradient(["#0EA5E9", "#2563EB", "#1E3A8A"], { direction: "topToBottom" }),
  blue: Widget.gradient(["#1E3A8A", "#312E81", "#0F172A"], { direction: "topToBottom" }),
  night: Widget.gradient(["#1E1B4B", "#0F172A", "#020617"], { direction: "topToBottom" }),
};
const SOFT = "#FFFFFFB3";
const DIM = "#FFFFFF2E";
const TILE_BG = { light: "#F1F5F9", dark: "#1E293B" };

// ─────────────────────────────────────────── Settings and formatting

const settings = () => ({ band: "classic", ...Storage.get("settings", {}) });
const band = () => BANDS[settings().band] ?? BANDS.classic;

const fmtTime = (ms) => (ms == null ? "–" : new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }));
const dayKey = (d) => new Date(d).toLocaleDateString("en-CA");

function fmtSpan(ms, { seconds = false } = {}) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} m`;
  if (m > 0 || !seconds) return `${m} m`;
  return `${s} s`;
}

function startOfDay(ms = Date.now()) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ─────────────────────────────────────────── Solar position

// Elevation of the sun in degrees. Low-precision algorithm from the Astronomical Almanac, good to ~0.01°.
function solarElevation(ms, lat, lon) {
  const n = ms / DAY + 2440587.5 - 2451545.0;                         // days since J2000.0
  const L = (280.46 + 0.9856474 * n) % 360;                           // mean longitude
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;                  // mean anomaly
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;                         // obliquity
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const ha = (gmst * 15 + lon) * RAD - ra;                            // hour angle
  const phi = lat * RAD;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha)) / RAD;
}

// Moments in one local day when the sun crosses the thresholds that matter, by scanning each minute
// and interpolating the crossing. Any of them is null when the sun never gets there that day.
const phaseMemo = new Map();

function dayPhases(day, lat, lon) {
  const key = `${day}:${settings().band}:${lat}:${lon}`;
  if (!phaseMemo.has(key)) phaseMemo.set(key, computePhases(day, lat, lon));
  return phaseMemo.get(key);
}

function computePhases(day, lat, lon) {
  const { low, high } = band();
  const levels = { blue: BLUE_LOW, gold: low, edge: SUN_EDGE, high };
  const up = {}, down = {};
  let prev = solarElevation(day, lat, lon);
  let noon = { t: day, el: prev };
  for (let i = 1; i <= 1440; i++) {
    const t = day + i * MINUTE;
    const el = solarElevation(t, lat, lon);
    if (el > noon.el) noon = { t, el };
    for (const [name, level] of Object.entries(levels)) {
      if (prev < level && el >= level && up[name] == null) up[name] = t - MINUTE * (1 - (level - prev) / (el - prev));
      if (prev >= level && el < level) down[name] = t - MINUTE * (1 - (prev - level) / (prev - el));
    }
    prev = el;
  }
  return {
    day,
    blueStart: up.blue ?? null, goldStart: up.gold ?? null, sunrise: up.edge ?? null, goldEnd: up.high ?? null,
    noon: noon.t, noonElevation: noon.el,
    eveStart: down.high ?? null, sunset: down.edge ?? null, eveEnd: down.gold ?? null, blueEnd: down.blue ?? null,
  };
}

// Golden-hour windows for a day, morning first. A window needs both ends.
function goldenWindows(p) {
  const list = [];
  if (p.goldStart != null && p.goldEnd != null && p.goldEnd > p.goldStart) list.push({ start: p.goldStart, end: p.goldEnd, when: "morning" });
  if (p.eveStart != null && p.eveEnd != null && p.eveEnd > p.eveStart) list.push({ start: p.eveStart, end: p.eveEnd, when: "evening" });
  return list;
}

// The window happening now, or the next one within three days.
function nextGolden(now, lat, lon) {
  const today = startOfDay(now);
  for (let d = -1; d <= 3; d++) {
    for (const w of goldenWindows(dayPhases(today + d * DAY, lat, lon))) {
      if (w.end > now) return { ...w, active: w.start <= now };
    }
  }
  return null;
}

function phaseName(el, now, p) {
  const { low, high } = band();
  if (el >= high) return "Daylight";
  if (el >= low) return "Golden hour";
  if (el >= BLUE_LOW) return "Blue hour";
  if (p.sunrise != null && now < p.sunrise) return "Night, before dawn";
  return "Night";
}

const skyFor = (phase) => (phase === "Golden hour" ? SKY.gold : phase === "Daylight" ? SKY.day : phase === "Blue hour" ? SKY.blue : SKY.night);

// ─────────────────────────────────────────── Light quality

// 0 for night. Otherwise a 1–100 score from the sun's height, cloud cover and UV.
function lightScore(el, cloud, uv) {
  if (el < BLUE_LOW) return 0;
  if (el < band().low) return 45;                                  // blue hour: lovely, but dim
  const sun = el <= band().high ? 1 : el <= 15 ? 0.85 : el <= 30 ? 0.65 : el <= 50 ? 0.45 : 0.3;
  const sky = cloud == null ? 0.9 : cloud < 0.2 ? 0.85 : cloud <= 0.6 ? 1 : cloud <= 0.85 ? 0.65 : 0.4;
  const glare = uv == null ? 1 : uv <= 2 ? 1 : uv <= 5 ? 0.9 : uv <= 7 ? 0.75 : 0.6;
  return Math.max(1, Math.round(100 * sun * sky * glare));
}

function scoreColor(score) {
  if (score === 0) return "#1E293B";
  if (score < 35) return "#94A3B8";
  if (score < 55) return "#FDE68A";
  if (score < 75) return "#FBBF24";
  return "#F97316";
}

const scoreWord = (score) => (score === 0 ? "Dark" : score < 35 ? "Flat" : score < 55 ? "Soft" : score < 75 ? "Good" : "Superb");

// One score per hour of a local day, using the cached forecast for that hour when there is one.
function hourScores(day, lat, lon, hourly) {
  return Array.from({ length: 24 }, (_, h) => {
    const t = day + h * HOUR + 30 * MINUTE;
    const el = solarElevation(t, lat, lon);
    const f = hourly?.find((x) => Math.abs(x.t - (day + h * HOUR)) < 30 * MINUTE);
    return { hour: h, t, el, score: lightScore(el, f?.cc, f?.uv), cloud: f?.cc ?? null, uv: f?.uv ?? null };
  });
}

// ─────────────────────────────────────────── Data

const cache = () => Storage.get("sun");

async function getPlace() {
  try {
    const here = await Location.current({ accuracy: "kilometer" });
    const place = { latitude: Number(here.latitude.toFixed(3)), longitude: Number(here.longitude.toFixed(3)) };
    Storage.set("place", place);
    return place;
  } catch (error) {
    const saved = Storage.get("place") ?? cache()?.place;
    if (saved) return saved;
    throw error;
  }
}

async function refresh() {
  const place = await getPlace();
  const today = startOfDay();
  const previous = cache();
  const data = { time: Date.now(), place, city: previous?.city ?? null, credit: previous?.credit ?? null, days: previous?.days ?? [], hourly: previous?.hourly ?? [], weatherError: null };

  try {
    const [daily, hourly] = await Promise.all([
      Weather.daily(place, { start: new Date(today - DAY), days: 3 }),
      Weather.hourly(place, { start: new Date(today), hours: 48 }),
    ]);
    data.days = daily.map((d) => ({
      key: dayKey(d.date),
      sunrise: d.sunrise ? new Date(d.sunrise).getTime() : null,
      sunset: d.sunset ? new Date(d.sunset).getTime() : null,
    }));
    data.hourly = hourly.map((h) => ({ t: new Date(h.date).getTime(), cc: h.cloudCover ?? null, uv: h.uvIndex ?? null }));
    data.weatherTime = Date.now();
  } catch (error) {
    data.weatherError = error.message;
    data.weatherTime = previous?.weatherTime ?? null;
  }

  if (!data.credit) {
    try { data.credit = await Weather.attribution(); } catch { data.credit = { text: "Apple Weather", url: "https://weatherkit.apple.com/legal-attribution.html" }; }
  }
  if (Script.env.mode !== "widget") {
    try {
      const [p] = await Location.reverseGeocode(place);
      if (p?.city || p?.name) data.city = p.city ?? p.name;
    } catch { /* keep the old name */ }
  }

  Storage.set("sun", data);
  return data;
}

// Everything the screens need for one moment, from the cache plus the solar maths.
function situation(now = Date.now()) {
  const data = cache();
  if (!data?.place) return null;
  const { latitude: lat, longitude: lon } = data.place;
  const today = startOfDay(now);
  const phases = dayPhases(today, lat, lon);
  const tomorrow = dayPhases(today + DAY, lat, lon);
  const byKey = (ms) => data.days.find((d) => d.key === dayKey(ms));
  const sun = byKey(today), yesterday = byKey(today - DAY), next = byKey(today + DAY);
  const sunrise = sun?.sunrise ?? phases.sunrise;
  const sunset = sun?.sunset ?? phases.sunset;
  const length = sunrise != null && sunset != null ? sunset - sunrise : null;
  const prevLength = yesterday?.sunrise != null && yesterday?.sunset != null ? yesterday.sunset - yesterday.sunrise : null;
  const el = solarElevation(now, lat, lon);
  const scores = hourScores(today, lat, lon, data.hourly);
  const current = scores[new Date(now).getHours()];
  return {
    data, lat, lon, now, phases, tomorrow, sunrise, sunset, length, prevLength,
    tomorrowSunrise: next?.sunrise ?? tomorrow.sunrise,
    elevation: el,
    phase: phaseName(el, now, phases),
    golden: nextGolden(now, lat, lon),
    scores,
    score: lightScore(el, current?.cloud, current?.uv),
    stale: Date.now() - data.time > STALE_MS,
  };
}

function countdownText(s, now = s.now) {
  const g = s.golden;
  if (!g) return "No golden hour in the next few days";
  if (g.active) return `Golden hour now · ${fmtSpan(g.end - now)} left`;
  return `Golden hour in ${fmtSpan(g.start - now)}`;
}

function lengthText(s) {
  if (s.length == null) return "Day length unknown";
  let text = `Day length ${fmtSpan(s.length)}`;
  if (s.prevLength != null) {
    const diff = s.length - s.prevLength;
    const amount = Math.abs(diff) < MINUTE ? `${Math.round(Math.abs(diff) / 1000)} s` : fmtSpan(Math.abs(diff));
    text += diff >= 0 ? ` · ${amount} longer than yesterday` : ` · ${amount} shorter than yesterday`;
  }
  return text;
}

function summaryText(s) {
  const g = s.golden;
  const when = g ? `${g.active ? "Golden hour is on now until" : "Next golden hour"} ${g.active ? fmtTime(g.end) : `${fmtTime(g.start)}–${fmtTime(g.end)}`}${!g.active && startOfDay(g.start) !== startOfDay(s.now) ? " tomorrow" : ""}` : "No golden hour in the next few days";
  return `${when}. Sunrise ${fmtTime(s.sunrise)}, sunset ${fmtTime(s.sunset)}. ${lengthText(s)}. Light now: ${scoreWord(s.score)} (${s.score}/100). ${s.data.credit?.text ?? "Apple Weather"}`;
}

// ─────────────────────────────────────────── Entry points: run and background

Script.run(async () => {
  try { await refresh(); } catch (error) {
    if (!cache()) return `Could not load: ${error.message}`;
  }
  return summaryText(situation());
});

Script.background(async () => {
  try { await refresh(); } catch (error) { Storage.set("lastError", `${new Date().toISOString()} ${error.message}`); }
});

// ─────────────────────────────────────────── Shared pieces

// 24 cells coloured by light quality, with sunrise and sunset marked underneath.
function strip(s, { height = 8, markers = true, labels = true, onDark = true } = {}) {
  const sunriseHour = s.sunrise != null ? new Date(s.sunrise).getHours() : -1;
  const sunsetHour = s.sunset != null ? new Date(s.sunset).getHours() : -1;
  const nowHour = new Date(s.now).getHours();
  const cells = Widget.hstack(s.scores.map((h) => ({
    type: "stack", direction: "vertical", children: [],
    background: h.score === 0 ? (onDark ? DIM : "#1E293B33") : scoreColor(h.score),
    cornerRadius: 2, opacity: h.hour === nowHour ? 1 : 0.85,
    frame: { maxWidth: "infinity", height: h.hour === nowHour ? height + 4 : height },
  })), { spacing: 1, alignment: "bottom" });
  const tone = onDark ? SOFT : "secondary";
  const marks = markers ? Widget.hstack(s.scores.map((h) => Widget.vstack([
    h.hour === sunriseHour ? Widget.symbol("sunrise.fill", { size: 8, color: onDark ? "white" : "orange", fallback: "↑" })
      : h.hour === sunsetHour ? Widget.symbol("sunset.fill", { size: 8, color: onDark ? "white" : "orange", fallback: "↓" }) : null,
  ], { frame: { maxWidth: "infinity", height: 10 } })), { spacing: 1 }) : null;
  const axis = labels ? Widget.hstack([0, 6, 12, 18, 24].flatMap((h, i) => [
    i ? Widget.spacer() : null,
    Widget.text(String(h), { font: 8, color: tone }),
  ])) : null;
  return Widget.vstack([cells, marks, axis], { spacing: 1 });
}

function countdownBlock(s, { font = 28, light = true } = {}) {
  const g = s.golden;
  const tone = light ? "white" : "primary";
  const soft = light ? SOFT : "secondary";
  if (!g) return Widget.text("No golden hour soon", { font: "headline", color: tone });
  return Widget.vstack([
    Widget.text(g.active ? "GOLDEN HOUR · NOW" : "NEXT GOLDEN HOUR", { font: "caption2", weight: "bold", color: soft }),
    Widget.date(g.active ? g.end : g.start, { style: "relative", font, weight: "bold", design: "rounded", color: tone, lineLimit: 1, minimumScale: 0.5 }),
    Widget.text(g.active ? `ends ${fmtTime(g.end)}` : `${fmtTime(g.start)}–${fmtTime(g.end)}${startOfDay(g.start) !== startOfDay(s.now) ? " tomorrow" : ` · ${g.when}`}`, { font: "caption", color: soft, lineLimit: 1, minimumScale: 0.7 }),
  ], { alignment: "leading", spacing: 1 });
}

function sunRow(s, light = true) {
  const tone = light ? "white" : "primary";
  return Widget.hstack([
    Widget.symbol("sunrise.fill", { size: 11, color: tone, fallback: "↑" }),
    Widget.text(fmtTime(s.sunrise), { font: "caption", weight: "medium", color: tone }),
    Widget.spacer(),
    Widget.symbol("sunset.fill", { size: 11, color: tone, fallback: "↓" }),
    Widget.text(fmtTime(s.sunset), { font: "caption", weight: "medium", color: tone }),
  ], { spacing: 3 });
}

function timelineRows(s, highlightNext = true) {
  const p = s.phases;
  const items = [
    { title: "Blue hour", t: p.blueStart, end: p.goldStart, symbol: "moon.stars.fill", color: "indigo" },
    { title: "Golden hour", t: p.goldStart, end: p.goldEnd, symbol: "sun.horizon.fill", color: "orange" },
    { title: "Sunrise", t: s.sunrise, symbol: "sunrise.fill", color: "yellow" },
    { title: "Solar noon", t: p.noon, symbol: "sun.max.fill", color: "yellow", note: `sun ${Math.round(p.noonElevation)}° high` },
    { title: "Golden hour", t: p.eveStart, end: p.eveEnd, symbol: "sun.horizon.fill", color: "orange" },
    { title: "Sunset", t: s.sunset, symbol: "sunset.fill", color: "pink" },
    { title: "Blue hour", t: p.eveEnd, end: p.blueEnd, symbol: "moon.stars.fill", color: "indigo" },
  ].filter((i) => i.t != null);
  const nextIndex = highlightNext ? items.findIndex((i) => (i.end ?? i.t) > s.now) : -1;
  return items.map((i, idx) => ({
    title: i.title,
    symbol: i.symbol,
    color: idx === nextIndex ? i.color : "secondary",
    subtitle: i.end != null ? `${fmtTime(i.t)} – ${fmtTime(i.end)}` : fmtTime(i.t),
    detail: idx === nextIndex ? (i.t <= s.now ? "now" : "next") : i.note ?? "",
  }));
}

function placeholder(family) {
  if (family === "inline") return Widget.text("Golden Hour: open once to set up");
  if (family === "circular") return Widget.text("Open", { font: "caption" });
  return Widget.vstack([
    Widget.symbol("sun.horizon.fill", { size: 24, color: "orange", fallback: "🌅" }),
    Widget.text("Open Golden Hour once to find your location", { font: "caption", color: "secondary", align: "center", lineLimit: 3 }),
  ], { spacing: 6, url: APP_LINK });
}

// Lock Screen text cannot tick, so give iOS a timeline of entries five minutes apart.
function lockTimeline(render) {
  const entries = [];
  const start = Date.now();
  for (let i = 0; i < 36; i++) {
    const t = i === 0 ? start : start + i * 5 * MINUTE;
    const s = situation(t);
    entries.push({ date: new Date(t), content: render(s, t) });
  }
  return { timeline: entries, refreshAfter: 90 * 60 };
}

// ─────────────────────────────────────────── Widget

Script.widget(({ family }) => {
  const s = situation();
  if (!s) return placeholder(family);
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };

  if (family === "inline") {
    return lockTimeline((x, t) => Widget.text(x.golden ? countdownText(x, t) : "No golden hour soon"));
  }

  if (family === "circular") {
    return lockTimeline((x, t) => {
      const g = x.golden;
      if (!g) return Widget.text("–", { font: "title2" });
      const minutes = Math.max(0, Math.round(((g.active ? g.end : g.start) - t) / MINUTE));
      const label = g.active ? `${minutes}m` : minutes < 100 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
      const span = g.active ? g.end - g.start : 12 * HOUR;
      const value = g.active ? (g.end - t) / span : Math.max(0.03, 1 - (g.start - t) / span);
      return Widget.progress(Math.max(0, Math.min(1, value)), { style: "ring", label });
    });
  }

  if (family === "rectangular") {
    const g = s.golden;
    return {
      content: Widget.vstack([
        Widget.hstack([
          Widget.symbol("sun.horizon.fill", { size: 11, fallback: "🌅" }),
          Widget.text(g?.active ? "GOLDEN HOUR NOW" : "GOLDEN HOUR", { font: "caption2", weight: "bold" }),
        ], { spacing: 3 }),
        g ? Widget.date(g.active ? g.end : g.start, { style: "relative", font: "headline" }) : Widget.text("none soon", { font: "headline" }),
        Widget.text(`↑ ${fmtTime(s.sunrise)} · ↓ ${fmtTime(s.sunset)} · ${s.length != null ? fmtSpan(s.length) : "–"}`, { font: "caption", lineLimit: 1, minimumScale: 0.7 }),
      ], { alignment: "leading", spacing: 1 }),
      refreshAfter: 30 * 60,
    };
  }

  const bg = skyFor(s.phase);
  let content;

  if (family === "small") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("sun.horizon.fill", { size: 14, color: "white", fallback: "🌅" }),
        Widget.text(s.phase, { font: "caption2", weight: "semibold", color: SOFT, lineLimit: 1, minimumScale: 0.7 }),
        Widget.spacer(),
      ], { spacing: 4 }),
      countdownBlock(s, { font: 24 }),
      Widget.spacer(),
      strip(s, { height: 6, markers: false, labels: false }),
      sunRow(s),
    ], { alignment: "leading", spacing: 4, padding: 12, background: bg, url: APP_LINK, frame: fill });
  } else if (family === "medium") {
    content = Widget.hstack([
      Widget.vstack([
        Widget.hstack([
          Widget.symbol("sun.horizon.fill", { size: 14, color: "white", fallback: "🌅" }),
          Widget.text(s.phase, { font: "caption2", weight: "semibold", color: SOFT, lineLimit: 1 }),
        ], { spacing: 4 }),
        countdownBlock(s, { font: 26 }),
        Widget.spacer(),
        sunRow(s),
      ], { alignment: "leading", spacing: 4, frame: { width: 138, maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack([
        Widget.hstack([
          Widget.text("LIGHT TODAY", { font: "caption2", weight: "bold", color: SOFT }),
          Widget.spacer(),
          Widget.text(`${scoreWord(s.score)} now`, { font: "caption2", weight: "semibold", color: "white" }),
        ]),
        strip(s, { height: 10 }),
        Widget.spacer(),
        Widget.text(lengthText(s).replace("Day length ", "Day "), { font: "caption2", color: SOFT, lineLimit: 2, minimumScale: 0.7 }),
        s.data.city ? Widget.text(s.data.city, { font: "caption2", color: SOFT, lineLimit: 1 }) : null,
      ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 12, padding: 14, background: bg, url: APP_LINK, frame: fill });
  } else {
    const best = [...s.scores].filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, 2).sort((a, b) => a.hour - b.hour);
    content = Widget.vstack([
      Widget.hstack([
        Widget.vstack([
          Widget.hstack([
            Widget.symbol("sun.horizon.fill", { size: 14, color: "white", fallback: "🌅" }),
            Widget.text(`${s.phase}${s.data.city ? ` · ${s.data.city}` : ""}`, { font: "caption2", weight: "semibold", color: SOFT, lineLimit: 1 }),
          ], { spacing: 4 }),
          countdownBlock(s, { font: 30 }),
        ], { alignment: "leading", spacing: 4 }),
        Widget.spacer(),
        Widget.vstack([
          Widget.text(String(s.score), { font: 30, weight: "bold", design: "rounded", color: "white" }),
          Widget.text(`${scoreWord(s.score)} light`, { font: "caption2", color: SOFT }),
        ], { alignment: "trailing", spacing: 0 }),
      ], { alignment: "top" }),
      Widget.vstack([
        Widget.text("LIGHT QUALITY TODAY", { font: "caption2", weight: "bold", color: SOFT }),
        strip(s, { height: 14 }),
        best.length ? Widget.text(`Best: ${best.map((h) => `${String(h.hour).padStart(2, "0")}:00 (${h.score})`).join(" · ")}`, { font: "caption2", color: SOFT, lineLimit: 1 }) : null,
      ], { alignment: "leading", spacing: 3, padding: 8, background: "#00000026", cornerRadius: 10 }),
      Widget.list(timelineRows(s).slice(0, 7), { style: "plain" }),
      Widget.spacer(),
      Widget.hstack([
        Widget.text(lengthText(s), { font: "caption2", color: SOFT, lineLimit: 1, minimumScale: 0.7 }),
        Widget.spacer(),
        Widget.text(s.data.credit?.text ?? "Apple Weather", { font: "caption2", color: SOFT, url: s.data.credit?.url }),
      ]),
    ], { alignment: "leading", spacing: 8, padding: 14, background: bg, url: APP_LINK, frame: fill });
  }

  // Redraw when the next phase change happens, or in 30 minutes at most.
  const g = s.golden;
  const nextChange = g ? (g.active ? g.end : g.start) : null;
  const refreshAt = new Date(Math.min(Date.now() + 30 * MINUTE, nextChange ?? Infinity) + 5_000);
  return { content, refreshAt };
});

// ─────────────────────────────────────────── Mini-app

Script.action("refresh", async () => {
  try {
    await refresh();
    Storage.set("lastError", null);
    await UI.haptic("success");
  } catch (error) {
    Storage.set("lastError", error.message);
    await UI.haptic("error");
  }
});

Script.action("band", ({ value }) => Storage.set("settings", { ...settings(), band: value }));

Script.action("share", async () => {
  const s = situation();
  if (s) await UI.share(summaryText(s));
});

function heroCard(s) {
  return Widget.vstack([
    Widget.hstack([
      Widget.symbol("sun.horizon.fill", { size: 18, color: "white", fallback: "🌅" }),
      Widget.text(`${s.phase} · sun ${s.elevation.toLocaleString(locale, { maximumFractionDigits: 0 })}°`, { font: "subheadline", weight: "semibold", color: "white" }),
      Widget.spacer(),
      Widget.text(s.data.city ?? "", { font: "caption", color: SOFT }),
    ], { spacing: 6 }),
    countdownBlock(s, { font: 40 }),
    s.golden ? Widget.hstack([
      Widget.text(s.golden.active ? "ends in" : "starts in", { font: "caption", color: SOFT }),
      Widget.date(s.golden.active ? s.golden.end : s.golden.start, { style: "timer", font: "caption", weight: "semibold", color: "white" }),
    ], { spacing: 4 }) : null,
    Widget.spacer(8),
    sunRow(s),
  ], { alignment: "leading", spacing: 6, padding: 16, background: skyFor(s.phase), cornerRadius: 18, frame: { maxWidth: "infinity", alignment: "leading" } });
}

function lightCard(s) {
  const best = [...s.scores].filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.hour - b.hour);
  const now = s.scores[new Date(s.now).getHours()];
  return Widget.card([
    strip(s, { height: 26, onDark: false }),
    Widget.hstack([
      ...[["Dark", 0], ["Flat", 20], ["Soft", 45], ["Good", 65], ["Superb", 90]].map(([word, v]) => Widget.hstack([
        { type: "stack", direction: "horizontal", children: [], background: v === 0 ? "#1E293B66" : scoreColor(v), cornerRadius: 2, frame: { width: 8, height: 8 } },
        Widget.text(word, { font: "caption2", color: "secondary" }),
      ], { spacing: 3 })),
    ], { spacing: 8 }),
    Widget.divider(),
    Widget.text(`Now: ${scoreWord(s.score)} (${s.score}/100)${now?.cloud != null ? ` · cloud ${Math.round(now.cloud * 100)}%` : ""}${now?.uv != null ? ` · UV ${now.uv}` : ""}`, { font: "footnote", weight: "medium" }),
    best.length ? Widget.list(best.map((h) => ({
      title: `${String(h.hour).padStart(2, "0")}:00 – ${String(h.hour + 1).padStart(2, "0")}:00`,
      subtitle: [h.cloud != null ? `cloud ${Math.round(h.cloud * 100)}%` : null, h.uv != null ? `UV ${h.uv}` : null, `sun ${Math.round(h.el)}°`].filter(Boolean).join(" · "),
      symbol: "camera.fill", color: "orange",
      detail: `${scoreWord(h.score)} ${h.score}`,
    })), { title: "Best hours for photos", style: "plain" }) : null,
    s.data.hourly?.length ? null : Widget.text("Cloud and UV are not loaded yet, so scores use the sun's height only.", { font: "caption2", color: "orange" }),
  ], { title: "Light quality today", subtitle: "low sun, broken cloud and gentle UV score highest", symbol: "camera.aperture", color: "orange" });
}

function dayCard(s) {
  const diff = s.length != null && s.prevLength != null ? s.length - s.prevLength : null;
  const tile = (title, value, sub) => Widget.vstack([
    Widget.text(title, { font: "caption2", color: "secondary" }),
    Widget.text(value, { font: "headline", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
    sub ? Widget.text(sub, { font: "caption2", color: "secondary", lineLimit: 1 }) : null,
  ], { alignment: "leading", spacing: 1, padding: 10, background: TILE_BG, cornerRadius: 12, frame: { maxWidth: "infinity", alignment: "leading" } });
  return Widget.card([
    Widget.hstack([
      tile("Sunrise", fmtTime(s.sunrise), s.tomorrowSunrise != null ? `tomorrow ${fmtTime(s.tomorrowSunrise)}` : null),
      tile("Sunset", fmtTime(s.sunset), s.tomorrow.sunset != null ? `tomorrow ${fmtTime(s.tomorrow.sunset)}` : null),
    ], { spacing: 8 }),
    Widget.hstack([
      tile("Day length", s.length != null ? fmtSpan(s.length) : "–", diff == null ? null : `${Math.abs(diff) < MINUTE ? `${Math.round(Math.abs(diff) / 1000)} s` : fmtSpan(Math.abs(diff))} ${diff >= 0 ? "longer" : "shorter"} than yesterday`),
      tile("Solar noon", fmtTime(s.phases.noon), `sun ${Math.round(s.phases.noonElevation)}° high`),
    ], { spacing: 8 }),
  ], { title: "The day", symbol: "sun.max.fill", color: "yellow" });
}

Script.ui(async () => {
  let s = situation();
  if (!s || s.stale) {
    try { await refresh(); Storage.set("lastError", null); s = situation(); }
    catch (error) { Storage.set("lastError", error.message); }
  }
  const error = Storage.get("lastError");

  if (!s) {
    return {
      title: "Golden Hour",
      content: Widget.vstack([
        Widget.symbol("sun.horizon.fill", { size: 60, color: "orange", fallback: "🌅" }),
        Widget.text("Where are you?", { font: "title2", weight: "bold" }),
        Widget.text(error ? `Could not find your location: ${error}` : "Allow location to work out sunrise, sunset and golden hour for where you are.", { font: "footnote", color: "secondary", align: "center" }),
        Widget.button("Find my location", "refresh", null, { style: "prominent", color: "orange" }),
      ], { spacing: 14, padding: 24 }),
    };
  }

  return {
    title: "Golden Hour",
    content: Widget.vstack([
      heroCard(s),
      error ? Widget.hstack([
        Widget.symbol("exclamationmark.triangle.fill", { size: 14, color: "orange", fallback: "⚠️" }),
        Widget.text(`Last refresh failed (${error}). Showing cached data.`, { font: "footnote", color: "orange", lineLimit: 3 }),
      ], { spacing: 6 }) : null,
      lightCard(s),
      Widget.list(timelineRows(s), { title: "Today" }),
      dayCard(s),
      Widget.card([
        Widget.picker(Object.entries(BANDS).map(([value, b]) => ({ label: `${b.label} (${b.low}° to ${b.high}°)`, value })), settings().band, "band", null, { style: "segmented", label: "Golden hour band" }),
        Widget.text("Classic is the hour or so after sunrise and before sunset. Wide starts in blue hour and lasts longer, which suits landscapes in winter.", { font: "caption2", color: "secondary" }),
      ], { title: "Settings", symbol: "gearshape.fill", color: "gray" }),
      Widget.hstack([
        Widget.button("Refresh", "refresh", null, { style: "prominent", color: "orange" }),
        Widget.button("Share", "share", null, { style: "bordered" }),
        Widget.spacer(),
        Widget.vstack([
          Widget.hstack([
            Widget.text("updated", { font: "caption2", color: "secondary" }),
            Widget.date(s.data.time, { style: "relative", font: "caption2", color: "secondary" }),
          ], { spacing: 3 }),
          s.data.weatherError ? Widget.text("forecast unavailable", { font: "caption2", color: "orange" }) : null,
        ], { alignment: "trailing", spacing: 1 }),
      ], { spacing: 10 }),
      Widget.text(`${s.data.credit?.text ?? "Apple Weather"} · sunrise, sunset, cloud cover and UV index`, { font: "caption2", color: "secondary", align: "center", url: s.data.credit?.url }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});
