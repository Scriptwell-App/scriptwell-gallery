// @name        Team Clocks
// @description Local time, day offset, working hours and day-or-night tint for each teammate, an overlap finder with a slider that shifts your own time, and optional Apple Weather for their cities; no permissions needed
// @widget      small, medium, large, rectangular
// @icon        globe.americas.fill
// @color       #2563EB
// @version     1.0.0
// @author      va4w
// @category    business

// How it works
// • Add a teammate with a name and a city. The city is looked up with Apple Maps place search (only the text you type is sent) and a time zone is suggested from the country and longitude; pick another from the list if it is wrong.
// • Each clock shows the local time, +1 or −1 when it is already tomorrow or still yesterday there, whether it is inside their working hours, and a tint worked out from the sun's height at their coordinates.
// • The overlap finder draws a 24-hour bar per person, coloured where their working hours overlap yours. The slider shifts "my time" so you can try a meeting hour and watch every clock move.
// • Weather is off by default. Turn it on to fetch Apple Weather for each city while the mini-app is open; widgets only show the cached temperature.
// • Widgets plan their next half hour as a timeline, so the times tick without a refresh. Everything stays in Storage on the device.

// ───────────────────────── Constants and helpers

const DAY = 86_400_000;
const MINUTE = 60_000;
const BLUE = "#2563EB";
const COLORS = ["#2563EB", "#DB2777", "#16A34A", "#EA580C", "#7C3AED", "#0891B2", "#CA8A04", "#475569"];
const TINTS = {
  day: { bg: { light: "#DBEAFE", dark: "#1E3A5F" }, symbol: "sun.max.fill", color: "orange", fallback: "☀️" },
  dawn: { bg: { light: "#FFE4CC", dark: "#4A2A12" }, symbol: "sunrise.fill", color: "orange", fallback: "🌅" },
  dusk: { bg: { light: "#FBD5C4", dark: "#4A2020" }, symbol: "sunset.fill", color: "pink", fallback: "🌇" },
  night: { bg: { light: "#E0E7FF", dark: "#111827" }, symbol: "moon.stars.fill", color: "indigo", fallback: "🌙" },
};
const ZONES = [
  ["Pacific/Honolulu", "US"], ["America/Anchorage", "US"], ["America/Los_Angeles", "US"], ["America/Vancouver", "CA"], ["America/Denver", "US"],
  ["America/Phoenix", "US"], ["America/Chicago", "US"], ["America/Mexico_City", "MX"], ["America/New_York", "US"], ["America/Toronto", "CA"],
  ["America/Bogota", "CO"], ["America/Lima", "PE"], ["America/Santiago", "CL"], ["America/Sao_Paulo", "BR"], ["America/Argentina/Buenos_Aires", "AR"],
  ["Atlantic/Reykjavik", "IS"], ["Europe/London", "GB"], ["Europe/Dublin", "IE"], ["Europe/Lisbon", "PT"], ["Europe/Madrid", "ES"],
  ["Europe/Paris", "FR"], ["Europe/Amsterdam", "NL"], ["Europe/Brussels", "BE"], ["Europe/Berlin", "DE"], ["Europe/Zurich", "CH"],
  ["Europe/Rome", "IT"], ["Europe/Vienna", "AT"], ["Europe/Prague", "CZ"], ["Europe/Stockholm", "SE"], ["Europe/Oslo", "NO"],
  ["Europe/Copenhagen", "DK"], ["Europe/Warsaw", "PL"], ["Europe/Athens", "GR"], ["Europe/Helsinki", "FI"], ["Europe/Kyiv", "UA"],
  ["Europe/Istanbul", "TR"], ["Europe/Moscow", "RU"], ["Africa/Lagos", "NG"], ["Africa/Cairo", "EG"], ["Africa/Johannesburg", "ZA"],
  ["Africa/Nairobi", "KE"], ["Asia/Dubai", "AE"], ["Asia/Tehran", "IR"], ["Asia/Karachi", "PK"], ["Asia/Kolkata", "IN"],
  ["Asia/Dhaka", "BD"], ["Asia/Bangkok", "TH"], ["Asia/Jakarta", "ID"], ["Asia/Singapore", "SG"], ["Asia/Hong_Kong", "HK"],
  ["Asia/Shanghai", "CN"], ["Asia/Taipei", "TW"], ["Asia/Manila", "PH"], ["Asia/Seoul", "KR"], ["Asia/Tokyo", "JP"],
  ["Australia/Perth", "AU"], ["Australia/Adelaide", "AU"], ["Australia/Brisbane", "AU"], ["Australia/Sydney", "AU"], ["Pacific/Auckland", "NZ"],
];
const locale = Script.env.locale;
const myZone = Script.env.timeZone;
const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

const zoneLabel = (zone) => zone.split("/").pop().replace(/_/g, " ");
const notice = (text, kind = "info") => Storage.set("notice", { text, kind, time: Date.now() });

// Offset from UTC in minutes for a zone at a moment, from the wall-clock parts Intl gives for it.
const offsetCache = {};
function zoneOffset(zone, date) {
  const key = `${zone}:${Math.floor(date.getTime() / (15 * MINUTE))}`;
  if (offsetCache[key] != null) return offsetCache[key];
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    const whole = Math.floor(date.getTime() / MINUTE) * MINUTE;
    offsetCache[key] = Math.round((wall - whole) / MINUTE);
  } catch {
    offsetCache[key] = -date.getTimezoneOffset();
  }
  return offsetCache[key];
}

// The wall clock in a zone: hours as a decimal, and the local calendar day as a number of days.
function wall(zone, date) {
  const shifted = new Date(date.getTime() + zoneOffset(zone, date) * MINUTE);
  return { hours: shifted.getUTCHours() + shifted.getUTCMinutes() / 60, day: Math.floor(shifted.getTime() / DAY), weekday: shifted.getUTCDay() };
}

const fmtTime = (zone, date) => date.toLocaleTimeString(locale, { timeZone: zone, hour: "2-digit", minute: "2-digit" });
const fmtOffset = (minutes) => `${minutes >= 0 ? "+" : "−"}${Math.floor(Math.abs(minutes) / 60)}${Math.abs(minutes) % 60 ? `:${String(Math.abs(minutes) % 60).padStart(2, "0")}` : ""}`;
const fmtHour = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

// Day, dawn, dusk or night from the sun's height above the horizon at a place.
function sunState(latitude, longitude, date) {
  const rad = Math.PI / 180;
  const dayOfYear = (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / DAY;
  const declination = -23.44 * rad * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
  const solarTime = (date.getUTCHours() + date.getUTCMinutes() / 60 + longitude / 15 + 24) % 24;
  const hourAngle = (solarTime - 12) * 15 * rad;
  const elevation = Math.asin(Math.sin(latitude * rad) * Math.sin(declination) + Math.cos(latitude * rad) * Math.cos(declination) * Math.cos(hourAngle)) / rad;
  if (elevation > 4) return "day";
  if (elevation > -8) return hourAngle < 0 ? "dawn" : "dusk";
  return "night";
}

// ───────────────────────── Data in Storage

const people = () => Storage.get("people", []);
const settings = () => ({ workStart: 9, workEnd: 18, weather: false, ...Storage.get("settings", {}) });
const saveSettings = (changes) => Storage.set("settings", { ...settings(), ...changes });
const shiftHours = () => Storage.get("shift", 0);
const newId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

const isWorking = (hours) => { const s = settings(); return hours >= s.workStart && hours < s.workEnd; };

// Everything the views need about one person at a moment.
function clock(person, date, myDate = date) {
  const theirs = wall(person.zone, date);
  const mine = wall(myZone, myDate);
  const offset = zoneOffset(person.zone, date);
  return {
    time: fmtTime(person.zone, date),
    dayOffset: theirs.day - mine.day,
    working: isWorking(theirs.hours) && theirs.weekday !== 0 && theirs.weekday !== 6,
    weekend: theirs.weekday === 0 || theirs.weekday === 6,
    sun: sunState(person.latitude, person.longitude, date),
    difference: offset - zoneOffset(myZone, date),
    offset,
  };
}

// 24 cells, one per hour of my day: "both", "them", "me" or "none".
function overlapCells(person, date) {
  const diff = (zoneOffset(person.zone, date) - zoneOffset(myZone, date)) / 60;
  return Array.from({ length: 24 }, (_, h) => {
    const me = isWorking(h + 0.5);
    const them = isWorking((((h + 0.5 + diff) % 24) + 24) % 24);
    return me && them ? "both" : them ? "them" : me ? "me" : "none";
  });
}

function commonHours(date) {
  const list = people();
  if (!list.length) return [];
  const cells = list.map((p) => overlapCells(p, date));
  return Array.from({ length: 24 }, (_, h) => h).filter((h) => cells.every((c) => c[h] === "both"));
}

function describeHours(hours) {
  if (!hours.length) return null;
  const runs = [];
  for (const h of hours) {
    const last = runs[runs.length - 1];
    if (last && last.end === h) last.end = h + 1;
    else runs.push({ start: h, end: h + 1 });
  }
  return runs.map((r) => `${fmtHour(r.start)}–${fmtHour(r.end)}`).join(", ");
}

// ───────────────────────── Adding people

const draft = () => ({ name: "", city: "", results: [], picked: null, zone: null, ...Storage.get("draft", {}) });
const saveDraft = (changes) => Storage.set("draft", { ...draft(), ...changes });

// The zone whose offset is closest to the place's longitude, among zones in the same country when there are any.
function guessZone(place) {
  const now = new Date();
  const candidates = ZONES.filter(([, cc]) => cc === place.countryCode);
  const pool = candidates.length ? candidates : ZONES;
  const target = place.longitude / 15 * 60;
  return pool.map(([zone]) => zone).sort((a, b) => Math.abs(zoneOffset(a, now) - target) - Math.abs(zoneOffset(b, now) - target))[0];
}

Script.action("draftName", ({ value }) => saveDraft({ name: value }));

Script.action("draftCity", async ({ value }) => {
  const city = String(value ?? "").trim();
  saveDraft({ city, results: [], picked: null, zone: null });
  if (!city) return;
  try {
    const found = await Location.search(city, { limit: 6 });
    const results = found.map((p) => ({ name: p.name ?? p.city ?? city, city: p.city ?? p.name ?? city, region: p.region, country: p.country, countryCode: p.countryCode, latitude: p.latitude, longitude: p.longitude }));
    if (!results.length) notice(`No place called “${city}” was found.`, "warn");
    saveDraft({ results, picked: results.length === 1 ? 0 : null, zone: results.length === 1 ? guessZone(results[0]) : null });
  } catch (error) {
    notice(`Place search failed: ${error.message}`, "warn");
  }
});

Script.action("draftPick", ({ index }) => {
  const d = draft();
  const place = d.results[index];
  if (place) saveDraft({ picked: index, zone: guessZone(place) });
});

Script.action("draftZone", ({ value }) => saveDraft({ zone: value }));

Script.action("addPerson", () => {
  const d = draft();
  const place = d.results[d.picked];
  if (!d.name.trim()) return notice("Give your teammate a name.", "warn");
  if (!place || !d.zone) return notice("Search for a city and pick one of the results.", "warn");
  const list = people();
  const person = {
    id: newId(), name: d.name.trim(), city: place.city, country: place.country ?? "", zone: d.zone,
    latitude: place.latitude, longitude: place.longitude, color: COLORS[list.length % COLORS.length],
  };
  Storage.set("people", [...list, person]);
  Storage.remove("draft");
  Storage.remove("notice");
});

Script.action("zone", ({ id, value }) => Storage.set("people", people().map((p) => (p.id === id ? { ...p, zone: value } : p))));

Script.action("remove", async ({ id }) => {
  const person = people().find((p) => p.id === id);
  const choice = await UI.alert({ title: `Remove ${person?.name ?? "this teammate"}?`, buttons: ["Cancel", "Remove"] });
  if (choice === 1) Storage.set("people", people().filter((p) => p.id !== id));
});

Script.action("move", ({ id, by }) => {
  const list = people();
  const index = list.findIndex((p) => p.id === id);
  const target = index + by;
  if (index < 0 || target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  Storage.set("people", list);
});

Script.action("shift", ({ value }) => Storage.set("shift", value));
Script.action("resetShift", () => Storage.set("shift", 0));
Script.action("work", ({ field, value }) => saveSettings({ [field]: value }));
Script.action("weatherToggle", ({ isOn }) => { saveSettings({ weather: isOn }); if (!isOn) Storage.remove("weather"); });

// ───────────────────────── Weather (mini-app only; widgets read the cache)

async function refreshWeather(force = false) {
  const list = people();
  if (!settings().weather || !list.length || (Script.env.lowPowerMode && !force)) return;
  const cache = Storage.get("weather", {});
  const stale = list.filter((p) => force || !cache[p.id] || Date.now() - cache[p.id].time > 30 * MINUTE);
  if (!stale.length) return;
  await Promise.all(stale.slice(0, 10).map(async (p) => {
    try {
      const now = await Weather.current({ latitude: p.latitude, longitude: p.longitude });
      cache[p.id] = { temp: Math.round(now.temperature), symbol: now.symbol, description: now.description, time: Date.now() };
    } catch (error) {
      cache[p.id] = { ...(cache[p.id] ?? {}), error: error.message, time: Date.now() };
    }
  }));
  Storage.set("weather", cache);
  if (!Storage.get("credit")) {
    try { Storage.set("credit", await Weather.attribution()); } catch { /* shown without a link */ }
  }
}

Script.action("refreshWeather", () => refreshWeather(true));

// ───────────────────────── Widget pieces

const weatherFor = (person) => Storage.get("weather", {})[person.id] ?? null;
const temp = (person) => { const w = weatherFor(person); return w && w.temp != null && !w.error ? `${w.temp}°` : null; };

function dayBadge(c, font = "caption2") {
  if (!c.dayOffset) return null;
  return Widget.text(c.dayOffset > 0 ? "+1" : "−1", { font, weight: "bold", color: c.dayOffset > 0 ? "orange" : "purple" });
}

function statusDot(c, size = 7) {
  return { type: "stack", direction: "horizontal", children: [], background: c.working ? "#22C55E" : c.weekend ? "#A78BFA" : "#9CA3AF", cornerRadius: size / 2, frame: { width: size, height: size } };
}

// Runs of equal hours become one block each, 11 points per hour, to keep the node count low.
function overlapBar(person, date, height) {
  const colors = { both: "#22C55E", them: `${person.color}99`, me: { light: "#CBD5E1", dark: "#475569" }, none: { light: "#E2E8F0", dark: "#1F2937" } };
  const runs = [];
  for (const kind of overlapCells(person, date)) {
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.hours += 1;
    else runs.push({ kind, hours: 1 });
  }
  return Widget.hstack(runs.map((run) => ({
    type: "stack", direction: "vertical", children: [],
    background: colors[run.kind], cornerRadius: 2,
    frame: { width: run.hours * 11 - 1, height },
  })), { spacing: 1 });
}

function tile(person, c, compact) {
  const tint = TINTS[c.sun];
  return Widget.vstack([
    Widget.hstack([
      Widget.symbol(tint.symbol, { size: compact ? 10 : 12, color: tint.color, fallback: tint.fallback }),
      Widget.text(person.name, { font: compact ? "caption2" : "caption", weight: "semibold", lineLimit: 1, minimumScale: 0.7 }),
      Widget.spacer(),
      statusDot(c),
    ], { spacing: 4 }),
    Widget.hstack([
      Widget.text(c.time, { font: compact ? 20 : 24, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
      dayBadge(c),
      Widget.spacer(),
      temp(person) ? Widget.text(temp(person), { font: "caption2", color: "secondary" }) : null,
    ], { spacing: 3, alignment: "top" }),
    Widget.text(`${person.city} · ${fmtOffset(c.difference)}h`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
  ], { alignment: "leading", spacing: 1, padding: compact ? 7 : 9, background: tint.bg, cornerRadius: 11, frame: { maxWidth: "infinity", alignment: "leading" } });
}

function placeholder(family) {
  if (family === "rectangular") return Widget.vstack([
    Widget.text("Team Clocks", { font: "headline" }),
    Widget.text("Add teammates in the mini-app", { font: "caption2" }),
  ], { alignment: "leading", spacing: 1, url: appLink });
  return Widget.vstack([
    Widget.symbol("globe.europe.africa.fill", { size: 30, color: BLUE, fallback: "🌍" }),
    Widget.text("No teammates yet", { font: "headline" }),
    Widget.text("Open Team Clocks and add a name and a city.", { font: "caption2", color: "secondary", align: "center", lineLimit: 2 }),
  ], { spacing: 6, padding: 14, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
}

function render(family, date) {
  const list = people();
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const clocks = list.map((p) => ({ p, c: clock(p, date) }));

  if (family === "rectangular") {
    return Widget.vstack(clocks.slice(0, 3).map(({ p, c }) => Widget.hstack([
      Widget.text(p.name, { font: "caption", weight: c.working ? "bold" : "regular", lineLimit: 1, minimumScale: 0.7 }),
      Widget.spacer(),
      Widget.text(c.time, { font: "caption", weight: "semibold", design: "rounded" }),
      c.dayOffset ? Widget.text(c.dayOffset > 0 ? "+1" : "−1", { font: "caption2" }) : null,
    ], { spacing: 3 })), { alignment: "leading", spacing: 1, url: appLink });
  }

  if (family === "small") {
    return Widget.vstack([
      ...clocks.slice(0, 3).map(({ p, c }) => {
        const tint = TINTS[c.sun];
        return Widget.hstack([
          Widget.symbol(tint.symbol, { size: 11, color: tint.color, fallback: tint.fallback }),
          Widget.vstack([
            Widget.text(p.name, { font: "caption2", weight: "semibold", lineLimit: 1, minimumScale: 0.7 }),
            Widget.text(p.city, { font: 9, color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
          ], { alignment: "leading", spacing: 0 }),
          Widget.spacer(),
          Widget.text(c.time, { font: 17, weight: "bold", design: "rounded" }),
          dayBadge(c, 9),
          statusDot(c, 6),
        ], { spacing: 5, padding: { horizontal: 7, vertical: 5 }, background: tint.bg, cornerRadius: 9 });
      }),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 4, padding: 11, url: appLink, frame: fill });
  }

  if (family === "medium") {
    const shown = clocks.slice(0, 6);
    const rows = Array.from({ length: Math.ceil(shown.length / 3) }, (_, r) => Widget.hstack(shown.slice(r * 3, r * 3 + 3).map(({ p, c }) => tile(p, c, true)), { spacing: 6 }));
    return Widget.vstack([...rows, Widget.spacer()], { alignment: "leading", spacing: 6, padding: 10, url: appLink, frame: fill });
  }

  // large
  const common = describeHours(commonHours(date));
  const shown = clocks.slice(0, 5);
  return Widget.vstack([
    Widget.hstack([
      Widget.text("Team Clocks", { font: "headline" }),
      Widget.spacer(),
      Widget.text(`You · ${fmtTime(myZone, date)} · ${zoneLabel(myZone)}`, { font: "caption", color: "secondary", lineLimit: 1 }),
    ]),
    ...shown.map(({ p, c }) => {
      const tint = TINTS[c.sun];
      return Widget.vstack([
        Widget.hstack([
          Widget.symbol(tint.symbol, { size: 12, color: tint.color, fallback: tint.fallback }),
          Widget.text(p.name, { font: "subheadline", weight: "semibold", lineLimit: 1 }),
          Widget.text(`${p.city} · ${fmtOffset(c.difference)}h`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
          Widget.spacer(),
          temp(p) ? Widget.text(temp(p), { font: "caption", color: "secondary" }) : null,
          Widget.text(c.time, { font: 20, weight: "bold", design: "rounded" }),
          dayBadge(c, "caption"),
          statusDot(c),
        ], { spacing: 5 }),
        overlapBar(p, date, 7),
      ], { alignment: "leading", spacing: 4, padding: { horizontal: 9, vertical: 6 }, background: tint.bg, cornerRadius: 11 });
    }),
    Widget.spacer(),
    Widget.hstack([
      { type: "stack", direction: "horizontal", children: [], background: "#22C55E", cornerRadius: 2, frame: { width: 10, height: 7 } },
      Widget.text(common ? `Everyone working: ${common} your time` : list.length > 1 ? "No hour when everyone is working" : "Green: both of you working", { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
      Widget.spacer(),
      Widget.text("0h  →  24h", { font: "caption2", color: "secondary" }),
    ], { spacing: 5 }),
  ], { alignment: "leading", spacing: 6, padding: 14, url: appLink, frame: fill });
}

// ───────────────────────── Widget

Script.widget(({ family }) => {
  if (!people().length) return { content: placeholder(family), refreshAfter: 60 * 60 };
  // Entries for the next half hour, so the clocks tick between refreshes: every minute for the small sizes,
  // less often for the bigger trees to keep the result small.
  const step = family === "large" ? 6 : family === "medium" ? 2 : 1;
  const count = family === "large" ? 6 : family === "medium" ? 16 : 31;
  const start = new Date(Math.floor(Date.now() / MINUTE) * MINUTE);
  const timeline = Array.from({ length: count }, (_, i) => {
    const date = new Date(start.getTime() + i * step * MINUTE);
    return { date, content: render(family, date) };
  });
  return { timeline, refreshAfter: 30 * 60 };
});

// ───────────────────────── Script.run (Siri and Shortcuts)

Script.run((input) => {
  const list = people();
  if (!list.length) return "No teammates yet. Open Team Clocks to add some.";
  const now = new Date();
  const wanted = String(input ?? "").trim().toLowerCase();
  const shown = wanted ? list.filter((p) => p.name.toLowerCase().includes(wanted) || p.city.toLowerCase().includes(wanted)) : list;
  if (!shown.length) return `Nobody called ${input}.`;
  return shown.map((p) => {
    const c = clock(p, now);
    return `${p.name} in ${p.city}: ${c.time}${c.dayOffset ? (c.dayOffset > 0 ? " tomorrow" : " yesterday") : ""}, ${c.working ? "working hours" : c.weekend ? "weekend" : "off hours"}`;
  }).join("\n");
});

// ───────────────────────── Mini-app

const NOTICE_COLORS = { info: "blue", success: "green", warn: "orange" };
const CARD = { light: "#F8FAFC", dark: "#1E293B" };

function noticeView() {
  const n = Storage.get("notice");
  if (!n || Date.now() - n.time > 5 * MINUTE) return null;
  return Widget.text(n.text, { font: "footnote", color: NOTICE_COLORS[n.kind] ?? "secondary", padding: 10, background: CARD, cornerRadius: 10, frame: { maxWidth: "infinity", alignment: "leading" } });
}

const zoneOptions = () => {
  const names = ZONES.map(([z]) => z);
  if (!names.includes(myZone)) names.unshift(myZone);
  return names.map((z) => ({ label: `${zoneLabel(z)} (${fmtOffset(zoneOffset(z, new Date()))})`, value: z }));
};

function personCard(person, index, date, shifted) {
  const c = clock(person, date, date);
  const tint = TINTS[c.sun];
  const w = weatherFor(person);
  const overlap = overlapCells(person, date).filter((k) => k === "both").length;
  return Widget.vstack([
    Widget.hstack([
      Widget.symbol(tint.symbol, { size: 18, color: tint.color, fallback: tint.fallback }),
      Widget.vstack([
        Widget.text(person.name, { font: "headline" }),
        Widget.text(`${person.city}${person.country ? `, ${person.country}` : ""} · ${zoneLabel(person.zone)} · ${fmtOffset(c.difference)}h from you`, { font: "caption", color: "secondary", lineLimit: 2 }),
      ], { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", alignment: "leading" } }),
      Widget.vstack([
        Widget.hstack([
          Widget.text(c.time, { font: 30, weight: "bold", design: "rounded" }),
          dayBadge(c, "caption"),
        ], { spacing: 3, alignment: "top" }),
        Widget.hstack([
          statusDot(c, 8),
          Widget.text(c.working ? "working hours" : c.weekend ? "weekend" : shifted ? "off hours" : "off hours", { font: "caption2", color: "secondary" }),
        ], { spacing: 4 }),
      ], { alignment: "trailing", spacing: 2 }),
    ], { spacing: 10 }),
    overlapBar(person, date, 12),
    Widget.hstack([
      Widget.text("0", { font: "caption2", color: "secondary" }),
      Widget.spacer(),
      Widget.text(`overlap ${overlap} h`, { font: "caption2", weight: "semibold", color: overlap ? "green" : "secondary" }),
      Widget.spacer(),
      Widget.text("24 (your time)", { font: "caption2", color: "secondary" }),
    ]),
    Widget.hstack([
      w && !w.error && w.temp != null ? Widget.hstack([
        Widget.symbol(w.symbol ?? "cloud.fill", { size: 14, color: "secondary", fallback: "☁️" }),
        Widget.text(`${w.temp}° ${w.description ?? ""}`, { font: "caption", color: "secondary", lineLimit: 1 }),
      ], { spacing: 4 }) : null,
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [
        { title: "Move up", symbol: "arrow.up", action: "move", args: { id: person.id, by: -1 } },
        { title: "Move down", symbol: "arrow.down", action: "move", args: { id: person.id, by: 1 } },
        { title: "Remove", symbol: "trash", action: "remove", args: { id: person.id }, destructive: true },
      ]),
    ]),
    Widget.picker(zoneOptions(), person.zone, "zone", { id: person.id }, { label: "Time zone" }),
  ], { alignment: "leading", spacing: 8, padding: 14, background: tint.bg, cornerRadius: 16 });
}

function addCard() {
  const d = draft();
  const place = d.picked != null ? d.results[d.picked] : null;
  return Widget.card([
    Widget.textField("Name", d.name, "draftName", null, { label: "Teammate" }),
    Widget.textField("City, then Return", d.city, "draftCity", null, { label: "City", keyboard: "search" }),
    d.results.length > 1 ? Widget.list(d.results.map((r, index) => ({
      title: r.name, subtitle: [r.region, r.country].filter(Boolean).join(", "), symbol: index === d.picked ? "checkmark.circle.fill" : "mappin.circle", color: index === d.picked ? "green" : "secondary", action: "draftPick", args: { index },
    })), { style: "plain" }) : null,
    place ? Widget.text(`${place.name}${place.country ? `, ${place.country}` : ""} · ${place.latitude.toFixed(2)}, ${place.longitude.toFixed(2)}`, { font: "caption", color: "secondary" }) : null,
    place ? Widget.picker(zoneOptions(), d.zone, "draftZone", null, { label: "Time zone (suggested from the country and longitude)" }) : null,
    place ? Widget.text(`It is ${fmtTime(d.zone, new Date())} there now.`, { font: "footnote", color: "secondary" }) : null,
    Widget.button(Widget.hstack([Widget.symbol("person.badge.plus", { size: 14, color: "white", fallback: "+" }), Widget.text("Add teammate", { color: "white", weight: "semibold" })], { spacing: 6 }), "addPerson", null, { style: "prominent", color: BLUE }),
  ], { title: "Add a teammate", symbol: "person.crop.circle.badge.plus", color: BLUE });
}

Script.ui(async () => {
  await refreshWeather().catch(() => {});
  const list = people();
  const s = settings();
  const shift = shiftHours();
  const date = new Date(Date.now() + shift * 3_600_000);
  const common = describeHours(commonHours(date));
  const credit = Storage.get("credit");

  return {
    title: "Team Clocks",
    content: Widget.vstack([
      noticeView(),
      Widget.vstack([
        Widget.hstack([
          Widget.vstack([
            Widget.text(shift ? "IF IT WERE" : "YOUR TIME", { font: "caption2", weight: "bold", color: BLUE }),
            Widget.text(fmtTime(myZone, date), { font: 40, weight: "bold", design: "rounded" }),
            Widget.text(`${zoneLabel(myZone)} · ${date.toLocaleDateString(locale, { timeZone: myZone, weekday: "long" })}`, { font: "caption", color: "secondary" }),
          ], { alignment: "leading", spacing: 0 }),
          Widget.spacer(),
          shift ? Widget.button("Back to now", "resetShift", null, { style: "bordered" }) : null,
        ]),
        Widget.slider(shift, "shift", null, { min: -12, max: 12, step: 0.5, label: shift ? `${shift > 0 ? "+" : ""}${shift} h from now` : "Slide to try another hour", color: BLUE }),
        list.length > 1 ? Widget.hstack([
          { type: "stack", direction: "horizontal", children: [], background: "#22C55E", cornerRadius: 3, frame: { width: 12, height: 12 } },
          Widget.text(common ? `Everyone is working ${common} your time.` : "There is no hour when everyone is working.", { font: "footnote" }),
        ], { spacing: 6 }) : null,
      ], { alignment: "leading", spacing: 10, padding: 16, background: CARD, cornerRadius: 16 }),

      ...list.map((p, i) => personCard(p, i, date, shift !== 0)),
      list.length ? null : Widget.text("Add the people you work with and see at a glance when you can reach them.", { font: "footnote", color: "secondary", align: "center", padding: 8 }),
      addCard(),

      Widget.card([
        Widget.stepper(`Working hours start ${fmtHour(s.workStart)}`, s.workStart, "work", { field: "workStart" }, { min: 0, max: 23 }),
        Widget.stepper(`Working hours end ${fmtHour(s.workEnd)}`, s.workEnd, "work", { field: "workEnd" }, { min: 1, max: 24 }),
        Widget.text("The same hours are assumed for everyone, in their own zone. Weekends count as off.", { font: "caption2", color: "secondary" }),
        Widget.toggle("Show weather", s.weather, "weatherToggle", null, { color: BLUE }),
        s.weather ? Widget.hstack([
          Widget.text("Apple Weather for each city, fetched while this screen is open.", { font: "caption2", color: "secondary", frame: { maxWidth: "infinity", alignment: "leading" } }),
          Widget.button("Refresh", "refreshWeather", null, { style: "bordered" }),
        ], { spacing: 8 }) : null,
        s.weather && credit ? Widget.text(credit.text, { font: "caption2", color: "secondary", url: credit.url }) : null,
      ], { title: "Settings", symbol: "gearshape.fill", color: "gray" }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});
