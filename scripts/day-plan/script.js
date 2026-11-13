// @name        Day Plan
// @description Today's calendar events and reminders merged into one timeline with free gaps, a live next-up countdown and Apple Weather for your commute
// @permissions calendar, reminders, location
// @widget      small, medium, large, extraLarge, rectangular, inline
// @icon        calendar.day.timeline.left
// @color       #2563EB
// @version     1.0.0
// @author      va4w
// @category    productivity

// How it works
// • Reads today's events from the calendars you choose and the reminders due today, and merges them into one timeline across your working hours (7:00–22:00 by default). Gaps between meetings are labelled as free time.
// • The widget shows what is next with a live countdown: small shows the next item, medium the next three, large and extra large the whole day. The Lock Screen inline widget shows the next event and its time.
// • In the mini-app you can tick reminders off, tap an event for its details, choose calendars, and set working and commute hours.
// • Commute weather comes from Apple Weather for your current location. It is fetched only in the mini-app and cached for the widget. Nothing else leaves the device.
// • Run the script once in the app to approve calendar, reminders and location access before adding the widget.

// ───────────────────────── Settings and helpers

const MIN = 60_000;
const DAY = 86_400_000;
const locale = Script.env.locale;
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

const DEFAULTS = { calendars: [], dayStart: 7, dayEnd: 22, commuteOut: 8, commuteHome: 18, weather: true, overdue: true };
const settings = () => ({ ...DEFAULTS, ...Storage.get("settings", {}) });
const save = (changes) => Storage.set("settings", { ...settings(), ...changes });

const ui = () => Storage.get("ui", { selected: null, tab: 0 });
const setUI = (changes) => Storage.set("ui", { ...ui(), ...changes });

const todayKey = () => new Date().toLocaleDateString("en-CA");
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const atHour = (hour, minute = 0) => { const d = startOfDay(); d.setHours(hour, minute, 0, 0); return d; };
const fmtTime = (t) => new Date(t).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
const fmtDuration = (ms) => {
  const minutes = Math.round(ms / MIN);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
};
const isHex = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
const tint = (color, alpha = "33") => (isHex(color) ? `${color}${alpha}` : { light: "#E2E8F0", dark: "#1E293B" });
const solid = (color) => (typeof color === "string" && color ? color : "#2563EB");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const CARD_BG = { light: "#FFFFFF", dark: "#1C1C1E" };
const PAGE_BG = { light: "#F2F4F8", dark: "#000000" };
const FREE = "#10B981";
const NOW = "#EF4444";
const REMINDER = "#F59E0B";

// ───────────────────────── Data

async function loadDay() {
  const s = settings();
  const start = startOfDay();
  const end = new Date(start.getTime() + DAY);
  const query = { start, end };
  if (s.calendars.length) query.calendars = s.calendars;

  const [events, reminders, lists] = await Promise.all([
    Calendar.events(query),
    Reminders.list().then((r) => r || []),
    Reminders.lists().catch(() => []),
  ]);
  const listColor = Object.fromEntries((lists || []).map((l) => [l.title, l.color]));

  const items = events.map((e) => ({
    kind: "event",
    id: e.id,
    title: e.title || "Untitled",
    start: new Date(e.start).getTime(),
    end: new Date(e.end).getTime(),
    allDay: !!e.allDay,
    color: solid(e.color),
    calendar: e.calendar,
    location: e.location || null,
    notes: e.notes || null,
  }));

  for (const r of reminders) {
    if (!r.due) continue;
    const due = new Date(r.due);
    if (due >= end) continue;
    const overdue = due < start;
    if (overdue && !s.overdue) continue;
    const anyTime = due.getHours() === 0 && due.getMinutes() === 0;
    items.push({
      kind: "reminder",
      id: r.id,
      title: r.title || "Reminder",
      start: due.getTime(),
      end: due.getTime(),
      allDay: anyTime || overdue,
      overdue,
      color: solid(listColor[r.list] ?? REMINDER),
      calendar: r.list,
      notes: r.notes || null,
    });
  }

  items.sort((a, b) => a.start - b.start || a.end - b.end);
  const day = { items, loaded: Date.now() };
  Storage.set("lastDay", day);
  return day;
}

// Free time between events, the same walk as the "Next free hour" recipe: merge busy
// blocks in order and keep every gap of 20 minutes or more inside the working hours.
function freeGaps(items, s) {
  const busy = items.filter((i) => i.kind === "event" && !i.allDay).map((i) => [i.start, i.end]).sort((a, b) => a[0] - b[0]);
  const dayEnd = atHour(s.dayEnd).getTime();
  const gaps = [];
  let cursor = Math.max(atHour(s.dayStart).getTime(), Date.now());
  for (const [start, end] of busy) {
    if (start - cursor >= 20 * MIN) gaps.push({ kind: "free", start: cursor, end: start });
    if (end > cursor) cursor = end;
  }
  if (dayEnd - cursor >= 20 * MIN) gaps.push({ kind: "free", start: cursor, end: dayEnd });
  return gaps;
}

// Timed items plus free gaps and a "now" marker, in time order.
function timeline(day, s) {
  const now = Date.now();
  const timed = day.items.filter((i) => !i.allDay);
  const rows = [...timed, ...freeGaps(timed, s)].sort((a, b) => a.start - b.start);
  const index = rows.findIndex((r) => r.start > now);
  const marker = { kind: "now", start: now, end: now };
  if (index === -1) rows.push(marker); else rows.splice(index, 0, marker);
  return rows;
}

function nextUp(day) {
  const now = Date.now();
  const timed = day.items.filter((i) => !i.allDay);
  const current = timed.find((i) => i.kind === "event" && i.start <= now && i.end > now) ?? null;
  const upcoming = timed.filter((i) => i.start > now);
  return { current, next: upcoming[0] ?? null, upcoming };
}

// ───────────────────────── Weather (mini-app only, cached for the widget)

async function refreshWeather(force = false) {
  const s = settings();
  const cached = Storage.get("weather");
  if (!s.weather) return cached;
  if (!force && cached && cached.day === todayKey() && Date.now() - cached.time < 30 * MIN) return cached;

  let place = Storage.get("place");
  try {
    const here = await Location.current({ accuracy: "kilometer" });
    place = { latitude: here.latitude, longitude: here.longitude };
    Storage.set("place", place);
  } catch (error) {
    if (!place) { Storage.set("weatherError", error.message); return cached; }
  }

  try {
    const hours = await Weather.hourly(place, { start: startOfDay(), hours: 24 });
    const credit = cached?.credit ?? await Weather.attribution();
    const data = {
      day: todayKey(),
      time: Date.now(),
      credit,
      hours: hours.map((h) => ({ date: h.date, temperature: h.temperature, symbol: h.symbol, condition: h.description ?? h.condition, chance: h.precipitationChance ?? 0 })),
    };
    Storage.set("weather", data);
    Storage.remove("weatherError");
    return data;
  } catch (error) {
    Storage.set("weatherError", error.message);
    return cached;
  }
}

function commuteHours(s) {
  const w = Storage.get("weather");
  if (!w || w.day !== todayKey()) return null;
  const pick = (hour) => w.hours.find((h) => new Date(h.date).getHours() === hour);
  const cells = [["Out", s.commuteOut], ["Home", s.commuteHome]]
    .map(([label, hour]) => ({ label, hour, data: pick(hour) }))
    .filter((c) => c.data);
  return cells.length ? { cells, credit: w.credit, time: w.time } : null;
}

function commuteStrip(s, { font = "caption2" } = {}) {
  const commute = commuteHours(s);
  if (!commute) return null;
  return Widget.hstack([
    ...commute.cells.map((c) => Widget.hstack([
      Widget.symbol(c.data.symbol ?? "cloud.fill", { size: 11, color: "secondary", fallback: "☁️" }),
      Widget.text(`${c.label} ${fmtTime(atHour(c.hour))} · ${Math.round(c.data.temperature)}°${c.data.chance >= 0.3 ? ` · ${Math.round(c.data.chance * 100)}%` : ""}`, { font, color: "secondary", lineLimit: 1 }),
    ], { spacing: 3 })),
    Widget.spacer(),
    Widget.text(commute.credit?.text ?? "Apple Weather", { font: "caption2", color: "secondary", url: commute.credit?.url, lineLimit: 1 }),
  ], { spacing: 8 });
}

// ───────────────────────── Widget pieces

function colorBar(color, height) {
  return { type: "stack", direction: "vertical", children: [], background: color, cornerRadius: 2, frame: { width: 4, height } };
}

function timelineRow(item, { compact = false } = {}) {
  const timeWidth = compact ? 40 : 46;
  if (item.kind === "now") {
    return Widget.hstack([
      Widget.date(item.start, { style: "time", font: "caption2", weight: "bold", color: NOW, frame: { width: timeWidth, alignment: "leading" } }),
      { type: "stack", direction: "horizontal", children: [], background: NOW, cornerRadius: 1, frame: { maxWidth: "infinity", height: 2 } },
    ], { spacing: 6 });
  }
  if (item.kind === "free") {
    return Widget.hstack([
      Widget.text(fmtTime(item.start), { font: "caption2", color: "secondary", frame: { width: timeWidth, alignment: "leading" } }),
      Widget.symbol("sparkles", { size: 10, color: FREE, fallback: "✦" }),
      Widget.text(`${fmtDuration(item.end - item.start)} free`, { font: compact ? "caption2" : "caption", weight: "medium", color: FREE, lineLimit: 1 }),
      Widget.spacer(),
    ], { spacing: 6, opacity: 0.9 });
  }
  const subtitle = item.kind === "reminder"
    ? `Reminder · ${item.calendar ?? ""}`
    : `${fmtTime(item.start)}–${fmtTime(item.end)}${item.location ? ` · ${item.location}` : ""}`;
  return Widget.hstack([
    Widget.text(fmtTime(item.start), { font: "caption2", weight: "semibold", color: "secondary", frame: { width: timeWidth, alignment: "leading" } }),
    colorBar(item.color, compact ? 24 : 28),
    Widget.vstack([
      Widget.text(item.title, { font: compact ? "caption" : "subheadline", weight: "medium", lineLimit: 1 }),
      Widget.text(subtitle, { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 1 }),
    Widget.spacer(),
    item.kind === "reminder" ? Widget.symbol("circle", { size: 14, color: item.color, fallback: "○" }) : null,
  ], { spacing: 6 });
}

function nextCard(day, { font = "headline", relativeFont = "title3", showAfter = true } = {}) {
  const { current, next, upcoming } = nextUp(day);
  if (current) {
    return Widget.vstack([
      Widget.text("NOW", { font: "caption2", weight: "bold", color: NOW }),
      Widget.text(current.title, { font, weight: "semibold", lineLimit: 2 }),
      Widget.hstack([
        Widget.text("ends", { font: "caption", color: "secondary" }),
        Widget.date(current.end, { style: "relative", font: "caption", weight: "semibold", color: "secondary" }),
      ], { spacing: 3 }),
      next && showAfter ? Widget.text(`then ${next.title} at ${fmtTime(next.start)}`, { font: "caption2", color: "secondary", lineLimit: 1 }) : null,
    ], { alignment: "leading", spacing: 2 });
  }
  if (!next) {
    return Widget.vstack([
      Widget.symbol("checkmark.seal.fill", { size: 26, color: FREE, fallback: "✓" }),
      Widget.text("All clear", { font, weight: "semibold" }),
      Widget.text("Nothing more planned today", { font: "caption2", color: "secondary", lineLimit: 2 }),
    ], { alignment: "leading", spacing: 3 });
  }
  return Widget.vstack([
    Widget.text(next.kind === "reminder" ? "NEXT REMINDER" : "NEXT UP", { font: "caption2", weight: "bold", color: next.color }),
    Widget.text(next.title, { font, weight: "semibold", lineLimit: 2 }),
    Widget.date(next.start, { style: "relative", font: relativeFont, weight: "bold", design: "rounded" }),
    Widget.text(`${fmtTime(next.start)}${next.kind === "event" ? ` · ${fmtDuration(next.end - next.start)}` : ""}${next.location ? ` · ${next.location}` : ""}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
    showAfter && upcoming.length > 1 ? Widget.text(`${plural(upcoming.length - 1, "more item")} after this`, { font: "caption2", color: "secondary" }) : null,
  ], { alignment: "leading", spacing: 2 });
}

function allDayChips(day, max) {
  const all = day.items.filter((i) => i.allDay);
  if (!all.length) return null;
  const chips = all.slice(0, max).map((i) => Widget.text(`${i.overdue ? "⚠︎ " : ""}${i.title}`, {
    font: "caption2", weight: "medium", lineLimit: 1,
    padding: { horizontal: 6, vertical: 2 }, background: tint(i.color), cornerRadius: 6,
  }));
  if (all.length > max) chips.push(Widget.text(`+${all.length - max}`, { font: "caption2", color: "secondary" }));
  return Widget.hstack(chips, { spacing: 4 });
}

function header(day) {
  const now = new Date();
  const reminders = day.items.filter((i) => i.kind === "reminder").length;
  const events = day.items.filter((i) => i.kind === "event").length;
  return Widget.hstack([
    Widget.text(now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short" }), { font: "headline", lineLimit: 1 }),
    Widget.spacer(),
    Widget.text(`${plural(events, "event")} · ${plural(reminders, "reminder")}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
  ]);
}

// Rows around "now": a few past rows for context, then as many upcoming as fit.
function windowRows(rows, max) {
  const nowIndex = rows.findIndex((r) => r.kind === "now");
  const start = Math.max(0, Math.min(nowIndex - 1, rows.length - max));
  return { shown: rows.slice(start, start + max), hidden: Math.max(0, rows.length - (start + max)) };
}

function refreshPlan(day) {
  const now = Date.now();
  const edges = day.items.filter((i) => !i.allDay).flatMap((i) => [i.start, i.end]).filter((t) => t > now);
  const soonest = edges.length ? Math.min(...edges) : null;
  if (soonest && soonest - now < 15 * MIN) return { refreshAt: new Date(Math.max(soonest + 5_000, now + 5 * MIN)) };
  return { refreshAfter: 15 * MIN / 1000 };
}

function errorWidget(family, message) {
  if (family === "inline") return Widget.text("Day Plan: open Scriptwell");
  return Widget.vstack([
    Widget.symbol("calendar.badge.exclamationmark", { size: 22, color: "orange", fallback: "⚠️" }),
    Widget.text(message, { font: "caption", color: "secondary", align: "center", lineLimit: 4 }),
  ], { spacing: 6, url: APP_LINK });
}

// ───────────────────────── Widget

Script.widget(async ({ family }) => {
  const s = settings();
  let day;
  try { day = await loadDay(); }
  catch (error) {
    day = Storage.get("lastDay");
    if (!day || day.loaded < startOfDay().getTime()) return errorWidget(family, `Open Day Plan once to allow access. ${error.message}`);
  }
  const { current, next } = nextUp(day);
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  let content;

  if (family === "inline") {
    content = Widget.text(current
      ? `Now: ${current.title} until ${fmtTime(current.end)}`
      : next ? `${next.title} · ${fmtTime(next.start)}` : "Nothing more today");
  } else if (family === "rectangular") {
    content = Widget.vstack([
      Widget.text(current ? "NOW" : "NEXT UP", { font: "caption2", weight: "bold" }),
      Widget.text(current?.title ?? next?.title ?? "All clear", { font: "headline", lineLimit: 1 }),
      current
        ? Widget.hstack([Widget.text(`until ${fmtTime(current.end)}`, { font: "caption" }), Widget.text("·", { font: "caption" }), Widget.date(current.end, { style: "relative", font: "caption" })], { spacing: 3 })
        : next
          ? Widget.hstack([Widget.text(fmtTime(next.start), { font: "caption" }), Widget.text("·", { font: "caption" }), Widget.date(next.start, { style: "relative", font: "caption" })], { spacing: 3 })
          : Widget.text("Nothing more planned", { font: "caption" }),
    ], { alignment: "leading", spacing: 1 });
  } else if (family === "small") {
    const reminders = day.items.filter((i) => i.kind === "reminder").length;
    content = Widget.vstack([
      Widget.hstack([
        Widget.text(new Date().toLocaleDateString(locale, { weekday: "short", day: "numeric" }).toUpperCase(), { font: "caption2", weight: "bold", color: "#2563EB" }),
        Widget.spacer(),
        reminders ? Widget.label(String(reminders), "checklist", { color: REMINDER }) : null,
      ]),
      nextCard(day, { font: "subheadline", relativeFont: "title2" }),
      Widget.spacer(),
      commuteStrip(s) ?? allDayChips(day, 1),
    ], { alignment: "leading", spacing: 4, padding: 12, frame: fill, url: APP_LINK });
  } else if (family === "medium") {
    const rows = timeline(day, s).filter((r) => r.kind !== "now" && r.start > Date.now()).slice(0, 3);
    content = Widget.vstack([
      Widget.hstack([
        Widget.vstack([nextCard(day, { font: "subheadline", relativeFont: "title2", showAfter: false })], {
          alignment: "leading", padding: 10, background: tint(next?.color ?? current?.color ?? "#2563EB", "1F"), cornerRadius: 12,
          frame: { width: 140, maxHeight: "infinity", alignment: "topLeading" },
        }),
        Widget.vstack(rows.length
          ? rows.map((r) => timelineRow(r, { compact: true }))
          : [Widget.text("Nothing more today", { font: "caption", color: "secondary" })],
        { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      ], { spacing: 10, alignment: "top" }),
      commuteStrip(s) ?? allDayChips(day, 3),
    ], { alignment: "leading", spacing: 6, padding: 12, frame: fill, url: APP_LINK });
  } else if (family === "large") {
    const { shown, hidden } = windowRows(timeline(day, s), 10);
    content = Widget.vstack([
      header(day),
      allDayChips(day, 3),
      Widget.divider(),
      ...shown.map((r) => timelineRow(r)),
      hidden ? Widget.text(`+${plural(hidden, "more item")} later`, { font: "caption2", color: "secondary" }) : null,
      Widget.spacer(),
      commuteStrip(s),
    ], { alignment: "leading", spacing: 7, padding: 14, frame: fill, url: APP_LINK });
  } else {
    const { shown, hidden } = windowRows(timeline(day, s), 14);
    const reminders = day.items.filter((i) => i.kind === "reminder");
    content = Widget.hstack([
      Widget.vstack([
        header(day),
        Widget.divider(),
        ...shown.map((r) => timelineRow(r)),
        hidden ? Widget.text(`+${plural(hidden, "more item")} later`, { font: "caption2", color: "secondary" }) : null,
        Widget.spacer(),
      ], { alignment: "leading", spacing: 7, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack([
        Widget.vstack([nextCard(day)], { alignment: "leading", padding: 12, background: tint(next?.color ?? current?.color ?? "#2563EB", "1F"), cornerRadius: 14, frame: { maxWidth: "infinity", alignment: "leading" } }),
        Widget.text("ALL DAY", { font: "caption2", weight: "bold", color: "secondary" }),
        allDayChips(day, 4) ?? Widget.text("Nothing all day", { font: "caption", color: "secondary" }),
        Widget.text("REMINDERS", { font: "caption2", weight: "bold", color: "secondary" }),
        ...(reminders.length
          ? reminders.slice(0, 6).map((r) => Widget.label(r.title, r.overdue ? "exclamationmark.circle" : "circle", { color: r.color }))
          : [Widget.text("Nothing due", { font: "caption", color: "secondary" })]),
        Widget.spacer(),
        commuteStrip(s),
      ], { alignment: "leading", spacing: 8, frame: { width: 220, maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 16, padding: 16, frame: fill, url: APP_LINK });
  }

  return { content, ...refreshPlan(day) };
});

// ───────────────────────── Mini-app actions

Script.action("complete", async ({ id, isOn }) => {
  try {
    if (isOn) await Reminders.complete(id);
    else await Reminders.update(id, { completed: false });
    await UI.haptic(isOn ? "success" : "light");
  } catch (error) {
    await UI.alert({ title: "Could not update the reminder", message: error.message });
  }
});

Script.action("tab", ({ value }) => setUI({ tab: value }));
Script.action("select", ({ id }) => setUI({ selected: ui().selected === id ? null : id }));
Script.action("close", () => setUI({ selected: null }));
Script.action("openMaps", ({ location }) => UI.openURL(`maps://?q=${encodeURIComponent(location)}`));
Script.action("openLink", ({ url }) => UI.openURL(url));
Script.action("calendars", ({ value }) => save({ calendars: value }));
Script.action("set", ({ field, value }) => save({ [field]: value }));
Script.action("flag", ({ field, isOn }) => save({ [field]: isOn }));
Script.action("refreshWeather", async () => {
  await refreshWeather(true);
  const error = Storage.get("weatherError");
  if (error) await UI.alert({ title: "Weather not updated", message: error });
});

// ───────────────────────── Mini-app pieces

const hourOptions = Array.from({ length: 24 }, (_, h) => ({ label: fmtTime(atHour(h)), value: h }));

function detailCard(item) {
  const link = item.notes ? /https?:\/\/\S+/.exec(item.notes)?.[0] : null;
  return Widget.card([
    Widget.text(item.allDay ? (item.overdue ? `Overdue since ${new Date(item.start).toLocaleDateString(locale)}` : "All day") : `${fmtTime(item.start)}${item.kind === "event" ? ` – ${fmtTime(item.end)} · ${fmtDuration(item.end - item.start)}` : ""}`, { font: "subheadline", weight: "medium" }),
    item.calendar ? Widget.label(item.calendar, item.kind === "event" ? "calendar" : "checklist", { color: item.color }) : null,
    item.location ? Widget.label(item.location, "mappin.and.ellipse", { color: "secondary" }) : null,
    item.notes ? Widget.text(item.notes, { font: "footnote", color: "secondary", lineLimit: 8 }) : null,
    Widget.hstack([
      item.location ? Widget.button("Open in Maps", "openMaps", { location: item.location }, { style: "bordered" }) : null,
      link ? Widget.button("Open link", "openLink", { url: link }, { style: "bordered" }) : null,
      Widget.spacer(),
      Widget.button("Close", "close", null, { style: "plain" }),
    ], { spacing: 8 }),
  ], { title: item.title, symbol: item.kind === "event" ? "calendar" : "checklist", color: item.color });
}

function appRow(item) {
  if (item.kind === "reminder") {
    return Widget.hstack([
      Widget.text(item.allDay ? (item.overdue ? "overdue" : "any time") : fmtTime(item.start), { font: "caption2", weight: "semibold", color: item.overdue ? NOW : "secondary", frame: { width: 56, alignment: "leading" } }),
      Widget.checkbox(item.title, false, "complete", { id: item.id }, { color: item.color }),
    ], { spacing: 8, padding: { horizontal: 12, vertical: 6 }, background: CARD_BG, cornerRadius: 12 });
  }
  if (item.kind === "now" || item.kind === "free") return timelineRow(item);
  const selected = ui().selected === item.id;
  return Widget.button(
    Widget.hstack([
      Widget.text(item.allDay ? "all day" : fmtTime(item.start), { font: "caption2", weight: "semibold", color: "secondary", frame: { width: 56, alignment: "leading" } }),
      colorBar(item.color, 30),
      Widget.vstack([
        Widget.text(item.title, { font: "subheadline", weight: "medium", lineLimit: 1 }),
        Widget.text(`${item.allDay ? item.calendar ?? "" : `${fmtTime(item.start)}–${fmtTime(item.end)}`}${item.location ? ` · ${item.location}` : ""}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
      ], { alignment: "leading", spacing: 1 }),
      Widget.spacer(),
      Widget.symbol(selected ? "chevron.down" : "chevron.right", { size: 11, color: "secondary", fallback: "›" }),
    ], { spacing: 8, padding: { horizontal: 12, vertical: 8 }, background: selected ? tint(item.color, "26") : CARD_BG, cornerRadius: 12, frame: { maxWidth: "infinity" } }),
    "select", { id: item.id }, { style: "plain" },
  );
}

function todayTab(day, s, error) {
  const rows = [...day.items.filter((i) => i.allDay && i.kind === "event"), ...timeline(day, s)].slice(0, 40);
  const selected = day.items.find((i) => i.id === ui().selected);
  const weather = Storage.get("weather");
  const commute = commuteHours(s);
  const weatherError = Storage.get("weatherError");
  return Widget.vstack([
    error ? Widget.text(`Showing the last loaded plan: ${error}`, { font: "caption", color: "orange" }) : null,
    Widget.vstack([nextCard(day, { font: "title3", relativeFont: "largeTitle" })], { alignment: "leading", padding: 16, background: CARD_BG, cornerRadius: 16, frame: { maxWidth: "infinity", alignment: "leading" } }),
    s.weather ? Widget.card([
      commute
        ? Widget.hstack(commute.cells.map((c) => Widget.vstack([
            Widget.text(`${c.label} · ${fmtTime(atHour(c.hour))}`, { font: "caption", color: "secondary" }),
            Widget.hstack([
              Widget.symbol(c.data.symbol ?? "cloud.fill", { size: 22, color: "#2563EB", fallback: "☁️" }),
              Widget.text(`${Math.round(c.data.temperature)}°`, { font: "title2", weight: "semibold", design: "rounded" }),
            ], { spacing: 6 }),
            Widget.text(`${c.data.condition ?? ""}${c.data.chance >= 0.2 ? ` · ${Math.round(c.data.chance * 100)}% rain` : ""}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
          ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } })), { spacing: 12 })
        : Widget.text(weatherError ? `Not available: ${weatherError}` : "Loading the forecast for your commute…", { font: "footnote", color: "secondary" }),
      Widget.hstack([
        weather ? Widget.hstack([Widget.text("Updated", { font: "caption2", color: "secondary" }), Widget.date(weather.time, { style: "relative", font: "caption2", color: "secondary" })], { spacing: 3 }) : null,
        Widget.spacer(),
        Widget.text(weather?.credit?.text ?? "Apple Weather", { font: "caption2", color: "secondary", url: weather?.credit?.url }),
      ]),
    ], { title: "Commute", symbol: "cloud.sun.fill", color: "#2563EB" }) : null,
    selected ? detailCard(selected) : null,
    Widget.text("TIMELINE", { font: "caption", weight: "bold", color: "secondary" }),
    ...(rows.filter((r) => r.kind !== "now").length ? rows.map(appRow) : [Widget.text("Nothing planned today. Enjoy the quiet.", { color: "secondary", padding: 12 })]),
  ], { alignment: "leading", spacing: 10 });
}

function remindersTab(day) {
  const due = day.items.filter((i) => i.kind === "reminder");
  if (!due.length) {
    return Widget.vstack([
      Widget.symbol("checkmark.circle.fill", { size: 44, color: FREE, fallback: "✓" }),
      Widget.text("No reminders due today", { font: "headline" }),
    ], { spacing: 10, padding: 30, frame: { maxWidth: "infinity" } });
  }
  const overdue = due.filter((r) => r.overdue);
  const today = due.filter((r) => !r.overdue);
  const section = (title, items) => (items.length ? [
    Widget.text(title, { font: "caption", weight: "bold", color: "secondary" }),
    ...items.map(appRow),
  ] : []);
  return Widget.vstack([
    Widget.text(`${plural(due.length, "reminder")} to tick off. Turn one on to complete it.`, { font: "footnote", color: "secondary" }),
    ...section("OVERDUE", overdue),
    ...section("TODAY", today),
  ], { alignment: "leading", spacing: 10 });
}

function settingsTab(s, calendars) {
  const row = (label, control) => Widget.vstack([Widget.text(label, { font: "caption", color: "secondary" }), control], { alignment: "leading", spacing: 4 });
  const options = calendars.map((c) => ({ label: c.title, value: c.title, symbol: "circle.fill" }));
  return Widget.vstack([
    Widget.card([
      calendars.length
        ? Widget.checklist(options, s.calendars, "calendars", null, { label: "Calendars shown" })
        : Widget.text("Calendars could not be listed yet.", { font: "footnote", color: "secondary" }),
      Widget.text(s.calendars.length ? `${s.calendars.length} of ${calendars.length} chosen` : "None ticked means all calendars are shown.", { font: "caption2", color: "secondary" }),
    ], { title: "Calendars", symbol: "calendar", color: "#2563EB" }),
    Widget.card([
      row("Day starts", Widget.picker(hourOptions.filter((o) => o.value < s.dayEnd), s.dayStart, "set", { field: "dayStart" })),
      row("Day ends", Widget.picker(hourOptions.filter((o) => o.value > s.dayStart), s.dayEnd, "set", { field: "dayEnd" })),
      Widget.text("Free gaps are only looked for between these hours.", { font: "caption2", color: "secondary" }),
      Widget.toggle("Show overdue reminders", s.overdue, "flag", { field: "overdue" }),
    ], { title: "Working hours", symbol: "clock", color: FREE }),
    Widget.card([
      Widget.toggle("Commute weather", s.weather, "flag", { field: "weather" }),
      s.weather ? row("Leaving home", Widget.picker(hourOptions, s.commuteOut, "set", { field: "commuteOut" })) : null,
      s.weather ? row("Heading home", Widget.picker(hourOptions, s.commuteHome, "set", { field: "commuteHome" })) : null,
      s.weather ? Widget.button("Refresh forecast now", "refreshWeather", null, { style: "bordered" }) : null,
      Widget.text("Uses your current location for Apple Weather and caches the hourly forecast for the widget.", { font: "caption2", color: "secondary" }),
    ], { title: "Commute", symbol: "cloud.sun.fill", color: REMINDER }),
  ], { alignment: "leading", spacing: 14 });
}

// ───────────────────────── Mini-app

Script.ui(async () => {
  const s = settings();
  let day, error = null;
  try { day = await loadDay(); }
  catch (e) { error = e.message; day = Storage.get("lastDay") ?? { items: [], loaded: 0 }; }
  const tab = ui().tab ?? 0;
  if (s.weather && tab === 0) await refreshWeather();
  let calendars = [];
  if (tab === 2) {
    try { calendars = await Calendar.calendars(); } catch { /* shown as a note in Settings */ }
  }
  const dueCount = day.items.filter((i) => i.kind === "reminder").length;

  // Only the open tab is built, which keeps the tree small on busy days.
  return {
    title: "Day Plan",
    content: Widget.vstack([
      Widget.tabs([
        { title: "Today", symbol: "calendar.day.timeline.left", content: tab === 0 ? todayTab(day, s, error) : Widget.text("") },
        { title: dueCount ? `Reminders (${dueCount})` : "Reminders", symbol: "checklist", content: tab === 1 ? remindersTab(day) : Widget.text("") },
        { title: "Settings", symbol: "gearshape", content: tab === 2 ? settingsTab(s, calendars) : Widget.text("") },
      ], { selected: tab, action: "tab" }),
    ], { padding: 16, background: PAGE_BG, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "top" } }),
  };
});

// ───────────────────────── Shortcuts and Siri

Script.run(async () => {
  const day = await loadDay();
  const s = settings();
  const { current, next } = nextUp(day);
  const timed = day.items.filter((i) => !i.allDay && i.start > Date.now());
  const gaps = freeGaps(day.items.filter((i) => !i.allDay), s);
  const lines = [];
  if (current) lines.push(`Now: ${current.title} until ${fmtTime(current.end)}.`);
  if (next) lines.push(`Next: ${next.title} at ${fmtTime(next.start)}.`);
  if (!current && !next) lines.push("Nothing more planned today.");
  if (timed.length > 1) lines.push(`${plural(timed.length, "item")} still to come: ${timed.slice(0, 5).map((i) => `${i.title} (${fmtTime(i.start)})`).join(", ")}.`);
  if (gaps.length) lines.push(`Free: ${gaps.slice(0, 3).map((g) => `${fmtDuration(g.end - g.start)} from ${fmtTime(g.start)}`).join(", ")}.`);
  return lines.join(" ");
});
