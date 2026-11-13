// @name        Waypoints
// @description Save places (where you stand, or a search result) and get a compass arrow and distance to the one you pick, on the Home Screen and the Lock Screen. Searches go to Apple Maps; nothing else leaves the device.
// @permissions location, motion
// @widget      small, medium, large, circular, rectangular, inline
// @icon        location.north.circle.fill
// @color       #0891B2
// @version     1.0.0
// @author      scriptwell
// @category    navigation

// How it works
// • Save a waypoint from your current position (best accuracy) with a name, or search a place by name.
//   Search text goes to Apple's map servers (Location.search); positions and waypoints stay on the device.
// • Tap a waypoint to make it active. The mini-app shows an arrow relative to the way you face
//   (Compass.heading plus the bearing from you to the waypoint) and the distance (Location.distance),
//   in metres/kilometres or feet/miles depending on your locale.
// • The screen only redraws after a tap, so use Refresh to update the arrow; there is no timer that
//   could redraw it for you. "Navigate" opens Apple Maps with directions to the waypoint.
// • Widgets show the last known bearing and distance from Storage and, when iOS gives them a fresh
//   position, an updated distance. The compass is not available in widgets, so the arrow there is relative
//   to the heading from your last refresh (or points by compass direction when that is stale). The large
//   widget shows a map with every pin. Tapping a widget opens the mini-app; "Navigate" opens Apple Maps.
// • Run the script once in the app before adding a widget, so location and motion are approved.

// ───────────────────────── Constants

const imperial = /-(US|GB|LR|MM)$/i.test(Script.env.locale);
const locale = Script.env.locale;
const HEADING_FRESH_MS = 10 * 60_000;
const ARROWS = ["arrow.up", "arrow.up.right", "arrow.right", "arrow.down.right", "arrow.down", "arrow.down.left", "arrow.left", "arrow.up.left"];
const ARROW_CHARS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const PIN_COLORS = ["cyan", "orange", "pink", "green", "purple", "yellow", "red", "indigo"];

const TEAL = "#06B6D4";
const WIDGET_BG = Widget.gradient(["#083344", "#155E75", "#0E7490"], { direction: "topLeadingToBottomTrailing" });
const CARD_BG = { light: "#FFFFFF", dark: "#1C1C1E" };
const SOFT_WHITE = "#FFFFFFB3";
const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────── Storage

const waypoints = () => Storage.get("waypoints", []);          // [{ id, name, latitude, longitude, address, created }]
const active = () => waypoints().find((w) => w.id === Storage.get("activeId")) ?? waypoints()[0] ?? null;
const fix = () => Storage.get("fix");                           // { latitude, longitude, accuracy, heading, headingAccuracy, time }
const pinColor = (index) => PIN_COLORS[index % PIN_COLORS.length];

function saveWaypoint(place, name) {
  const w = {
    id: crypto.randomUUID(),
    name: name.trim(),
    latitude: place.latitude,
    longitude: place.longitude,
    address: place.address ?? null,
    created: Date.now(),
  };
  Storage.set("waypoints", [...waypoints(), w].slice(-50));
  Storage.set("activeId", w.id);
  return w;
}

// ───────────────────────── Geometry and formatting

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

function bearing(from, to) {
  const dLon = rad(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(rad(to.latitude));
  const x = Math.cos(rad(from.latitude)) * Math.sin(rad(to.latitude)) - Math.sin(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Location.distance is arithmetic and needs no permission; fall back to the haversine formula if it is ever unavailable.
function metres(a, b) {
  try { return Location.distance(a, b); } catch {
    const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return 6_371_000 * 2 * Math.asin(Math.sqrt(h));
  }
}

function formatDistance(m) {
  if (!Number.isFinite(m)) return "–";
  const num = (v, digits) => v.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  if (imperial) {
    const feet = m / 0.3048;
    if (feet < 1000) return `${num(Math.round(feet / 10) * 10, 0)} ft`;
    const miles = m / 1609.344;
    return `${num(miles, miles < 10 ? 1 : 0)} mi`;
  }
  if (m < 1000) return `${num(Math.round(m / (m < 100 ? 1 : 10)) * (m < 100 ? 1 : 10), 0)} m`;
  const km = m / 1000;
  return `${num(km, km < 10 ? 1 : 0)} km`;
}

const compassPoint = (b) => POINTS[Math.round(b / 22.5) % 16];
const sector = (relative) => Math.round(((relative % 360) + 360) % 360 / 45) % 8;

// Everything the screens need about one waypoint, given the latest fix.
function describe(w, f) {
  if (!w || !f) return null;
  const abs = bearing(f, w);
  const headingFresh = f.heading !== null && Date.now() - f.time < HEADING_FRESH_MS;
  const relative = f.heading === null ? null : (abs - f.heading + 360) % 360;
  const turn = relative === null ? null : ((relative + 540) % 360) - 180; // −180…180, negative = left
  return {
    distance: metres(f, w),
    bearing: abs,
    point: compassPoint(abs),
    relative,
    turn,
    headingFresh,
    // With no usable heading, point the arrow by compass direction (north up).
    arrow: ARROWS[sector(relative ?? abs)],
    arrowChar: ARROW_CHARS[sector(relative ?? abs)],
  };
}

function turnText(d) {
  if (!d) return "";
  if (d.turn === null) return `Head ${d.point}`;
  if (Math.abs(d.turn) <= 12) return "Straight ahead";
  if (Math.abs(d.turn) >= 168) return "Behind you";
  return `Turn ${d.turn > 0 ? "right" : "left"} ${Math.round(Math.abs(d.turn))}°`;
}

// ───────────────────────── Reading the sensors

async function refresh({ accuracy = "best", compass = true } = {}) {
  const here = await Location.current({ accuracy });
  let heading = null, headingAccuracy = null;
  if (compass && Script.env.mode !== "widget") {
    try {
      if (await Compass.available()) {
        const reading = await Compass.heading({ timeout: 4000 });
        heading = reading.heading;
        headingAccuracy = reading.accuracy;
      }
    } catch { /* no compass, or still calibrating: fall back to north-up */ }
  }
  const f = { latitude: here.latitude, longitude: here.longitude, accuracy: here.accuracy, heading, headingAccuracy, time: Date.now() };
  Storage.set("fix", f);
  Storage.set("lastError", null);
  return f;
}

// ───────────────────────── Actions

Script.action("refresh", async () => {
  try { await refresh(); await UI.haptic("light"); }
  catch (e) { Storage.set("lastError", `Could not get a position: ${e.message}`); await UI.haptic("error"); }
});

Script.action("saveHere", async () => {
  const name = await UI.prompt({ title: "Name this place", placeholder: "Car, tent, trailhead…" });
  if (!name?.trim()) return;
  try {
    const f = await refresh();
    let address = null;
    try { address = (await Location.reverseGeocode(f))[0]?.address ?? null; } catch { /* optional */ }
    saveWaypoint({ ...f, address }, name);
    await UI.haptic("success");
  } catch (e) {
    Storage.set("lastError", `Could not get a position: ${e.message}`);
  }
});

Script.action("query", async ({ value }) => {
  const query = (value ?? "").trim();
  Storage.set("query", query);
  if (!query) { Storage.remove("searchResults"); return; }
  try {
    const near = fix() ?? undefined;
    const results = await Location.search(query, { near, limit: 8 });
    Storage.set("searchResults", results.map((p) => ({ name: p.name ?? query, address: p.address, latitude: p.latitude, longitude: p.longitude })));
    Storage.set("lastError", null);
  } catch (e) {
    Storage.set("lastError", `Search failed: ${e.message}`);
  }
});

Script.action("addResult", async ({ index }) => {
  const place = (Storage.get("searchResults") ?? [])[index];
  if (!place) return;
  const name = await UI.prompt({ title: "Save as", defaultValue: place.name });
  if (name === null) return;
  saveWaypoint(place, name || place.name);
  Storage.remove("searchResults");
  Storage.set("query", "");
  await UI.haptic("success");
});

Script.action("activate", ({ id, index }) => {
  const w = id ? waypoints().find((x) => x.id === id) : waypoints()[index];
  if (w) Storage.set("activeId", w.id);
});

Script.action("rename", async () => {
  const w = active();
  if (!w) return;
  const name = await UI.prompt({ title: "Rename waypoint", defaultValue: w.name });
  if (name?.trim()) Storage.set("waypoints", waypoints().map((x) => (x.id === w.id ? { ...x, name: name.trim() } : x)));
});

Script.action("delete", async () => {
  const w = active();
  if (!w) return;
  const choice = await UI.alert({ title: `Delete “${w.name}”?`, buttons: ["Cancel", "Delete"] });
  if (choice !== 1) return;
  Storage.set("waypoints", waypoints().filter((x) => x.id !== w.id));
  Storage.remove("activeId");
});

Script.action("navigate", async ({ walking }) => {
  const w = active();
  if (!w) return;
  await UI.openURL(`maps://?daddr=${w.latitude},${w.longitude}${walking ? "&dirflg=w" : ""}`);
});

// ───────────────────────── Mini-app

function heroCard(w, f, d) {
  if (!w) {
    return Widget.vstack([
      Widget.symbol("location.north.circle", { size: 64, color: TEAL, fallback: "🧭" }),
      Widget.text("No waypoints yet", { font: "title3", weight: "semibold" }),
      Widget.text("Save where you are, or search a place below.", { font: "footnote", color: "secondary", align: "center" }),
    ], { spacing: 8, padding: 24, background: CARD_BG, cornerRadius: 20, frame: { maxWidth: "infinity" } });
  }
  if (!f || !d) {
    return Widget.vstack([
      Widget.text(w.name, { font: "title2", weight: "bold" }),
      Widget.text("Tap Refresh to get your position and heading.", { font: "footnote", color: "secondary" }),
      Widget.button("Refresh", "refresh", null, { style: "prominent", color: "cyan" }),
    ], { spacing: 10, padding: 20, background: CARD_BG, cornerRadius: 20, frame: { maxWidth: "infinity" } });
  }
  return Widget.vstack([
    Widget.text(w.name, { font: "title2", weight: "bold", lineLimit: 1 }),
    Widget.symbol(d.arrow, { size: 96, color: TEAL, fallback: d.arrowChar }),
    Widget.text(formatDistance(d.distance), { font: 44, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
    Widget.text(turnText(d), { font: "headline", color: TEAL }),
    Widget.text(`Bearing ${Math.round(d.bearing)}° ${d.point}${f.heading === null ? " · no compass reading, arrow is north-up" : ` · you face ${Math.round(f.heading)}° ${compassPoint(f.heading)}`}`, { font: "caption", color: "secondary", align: "center", lineLimit: 2 }),
    Widget.hstack([
      Widget.text(`±${Math.round(f.accuracy)} m`, { font: "caption2", color: "secondary" }),
      f.headingAccuracy === null && f.heading !== null ? Widget.text("· compass needs calibrating (move the phone in a figure of eight)", { font: "caption2", color: "orange", lineLimit: 2 }) : null,
      Widget.text("· updated", { font: "caption2", color: "secondary" }),
      Widget.date(f.time, { style: "relative", font: "caption2", color: "secondary" }),
    ], { spacing: 3 }),
    Widget.hstack([
      Widget.button("Refresh", "refresh", null, { style: "prominent", color: "cyan" }),
      Widget.button("Walk", "navigate", { walking: true }, { style: "bordered", color: "cyan" }),
      Widget.button("Drive", "navigate", { walking: false }, { style: "bordered", color: "cyan" }),
      Widget.menu("ellipsis.circle", [
        { title: "Rename", symbol: "pencil", action: "rename" },
        { title: "Delete waypoint", symbol: "trash", action: "delete", destructive: true },
      ]),
    ], { spacing: 10 }),
  ], { spacing: 8, padding: 20, background: CARD_BG, cornerRadius: 20, frame: { maxWidth: "infinity" } });
}

function mapCard(list, f) {
  const pins = list.map((w, i) => ({ title: w.name, latitude: w.latitude, longitude: w.longitude, color: pinColor(i) }));
  if (f) pins.push({ title: "You", latitude: f.latitude, longitude: f.longitude, color: "blue" });
  if (pins.length === 0) return null;
  return Widget.map({ pins, action: "activate", frame: { height: 240 }, cornerRadius: 16 });
}

Script.ui(() => {
  const list = waypoints();
  const w = active();
  const f = fix();
  const d = describe(w, f);
  const results = Storage.get("searchResults");
  const error = Storage.get("lastError");

  return {
    title: w ? w.name : "Waypoints",
    content: Widget.vstack([
      error ? Widget.text(error, { font: "footnote", color: "orange", padding: { horizontal: 12, vertical: 8 }, background: { light: "#FFEDD5", dark: "#431407" }, cornerRadius: 10 }) : null,
      heroCard(w, f, d),
      mapCard(list, f),
      Widget.hstack([
        Widget.button("Save my location", "saveHere", null, { style: "bordered", color: "cyan" }),
        Widget.spacer(),
      ]),
      Widget.textField("Search a place (Apple Maps)", Storage.get("query", ""), "query", null, { keyboard: "search" }),
      results ? (results.length
        ? Widget.list(results.map((p) => ({
            title: p.name,
            subtitle: p.address ?? `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`,
            symbol: "mappin.circle",
            color: "cyan",
            detail: f ? formatDistance(metres(f, p)) : "",
          })), { title: "Tap to save", action: "addResult" })
        : Widget.text("Nothing found. Try a fuller name or add the town.", { font: "footnote", color: "secondary" })) : null,
      list.length ? Widget.list(list.map((x, i) => {
        const dx = describe(x, f);
        return {
          title: x.name,
          subtitle: x.address ?? `${x.latitude.toFixed(5)}, ${x.longitude.toFixed(5)}`,
          symbol: x.id === w?.id ? "location.north.circle.fill" : "mappin",
          color: pinColor(i),
          detail: dx ? `${dx.arrowChar} ${formatDistance(dx.distance)}` : "",
          action: "activate",
          args: { id: x.id },
        };
      }), { title: `Waypoints (${list.length}) · tap to make active` }) : null,
      Widget.text("The arrow uses the compass heading from the last refresh and the bearing from your position to the waypoint. Distances are straight-line.", { font: "caption2", color: "secondary" }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});

// ───────────────────────── Widgets

function navigateChip(w, light = true) {
  return Widget.hstack([
    Widget.symbol("arrow.triangle.turn.up.right.diamond.fill", { size: 11, color: light ? "white" : TEAL, fallback: "➤" }),
    Widget.text("Navigate", { font: "caption2", weight: "semibold", color: light ? "white" : TEAL }),
  ], { spacing: 4, padding: { horizontal: 9, vertical: 5 }, background: light ? "#FFFFFF2E" : { light: "#CFFAFE", dark: "#164E63" }, cornerRadius: 8, url: `maps://?daddr=${w.latitude},${w.longitude}` });
}

function headingNote(f, d) {
  if (!f) return "no position yet";
  if (f.heading === null) return "arrow is north-up";
  return d.headingFresh ? `facing ${compassPoint(f.heading)}` : `heading from ${new Date(f.time).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
}

function lockScreen(family, w, f, d) {
  if (!w) return family === "inline" ? Widget.text("Waypoints: add one in Scriptwell") : Widget.text("Add a waypoint", { font: "caption" });
  if (!d) return family === "inline" ? Widget.text(`${w.name}: refresh in Scriptwell`) : Widget.vstack([
    Widget.text(w.name, { font: "headline", lineLimit: 1 }),
    Widget.text("Refresh in app", { font: "caption2" }),
  ], { spacing: 1 });
  if (family === "inline") return Widget.text(`${d.arrowChar} ${formatDistance(d.distance)} · ${w.name}`);
  if (family === "circular") {
    return Widget.vstack([
      Widget.symbol(d.arrow, { size: 24, fallback: d.arrowChar }),
      Widget.text(formatDistance(d.distance), { font: "caption2", weight: "bold", lineLimit: 1, minimumScale: 0.6 }),
    ], { spacing: 1 });
  }
  return Widget.hstack([
    Widget.symbol(d.arrow, { size: 30, fallback: d.arrowChar }),
    Widget.vstack([
      Widget.text(w.name, { font: "headline", lineLimit: 1 }),
      Widget.text(`${formatDistance(d.distance)} · ${d.point}`, { font: "caption", lineLimit: 1 }),
      Widget.text(headingNote(f, d), { font: "caption2", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 0 }),
  ], { spacing: 8 });
}

function emptyWidget() {
  return Widget.vstack([
    Widget.symbol("location.north.circle", { size: 30, color: "white", fallback: "🧭" }),
    Widget.text(waypoints().length ? "Open Waypoints and tap Refresh" : "Open Waypoints and save a place", { font: "caption", color: SOFT_WHITE, align: "center", lineLimit: 3 }),
  ], { spacing: 8, padding: 14, background: WIDGET_BG, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
}

function smallWidget(w, f, d) {
  return Widget.vstack([
    Widget.text(w.name.toUpperCase(), { font: "caption2", weight: "bold", color: "#A5F3FC", lineLimit: 1 }),
    Widget.spacer(),
    Widget.symbol(d.arrow, { size: 46, color: "white", fallback: d.arrowChar }),
    Widget.spacer(),
    Widget.text(formatDistance(d.distance), { font: 26, weight: "bold", design: "rounded", color: "white", lineLimit: 1, minimumScale: 0.6 }),
    Widget.text(headingNote(f, d), { font: "caption2", color: SOFT_WHITE, lineLimit: 1 }),
  ], { alignment: "leading", spacing: 2, padding: 14, background: WIDGET_BG, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
}

function mediumWidget(w, f, d) {
  return Widget.hstack([
    Widget.vstack([
      Widget.symbol(d.arrow, { size: 52, color: "white", fallback: d.arrowChar }),
      Widget.text(formatDistance(d.distance), { font: 24, weight: "bold", design: "rounded", color: "white", lineLimit: 1, minimumScale: 0.6 }),
    ], { spacing: 6, frame: { width: 104 } }),
    Widget.vstack([
      Widget.text(w.name, { font: "headline", color: "white", lineLimit: 1 }),
      Widget.text(turnText(d), { font: "subheadline", weight: "semibold", color: "#A5F3FC", lineLimit: 1 }),
      Widget.text(`Bearing ${Math.round(d.bearing)}° ${d.point} · ${headingNote(f, d)}`, { font: "caption2", color: SOFT_WHITE, lineLimit: 2 }),
      Widget.spacer(),
      Widget.hstack([
        navigateChip(w),
        Widget.spacer(),
        Widget.date(f.time, { style: "relative", font: "caption2", color: SOFT_WHITE }),
      ]),
    ], { alignment: "leading", spacing: 3, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
  ], { spacing: 12, padding: 14, background: WIDGET_BG, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
}

function largeWidget(w, f, d) {
  const list = waypoints();
  const pins = list.map((x, i) => ({ title: x.name, latitude: x.latitude, longitude: x.longitude, color: x.id === w.id ? "cyan" : pinColor(i) }));
  pins.push({ title: "You", latitude: f.latitude, longitude: f.longitude, color: "blue" });
  const others = list.filter((x) => x.id !== w.id).map((x, i) => ({ x, dx: describe(x, f), i })).sort((a, b) => a.dx.distance - b.dx.distance).slice(0, 4);
  return Widget.vstack([
    Widget.map({ pins, frame: { height: 150 }, cornerRadius: 14 }),
    Widget.hstack([
      Widget.symbol(d.arrow, { size: 34, color: "white", fallback: d.arrowChar }),
      Widget.vstack([
        Widget.text(w.name, { font: "headline", color: "white", lineLimit: 1 }),
        Widget.text(`${turnText(d)} · ${headingNote(f, d)}`, { font: "caption2", color: SOFT_WHITE, lineLimit: 1 }),
      ], { alignment: "leading", spacing: 1 }),
      Widget.spacer(),
      Widget.text(formatDistance(d.distance), { font: "title2", weight: "bold", design: "rounded", color: "white", lineLimit: 1, minimumScale: 0.6 }),
    ], { spacing: 10 }),
    Widget.hstack([navigateChip(w), Widget.spacer(), Widget.date(f.time, { style: "relative", font: "caption2", color: SOFT_WHITE })]),
    others.length ? Widget.divider() : null,
    ...others.map(({ x, dx }) => Widget.hstack([
      Widget.symbol(dx.arrow, { size: 13, color: "#A5F3FC", fallback: dx.arrowChar }),
      Widget.text(x.name, { font: "caption", color: "white", lineLimit: 1 }),
      Widget.spacer(),
      Widget.text(`${formatDistance(dx.distance)} ${dx.point}`, { font: "caption", weight: "semibold", color: "white" }),
    ], { spacing: 6 })),
    Widget.spacer(),
  ], { alignment: "leading", spacing: 7, padding: 14, background: WIDGET_BG, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
}

Script.widget(async ({ family, parameter }) => {
  const list = waypoints();
  const w = list.find((x) => parameter && x.name.toLowerCase() === parameter.trim().toLowerCase()) ?? active();
  let f = fix();

  // A fresh position when iOS grants one; the heading stays from the last refresh in the app.
  if (w && f && Date.now() - f.time > 5 * 60_000) {
    try {
      const here = await Location.current({ accuracy: "hundredMeters" });
      f = { ...f, latitude: here.latitude, longitude: here.longitude, accuracy: here.accuracy, positionTime: Date.now() };
      Storage.set("fix", f);
    } catch { /* keep the stored fix */ }
  }

  const d = describe(w, f);
  const lock = family === "circular" || family === "rectangular" || family === "inline";
  let content;
  if (lock) content = lockScreen(family, w, f, d);
  else if (!w || !d) content = emptyWidget();
  else if (family === "small") content = smallWidget(w, f, d);
  else if (family === "medium") content = mediumWidget(w, f, d);
  else content = largeWidget(w, f, d);
  return { content, refreshAfter: 15 * 60 };
});

// ───────────────────────── Shortcuts and Siri

// "Run Waypoints" says where the active waypoint is; pass a waypoint's name as input to make it active first.
Script.run(async (input) => {
  const name = (input ?? "").trim().toLowerCase();
  if (name) {
    const match = waypoints().find((x) => x.name.toLowerCase() === name) ?? waypoints().find((x) => x.name.toLowerCase().includes(name));
    if (!match) return `No waypoint called “${input.trim()}”.`;
    Storage.set("activeId", match.id);
  }
  const w = active();
  if (!w) return "No waypoints saved yet. Open Waypoints in Scriptwell to add one.";
  try {
    const f = await refresh();
    const d = describe(w, f);
    return `${w.name} is ${formatDistance(d.distance)} away, bearing ${Math.round(d.bearing)}° ${d.point}. ${turnText(d)}.`;
  } catch (e) {
    return `Could not get a position: ${e.message}`;
  }
});
