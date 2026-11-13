// @name        Sun Shot Planner
// @description Plans photographs around the sun: golden and blue hour, sunrise, sunset and solar noon for where you are or any searched place, a 24-hour elevation curve, an azimuth dial with your compass heading, and Apple Weather cloud cover for the day
// @permissions location, motion
// @widget      small, medium, large, rectangular
// @icon        camera.aperture
// @color       #F59E0B
// @version     1.0.0
// @author      scriptwell
// @category    photo-video

// How it works
// • The sun's azimuth and elevation are computed on the device with the NOAA solar position
//   algorithm, so the planning itself sends nothing anywhere. Place searches go to Apple Maps and
//   cloud cover comes from Apple Weather, both only with the place you chose.
// • Tap "Use my location" or search a place, then pick a date and time. Golden hour is the sun
//   between −4° and 6°, blue hour between −6° and −4°. Times are shown in your device's time zone.
// • "Read compass" shows which way you are facing and how far to turn to line up with the sun.
// • The widget counts down to the next golden hour for the saved place (or your location) and shows
//   where the sun is right now; the large one adds the elevation curve and the day's cloud cover.
// • Run the script once in the app, so location and motion are approved, before adding the widget.

// ───────────────────────── Constants

const DAY = 86_400_000;
const STEP_MIN = 2;                // sample spacing for the daily scan
const GOLDEN = [-4, 6];
const BLUE = [-6, -4];
const POINTS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const locale = Script.env.locale;

const WARM = Widget.gradient([{ light: "#FEF3C7", dark: "#3B1D0B" }, { light: "#FED7AA", dark: "#1C1917" }], { direction: "topLeadingToBottomTrailing" });
const TILE = { light: "#FFFFFF99", dark: "#FFFFFF14" };
const CARD = { light: "#F1F5F9", dark: "#1E293B" };
const FILL = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
const GOLD = "#F59E0B";
const PHASE_COLORS = { night: "#1E293B", blue: "#3B82F6", golden: "#F59E0B", day: "#FDE68A" };

// ───────────────────────── Solar position (NOAA)

// Azimuth in degrees clockwise from north and apparent elevation in degrees, for a Date and a place.
function solarPosition(date, latitude, longitude) {
  const rad = Math.PI / 180;
  const jd = date.getTime() / DAY + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * rad) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * M * rad) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const declination = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqTime = (4 / rad) * (
    y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad)
    + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad)
    - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad)
  ); // minutes
  const minutesUTC = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolar = (((minutesUTC + eqTime + 4 * longitude) % 1440) + 1440) % 1440;
  const hourAngle = trueSolar / 4 - 180;
  const lat = latitude * rad;
  const cosZenith = Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle * rad);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  const elevation = 90 - zenith / rad;

  let azimuth;
  const denominator = Math.cos(lat) * Math.sin(zenith);
  if (Math.abs(denominator) > 1e-9) {
    const cosAz = Math.max(-1, Math.min(1, (Math.sin(lat) * Math.cos(zenith) - Math.sin(declination)) / denominator));
    const az = Math.acos(cosAz) / rad;
    azimuth = hourAngle > 0 ? (180 + az) % 360 : (540 - az) % 360;
  } else {
    azimuth = latitude >= 0 ? 180 : 0;
  }

  // Atmospheric refraction lifts the apparent sun a little near the horizon.
  let refraction = 0;
  if (elevation <= 85) {
    const te = Math.tan(elevation * rad);
    if (elevation > 5) refraction = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    else if (elevation > -0.575) refraction = 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
    else refraction = -20.772 / te;
    refraction /= 3600;
  }
  return { azimuth, elevation: elevation + refraction };
}

// ───────────────────────── A day of sun

const dayStart = (date) => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; };
const compass = (az) => POINTS16[Math.round(az / 22.5) % 16];
const fmtTime = (t) => (t == null ? "—" : new Date(t).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }));
const fmtDeg = (d) => `${Math.round(d)}°`;

function scanDay(place, date) {
  const start = dayStart(date).getTime();
  const samples = [];
  for (let m = 0; m <= 1440; m += STEP_MIN) {
    const t = start + m * 60000;
    const p = solarPosition(new Date(t), place.latitude, place.longitude);
    samples.push({ t, minutes: m, elevation: p.elevation, azimuth: p.azimuth });
  }
  return { start, samples };
}

// Linear interpolation of the moment between two samples where the elevation crosses a bound.
function edge(a, b, lo, hi) {
  const level = (a.elevation - lo) * (b.elevation - lo) <= 0 ? lo : hi;
  const f = (level - a.elevation) / (b.elevation - a.elevation || 1e-9);
  return a.t + Math.max(0, Math.min(1, f)) * (b.t - a.t);
}

// Time spans where lo ≤ elevation ≤ hi.
function spans(samples, lo, hi) {
  const result = [];
  let open = null;
  samples.forEach((s, i) => {
    const prev = samples[i - 1];
    const inside = s.elevation >= lo && s.elevation <= hi;
    if (inside && !open) open = { start: prev ? edge(prev, s, lo, hi) : s.t };
    if (!inside && open) { open.end = edge(prev, s, lo, hi); result.push(open); open = null; }
  });
  if (open) { open.end = samples[samples.length - 1].t; result.push(open); }
  return result;
}

function crossing(samples, rising) {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].elevation, b = samples[i].elevation;
    if (rising ? a < 0 && b >= 0 : a >= 0 && b < 0) return edge(samples[i - 1], samples[i], 0, 0);
  }
  return null;
}

function dayEvents(place, date) {
  const { start, samples } = scanDay(place, date);
  const noon = samples.reduce((best, s) => (s.elevation > best.elevation ? s : best));
  const golden = spans(samples, GOLDEN[0], GOLDEN[1]).map((g) => ({ ...g, label: g.start < noon.t ? "Morning golden hour" : "Evening golden hour" }));
  const blue = spans(samples, BLUE[0], BLUE[1]).map((b) => ({ ...b, label: b.start < noon.t ? "Morning blue hour" : "Evening blue hour" }));
  return {
    start, samples, golden, blue,
    sunrise: crossing(samples, true),
    sunset: crossing(samples, false),
    noon: noon.t,
    noonElevation: noon.elevation,
    minElevation: Math.min(...samples.map((s) => s.elevation)),
  };
}

function nextGolden(place, now = Date.now()) {
  for (let d = 0; d < 4; d++) {
    const events = dayEvents(place, new Date(now + d * DAY));
    const found = events.golden.find((g) => g.end > now);
    if (found) return { ...found, active: found.start <= now };
  }
  return null;
}

function phaseAt(elevation) {
  if (elevation >= GOLDEN[0] && elevation <= GOLDEN[1]) return "golden";
  if (elevation >= BLUE[0] && elevation < BLUE[0] + (BLUE[1] - BLUE[0])) return "blue";
  return elevation > GOLDEN[1] ? "day" : "night";
}

// ───────────────────────── Place, time, clouds

async function locateHere() {
  const here = await Location.current({ accuracy: "hundredMeters" });
  const place = { name: "Your location", latitude: here.latitude, longitude: here.longitude, source: "here", time: Date.now() };
  if (Script.env.mode !== "widget") {
    try {
      const [found] = await Location.reverseGeocode(here);
      if (found?.city || found?.name) place.name = found.city ?? found.name;
    } catch { /* keep the generic name */ }
  }
  Storage.set("place", place);
  return place;
}

async function currentPlace() {
  const saved = Storage.get("place");
  if (saved) return saved;
  return locateHere();
}

function chosenTime() {
  if (Storage.get("liveTime", true)) return Date.now();
  const when = new Date(Storage.get("when") ?? Date.now()).getTime();
  return Number.isFinite(when) ? when : Date.now();
}

const cloudKey = (place, date) => `${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}:${dayStart(date).toLocaleDateString("en-CA")}`;

// Cloud cover for the chosen day, cached so the widget can draw it without asking Weather itself.
async function ensureClouds(place, date) {
  const key = cloudKey(place, date);
  const cached = Storage.get("clouds");
  if (cached?.key === key && Date.now() - cached.time < (cached.failed ? 15 : 180) * 60000) return cached;
  const start = dayStart(date);
  try {
    const hours = await Weather.hourly(place, { start, hours: 24 });
    let credit = Storage.get("credit");
    if (!credit) {
      credit = await Weather.attribution();
      Storage.set("credit", credit);
    }
    const cover = Array(24).fill(null);
    for (const h of hours) {
      const i = Math.round((new Date(h.date).getTime() - start.getTime()) / 3600e3);
      if (i >= 0 && i < 24) cover[i] = h.cloudCover;
    }
    const data = { key, time: Date.now(), cover, credit };
    Storage.set("clouds", data);
    return data;
  } catch (error) {
    const data = { key, time: Date.now(), failed: error.message, credit: Storage.get("credit") };
    Storage.set("clouds", data);
    return data;
  }
}

// ───────────────────────── Drawing

function elevationChart(events, height) {
  const points = events.samples.filter((s) => s.minutes % 20 === 0).map((s) => ({ x: s.minutes / 60, y: Number(s.elevation.toFixed(1)) }));
  const lo = Math.floor(Math.min(-10, events.minElevation) / 10) * 10;
  const hi = Math.ceil(Math.max(20, events.noonElevation) / 10) * 10;
  return Widget.chart(points, { kind: "area", smooth: true, color: GOLD, range: [lo, hi], frame: { height } });
}

// 48 half-hour cells coloured by phase: night, blue hour, golden hour, day.
function phaseBar(events, height = 8) {
  const cells = [];
  for (let i = 0; i < 48; i++) {
    const s = events.samples[Math.min(events.samples.length - 1, Math.round(((i + 0.5) * 30) / STEP_MIN))];
    cells.push({ type: "stack", direction: "vertical", children: [], background: PHASE_COLORS[phaseAt(s.elevation)], frame: { maxWidth: "infinity", height } });
  }
  return Widget.hstack(cells, { spacing: 1, cornerRadius: 3 });
}

// 24 hourly cells, darker the cloudier. Null hours stay empty.
function cloudBar(clouds, height = 8) {
  return Widget.hstack(clouds.cover.map((c) => ({
    type: "stack", direction: "vertical", children: [],
    background: c == null ? { light: "#00000008", dark: "#FFFFFF10" } : { light: `#475569${alpha(c)}`, dark: `#CBD5E1${alpha(c)}` },
    frame: { maxWidth: "infinity", height },
  })), { spacing: 1, cornerRadius: 3 });
}
const alpha = (fraction) => Math.round(Math.max(0.08, Math.min(1, fraction)) * 255).toString(16).padStart(2, "0");

function hourLabels(font = 8) {
  return Widget.hstack([0, 6, 12, 18, 24].map((h, i) => Widget.text(`${h}`, { font, color: "secondary", align: i === 0 ? "leading" : i === 4 ? "trailing" : "center", frame: { maxWidth: "infinity" } })));
}

function eventRow(symbol, label, value, color = "secondary", font = "caption") {
  return Widget.hstack([
    Widget.symbol(symbol, { size: 11, color, fallback: "•" }),
    Widget.text(label, { font, color: "secondary", lineLimit: 1 }),
    Widget.spacer(),
    Widget.text(value, { font, weight: "semibold", design: "rounded", lineLimit: 1 }),
  ], { spacing: 5 });
}

function eventList(events, font = "caption") {
  const span = (s) => (s ? `${fmtTime(s.start)}–${fmtTime(s.end)}` : "none");
  const am = events.golden.find((g) => g.label.startsWith("Morning"));
  const pm = events.golden.find((g) => g.label.startsWith("Evening"));
  const bluePm = events.blue.find((b) => b.label.startsWith("Evening"));
  return [
    eventRow("sunrise.fill", "Sunrise", fmtTime(events.sunrise), "orange", font),
    eventRow("sun.horizon.fill", "Golden am", span(am), GOLD, font),
    eventRow("sun.max.fill", `Solar noon · ${fmtDeg(events.noonElevation)}`, fmtTime(events.noon), "yellow", font),
    eventRow("sun.horizon.fill", "Golden pm", span(pm), GOLD, font),
    eventRow("sunset.fill", "Sunset", fmtTime(events.sunset), "orange", font),
    eventRow("moon.stars.fill", "Blue pm", span(bluePm), "blue", font),
  ];
}

function countdown(next, big = 30) {
  if (!next) {
    return Widget.vstack([
      Widget.text("GOLDEN HOUR", { font: "caption2", weight: "bold", color: GOLD }),
      Widget.text("None in the next days", { font: "footnote", weight: "semibold", lineLimit: 2 }),
    ], { alignment: "leading", spacing: 2 });
  }
  return Widget.vstack([
    Widget.text(`${next.label.toUpperCase()} ${next.active ? "ENDS" : "STARTS"}`, { font: "caption2", weight: "bold", color: GOLD, lineLimit: 1, minimumScale: 0.7 }),
    Widget.date(next.active ? next.end : next.start, { style: "relative", font: big, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.5 }),
    Widget.text(`${fmtTime(next.start)}–${fmtTime(next.end)}`, { font: "caption", color: "secondary" }),
  ], { alignment: "leading", spacing: 1 });
}

function sunNowLine(pos, font = "caption") {
  const up = pos.elevation >= 0;
  return Widget.hstack([
    Widget.symbol(up ? "sun.max.fill" : "moon.fill", { size: 12, color: up ? "orange" : "indigo", fallback: up ? "☀️" : "🌙" }),
    Widget.text(`Sun now ${fmtDeg(pos.azimuth)} ${compass(pos.azimuth)} · ${up ? `${fmtDeg(pos.elevation)} up` : `${fmtDeg(-pos.elevation)} below horizon`}`, { font, lineLimit: 1, minimumScale: 0.7 }),
  ], { spacing: 4 });
}

// A 16-sector compass ring; the sun sits in its sector, "you" marks the phone's heading.
function dial(pos, heading, size = 42) {
  const ring = [[0, 2], [0, 3], [0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0], [3, 0], [2, 0], [1, 0], [0, 0], [0, 1]];
  const sunSector = Math.round(pos.azimuth / 22.5) % 16;
  const youSector = heading == null ? -1 : Math.round(heading / 22.5) % 16;
  const up = pos.elevation >= 0;

  const cell = (row, col) => {
    const idx = ring.findIndex(([r, c]) => r === row && c === col);
    const major = idx % 4 === 0;
    let text = major ? POINTS16[idx] : idx % 2 === 0 ? POINTS16[idx] : "·";
    let background = CARD, color = major ? "primary" : "secondary", weight = major ? "bold" : "regular";
    if (idx === sunSector && idx === youSector) { text = "☀"; background = "#16A34A"; color = "white"; weight = "bold"; }
    else if (idx === sunSector) { text = "☀"; background = up ? GOLD : "#94A3B8"; color = "white"; weight = "bold"; }
    else if (idx === youSector) { text = "you"; background = "#3B82F6"; color = "white"; weight = "bold"; }
    return Widget.text(text, { font: major ? 13 : 10, weight, color, align: "center", background, cornerRadius: 8, frame: { width: size, height: size } });
  };

  const turn = heading == null ? null : ((pos.azimuth - heading + 540) % 360) - 180;
  const centre = Widget.vstack([
    Widget.text(`${fmtDeg(pos.azimuth)} ${compass(pos.azimuth)}`, { font: "title3", weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
    Widget.text(up ? `${fmtDeg(pos.elevation)} above horizon` : `${fmtDeg(-pos.elevation)} below horizon`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.6 }),
    turn == null
      ? Widget.text("Read the compass to line up", { font: "caption2", color: "secondary", align: "center", lineLimit: 2 })
      : Widget.text(Math.abs(turn) < 6 ? "Lined up with the sun" : `Turn ${turn > 0 ? "right" : "left"} ${fmtDeg(Math.abs(turn))}`, { font: "caption", weight: "semibold", color: Math.abs(turn) < 6 ? "green" : "blue", align: "center" }),
  ], { spacing: 3, frame: { width: size * 3 + 8, height: size * 3 + 8 } });

  const column = (col) => Widget.vstack([0, 1, 2, 3, 4].map((row) => cell(row, col)), { spacing: 4 });
  return Widget.hstack([
    column(0),
    Widget.vstack([
      Widget.hstack([cell(0, 1), cell(0, 2), cell(0, 3)], { spacing: 4 }),
      centre,
      Widget.hstack([cell(4, 1), cell(4, 2), cell(4, 3)], { spacing: 4 }),
    ], { spacing: 4 }),
    column(4),
  ], { spacing: 4 });
}

function credit(clouds, font = "caption2") {
  const c = clouds?.credit ?? { text: "Apple Weather", url: "https://weatherkit.apple.com/legal-attribution.html" };
  return Widget.text(c.text, { font, color: "secondary", url: c.url, lineLimit: 1 });
}

// ───────────────────────── Widget

Script.widget(async ({ family }) => {
  let place;
  try {
    place = await currentPlace();
  } catch (error) {
    const message = `Open Sun Shot Planner once to choose a place (${error.message})`;
    return family === "rectangular"
      ? Widget.text(message, { font: "caption", lineLimit: 3 })
      : Widget.vstack([
          Widget.symbol("sun.horizon.fill", { size: 26, color: "orange", fallback: "🌅" }),
          Widget.text(message, { font: "caption", color: "secondary", align: "center", lineLimit: 4 }),
        ], { spacing: 8, padding: 14, background: WARM, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
  }

  const now = Date.now();
  const pos = solarPosition(new Date(now), place.latitude, place.longitude);
  const next = nextGolden(place, now);
  const today = dayEvents(place, new Date(now));
  const clouds = Storage.get("clouds");
  const cloudsToday = clouds && !clouds.failed && clouds.key === cloudKey(place, new Date(now)) ? clouds : null;
  let content;

  if (family === "rectangular") {
    content = Widget.vstack([
      Widget.text(next ? `${next.label.toUpperCase()} ${next.active ? "ENDS" : "STARTS"}` : "GOLDEN HOUR", { font: "caption2", weight: "bold", lineLimit: 1 }),
      next ? Widget.date(next.active ? next.end : next.start, { style: "relative", font: "headline", lineLimit: 1 }) : Widget.text("None in the next days", { font: "headline" }),
      Widget.text(`Sun ${fmtDeg(pos.azimuth)} ${compass(pos.azimuth)} · ${fmtDeg(pos.elevation)}`, { font: "caption", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 1 });
  } else if (family === "small") {
    content = Widget.vstack([
      countdown(next, 26),
      Widget.spacer(),
      sunNowLine(pos, "caption2"),
      Widget.text(place.name, { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 4, padding: 13, background: WARM, url: APP_LINK, frame: FILL });
  } else if (family === "medium") {
    content = Widget.hstack([
      Widget.vstack([
        countdown(next, 28),
        Widget.spacer(),
        sunNowLine(pos, "caption2"),
        Widget.text(place.name, { font: "caption2", color: "secondary", lineLimit: 1 }),
      ], { alignment: "leading", spacing: 4, frame: FILL }),
      Widget.vstack(eventList(today, "caption2"), { alignment: "leading", spacing: 3, padding: 8, background: TILE, cornerRadius: 10, frame: { width: 150 } }),
    ], { spacing: 10, padding: 12, background: WARM, url: APP_LINK, frame: FILL });
  } else {
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("sun.horizon.fill", { size: 14, color: "orange", fallback: "🌅" }),
        Widget.text(place.name, { font: "headline", lineLimit: 1 }),
        Widget.spacer(),
        Widget.text(new Date(now).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }), { font: "caption", color: "secondary" }),
      ], { spacing: 5 }),
      Widget.hstack([
        Widget.vstack([countdown(next, 26)], { alignment: "leading", frame: { maxWidth: "infinity", alignment: "leading" } }),
        Widget.vstack(eventList(today, "caption2"), { alignment: "leading", spacing: 2, padding: 8, background: TILE, cornerRadius: 10, frame: { width: 150 } }),
      ], { spacing: 8, alignment: "top" }),
      sunNowLine(pos),
      elevationChart(today, 96),
      phaseBar(today),
      cloudsToday ? cloudBar(cloudsToday) : null,
      hourLabels(),
      Widget.hstack([
        Widget.text(cloudsToday ? "Phase bar above, cloud cover below (darker is cloudier)" : "Open the mini-app to load today's cloud cover", { font: 8, color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
        Widget.spacer(),
        cloudsToday ? credit(cloudsToday, 8) : null,
      ]),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 5, padding: 14, background: WARM, url: APP_LINK, frame: FILL });
  }

  return { content, refreshAfter: 15 * 60 };
});

// ───────────────────────── Run

Script.run(async (input) => {
  let place;
  const query = String(input ?? "").trim();
  if (query) {
    const [found] = await Location.geocode(query);
    if (!found) return `Could not find "${query}".`;
    place = { name: found.name ?? found.city ?? query, latitude: found.latitude, longitude: found.longitude };
  } else {
    place = await currentPlace();
  }
  const now = Date.now();
  const events = dayEvents(place, new Date(now));
  const pos = solarPosition(new Date(now), place.latitude, place.longitude);
  const next = nextGolden(place, now);
  const span = (s) => (s ? `${fmtTime(s.start)} to ${fmtTime(s.end)}` : "none");
  return [
    `${place.name}: sunrise ${fmtTime(events.sunrise)}, solar noon ${fmtTime(events.noon)} at ${fmtDeg(events.noonElevation)}, sunset ${fmtTime(events.sunset)}.`,
    ...events.golden.map((g) => `${g.label} ${span(g)}.`),
    ...events.blue.map((b) => `${b.label} ${span(b)}.`),
    `Sun now at ${fmtDeg(pos.azimuth)} ${compass(pos.azimuth)}, ${fmtDeg(pos.elevation)} elevation.`,
    next ? `${next.label} ${next.active ? "ends" : "starts"} at ${fmtTime(next.active ? next.end : next.start)}.` : "",
  ].filter(Boolean).join(" ");
});

// ───────────────────────── Mini-app

let results = [];
let status = null;

Script.action("here", async () => {
  try {
    await locateHere();
    status = null;
  } catch (error) {
    status = `Location: ${error.message}`;
  }
});

Script.action("search", async ({ value }) => {
  const query = String(value ?? "").trim();
  if (!query) { results = []; return; }
  try {
    const saved = Storage.get("place");
    results = (await Location.search(query, { near: saved ? { latitude: saved.latitude, longitude: saved.longitude } : undefined, limit: 6 }))
      .map((p) => ({ name: p.name ?? p.city ?? query, address: p.address ?? "", latitude: p.latitude, longitude: p.longitude }));
    status = results.length ? null : `Nothing found for "${query}"`;
  } catch (error) {
    status = `Search: ${error.message}`;
  }
});

Script.action("choose", ({ index }) => {
  const r = results[index];
  if (!r) return;
  Storage.set("place", { name: r.name, latitude: r.latitude, longitude: r.longitude, source: "search", time: Date.now() });
  results = [];
});

Script.action("when", ({ value }) => {
  Storage.set("when", value);
  Storage.set("liveTime", false);
});

Script.action("now", () => Storage.set("liveTime", true));

Script.action("shift", ({ hours }) => {
  Storage.set("when", new Date(chosenTime() + hours * 3600e3).toISOString());
  Storage.set("liveTime", false);
});

Script.action("compass", async () => {
  try {
    if (!(await Compass.available())) throw new Error("this device has no compass");
    const reading = await Compass.heading({ timeout: 4000 });
    Storage.set("heading", { heading: reading.heading, accuracy: reading.accuracy, time: Date.now() });
    status = reading.accuracy === null ? "Compass needs calibrating: move the phone in a figure of eight" : null;
  } catch (error) {
    status = `Compass: ${error.message}`;
  }
});

Script.ui(async () => {
  let place = null;
  try {
    place = Storage.get("place") ?? await locateHere();
  } catch (error) {
    status = status ?? `Location: ${error.message}. Search for a place instead.`;
  }

  const live = Storage.get("liveTime", true);
  const when = chosenTime();
  const heading = Storage.get("heading");
  const headingFresh = heading && Date.now() - heading.time < 2 * 60000 ? heading.heading : null;

  const placeCard = Widget.card([
    Widget.hstack([
      Widget.symbol(place?.source === "search" ? "mappin.circle.fill" : "location.fill", { size: 16, color: "orange", fallback: "📍" }),
      Widget.text(place ? place.name : "No place yet", { font: "headline", lineLimit: 1 }),
      Widget.spacer(),
      Widget.button("Use my location", "here", null, { style: "bordered" }),
    ], { spacing: 6 }),
    place ? Widget.text(`${place.latitude.toFixed(3)}, ${place.longitude.toFixed(3)}`, { font: "caption2", color: "secondary", design: "monospaced" }) : null,
    Widget.textField("Search a place or landmark", "", "search", null, { keyboard: "search" }),
    results.length ? Widget.list(results.map((r) => ({ title: r.name, subtitle: r.address, symbol: "mappin" })), { action: "choose" }) : null,
    status ? Widget.text(status, { font: "caption", color: "orange" }) : null,
  ], { title: "Place", symbol: "map.fill", color: "orange" });

  const timeCard = Widget.card([
    Widget.datePicker(new Date(when).toISOString(), "when", null, { mode: "dateTime", label: "Shoot at" }),
    Widget.hstack([
      Widget.button("−1 h", "shift", { hours: -1 }, { style: "bordered" }),
      Widget.button(live ? "Following now" : "Now", "now", null, { style: live ? "prominent" : "bordered", color: "orange" }),
      Widget.button("+1 h", "shift", { hours: 1 }, { style: "bordered" }),
      Widget.button("+1 day", "shift", { hours: 24 }, { style: "bordered" }),
    ], { spacing: 8 }),
    Widget.text("Times are in your device's time zone.", { font: "caption2", color: "secondary" }),
  ], { title: "When", symbol: "clock.fill", color: "orange" });

  if (!place) {
    return { title: "Sun Shot Planner", content: Widget.vstack([placeCard, timeCard], { spacing: 16, padding: 16 }) };
  }

  const pos = solarPosition(new Date(when), place.latitude, place.longitude);
  const events = dayEvents(place, new Date(when));
  const next = nextGolden(place, when);
  const clouds = await ensureClouds(place, new Date(when));
  const phase = phaseAt(pos.elevation);
  const phaseText = { golden: "Golden hour: warm, low, long shadows", blue: "Blue hour: soft, cool, even light", day: "Full daylight: hard light, short shadows", night: "Night: the sun is well below the horizon" }[phase];
  const hourIndex = Math.min(23, Math.max(0, Math.floor((when - events.start) / 3600e3)));
  const cover = clouds.cover?.[hourIndex];

  return {
    title: "Sun Shot Planner",
    content: Widget.vstack([
      Widget.vstack([
        Widget.text(`${place.name} · ${new Date(when).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`, { font: "subheadline", weight: "semibold", lineLimit: 1, minimumScale: 0.7 }),
        Widget.text(phaseText, { font: "headline", color: phase === "golden" ? GOLD : phase === "blue" ? "blue" : "primary" }),
        cover != null ? Widget.text(`Cloud cover ${Math.round(cover * 100)}% at that hour`, { font: "caption", color: "secondary" }) : null,
        countdown(next, 28),
      ], { alignment: "leading", spacing: 6, padding: 14, background: WARM, cornerRadius: 16, frame: { maxWidth: "infinity", alignment: "leading" } }),

      Widget.card([
        Widget.hstack([Widget.spacer(), dial(pos, headingFresh), Widget.spacer()]),
        Widget.hstack([
          Widget.button("Read compass", "compass", null, { style: "prominent", color: "blue" }),
          headingFresh != null ? Widget.text(`Facing ${fmtDeg(headingFresh)} ${compass(headingFresh)}${heading.accuracy != null ? ` ±${fmtDeg(heading.accuracy)}` : ""}`, { font: "caption", color: "secondary" }) : Widget.text("Hold the phone flat, pointing where you will shoot.", { font: "caption2", color: "secondary", lineLimit: 2 }),
        ], { spacing: 10 }),
      ], { title: "Where the sun will be", subtitle: "At the chosen time, from the chosen place", symbol: "safari.fill", color: "blue" }),

      Widget.card([
        elevationChart(events, 180),
        phaseBar(events, 10),
        clouds.cover ? cloudBar(clouds, 10) : null,
        hourLabels(9),
        Widget.text(clouds.cover ? "Top bar: night, blue hour, golden hour, day. Bottom bar: hourly cloud cover, darker is cloudier." : `Cloud cover unavailable: ${clouds.failed ?? "no forecast for that day"}`, { font: "caption2", color: "secondary" }),
        Widget.hstack([Widget.spacer(), credit(clouds)]),
      ], { title: "Sun elevation through the day", subtitle: "Degrees above the horizon, hour by hour", symbol: "chart.xyaxis.line", color: GOLD }),

      Widget.card(eventList(events, "subheadline"), { title: "Key moments", symbol: "sun.horizon.fill", color: GOLD }),

      placeCard,
      timeCard,
    ], { alignment: "leading", spacing: 16, padding: 16 }),
  };
});
