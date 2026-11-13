// @name        Parked Car
// @description Remembers where you parked: automatically when background runs see you switch from driving to walking, or with one tap. Map widget, street name, parking-meter countdown, walking directions, a photo of the spot and a history of past spots.
// @permissions location, motion, notifications, camera
// @widget      small, medium, large, rectangular
// @icon        car.fill
// @color       #2563EB
// @version     1.0.0
// @author      va4w
// @category    navigation

// How it works
// • Automatic detection: in background runs the script reads Motion.activity(). When the last run saw
//   you driving (automotive) and this one sees you walking, your position is saved as the parking spot,
//   with the street from Location.reverseGeocode (coordinates go to Apple's map servers; nothing else).
// • Honest limit: iOS gives background runs only a few times a day, so automatic detection can be late or
//   miss a short stop. The reliable trigger is a Shortcuts automation "When CarPlay disconnects" (or when
//   your car's Bluetooth disconnects) with the action Scriptwell › Run Script › Parked Car and input
//   "park". The "I parked here" button and Siri ("Run Parked Car") work too.
// • Parking meter: pick the minutes and start it; a notification arrives 10 minutes before it runs out
//   and again when it does. The widget shows a live countdown.
// • Widgets show the map with the car pin, the street, how long ago you parked, the meter, and the
//   straight-line distance from where you are when iOS refreshes the widget. "Walk me there" opens Apple
//   Maps walking directions. The mini-app keeps the last 10 spots and can attach a photo (Camera).
// • Run the script once in the app before adding a widget, so its permissions are approved.

// ───────────────────────── Constants

const locale = Script.env.locale;
const imperial = /-(US|GB|LR|MM)$/i.test(locale);
const HISTORY_MAX = 10;
const METER_WARNING_MIN = 10;
const AUTO_MAX_DELAY_MIN = 45;      // a walk detected later than this is too far from the car to trust
const BLUE = "#3B82F6";
const WIDGET_BG = Widget.gradient(["#1E3A8A", "#1D4ED8", "#2563EB"], { direction: "topLeadingToBottomTrailing" });
const CARD_BG = { light: "#FFFFFF", dark: "#1C1C1E" };
const CHIP_BG = { light: "#FFFFFFD9", dark: "#000000B3" };
const SOFT_WHITE = "#FFFFFFB3";
const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────── Storage

const car = () => Storage.get("car");                 // { latitude, longitude, accuracy, time, street, source, delayMinutes, meterEnd, photo }
const history = () => Storage.get("history", []);     // past spots, newest first
const settings = () => ({ meterMinutes: 60, ...Storage.get("settings", {}) });
const save = (changes) => Storage.set("settings", { ...settings(), ...changes });

const directions = (c) => `maps://?daddr=${c.latitude},${c.longitude}&dirflg=w`;
const meterRunning = (c) => Boolean(c?.meterEnd && c.meterEnd > Date.now());

function formatDistance(m) {
  if (!Number.isFinite(m)) return "–";
  const num = (v, digits) => v.toLocaleString(locale, { maximumFractionDigits: digits });
  if (imperial) {
    const feet = m / 0.3048;
    return feet < 1000 ? `${num(Math.round(feet / 10) * 10, 0)} ft` : `${num(m / 1609.344, m / 1609.344 < 10 ? 1 : 0)} mi`;
  }
  return m < 1000 ? `${num(Math.round(m / 10) * 10, 0)} m` : `${num(m / 1000, m < 10_000 ? 1 : 0)} km`;
}

function metres(a, b) {
  try { return Location.distance(a, b); } catch {
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return 6_371_000 * 2 * Math.asin(Math.sqrt(h));
  }
}

// ───────────────────────── Parking

async function streetName(place) {
  try {
    const [p] = await Location.reverseGeocode(place);
    return p?.street ?? p?.name ?? p?.address ?? null;
  } catch { return null; }
}

// Saves the current position as the car's spot. `source` is "auto", "manual" or "shortcut".
async function park(source, extra = {}) {
  const here = await Location.current({ accuracy: "best" });
  const previous = car();
  if (previous) {
    try { await Notification.cancel("meter-warning"); await Notification.cancel("meter-end"); } catch { /* none pending */ }
    Storage.set("history", [{ ...previous, left: Date.now() }, ...history()].slice(0, HISTORY_MAX));
  }
  const spot = {
    latitude: here.latitude,
    longitude: here.longitude,
    accuracy: Math.round(here.accuracy ?? 0),
    time: Date.now(),
    street: await streetName(here),
    source,
    ...extra,
  };
  Storage.set("car", spot);
  Storage.set("lastError", null);
  return spot;
}

async function clearSpot() {
  const c = car();
  if (!c) return;
  try { await Notification.cancel("meter-warning"); await Notification.cancel("meter-end"); } catch { /* none pending */ }
  Storage.set("history", [{ ...c, left: Date.now() }, ...history()].slice(0, HISTORY_MAX));
  Storage.remove("car");
}

async function startMeter(minutes) {
  const c = car();
  if (!c) return;
  const end = Date.now() + minutes * 60_000;
  const street = c.street ? ` on ${c.street}` : "";
  if (minutes > METER_WARNING_MIN) {
    await Notification.schedule({ id: "meter-warning", title: `Parking runs out in ${METER_WARNING_MIN} minutes`, body: `Your car${street} is at the end of its time soon.`, at: new Date(end - METER_WARNING_MIN * 60_000) });
  }
  await Notification.schedule({ id: "meter-end", title: "Parking has run out", body: `Time is up for your car${street}.`, at: new Date(end) });
  Storage.set("car", { ...c, meterEnd: end, meterMinutes: minutes });
}

async function stopMeter() {
  const c = car();
  try { await Notification.cancel("meter-warning"); await Notification.cancel("meter-end"); } catch { /* none pending */ }
  if (c) Storage.set("car", { ...c, meterEnd: null });
}

// ───────────────────────── Automatic detection (background)

// Motion.activity() returns the most recent activity: { type, since, confidence } or null.
// Driving followed by walking means the car stopped; the walk's `since` is roughly when.
async function detectParking() {
  const now = Date.now();
  let activity;
  try { activity = await Motion.activity(); } catch (e) { Storage.set("lastError", `Motion: ${e.message}`); return null; }
  const previous = Storage.get("lastActivity");
  const record = activity ? { type: activity.type, since: new Date(activity.since).getTime(), confidence: activity.confidence, seen: now } : null;
  Storage.set("lastActivity", record);
  if (!activity || !record) return null;

  // Remember the most recent spell of driving, so a later walk can be matched to it.
  if (record.type === "automotive") { Storage.set("lastDrive", record); return null; }
  const drive = Storage.get("lastDrive") ?? (previous?.type === "automotive" ? previous : null);
  if (!drive || !/walking|stationary/.test(record.type) || record.confidence === "low") return null;
  if (record.since < drive.since) return null;                      // the walk is older than the drive
  if (car() && car().time >= drive.since) return null;             // this stop was already recorded

  const delayMinutes = Math.round((now - record.since) / 60_000);
  if (delayMinutes > AUTO_MAX_DELAY_MIN) {
    Storage.set("lastError", `Drive ended ${delayMinutes} min before the background run; too late to trust the position, so nothing was saved.`);
    Storage.remove("lastDrive");
    return null;
  }
  const spot = await park("auto", { delayMinutes });
  Storage.remove("lastDrive");
  await Notification.schedule({
    id: "auto-parked",
    title: "Parking spot saved",
    body: spot.street ? `Looks like you parked on ${spot.street}.` : "Looks like you parked. Open Parked Car to check the spot.",
    after: 2,
  });
  return spot;
}

Script.background(async () => {
  try { await detectParking(); }
  catch (e) { Storage.set("lastError", `${new Date().toISOString()} ${e.message}`); }
});

// ───────────────────────── Shortcuts, Siri and automations

// Input: "park" (or nothing) saves the spot, "clear" forgets it, "meter 90" starts a 90-minute meter,
// "where" only answers. Use "park" from a CarPlay-disconnect automation.
Script.run(async (input) => {
  const text = (input ?? "park").trim().toLowerCase();
  const meter = /^meter\s+(\d+)/.exec(text);
  try {
    if (text === "clear") { await clearSpot(); return "Parking spot cleared."; }
    if (meter) {
      if (!car()) await park("shortcut");
      await startMeter(Number(meter[1]));
      return `Meter set for ${meter[1]} minutes. You will hear ${METER_WARNING_MIN} minutes before it runs out.`;
    }
    if (text !== "where") {
      const spot = await park(Script.env.mode === "app" ? "manual" : "shortcut");
      return spot.street ? `Parked on ${spot.street}. Saved.` : "Parking spot saved.";
    }
  } catch (e) {
    return `Could not save the spot: ${e.message}`;
  }
  const c = car();
  if (!c) return "No parking spot saved.";
  const ago = Math.round((Date.now() - c.time) / 60_000);
  return `Your car is ${c.street ? `on ${c.street}, ` : ""}parked ${ago < 60 ? `${ago} min` : `${(ago / 60).toFixed(1)} h`} ago${meterRunning(c) ? `; the meter runs out in ${Math.max(1, Math.round((c.meterEnd - Date.now()) / 60_000))} min` : ""}.`;
});

// ───────────────────────── Mini-app actions

Script.action("park", async () => {
  try { await park("manual"); await UI.haptic("success"); }
  catch (e) { Storage.set("lastError", `Could not get a position: ${e.message}`); await UI.haptic("error"); }
});

Script.action("clear", async () => {
  const choice = await UI.alert({ title: "Forget this parking spot?", message: "It is kept in the history.", buttons: ["Cancel", "Forget"] });
  if (choice === 1) await clearSpot();
});

Script.action("minutes", ({ value }) => save({ meterMinutes: value }));
Script.action("preset", ({ minutes }) => save({ meterMinutes: minutes }));
Script.action("startMeter", async () => { await startMeter(settings().meterMinutes); await UI.haptic("success"); });
Script.action("extendMeter", async () => {
  const c = car();
  if (!c) return;
  const remaining = Math.max(0, (c.meterEnd ?? Date.now()) - Date.now());
  await startMeter(Math.round(remaining / 60_000) + settings().meterMinutes);
});
Script.action("stopMeter", stopMeter);

Script.action("walk", async () => { const c = car(); if (c) await UI.openURL(directions(c)); });

Script.action("photo", async () => {
  const c = car();
  if (!c) return;
  const photo = await Camera.capture({ saveAs: "spot.jpg" });
  if (photo) Storage.set("car", { ...c, photo });
});

Script.action("removePhoto", async () => {
  const c = car();
  if (!c?.photo) return;
  try { await Files.remove(c.photo.path); } catch { /* already gone */ }
  Storage.set("car", { ...c, photo: null });
});

Script.action("locate", async () => {
  try {
    const here = await Location.current({ accuracy: "hundredMeters" });
    Storage.set("here", { latitude: here.latitude, longitude: here.longitude, time: Date.now() });
  } catch (e) { Storage.set("lastError", `Could not get a position: ${e.message}`); }
});

Script.action("restore", async ({ index }) => {
  const past = history()[index];
  if (!past) return;
  const choice = await UI.alert({ title: "Use this spot again?", message: past.street ?? `${past.latitude.toFixed(5)}, ${past.longitude.toFixed(5)}`, buttons: ["Cancel", "Open in Maps", "Set as current"] });
  if (choice === 1) await UI.openURL(directions(past));
  if (choice === 2) {
    const current = car();
    if (current) Storage.set("history", [{ ...current, left: Date.now() }, ...history().filter((h) => h !== past)].slice(0, HISTORY_MAX));
    Storage.set("car", { ...past, left: undefined, meterEnd: null, photo: null, time: Date.now(), source: "manual" });
  }
});

Script.action("clearHistory", async () => {
  const choice = await UI.alert({ title: "Delete the parking history?", buttons: ["Cancel", "Delete"] });
  if (choice === 1) Storage.remove("history");
});

// ───────────────────────── Mini-app

const SOURCE_LABEL = { auto: "detected automatically", manual: "saved by you", shortcut: "saved by a shortcut" };

function meterCard(c) {
  const s = settings();
  if (meterRunning(c)) {
    const warn = c.meterEnd - Date.now() < METER_WARNING_MIN * 60_000;
    return Widget.vstack([
      Widget.text("PARKING METER", { font: "caption2", weight: "bold", color: warn ? "orange" : BLUE }),
      Widget.date(c.meterEnd, { style: "timer", font: 48, weight: "bold", design: "rounded", color: warn ? "orange" : "primary" }),
      Widget.hstack([
        Widget.text("runs out at", { font: "caption", color: "secondary" }),
        Widget.date(c.meterEnd, { style: "time", font: "caption", color: "secondary" }),
      ], { spacing: 4 }),
      Widget.hstack([
        Widget.button(`+${s.meterMinutes} min`, "extendMeter", null, { style: "bordered", color: "blue" }),
        Widget.button("Stop meter", "stopMeter", null, { style: "bordered", color: "red" }),
      ], { spacing: 10 }),
    ], { spacing: 6, padding: 16, background: CARD_BG, cornerRadius: 16, frame: { maxWidth: "infinity" } });
  }
  return Widget.vstack([
    Widget.text("PARKING METER", { font: "caption2", weight: "bold", color: BLUE }),
    Widget.hstack([15, 30, 60, 120].map((m) => Widget.button(m >= 60 ? `${m / 60} h` : `${m} min`, "preset", { minutes: m }, { style: s.meterMinutes === m ? "prominent" : "bordered", color: "blue" })), { spacing: 8 }),
    Widget.stepper(`${s.meterMinutes} minutes`, s.meterMinutes, "minutes", null, { min: 5, max: 720 }),
    Widget.button(`Start · notify ${METER_WARNING_MIN} min before`, "startMeter", null, { style: "prominent", color: "blue" }),
  ], { alignment: "leading", spacing: 10, padding: 16, background: CARD_BG, cornerRadius: 16, frame: { maxWidth: "infinity", alignment: "leading" } });
}

function spotCard(c) {
  const here = Storage.get("here");
  const distance = here ? metres(here, c) : null;
  return Widget.vstack([
    Widget.map({ center: c, span: 500, pins: [{ title: "Car", latitude: c.latitude, longitude: c.longitude, color: "blue" }, ...(here ? [{ title: "You", latitude: here.latitude, longitude: here.longitude, color: "green" }] : [])], frame: { height: 220 }, cornerRadius: 16 }),
    Widget.hstack([
      Widget.symbol("car.fill", { size: 22, color: BLUE, fallback: "🚗" }),
      Widget.vstack([
        Widget.text(c.street ?? "Unknown street", { font: "headline", lineLimit: 1 }),
        Widget.hstack([
          Widget.text("Parked", { font: "caption", color: "secondary" }),
          Widget.date(c.time, { style: "relative", font: "caption", color: "secondary" }),
          Widget.text(`· ${SOURCE_LABEL[c.source] ?? c.source}${c.delayMinutes ? `, ${c.delayMinutes} min after the drive ended` : ""} · ±${c.accuracy} m`, { font: "caption", color: "secondary", lineLimit: 2 }),
        ], { spacing: 3 }),
      ], { alignment: "leading", spacing: 2 }),
      Widget.spacer(),
    ], { spacing: 10 }),
    distance !== null ? Widget.hstack([
      Widget.symbol("figure.walk", { size: 14, color: "green", fallback: "🚶" }),
      Widget.text(`${formatDistance(distance)} away (straight line), about ${Math.max(1, Math.round((distance * 1.3) / 80))} min on foot`, { font: "footnote", color: "secondary" }),
      Widget.date(here.time, { style: "relative", font: "caption2", color: "secondary" }),
    ], { spacing: 6 }) : null,
    Widget.hstack([
      Widget.button("Walk me there", "walk", null, { style: "prominent", color: "blue" }),
      Widget.button("Where am I?", "locate", null, { style: "bordered", color: "blue" }),
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [
        { title: c.photo ? "Retake photo" : "Photo of the spot", symbol: "camera", action: "photo" },
        c.photo ? { title: "Remove photo", symbol: "trash", action: "removePhoto" } : null,
        { title: "Park somewhere else", symbol: "arrow.triangle.2.circlepath", action: "park" },
        { title: "Forget this spot", symbol: "trash", action: "clear", destructive: true },
      ].filter(Boolean)),
    ], { spacing: 10 }),
    c.photo ? Widget.image({ file: c.photo, cornerRadius: 12, frame: { maxWidth: "infinity" } }) : null,
  ], { alignment: "leading", spacing: 12 });
}

function historyList() {
  const past = history();
  if (past.length === 0) return null;
  return Widget.list(past.map((h) => ({
    title: h.street ?? `${h.latitude.toFixed(4)}, ${h.longitude.toFixed(4)}`,
    subtitle: `${new Date(h.time).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${h.left ? ` · ${Math.max(1, Math.round((h.left - h.time) / 60_000))} min` : ""}`,
    symbol: h.source === "auto" ? "sparkles" : "car",
    color: "blue",
  })), { title: `Previous spots (${past.length})`, action: "restore" });
}

Script.ui(() => {
  const c = car();
  const error = Storage.get("lastError");
  const activity = Storage.get("lastActivity");
  return {
    title: c ? (c.street ?? "Parked Car") : "Parked Car",
    content: Widget.vstack([
      error ? Widget.text(error, { font: "footnote", color: "orange", padding: { horizontal: 12, vertical: 8 }, background: { light: "#FFEDD5", dark: "#431407" }, cornerRadius: 10 }) : null,
      c ? spotCard(c) : Widget.vstack([
        Widget.symbol("car.circle", { size: 72, color: BLUE, fallback: "🚗" }),
        Widget.text("No car parked", { font: "title2", weight: "bold" }),
        Widget.text("Tap when you leave the car. Background runs also watch for the moment you stop driving and start walking.", { font: "footnote", color: "secondary", align: "center" }),
        Widget.button("I parked here", "park", null, { style: "prominent", color: "blue" }),
      ], { spacing: 10, padding: 24, background: CARD_BG, cornerRadius: 20, frame: { maxWidth: "infinity" } }),
      c ? meterCard(c) : null,
      historyList(),
      history().length ? Widget.button("Delete history", "clearHistory", null, { style: "plain", color: "red" }) : null,
      Widget.card([
        Widget.text("iOS runs this script in the background only a few times a day, so automatic detection can be late. For a reliable trigger, add a Shortcuts automation: When CarPlay disconnects (or your car's Bluetooth disconnects) › Scriptwell › Run Script › Parked Car, with the input “park”.", { font: "caption", color: "secondary" }),
        activity ? Widget.text(`Last motion check: ${activity.type} (${activity.confidence}), seen ${new Date(activity.seen).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`, { font: "caption2", color: "secondary" }) : null,
      ], { title: "Automatic detection", symbol: "sparkles", color: "blue" }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});

// ───────────────────────── Widgets

function chip(children, props = {}) {
  return Widget.hstack(children, { spacing: 4, padding: { horizontal: 8, vertical: 4 }, background: CHIP_BG, cornerRadius: 8, ...props });
}

function walkChip(c) {
  return chip([
    Widget.symbol("figure.walk", { size: 11, color: "white", fallback: "🚶" }),
    Widget.text("Walk me there", { font: "caption2", weight: "semibold", color: "white" }),
  ], { background: BLUE, url: directions(c) });
}

function meterChip(c, font = "caption2") {
  if (!meterRunning(c)) return null;
  const warn = c.meterEnd - Date.now() < METER_WARNING_MIN * 60_000;
  return chip([
    Widget.symbol("timer", { size: 11, color: warn ? "orange" : "primary", fallback: "⏱" }),
    Widget.date(c.meterEnd, { style: "timer", font, weight: "semibold", design: "monospaced", color: warn ? "orange" : "primary" }),
  ]);
}

function emptyWidget(family) {
  if (family === "rectangular") return Widget.vstack([
    Widget.text("Parked Car", { font: "headline" }),
    Widget.text("No spot saved", { font: "caption" }),
  ], { alignment: "leading", spacing: 1 });
  return Widget.vstack([
    Widget.symbol("car.circle", { size: 32, color: "white", fallback: "🚗" }),
    Widget.text("No car parked", { font: "headline", color: "white" }),
    family === "small" ? null : Widget.text("Tap to open Parked Car and save a spot", { font: "caption", color: SOFT_WHITE, align: "center" }),
  ], { spacing: 6, padding: 14, background: WIDGET_BG, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
}

Script.widget(async ({ family }) => {
  const c = car();
  if (!c) return { content: emptyWidget(family), refreshAfter: 30 * 60 };

  // Distance from wherever you are now, if iOS hands the widget a position in time.
  let here = Storage.get("here");
  try {
    const now = await Location.current({ accuracy: "hundredMeters" });
    here = { latitude: now.latitude, longitude: now.longitude, time: Date.now() };
    Storage.set("here", here);
  } catch { /* use the last known position */ }
  const distance = here ? metres(here, c) : null;
  const distanceText = distance === null ? null : `${formatDistance(distance)} away`;
  const pins = [{ title: "Car", latitude: c.latitude, longitude: c.longitude, color: "blue" }];
  if (here && distance < 3000 && family === "large") pins.push({ title: "You", latitude: here.latitude, longitude: here.longitude, color: "green" });
  let content;

  if (family === "rectangular") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("car.fill", { size: 12, fallback: "🚗" }),
        Widget.text(c.street ?? "Parked car", { font: "headline", lineLimit: 1 }),
      ], { spacing: 4 }),
      Widget.hstack([
        Widget.text("parked", { font: "caption" }),
        Widget.date(c.time, { style: "relative", font: "caption" }),
        distanceText ? Widget.text(`· ${distanceText}`, { font: "caption" }) : null,
      ], { spacing: 3 }),
      meterRunning(c)
        ? Widget.hstack([Widget.text("meter", { font: "caption2" }), Widget.date(c.meterEnd, { style: "timer", font: "caption2", weight: "semibold", design: "monospaced" })], { spacing: 3 })
        : Widget.text(c.source === "auto" ? "detected automatically" : "tap to open", { font: "caption2" }),
    ], { alignment: "leading", spacing: 1 });
  } else if (family === "small") {
    content = Widget.zstack([
      Widget.map({ center: c, span: 350, pins }),
      Widget.vstack([
        Widget.hstack([
          chip([Widget.symbol("car.fill", { size: 11, color: BLUE, fallback: "🚗" }), Widget.date(c.time, { style: "relative", font: "caption2", weight: "semibold" })]),
          Widget.spacer(),
        ]),
        Widget.spacer(),
        meterChip(c),
        chip([Widget.text(distanceText ?? c.street ?? "Your car", { font: "caption2", weight: "semibold", lineLimit: 1, minimumScale: 0.7 })]),
      ], { alignment: "leading", spacing: 4, padding: 10, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { url: directions(c) });
  } else if (family === "medium") {
    content = Widget.hstack([
      Widget.map({ center: c, span: 400, pins, frame: { width: 140, maxHeight: "infinity" }, cornerRadius: 12 }),
      Widget.vstack([
        Widget.text(c.street ?? "Your car", { font: "headline", color: "white", lineLimit: 2 }),
        Widget.hstack([
          Widget.text("Parked", { font: "caption", color: SOFT_WHITE }),
          Widget.date(c.time, { style: "relative", font: "caption", color: SOFT_WHITE }),
        ], { spacing: 3 }),
        distanceText ? Widget.text(distanceText, { font: "caption", color: SOFT_WHITE }) : null,
        meterRunning(c) ? Widget.hstack([
          Widget.symbol("timer", { size: 12, color: "#FDE68A", fallback: "⏱" }),
          Widget.date(c.meterEnd, { style: "timer", font: "subheadline", weight: "bold", design: "monospaced", color: "#FDE68A" }),
        ], { spacing: 4 }) : null,
        Widget.spacer(),
        walkChip(c),
      ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 12, padding: 12, background: WIDGET_BG, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
  } else {
    content = Widget.vstack([
      // With your position on the map, let it fit both pins; otherwise frame the car at street level.
      Widget.map(pins.length > 1 ? { pins, frame: { height: 190 }, cornerRadius: 14 } : { center: c, span: 500, pins, frame: { height: 190 }, cornerRadius: 14 }),
      Widget.hstack([
        Widget.symbol("car.fill", { size: 24, color: "white", fallback: "🚗" }),
        Widget.vstack([
          Widget.text(c.street ?? "Your car", { font: "headline", color: "white", lineLimit: 1 }),
          Widget.hstack([
            Widget.text("Parked", { font: "caption", color: SOFT_WHITE }),
            Widget.date(c.time, { style: "relative", font: "caption", color: SOFT_WHITE }),
            Widget.text(`· ${new Date(c.time).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })} · ${SOURCE_LABEL[c.source] ?? c.source}`, { font: "caption", color: SOFT_WHITE, lineLimit: 1 }),
          ], { spacing: 3 }),
        ], { alignment: "leading", spacing: 1 }),
        Widget.spacer(),
        distanceText ? Widget.vstack([
          Widget.text(formatDistance(distance), { font: "title3", weight: "bold", design: "rounded", color: "white" }),
          Widget.text("away", { font: "caption2", color: SOFT_WHITE }),
        ], { alignment: "trailing", spacing: 0 }) : null,
      ], { spacing: 10 }),
      meterRunning(c) ? Widget.hstack([
        Widget.symbol("timer", { size: 16, color: "#FDE68A", fallback: "⏱" }),
        Widget.text("Meter", { font: "subheadline", color: "white" }),
        Widget.date(c.meterEnd, { style: "timer", font: "title3", weight: "bold", design: "monospaced", color: "#FDE68A" }),
        Widget.spacer(),
        Widget.text("ends", { font: "caption", color: SOFT_WHITE }),
        Widget.date(c.meterEnd, { style: "time", font: "caption", color: SOFT_WHITE }),
      ], { spacing: 6 }) : Widget.text("No meter running · set one in the app", { font: "caption", color: SOFT_WHITE }),
      c.photo ? Widget.image({ file: c.photo, contentMode: "fill", cornerRadius: 10, frame: { height: 60, maxWidth: "infinity" } }) : null,
      Widget.spacer(),
      Widget.hstack([
        walkChip(c),
        Widget.spacer(),
        Widget.text(`${here ? "position " : ""}${c.accuracy ? `±${c.accuracy} m` : ""}`, { font: "caption2", color: SOFT_WHITE }),
      ]),
    ], { alignment: "leading", spacing: 10, padding: 14, background: WIDGET_BG, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
  }

  return { content, refreshAfter: 15 * 60 };
});
