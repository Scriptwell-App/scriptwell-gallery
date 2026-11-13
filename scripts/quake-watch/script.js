// @name        Quake Watch
// @description Earthquakes near you from the USGS catalogue at earthquake.usgs.gov: a map, a magnitude chart, distance and depth for each quake, and a notification when a strong one happens within your radius
// @permissions network, location, notifications
// @widget      small, medium, large, rectangular, inline
// @icon        waveform.path.ecg
// @color       #DC2626
// @version     1.0.0
// @author      va4w
// @category    news

// How it works
// • Loads the last seven days of earthquakes within your chosen radius from the USGS earthquake
//   catalogue (earthquake.usgs.gov). Only rounded coordinates, the radius and a minimum magnitude are sent.
// • Your location is read once and kept in Storage, so widgets and background runs reuse it.
//   Tap "Update location" in the mini-app after you travel.
// • Background runs look for new quakes and send one notification per event at or above the
//   "Notify me" magnitude you choose. Set it to Off to stay quiet.
// • Run the script once in the app to approve location and notifications before adding a widget.
// • Widget parameter: a minimum magnitude to show, for example "3".

// ───────────────────────── Constants and settings

const USGS = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const DAY = 86_400_000;
const FRESH_MS = 15 * 60 * 1000;    // reuse the cached list for this long
const PLACE_MAX_AGE = 12 * 3600e3;  // widgets reuse a location fix younger than this
const DEFAULTS = { radius: 300, minMag: 1.5, notifyMag: 4.5 };
const MIN_MAGS = [1, 1.5, 2, 2.5, 3, 4];
const NOTIFY_MAGS = [
  { label: "Off", value: 0 }, { label: "M3+", value: 3 }, { label: "M4+", value: 4 },
  { label: "M4.5+", value: 4.5 }, { label: "M5+", value: 5 }, { label: "M6+", value: 6 },
];

const settings = () => ({ ...DEFAULTS, ...Storage.get("settings", {}) });
const save = (changes) => Storage.set("settings", { ...settings(), ...changes });

const BANDS = [
  { min: 6, hex: "#7C3AED", name: "purple", label: "Strong" },
  { min: 5, hex: "#EF4444", name: "red", label: "Moderate" },
  { min: 4, hex: "#F97316", name: "orange", label: "Light" },
  { min: 2.5, hex: "#EAB308", name: "yellow", label: "Minor" },
  { min: 0, hex: "#22C55E", name: "green", label: "Micro" },
];
const band = (mag) => BANDS.find((b) => (mag ?? 0) >= b.min) ?? BANDS[BANDS.length - 1];

const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const BG = Widget.gradient([{ light: "#FFF7ED", dark: "#1C1917" }, { light: "#FEE2E2", dark: "#292524" }], { direction: "topLeadingToBottomTrailing" });
const PANEL = { light: "#FFFFFFE6", dark: "#000000B3" };
const TILE = { light: "#FFFFFF99", dark: "#FFFFFF14" };
const FILL = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };

// ───────────────────────── Formatting

const locale = Script.env.locale;
const useMiles = /-(US|GB|LR|MM)$/i.test(locale);
const fmtNum = (n, digits = 0) => n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtMag = (m) => (m == null ? "?" : fmtNum(m, 1));
const fmtDistance = (km) => (useMiles ? `${fmtNum(km * 0.621371)} mi` : `${fmtNum(km)} km`);
const fmtDepth = (km) => `${fmtNum(useMiles ? km * 0.621371 : km, km < 10 ? 1 : 0)} ${useMiles ? "mi" : "km"} deep`;

// Great-circle distance in kilometres, so widgets never need a place lookup.
function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// ───────────────────────── Location

async function getPlace({ allowStale = false } = {}) {
  const saved = Storage.get("place");
  if (allowStale && saved && Date.now() - saved.time < PLACE_MAX_AGE) return saved;
  try {
    const here = await Location.current({ accuracy: "kilometer" });
    const place = { latitude: here.latitude, longitude: here.longitude, time: Date.now() };
    Storage.set("place", place);
    return place;
  } catch (error) {
    if (saved) return saved;
    throw error;
  }
}

// A readable name for the cached place. Place lookups do not run in widgets, so this is cached.
async function placeName(place) {
  const key = `${place.latitude.toFixed(1)},${place.longitude.toFixed(1)}`;
  const saved = Storage.get("placeName");
  if (saved?.key === key) return saved.name;
  if (Script.env.mode === "widget") return saved?.name ?? "your location";
  try {
    const [found] = await Location.reverseGeocode(place);
    const name = found?.city ?? found?.region ?? found?.name ?? "your location";
    Storage.set("placeName", { key, name });
    return name;
  } catch {
    return saved?.name ?? "your location";
  }
}

// ───────────────────────── USGS

async function fetchQuakes(place, s, timeout) {
  const url = new URL(USGS);
  url.search = new URLSearchParams({
    format: "geojson",
    latitude: place.latitude.toFixed(2),
    longitude: place.longitude.toFixed(2),
    maxradiuskm: String(s.radius),
    starttime: new Date(Date.now() - 7 * DAY).toISOString(),
    minmagnitude: String(s.minMag),
    orderby: "time",
    limit: "50",
  }).toString();

  const response = await fetch(url, { timeout });
  if (!response.ok) throw new Error(`USGS returned ${response.status}`);
  const data = await response.json();
  return (data.features ?? [])
    .filter((f) => f.properties?.mag != null && f.geometry?.coordinates)
    .map((f) => {
      const [longitude, latitude, depth] = f.geometry.coordinates;
      return {
        id: f.id,
        mag: f.properties.mag,
        place: f.properties.place ?? "Unknown location",
        time: f.properties.time,
        url: f.properties.url,
        latitude,
        longitude,
        depth: depth ?? 0,
        km: distanceKm(place, { latitude, longitude }),
      };
    });
}

async function notifyNew(quakes, s) {
  const seen = Storage.get("seen"); // null on the very first run: remember, do not notify
  if (seen && s.notifyMag > 0 && (Script.env.mode === "background" || Script.env.mode === "shortcut")) {
    const fresh = quakes.filter((q) => !seen.includes(q.id) && q.mag >= s.notifyMag && Date.now() - q.time < DAY);
    for (const q of fresh.slice(0, 3)) {
      await Notification.schedule({
        id: `quake-${q.id}`,
        title: `M${fmtMag(q.mag)} earthquake ${fmtDistance(q.km)} away`,
        body: `${q.place} · ${fmtDepth(q.depth)}`,
        after: 1,
      });
    }
  }
  Storage.set("seen", [...new Set([...quakes.map((q) => q.id), ...(seen ?? [])])].slice(0, 300));
}

async function refresh({ timeout = 10_000 } = {}) {
  const s = settings();
  const place = await getPlace({ allowStale: Script.env.mode === "widget" });
  const quakes = await fetchQuakes(place, s, timeout);
  const data = { quakes, place, radius: s.radius, minMag: s.minMag, time: Date.now() };
  Storage.set("data", data);
  Storage.remove("lastError");
  if (Script.env.mode !== "widget") await notifyNew(quakes, s);
  return data;
}

// Cached when fresh and the settings have not changed; otherwise refreshed, falling back to the cache.
async function load({ timeout } = {}) {
  const cached = Storage.get("data");
  const s = settings();
  const fresh = cached && Date.now() - cached.time < FRESH_MS && cached.radius === s.radius && cached.minMag === s.minMag;
  if (fresh) return cached;
  try {
    return await refresh({ timeout });
  } catch (error) {
    Storage.set("lastError", { message: error.message, time: Date.now() });
    if (cached) return cached;
    throw error;
  }
}

function summarize(data) {
  const now = Date.now();
  const quakes = data.quakes;
  const last24 = quakes.filter((q) => now - q.time < DAY);
  const biggest = quakes.reduce((best, q) => (!best || q.mag > best.mag ? q : best), null);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const first = midnight.getTime() - 6 * DAY;
  const days = Array.from({ length: 7 }, (_, i) => ({
    label: new Date(first + i * DAY).toLocaleDateString(locale, { weekday: "short" }),
    count: 0,
    max: 0,
  }));
  for (const q of quakes) {
    const i = Math.min(6, Math.max(0, Math.floor((q.time - first) / DAY)));
    days[i].count += 1;
    days[i].max = Math.max(days[i].max, q.mag);
  }
  return { last24, biggest, days };
}

// ───────────────────────── Shared pieces

function magBadge(mag, size = 13) {
  return Widget.text(`M${fmtMag(mag)}`, {
    font: size, weight: "heavy", design: "rounded", color: "white", lineLimit: 1,
    padding: { horizontal: Math.round(size * 0.55), vertical: Math.round(size * 0.25) },
    background: band(mag).hex, cornerRadius: Math.round(size * 0.55),
  });
}

function mapNode(data, quakes, props = {}) {
  const pins = quakes.slice(0, 40).map((q) => ({ title: `M${fmtMag(q.mag)} · ${q.place}`, latitude: q.latitude, longitude: q.longitude, color: band(q.mag).name }));
  pins.push({ title: "You", latitude: data.place.latitude, longitude: data.place.longitude, color: "blue" });
  return Widget.map({ center: data.place, span: data.radius * 2200, pins, ...props });
}

function quakeRow(q, { compact = false } = {}) {
  return Widget.hstack([
    magBadge(q.mag, compact ? 11 : 13),
    Widget.vstack([
      Widget.text(q.place, { font: compact ? "caption" : "subheadline", weight: "medium", lineLimit: 1, minimumScale: 0.8 }),
      Widget.text(`${fmtDistance(q.km)} away · ${fmtDepth(q.depth)}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", alignment: "leading" } }),
    Widget.date(q.time, { style: "relative", font: "caption2", color: "secondary", lineLimit: 1 }),
  ], { spacing: 8, url: compact ? undefined : q.url });
}

function placeholder(family, message) {
  if (family === "inline") return Widget.text("Quake Watch: open Scriptwell");
  if (family === "rectangular") return Widget.text(message, { font: "caption", lineLimit: 3 });
  return Widget.vstack([
    Widget.symbol("waveform.path.ecg", { size: 26, color: "red", fallback: "〰️" }),
    Widget.text(message, { font: "caption", color: "secondary", align: "center", lineLimit: 4 }),
  ], { spacing: 8, padding: 14, background: BG, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
}

// ───────────────────────── Widget

Script.widget(async ({ family, parameter }) => {
  let data = null;
  try {
    data = await load({ timeout: 6000 });
  } catch {
    data = Storage.get("data");
  }
  if (!data) {
    const error = Storage.get("lastError");
    return placeholder(family, error ? `Could not load: ${error.message}` : "Open Quake Watch once to allow location");
  }

  const minShown = parseFloat(parameter);
  const quakes = Number.isFinite(minShown) ? data.quakes.filter((q) => q.mag >= minShown) : data.quakes;
  const shown = { ...data, quakes };
  const s = summarize(shown);
  const radiusText = fmtDistance(data.radius);
  const countLine = `${s.last24.length} in 24 h · ${quakes.length} in 7 d · ${radiusText}`;
  let content;

  if (family === "inline") {
    content = Widget.text(`${s.last24.length} quake${s.last24.length === 1 ? "" : "s"} in 24 h${s.biggest ? ` · max M${fmtMag(s.biggest.mag)}` : ""}`);
  } else if (family === "rectangular") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("waveform.path.ecg", { size: 12, fallback: "〰️" }),
        Widget.text("QUAKES · 24 H", { font: "caption2", weight: "bold" }),
        Widget.spacer(),
        Widget.text(String(s.last24.length), { font: "title2", weight: "bold", design: "rounded" }),
      ], { spacing: 4 }),
      Widget.text(s.biggest ? `Biggest M${fmtMag(s.biggest.mag)} · ${fmtDistance(s.biggest.km)} away` : `Quiet within ${radiusText}`, { font: "caption", lineLimit: 1 }),
      s.biggest ? Widget.text(s.biggest.place, { font: "caption2", lineLimit: 1 }) : Widget.text("Last 7 days", { font: "caption2" }),
    ], { alignment: "leading", spacing: 1 });
  } else if (family === "small") {
    const b = s.biggest;
    content = Widget.zstack([
      mapNode(data, quakes),
      Widget.vstack([
        Widget.hstack([
          Widget.text(`${s.last24.length} · 24 h`, { font: "caption2", weight: "bold", padding: { horizontal: 6, vertical: 3 }, background: PANEL, cornerRadius: 7 }),
          Widget.spacer(),
        ]),
        Widget.spacer(),
        b
          ? Widget.hstack([
              magBadge(b.mag, 12),
              Widget.vstack([
                Widget.text(b.place, { font: 10, weight: "semibold", lineLimit: 1, minimumScale: 0.75 }),
                Widget.hstack([
                  Widget.text(fmtDistance(b.km), { font: 9, color: "secondary" }),
                  Widget.text("·", { font: 9, color: "secondary" }),
                  Widget.date(b.time, { style: "relative", font: 9, color: "secondary", lineLimit: 1 }),
                ], { spacing: 3 }),
              ], { alignment: "leading", spacing: 0 }),
            ], { spacing: 6, padding: 7, background: PANEL, cornerRadius: 10 })
          : Widget.text(`Quiet week within ${radiusText}`, { font: "caption2", weight: "semibold", padding: 7, background: PANEL, cornerRadius: 10, lineLimit: 2 }),
      ], { alignment: "leading", padding: 8, frame: FILL }),
    ], { url: APP_LINK });
  } else if (family === "medium") {
    const b = s.biggest;
    content = Widget.hstack([
      Widget.vstack([
        Widget.hstack([
          Widget.symbol("waveform.path.ecg", { size: 12, color: "red", fallback: "〰️" }),
          Widget.text("NEARBY QUAKES", { font: "caption2", weight: "bold", color: "secondary" }),
        ], { spacing: 4 }),
        b ? magBadge(b.mag, 20) : Widget.text("Quiet week", { font: "title3", weight: "bold" }),
        Widget.text(b ? b.place : `Nothing at or above M${fmtMag(data.minMag)} within ${radiusText} in 7 days.`, { font: "footnote", weight: "medium", lineLimit: 2, minimumScale: 0.8 }),
        b ? Widget.text(`${fmtDistance(b.km)} away · ${fmtDepth(b.depth)}`, { font: "caption2", color: "secondary", lineLimit: 1 }) : null,
        b ? Widget.date(b.time, { style: "relative", font: "caption2", color: "secondary" }) : null,
        Widget.spacer(),
        Widget.text(countLine, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
      ], { alignment: "leading", spacing: 3, frame: FILL }),
      Widget.vstack([mapNode(data, quakes)], { cornerRadius: 12, frame: { width: 138, maxHeight: "infinity" } }),
    ], { spacing: 10, padding: 12, background: BG, url: APP_LINK, frame: FILL });
  } else {
    const b = s.biggest;
    const maxCount = Math.max(1, ...s.days.map((d) => d.count));
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("waveform.path.ecg", { size: 14, color: "red", fallback: "〰️" }),
        Widget.text("Quake Watch", { font: "headline" }),
        Widget.spacer(),
        Widget.text(`within ${radiusText}`, { font: "caption2", color: "secondary" }),
      ], { spacing: 5 }),
      Widget.hstack([
        Widget.vstack([
          Widget.text("BIGGEST · 7 DAYS", { font: "caption2", weight: "bold", color: "secondary" }),
          b ? magBadge(b.mag, 18) : Widget.text("—", { font: "title2", weight: "bold" }),
          Widget.text(b ? b.place : "Quiet week", { font: "caption", weight: "medium", lineLimit: 2, minimumScale: 0.8 }),
          b ? Widget.text(`${fmtDistance(b.km)} away · ${fmtDepth(b.depth)}`, { font: "caption2", color: "secondary", lineLimit: 1 }) : null,
        ], { alignment: "leading", spacing: 3, padding: 9, background: TILE, cornerRadius: 12, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
        Widget.vstack([
          Widget.text("LAST 24 H", { font: "caption2", weight: "bold", color: "secondary" }),
          Widget.text(String(s.last24.length), { font: 30, weight: "heavy", design: "rounded", color: "red" }),
          Widget.text(`${quakes.length} in 7 days`, { font: "caption2", color: "secondary" }),
        ], { alignment: "leading", spacing: 2, padding: 9, background: TILE, cornerRadius: 12, frame: { width: 92, maxHeight: "infinity", alignment: "topLeading" } }),
      ], { spacing: 8 }),
      Widget.vstack([mapNode(data, quakes)], { cornerRadius: 12, frame: { height: 112 } }),
      Widget.text(`Quakes per day · busiest ${maxCount}`, { font: "caption2", weight: "semibold", color: "secondary" }),
      Widget.chart(s.days.map((d) => ({ x: d.label, y: d.count })), { color: "red", axes: false, range: [0, maxCount], frame: { height: 40 } }),
      Widget.hstack(s.days.map((d) => Widget.text(d.label, { font: 8, color: "secondary", align: "center", frame: { maxWidth: "infinity" } }))),
      ...quakes.slice(0, 3).map((q) => quakeRow(q, { compact: true })),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 6, padding: 14, background: BG, url: APP_LINK, frame: FILL });
  }

  return { content, refreshAfter: 30 * 60 };
});

// ───────────────────────── Run and background

Script.run(async () => {
  let data;
  try {
    data = await refresh();
  } catch (error) {
    data = Storage.get("data");
    if (!data) return `Could not load earthquakes: ${error.message}`;
  }
  const s = summarize(data);
  const where = await placeName(data.place);
  if (!s.biggest) return `No earthquakes at or above M${fmtMag(data.minMag)} within ${fmtDistance(data.radius)} of ${where} in the last 7 days.`;
  return `${s.last24.length} earthquake${s.last24.length === 1 ? "" : "s"} within ${fmtDistance(data.radius)} of ${where} in the last 24 hours, ${data.quakes.length} in 7 days. ` +
    `Biggest: M${fmtMag(s.biggest.mag)}, ${s.biggest.place}, ${fmtDistance(s.biggest.km)} away, ${fmtDepth(s.biggest.depth)}.`;
});

Script.background(async () => {
  try {
    await refresh({ timeout: 9000 });
  } catch (error) {
    Storage.set("lastError", { message: error.message, time: Date.now() });
  }
});

// ───────────────────────── Mini-app

let showAll = false;

Script.action("refresh", async () => {
  try {
    await refresh();
    await UI.haptic("success");
  } catch (error) {
    Storage.set("lastError", { message: error.message, time: Date.now() });
    await UI.haptic("error");
  }
});

Script.action("locate", async () => {
  Storage.remove("place");
  try {
    await refresh();
  } catch (error) {
    Storage.set("lastError", { message: error.message, time: Date.now() });
  }
});

Script.action("radius", ({ value }) => save({ radius: value }));
Script.action("minMag", ({ value }) => save({ minMag: value }));
Script.action("toggleAll", () => { showAll = !showAll; });

Script.action("notifyMag", async ({ value }) => {
  save({ notifyMag: value });
  if (value <= 0) return;
  // Scheduling once here lets iOS ask for permission while there is a screen to ask on.
  try {
    await Notification.schedule({
      id: "quake-armed",
      title: "Quake alerts are on",
      body: `You will hear about M${fmtMag(value)}+ earthquakes within ${fmtDistance(settings().radius)}.`,
      after: 1,
    });
  } catch (error) {
    Storage.set("lastError", { message: error.message, time: Date.now() });
  }
});

Script.action("pin", async ({ index }) => {
  const q = Storage.get("data")?.quakes[index];
  if (q?.url) await UI.openURL(q.url);
});

function magnitudeChart(quakes) {
  const now = Date.now();
  const order = [...BANDS].reverse();
  const points = [];
  for (const b of order) {
    for (const q of quakes) {
      if (band(q.mag) === b) points.push({ x: Number(((q.time - now) / DAY).toFixed(2)), y: q.mag, series: b.label });
    }
  }
  const colors = order.filter((b) => points.some((p) => p.series === b.label)).map((b) => b.hex);
  const top = Math.max(5, ...quakes.map((q) => q.mag)) + 0.5;
  return Widget.vstack([
    Widget.chart(points, { kind: "point", colors, range: [0, top], frame: { height: 200 } }),
    Widget.text("Days ago → now · magnitude", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 4 });
}

Script.ui(async () => {
  const s = settings();
  let data = null;
  try {
    data = await load();
  } catch {
    data = Storage.get("data");
  }
  const error = Storage.get("lastError");
  const where = data ? await placeName(data.place) : null;

  const settingsCard = Widget.card([
    Widget.text(`Radius: ${fmtDistance(s.radius)}`, { font: "caption", color: "secondary" }),
    Widget.slider(s.radius, "radius", null, { min: 50, max: 1000, step: 50, color: "red" }),
    Widget.text("Minimum magnitude", { font: "caption", color: "secondary" }),
    Widget.picker(MIN_MAGS.map((m) => ({ label: `M${fmtMag(m)}`, value: m })), s.minMag, "minMag", null, { style: "segmented" }),
    Widget.hstack([
      Widget.text("Notify me about", { font: "subheadline" }),
      Widget.spacer(),
      Widget.picker(NOTIFY_MAGS, s.notifyMag, "notifyMag", null, { style: "menu" }),
    ]),
    Widget.text("Notifications arrive from background runs, which iOS allows a few times a day. For sharper timing, add a Shortcuts automation that runs this script every hour.", { font: "caption2", color: "secondary" }),
    Widget.hstack([
      Widget.button("Refresh", "refresh", null, { style: "prominent", color: "red" }),
      Widget.button("Update location", "locate", null, { style: "bordered" }),
    ], { spacing: 10 }),
  ], { title: "Settings", symbol: "slider.horizontal.3", color: "red" });

  if (!data) {
    return {
      title: "Quake Watch",
      content: Widget.vstack([
        Widget.symbol("waveform.path.ecg", { size: 56, color: "red", fallback: "〰️" }),
        Widget.text(error ? `Could not load earthquakes: ${error.message}` : "Loading earthquakes near you…", { align: "center", color: "secondary" }),
        settingsCard,
      ], { spacing: 16, padding: 16 }),
    };
  }

  const sum = summarize(data);
  const list = data.quakes.slice(0, showAll ? 30 : 10);

  const stat = (label, value, color) => Widget.vstack([
    Widget.text(value, { font: "title2", weight: "bold", design: "rounded", color }),
    Widget.text(label, { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 0, frame: { maxWidth: "infinity", alignment: "leading" } });

  return {
    title: "Quake Watch",
    content: Widget.vstack([
      Widget.vstack([
        Widget.hstack([
          Widget.symbol("location.fill", { size: 12, color: "red", fallback: "📍" }),
          Widget.text(`Within ${fmtDistance(data.radius)} of ${where}`, { font: "footnote", weight: "medium", lineLimit: 1 }),
          Widget.spacer(),
          Widget.date(data.time, { style: "relative", font: "caption2", color: "secondary" }),
        ], { spacing: 4 }),
        error && error.time > data.time ? Widget.text(`Showing cached data: ${error.message}`, { font: "caption", color: "orange" }) : null,
      ], { alignment: "leading", spacing: 4 }),
      Widget.hstack([
        stat("last 24 h", String(sum.last24.length), "red"),
        stat("last 7 days", String(data.quakes.length), "primary"),
        stat("biggest", sum.biggest ? `M${fmtMag(sum.biggest.mag)}` : "—", sum.biggest ? band(sum.biggest.mag).hex : "secondary"),
      ], { spacing: 8, padding: 12, background: TILE, cornerRadius: 14 }),
      mapNode(data, data.quakes, { action: "pin", frame: { height: 260 } }),
      Widget.text("Tap a pin to open the USGS event page. Your position is the blue pin.", { font: "caption2", color: "secondary" }),
      data.quakes.length
        ? Widget.card([magnitudeChart(data.quakes)], { title: "Seven days", subtitle: "Each dot is one quake, coloured by magnitude", symbol: "chart.dots.scatter", color: "red" })
        : Widget.card([Widget.text(`No earthquakes at or above M${fmtMag(data.minMag)} in the last seven days. Lower the minimum magnitude or widen the radius to see smaller ones.`, { font: "footnote", color: "secondary" })], { title: "Quiet week", symbol: "checkmark.seal.fill", color: "green" }),
      settingsCard,
      list.length ? Widget.text(`Latest ${list.length} of ${data.quakes.length} · tap one for details`, { font: "headline" }) : null,
      ...list.map((q) => Widget.vstack([quakeRow(q)], { padding: 10, background: TILE, cornerRadius: 12 })),
      data.quakes.length > 10 ? Widget.button(showAll ? "Show fewer" : `Show ${Math.min(30, data.quakes.length)} most recent`, "toggleAll", null, { style: "bordered" }) : null,
      Widget.text("Data: USGS Earthquake Hazards Program", { font: "caption2", color: "secondary", url: "https://earthquake.usgs.gov" }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});
