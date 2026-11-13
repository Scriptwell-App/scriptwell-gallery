// @name        Plant Care
// @description Watering reminders for your plants, with photos, light levels, a care log and an on-time streak. Hot days in the Apple Weather forecast for your location bring outdoor plants forward a day. Notifications are local; nothing is sent anywhere.
// @permissions camera, location, notifications
// @widget      small, medium, large, rectangular
// @icon        camera.macro
// @color       #16A34A
// @version     1.0.0
// @author      va4w
// @category    lifestyle

// How it works
// • Open the mini-app once to approve camera, location and notifications, then add plants: a name, a photo
//   (camera or photo library), how often to water, when you last did, the light it gets and whether it lives outside.
// • Each plant gets one local notification on its due date at 9:00. Background runs and every "Watered" tap
//   keep those notifications up to date.
// • In the mini-app the script asks Apple Weather for the next days at your location. When a day above 28 °C
//   is coming, outdoor plants are due a day sooner. Only your coordinates go to Apple Weather.
// • "Watered" works from the widget and the mini-app. Watering on or before the due date extends your streak.
// • Widget Parameter: a plant's name pins the small and medium widgets to that plant. The large widget shows
//   a grid of photos with a droplet on the plants that need water.

// ───────────────────────── Constants

const DAY = 86_400_000;
const HOT_C = 28;
const WATER_HOUR = 9;
const WEATHER_FRESH_MS = 6 * 60 * 60 * 1000;
const WEATHER_RETRY_MS = 60 * 60 * 1000;
const SCHEDULE_FRESH_MS = 6 * 60 * 60 * 1000;
const MAX_LOG = 300;
const useF = /-US$/i.test(Script.env.locale);

const LIGHTS = [
  { value: "low", label: "Low", symbol: "moon.fill", emoji: "🌙" },
  { value: "medium", label: "Medium", symbol: "cloud.sun.fill", emoji: "⛅️" },
  { value: "bright", label: "Bright", symbol: "sun.min.fill", emoji: "🌤" },
  { value: "direct", label: "Direct sun", symbol: "sun.max.fill", emoji: "☀️" },
];
const lightInfo = (value) => LIGHTS.find((l) => l.value === value) ?? LIGHTS[1];

const GREEN = "#16A34A";
const BLUE = "#0EA5E9";
const CARD = { light: "#FFFFFF", dark: "#1C1C1E" };
const PAGE = { light: "#F0FDF4", dark: "#0B130D" };
const SOIL = { light: "#DCFCE7", dark: "#14532D" };
const DIM = { light: "#E5E7EB", dark: "#2A2E2B" };

// ───────────────────────── Dates

const isoDay = (date = new Date()) => date.toLocaleDateString("en-CA");
const noon = (day) => new Date(`${day}T12:00:00`);
const diffDays = (from, to) => Math.round((noon(to) - noon(from)) / DAY);
function addDays(day, n) {
  const d = noon(day);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}
const shortDate = (day) => noon(day).toLocaleDateString(Script.env.locale, { weekday: "short", day: "numeric", month: "short" });
const fmtTemp = (c) => (useF ? `${Math.round((c * 9) / 5 + 32)}°F` : `${Math.round(c)}°C`);

// ───────────────────────── Data

const plants = () => Storage.get("plants", []);
const savePlants = (list) => Storage.set("plants", list);
const plantById = (id) => plants().find((p) => p.id === id) ?? null;
const updatePlant = (id, changes) => savePlants(plants().map((p) => (p.id === id ? { ...p, ...changes } : p)));
const log = () => Storage.get("log", []);
const weather = () => Storage.get("weather");
const ui = () => Storage.get("ui", { page: "home" });
const setUi = (changes) => Storage.set("ui", { ...ui(), ...changes });

const hotSpell = () => Boolean(weather()?.hot);
const effectiveInterval = (plant) => Math.max(1, plant.interval - (plant.outdoor && hotSpell() ? 1 : 0));
const dueDay = (plant) => addDays(plant.lastWatered, effectiveInterval(plant));
const daysUntil = (plant) => diffDays(isoDay(), dueDay(plant));
const isDue = (plant) => daysUntil(plant) <= 0;
const sorted = () => [...plants()].sort((a, b) => daysUntil(a) - daysUntil(b) || a.name.localeCompare(b.name));
const dueList = () => sorted().filter(isDue);

function statusText(plant) {
  const n = daysUntil(plant);
  if (n === 0) return "Due today";
  if (n < 0) return `Overdue ${-n} day${n === -1 ? "" : "s"}`;
  if (n === 1) return "Due tomorrow";
  return `Due in ${n} days`;
}

const statusColor = (plant) => (daysUntil(plant) < 0 ? "red" : daysUntil(plant) === 0 ? BLUE : "secondary");

function streak() {
  let count = 0;
  for (const entry of log()) {
    if (!entry.onTime) break;
    count += 1;
  }
  return count;
}

// Which plant the small and medium widgets feature: the Parameter names one, otherwise the most urgent.
function featured(parameter) {
  const wanted = (parameter ?? "").trim().toLowerCase();
  const list = sorted();
  return (wanted && list.find((p) => p.name.toLowerCase() === wanted || p.name.toLowerCase().startsWith(wanted))) || list[0] || null;
}

function newPlant(name) {
  return {
    id: crypto.randomUUID(),
    name,
    notes: "",
    photo: null,
    interval: 7,
    lastWatered: isoDay(),
    light: "medium",
    outdoor: false,
    created: Date.now(),
  };
}

// ───────────────────────── Weather

async function refreshWeather() {
  const here = await Location.current({ accuracy: "kilometer" });
  const place = { latitude: here.latitude, longitude: here.longitude };
  const days = await Weather.daily(place, { days: 4 });
  const highs = days.map((d) => d.high ?? d.temperature).filter((v) => typeof v === "number");
  const maxHigh = highs.length ? Math.max(...highs) : null;

  let credit = weather()?.credit;
  if (!credit) {
    try { credit = await Weather.attribution(); }
    catch { credit = { text: "Apple Weather", url: "https://weatherkit.apple.com/legal-attribution.html" }; }
  }

  const data = {
    hot: maxHigh !== null && maxHigh > HOT_C,
    maxHigh,
    days: days.slice(0, 4).map((d) => ({ date: d.date, high: d.high ?? d.temperature, symbol: d.symbol })),
    credit,
    time: Date.now(),
  };
  Storage.set("weather", data);
  Storage.remove("weatherError");
  return data;
}

async function weatherIfStale(maxAge) {
  const cached = weather();
  const failed = Storage.get("weatherError");
  if (cached && Date.now() - cached.time < maxAge) return;
  if (failed && Date.now() - failed.time < WEATHER_RETRY_MS) return;
  try {
    await refreshWeather();
  } catch (error) {
    Storage.set("weatherError", { message: error.message, time: Date.now() });
  }
}

// ───────────────────────── Notifications

// 9:00 on the due day; for an overdue plant, the next 9:00 from now.
function reminderTime(plant) {
  const at = noon(dueDay(plant));
  at.setHours(WATER_HOUR, 0, 0, 0);
  if (at.getTime() <= Date.now() + 60_000) {
    at.setTime(Date.now());
    at.setHours(WATER_HOUR, 0, 0, 0);
    if (at.getTime() <= Date.now() + 60_000) at.setDate(at.getDate() + 1);
  }
  return at;
}

async function schedulePlant(plant) {
  const every = effectiveInterval(plant);
  await Notification.schedule({
    id: `plant-${plant.id}`,
    title: `Water ${plant.name}`,
    body: `${daysUntil(plant) < 0 ? "Still waiting for water" : "Due today"} · every ${every} day${every === 1 ? "" : "s"}${plant.outdoor && hotSpell() ? " (hot spell)" : ""}.`,
    at: reminderTime(plant),
  });
}

async function scheduleAll() {
  for (const plant of plants()) await schedulePlant(plant);
  Storage.set("lastSchedule", Date.now());
}

async function scheduleIfStale() {
  if (Date.now() - Storage.get("lastSchedule", 0) < SCHEDULE_FRESH_MS) return;
  try { await scheduleAll(); }
  catch (error) { Storage.set("scheduleError", { message: error.message, time: Date.now() }); }
}

// ───────────────────────── Watering

async function water(plantId) {
  const plant = plantById(plantId);
  if (!plant) return;
  const today = isoDay();
  const late = -daysUntil(plant);
  const entry = { plantId, name: plant.name, day: today, at: Date.now(), onTime: late <= 0, late: Math.max(0, late) };
  Storage.set("log", [entry, ...log()].slice(0, MAX_LOG));
  updatePlant(plantId, { lastWatered: today });

  // A widget action cannot schedule notifications; the next app or background run catches up.
  if (Script.env.mode === "app") {
    try { await schedulePlant(plantById(plantId)); } catch { /* approved later */ }
    try {
      await UI.haptic("success");
      await Sound.play("pop", { volume: 0.5 });
    } catch { /* optional */ }
  } else {
    Storage.set("lastSchedule", 0);
  }
}

// ───────────────────────── Actions

Script.action("water", ({ plantId }) => water(plantId));
Script.action("open", ({ plantId }) => setUi({ page: "plant", plantId }));
Script.action("back", () => setUi({ page: "home", plantId: null }));

Script.action("add", async () => {
  const name = await UI.prompt({ title: "New plant", placeholder: "Monstera by the window" });
  if (!name?.trim()) return;
  const plant = newPlant(name.trim().slice(0, 40));
  savePlants([...plants(), plant]);
  setUi({ page: "plant", plantId: plant.id });
  try { await schedulePlant(plant); } catch { /* approved later */ }
});

Script.action("field", ({ plantId, field, value }) => {
  const text = String(value).trim().slice(0, field === "notes" ? 300 : 40);
  if (field === "name" && !text) return; // keep the old name rather than a blank one
  updatePlant(plantId, { [field]: text });
});
Script.action("interval", async ({ plantId, value }) => {
  updatePlant(plantId, { interval: value });
  try { await schedulePlant(plantById(plantId)); } catch { /* approved later */ }
});
Script.action("lastWatered", async ({ plantId, value }) => {
  const day = isoDay(new Date(value));
  if (day > isoDay()) return;
  updatePlant(plantId, { lastWatered: day });
  try { await schedulePlant(plantById(plantId)); } catch { /* approved later */ }
});
Script.action("light", ({ plantId, value }) => updatePlant(plantId, { light: value }));
Script.action("outdoor", async ({ plantId, isOn }) => {
  updatePlant(plantId, { outdoor: isOn });
  try { await schedulePlant(plantById(plantId)); } catch { /* approved later */ }
});

Script.action("snap", async ({ plantId }) => {
  const photo = await Camera.capture({ saveAs: `plant-${plantId}.jpg` });
  if (photo) updatePlant(plantId, { photo });
});

Script.action("pick", async ({ plantId }) => {
  const photo = await Photos.pick({ saveAs: `plant-${plantId}.jpg` });
  if (photo) updatePlant(plantId, { photo });
});

Script.action("removePhoto", async ({ plantId }) => {
  const plant = plantById(plantId);
  if (plant?.photo) { try { await Files.remove(plant.photo.path); } catch { /* already gone */ } }
  updatePlant(plantId, { photo: null });
});

Script.action("remove", async ({ plantId }) => {
  const plant = plantById(plantId);
  const choice = await UI.alert({ title: `Remove ${plant.name}?`, message: "Its photo and reminder are deleted. The care log keeps its entries.", buttons: ["Cancel", "Remove"] });
  if (choice !== 1) return;
  if (plant.photo) { try { await Files.remove(plant.photo.path); } catch { /* already gone */ } }
  try { await Notification.cancel(`plant-${plantId}`); } catch { /* nothing scheduled */ }
  savePlants(plants().filter((p) => p.id !== plantId));
  setUi({ page: "home", plantId: null });
});

Script.action("refreshWeather", async () => {
  try { await refreshWeather(); }
  catch (error) { Storage.set("weatherError", { message: error.message, time: Date.now() }); }
});

Script.action("clearLog", async () => {
  const choice = await UI.alert({ title: "Clear the care log?", message: "The streak starts again from zero.", buttons: ["Cancel", "Clear"] });
  if (choice === 1) Storage.set("log", []);
});

// ───────────────────────── Shared pieces

function photoOrLeaf(plant, size, cornerRadius = size * 0.22) {
  if (plant.photo) {
    return Widget.image({ file: plant.photo, contentMode: "fill", cornerRadius, frame: { width: size, height: size } });
  }
  return Widget.vstack([
    Widget.symbol("leaf.fill", { size: size * 0.45, color: GREEN, fallback: "🌿" }),
  ], { background: SOIL, cornerRadius, frame: { width: size, height: size } });
}

const droplet = (plant, size = 14) => Widget.symbol(daysUntil(plant) < 0 ? "drop.triangle.fill" : "drop.fill", {
  size, color: daysUntil(plant) < 0 ? "red" : BLUE, fallback: "💧",
});

function waterButton(plant, props = {}) {
  return Widget.button(Widget.label("Watered", "drop.fill"), "water", { plantId: plant.id }, { style: isDue(plant) ? "prominent" : "bordered", color: BLUE, ...props });
}

function weatherLine(compact = false) {
  const w = weather();
  if (!w) return null;
  const text = w.hot ? `Hot spell to ${fmtTemp(w.maxHigh)}: outdoor plants a day sooner` : `Next days up to ${fmtTemp(w.maxHigh)}`;
  return Widget.hstack([
    Widget.symbol(w.hot ? "thermometer.sun.fill" : "thermometer.medium", { size: compact ? 10 : 12, color: w.hot ? "orange" : "secondary", fallback: "🌡" }),
    Widget.text(text, { font: compact ? "caption2" : "caption", color: w.hot ? "orange" : "secondary", lineLimit: 1, minimumScale: 0.7 }),
    Widget.spacer(),
    Widget.text(w.credit?.text ?? "Apple Weather", { font: "caption2", color: "secondary", url: w.credit?.url, lineLimit: 1 }),
  ], { spacing: 4 });
}

// ───────────────────────── Widget

const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };

function heroBlock(plant, size) {
  return Widget.hstack([
    photoOrLeaf(plant, size),
    Widget.vstack([
      Widget.text(plant.name, { font: "headline", lineLimit: 2, minimumScale: 0.7 }),
      Widget.hstack([droplet(plant, 11), Widget.text(statusText(plant), { font: "caption", weight: "semibold", color: statusColor(plant), lineLimit: 1 })], { spacing: 3 }),
      Widget.text(`Every ${effectiveInterval(plant)} days · ${lightInfo(plant.light).label}`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
    ], { alignment: "leading", spacing: 2 }),
  ], { spacing: 10, alignment: "top" });
}

function gridTile(plant, size) {
  return Widget.vstack([
    Widget.zstack([
      photoOrLeaf(plant, size, 14),
      isDue(plant) ? Widget.vstack([droplet(plant, 13)], { padding: 4, background: { light: "#FFFFFFE6", dark: "#000000B3" }, cornerRadius: 10 }) : null,
    ], { alignment: "topTrailing" }),
    Widget.text(plant.name, { font: "caption2", weight: isDue(plant) ? "bold" : "regular", lineLimit: 1, minimumScale: 0.7, frame: { width: size } }),
  ], { spacing: 3 });
}

Script.widget(({ family, parameter }) => {
  const list = sorted();
  if (list.length === 0) {
    if (family === "rectangular") return Widget.text("Plant Care: add a plant in Scriptwell", { font: "caption" });
    return Widget.vstack([
      Widget.symbol("leaf.fill", { size: 30, color: GREEN, fallback: "🌿" }),
      Widget.text("Open Plant Care and add your first plant", { font: "caption", color: "secondary", align: "center" }),
    ], { spacing: 8, url: appLink, background: PAGE, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
  }

  const due = dueList();
  const hero = featured(parameter);
  let content;

  if (family === "rectangular") {
    const next = list[0];
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("drop.fill", { size: 12, fallback: "💧" }),
        Widget.text(due.length ? `${due.length} to water` : "All watered", { font: "headline", lineLimit: 1 }),
      ], { spacing: 4 }),
      Widget.text(next.name, { font: "caption", lineLimit: 1 }),
      Widget.text(statusText(next), { font: "caption2" }),
    ], { alignment: "leading", spacing: 1 });
  } else if (family === "small") {
    content = Widget.vstack([
      Widget.hstack([
        photoOrLeaf(hero, 46),
        Widget.spacer(),
        due.length ? Widget.hstack([droplet(hero, 12), Widget.text(`${due.length}`, { font: "caption", weight: "bold", color: BLUE })], { spacing: 2 }) : null,
      ], { alignment: "top" }),
      Widget.spacer(4),
      Widget.text(hero.name, { font: "headline", lineLimit: 2, minimumScale: 0.7 }),
      Widget.text(statusText(hero), { font: "caption", weight: "semibold", color: statusColor(hero), lineLimit: 1 }),
      Widget.spacer(),
      waterButton(hero),
    ], { alignment: "leading", spacing: 2, padding: 12, background: PAGE, url: appLink, frame: fill });
  } else if (family === "medium") {
    const others = list.filter((p) => p.id !== hero.id).slice(0, 3);
    content = Widget.hstack([
      Widget.vstack([
        heroBlock(hero, 58),
        Widget.spacer(),
        waterButton(hero),
      ], { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack([
        Widget.text(others.length ? "Up next" : `${streak()} on time in a row`, { font: "caption2", weight: "bold", color: "secondary" }),
        ...others.map((p) => Widget.hstack([
          photoOrLeaf(p, 22, 6),
          Widget.text(p.name, { font: "caption", lineLimit: 1, minimumScale: 0.7 }),
          Widget.spacer(),
          isDue(p) ? droplet(p, 11) : Widget.text(`${daysUntil(p)}d`, { font: "caption2", color: "secondary" }),
        ], { spacing: 6 })),
        Widget.spacer(),
        weatherLine(true),
      ], { alignment: "leading", spacing: 6, frame: { width: 140, maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 12, padding: 12, background: PAGE, url: appLink, frame: fill });
  } else {
    const tiles = list.slice(0, 9);
    const rows = [];
    for (let i = 0; i < tiles.length; i += 3) rows.push(tiles.slice(i, i + 3));
    const first = due[0];
    content = Widget.vstack([
      Widget.hstack([
        Widget.text("Plants", { font: "headline" }),
        Widget.text(due.length ? `${due.length} need water` : "all watered", { font: "caption", color: due.length ? BLUE : "secondary" }),
        Widget.spacer(),
        Widget.symbol("flame.fill", { size: 12, color: "orange", fallback: "🔥" }),
        Widget.text(`${streak()} on time`, { font: "caption", weight: "semibold" }),
      ], { spacing: 6 }),
      ...rows.map((row) => Widget.hstack(row.map((p) => gridTile(p, 92)), { spacing: 10 })),
      list.length > 9 ? Widget.text(`+ ${list.length - 9} more in the app`, { font: "caption2", color: "secondary" }) : null,
      Widget.spacer(),
      first ? Widget.hstack([
        Widget.text(`${first.name}: ${statusText(first).toLowerCase()}`, { font: "caption", lineLimit: 1, minimumScale: 0.7 }),
        Widget.spacer(),
        waterButton(first),
      ]) : null,
      weatherLine(true),
    ], { alignment: "leading", spacing: 8, padding: 14, background: PAGE, url: appLink, frame: fill });
  }

  const nextMorning = new Date();
  nextMorning.setHours(nextMorning.getHours() < WATER_HOUR ? WATER_HOUR : 24 + WATER_HOUR, 0, 10, 0);
  return { content, refreshAt: nextMorning };
});

// ───────────────────────── Mini-app: home

function homeView() {
  const list = sorted();
  const due = list.filter(isDue);
  const later = list.filter((p) => !isDue(p));
  const w = weather();
  const weatherError = Storage.get("weatherError");
  const count = streak();

  const statCard = (symbol, color, title, subtitle) => Widget.hstack([
    Widget.symbol(symbol, { size: 26, color, fallback: "•" }),
    Widget.vstack([
      Widget.text(title, { font: "headline", lineLimit: 1, minimumScale: 0.7 }),
      Widget.text(subtitle, { font: "caption", color: "secondary", lineLimit: 2 }),
    ], { alignment: "leading", spacing: 1 }),
  ], { spacing: 10, padding: 12, background: CARD, cornerRadius: 14, frame: { maxWidth: "infinity", alignment: "leading" } });

  const dueRow = (plant) => Widget.hstack([
    Widget.button(Widget.hstack([
      photoOrLeaf(plant, 44),
      Widget.vstack([
        Widget.text(plant.name, { font: "headline", lineLimit: 1 }),
        Widget.text(statusText(plant), { font: "caption", color: statusColor(plant) }),
      ], { alignment: "leading", spacing: 2 }),
    ], { spacing: 10 }), "open", { plantId: plant.id }),
    Widget.spacer(),
    waterButton(plant),
  ], { padding: 10, background: CARD, cornerRadius: 14 });

  return Widget.vstack([
    Widget.hstack([
      statCard("flame.fill", "orange", `${count} on time`, count === 1 ? "watering in a row" : "waterings in a row"),
      statCard(w?.hot ? "thermometer.sun.fill" : "cloud.sun.fill", w?.hot ? "orange" : "blue",
        w ? (w.hot ? `Hot: ${fmtTemp(w.maxHigh)}` : `Up to ${fmtTemp(w.maxHigh)}`) : "No forecast",
        w ? (w.hot ? "Outdoor plants a day sooner" : "Normal schedule") : weatherError ? "Could not load weather" : "Loading from Apple Weather"),
    ], { spacing: 10 }),

    Widget.text(due.length ? `Water today (${due.length})` : list.length ? "Nothing to water today 🎉" : "No plants yet", { font: "title3", weight: "bold" }),
    ...due.map(dueRow),

    later.length ? Widget.list(later.map((p) => ({
      title: p.name,
      subtitle: `Every ${effectiveInterval(p)} days · ${lightInfo(p.light).label}${p.outdoor ? " · outdoors" : ""}`,
      symbol: lightInfo(p.light).symbol, color: GREEN,
      detail: statusText(p).replace("Due ", ""),
      action: "open", args: { plantId: p.id },
    })), { title: "Coming up" }) : null,

    Widget.button("Add a plant", "add", null, { style: "prominent", color: GREEN }),

    log().length ? Widget.list(log().slice(0, 8).map((e) => ({
      title: e.name,
      subtitle: e.onTime ? "On time" : `${e.late} day${e.late === 1 ? "" : "s"} late`,
      symbol: e.onTime ? "checkmark.circle.fill" : "clock.badge.exclamationmark", color: e.onTime ? "green" : "orange",
      detail: shortDate(e.day),
    })), { title: "Care log" }) : null,

    Widget.hstack([
      w ? Widget.text(w.credit?.text ?? "Apple Weather", { font: "caption2", color: "secondary", url: w.credit?.url }) : null,
      w ? Widget.date(w.time, { style: "relative", font: "caption2", color: "secondary" }) : null,
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [
        { title: "Refresh weather", symbol: "arrow.clockwise", action: "refreshWeather" },
        { title: "Clear care log", symbol: "trash", action: "clearLog", destructive: true },
      ]),
    ], { spacing: 6 }),
  ], { alignment: "leading", spacing: 14, padding: 16, background: PAGE });
}

// ───────────────────────── Mini-app: one plant

function plantView(plant) {
  const elapsed = diffDays(plant.lastWatered, isoDay());
  const every = effectiveInterval(plant);
  const fraction = Math.max(0, Math.min(1, elapsed / every));
  const entries = log().filter((e) => e.plantId === plant.id).slice(0, 10);
  const hotNote = plant.outdoor && hotSpell();

  return Widget.vstack([
    Widget.hstack([
      Widget.button(Widget.label("Plants", "chevron.left"), "back", null, { style: "plain" }),
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [
        { title: "Take a photo", symbol: "camera.fill", action: "snap", args: { plantId: plant.id } },
        { title: "Choose a photo", symbol: "photo.on.rectangle", action: "pick", args: { plantId: plant.id } },
        { title: "Remove photo", symbol: "trash", action: "removePhoto", args: { plantId: plant.id } },
        { title: "Remove plant", symbol: "trash", action: "remove", args: { plantId: plant.id }, destructive: true },
      ]),
    ]),
    plant.photo
      ? Widget.image({ file: plant.photo, contentMode: "fill", cornerRadius: 20, frame: { maxWidth: "infinity", height: 240 } })
      : Widget.vstack([
          Widget.symbol("leaf.fill", { size: 56, color: GREEN, fallback: "🌿" }),
          Widget.text("Add a photo so the widget can show it", { font: "caption", color: "secondary" }),
        ], { spacing: 8, padding: 30, background: SOIL, cornerRadius: 20, frame: { maxWidth: "infinity" } }),
    Widget.hstack([
      Widget.button(Widget.label("Camera", "camera.fill"), "snap", { plantId: plant.id }, { style: "bordered" }),
      Widget.button(Widget.label("Library", "photo.on.rectangle"), "pick", { plantId: plant.id }, { style: "bordered" }),
    ], { spacing: 10 }),

    Widget.hstack([
      Widget.progress(fraction, { style: "ring", color: isDue(plant) ? BLUE : GREEN, label: `${elapsed}d` }),
      Widget.vstack([
        Widget.text(statusText(plant), { font: "title3", weight: "bold", color: statusColor(plant) }),
        Widget.text(`Last watered ${shortDate(plant.lastWatered)} · next ${shortDate(dueDay(plant))}`, { font: "caption", color: "secondary", lineLimit: 2 }),
        hotNote ? Widget.text(`Hot spell: every ${every} days instead of ${plant.interval}`, { font: "caption", color: "orange" }) : null,
      ], { alignment: "leading", spacing: 3 }),
      Widget.spacer(),
    ], { spacing: 14, padding: 14, background: CARD, cornerRadius: 16 }),
    Widget.button(Widget.label("Watered today", "drop.fill"), "water", { plantId: plant.id }, { style: "prominent", color: BLUE }),

    Widget.textField("Name", plant.name, "field", { plantId: plant.id, field: "name" }, { label: "Name" }),
    Widget.textField("Species, pot size, where it lives", plant.notes, "field", { plantId: plant.id, field: "notes" }, { label: "Notes", multiline: true }),
    Widget.stepper(`Water every ${plant.interval} day${plant.interval === 1 ? "" : "s"}`, plant.interval, "interval", { plantId: plant.id }, { min: 1, max: 60 }),
    Widget.datePicker(noon(plant.lastWatered).toISOString(), "lastWatered", { plantId: plant.id }, { label: "Last watered", mode: "date", max: new Date().toISOString() }),
    Widget.picker(LIGHTS.map((l) => ({ label: `${l.emoji} ${l.label}`, value: l.value })), plant.light, "light", { plantId: plant.id }, { style: "segmented", label: "Light" }),
    Widget.toggle("Lives outdoors", plant.outdoor, "outdoor", { plantId: plant.id }, { color: GREEN }),
    Widget.text("Outdoor plants are watered a day sooner when the forecast goes above 28 °C.", { font: "caption2", color: "secondary" }),

    entries.length ? Widget.list(entries.map((e) => ({
      title: shortDate(e.day),
      symbol: e.onTime ? "checkmark.circle.fill" : "clock.badge.exclamationmark", color: e.onTime ? "green" : "orange",
      detail: e.onTime ? "on time" : `${e.late}d late`,
    })), { title: "Watering history" }) : null,
  ], { alignment: "leading", spacing: 14, padding: 16, background: PAGE });
}

Script.ui(async () => {
  await weatherIfStale(WEATHER_FRESH_MS);
  await scheduleIfStale();
  const state = ui();
  const plant = state.page === "plant" ? plantById(state.plantId) : null;
  return { title: plant ? plant.name : "Plant Care", content: plant ? plantView(plant) : homeView() };
});

// ───────────────────────── Shortcuts and background

Script.run(async () => {
  await weatherIfStale(WEATHER_FRESH_MS);
  try { await scheduleAll(); } catch { /* reported in the app */ }
  const due = dueList();
  if (!plants().length) return "No plants yet. Open Plant Care to add one.";
  if (!due.length) return `All ${plants().length} plants are watered. Next: ${sorted()[0].name}, ${statusText(sorted()[0]).toLowerCase()}.`;
  return `${due.length} plant${due.length === 1 ? " needs" : "s need"} water: ${due.map((p) => p.name).join(", ")}.`;
});

Script.background(async () => {
  await weatherIfStale(12 * 60 * 60 * 1000);
  try { await scheduleAll(); }
  catch (error) { Storage.set("scheduleError", { message: error.message, time: Date.now() }); }
});
