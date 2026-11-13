// @name        Med Schedule
// @description A medication log with reminders: doses per day and weekday, notifications for today and tomorrow, a tap-to-log widget, 30-day adherence and refill countdowns, plus optional label excerpts from the US openFDA service (api.fda.gov)
// @permissions notifications, network
// @widget      small, medium, large, rectangular, inline
// @icon        pills.fill
// @color       #0D9488
// @version     1.0.0
// @author      scriptwell
// @category    medical

// How it works
// • Add each medication in the mini-app: dose, times per day (time pickers), days of the week, notes
//   and, if you like, how many pills are left. Everything is stored on the device.
// • Reminders: every dose for today and tomorrow gets a local notification with a stable id (medication,
//   day and time), so rescheduling replaces rather than duplicates. Background runs keep the next 48 hours
//   covered; opening the app, logging a dose or running the script does the same.
// • The widget lists today's doses; tap one to mark it taken (tap again to undo). The mini-app logs taken
//   or skipped with a timestamp in log.json, shows adherence per medication over 30 days as a bar chart,
//   and counts down to a refill (pills left ÷ doses per day) with a reminder at 5 days.
// • Leaflet: the only network use. It asks api.fda.gov for the US label matching the medication name and
//   shows purpose, dosage and warnings excerpts. That is the US label text, not advice for you.
// • This script is a log and a set of reminders. It does not give medical guidance; follow the directions
//   from your prescriber and pharmacist.

// ───────────────────────── Constants

const DAY = 86_400_000;
const ADHERENCE_DAYS = 30;
const REFILL_WARN_DAYS = 5;
const LOG_FILE = "log.json";
const MAX_LOG = 5000;
const TEAL = "#0D9488";
const TEAL_SOFT = { light: "#CCFBF1", dark: "#134E4A" };
const TILE = { light: "#F1F5F9", dark: "#1E293B" };
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const DISCLAIMER = "A log and reminders only, not medical advice. Follow your prescriber's and pharmacist's directions.";

// ───────────────────────── Data

const meds = () => Storage.get("meds", []);
const medById = (id) => meds().find((m) => m.id === id);
const dayKey = (date) => date.toLocaleDateString("en-CA");
const statusIndex = () => Storage.get("status", {});
const statusOf = (slot) => statusIndex()[slot.day]?.[slot.key] ?? null;
const dosesPerDay = (med) => (med.times.length * med.days.length) / 7;
const weekdayName = (d, style = "short") => new Date(2024, 0, 7 + d).toLocaleDateString(Script.env.locale, { weekday: style });

function fmtTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return date.toLocaleTimeString(Script.env.locale, { hour: "2-digit", minute: "2-digit" });
}

function daysText(days) {
  if (days.length === 7) return "Every day";
  if (days.length === 5 && !days.includes(0) && !days.includes(6)) return "Weekdays";
  return WEEKDAYS.filter((d) => days.includes(d)).map((d) => weekdayName(d)).join(" ");
}

// Every dose scheduled on a given day, earliest first.
function slotsFor(date) {
  const day = dayKey(date);
  const weekday = date.getDay();
  const out = [];
  for (const med of meds()) {
    if (!med.days.includes(weekday) || (med.created && med.created > day)) continue;
    for (const time of med.times) {
      const [h, m] = time.split(":").map(Number);
      const at = new Date(date);
      at.setHours(h, m, 0, 0);
      out.push({ med, time, day, key: `${med.id}@${time}`, at: at.getTime() });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

const todaySlots = () => slotsFor(new Date());
const nextDue = () => todaySlots().find((slot) => !statusOf(slot)) ?? null;

async function appendLog(entry) {
  let log = [];
  try { if (await Files.exists(LOG_FILE)) log = await Files.readJSON(LOG_FILE); } catch { log = []; }
  log.push(entry);
  await Files.writeJSON(LOG_FILE, log.slice(-MAX_LOG));
}

// Records taken, skipped or nothing for one dose, keeps the pill count in step and logs it to the file.
async function setStatus(slot, status) {
  const index = statusIndex();
  const previous = index[slot.day]?.[slot.key]?.status ?? null;
  if (previous === status) return;
  index[slot.day] ??= {};
  if (status) index[slot.day][slot.key] = { status, at: Date.now() };
  else delete index[slot.day][slot.key];
  const cutoff = dayKey(new Date(Date.now() - (ADHERENCE_DAYS + 5) * DAY));
  for (const day of Object.keys(index)) if (day < cutoff) delete index[day];
  Storage.set("status", index);

  const med = medById(slot.med.id);
  if (med && med.pills != null) {
    const delta = (status === "taken" ? -1 : 0) + (previous === "taken" ? 1 : 0);
    if (delta) Storage.set("meds", meds().map((m) => (m.id === med.id ? { ...m, pills: Math.max(0, m.pills + delta) } : m)));
  }
  await appendLog({ medId: slot.med.id, name: slot.med.name, dose: slot.med.dose, day: slot.day, time: slot.time, status: status ?? "cleared", at: new Date().toISOString() });

  // A logged dose no longer needs its reminder. Not possible from a widget action; the next reschedule tidies up.
  if (status && Script.env.mode !== "widget") {
    try { await Notification.cancel(`dose-${slot.med.id}-${slot.day}-${slot.time}`); } catch { /* widgets cannot */ }
  }
}

// ───────────────────────── Reminders and refills

async function scheduleReminders() {
  const now = Date.now();
  const wanted = new Map();
  for (const date of [new Date(now), new Date(now + DAY)]) {
    for (const slot of slotsFor(date)) {
      if (slot.at <= now || statusOf(slot)) continue;
      wanted.set(`dose-${slot.med.id}-${slot.day}-${slot.time}`, slot);
    }
  }
  const pending = await Notification.pending();
  const stale = pending.filter((n) => String(n.id).startsWith("dose-") && !wanted.has(n.id));
  await Promise.all(stale.map((n) => Notification.cancel(n.id)));
  await Promise.all([...wanted].map(([id, slot]) => Notification.schedule({
    id,
    title: slot.med.dose ? `${slot.med.name} · ${slot.med.dose}` : slot.med.name,
    body: slot.med.notes || `Due at ${fmtTime(slot.time)}. Tap the widget or open Med Schedule to log it.`,
    at: new Date(slot.at),
  })));
  Storage.set("scheduled", { count: wanted.size, time: now });
  return wanted.size;
}

function refillOf(med) {
  if (med.pills == null) return null;
  const perDay = dosesPerDay(med);
  const daysLeft = perDay > 0 ? med.pills / perDay : Infinity;
  return { pills: med.pills, daysLeft, runsOut: Number.isFinite(daysLeft) ? Date.now() + daysLeft * DAY : null, low: daysLeft <= REFILL_WARN_DAYS };
}

async function checkRefills() {
  const today = dayKey(new Date());
  const notified = Storage.get("refillNotified", {});
  for (const med of meds()) {
    const refill = refillOf(med);
    if (!refill?.low || notified[med.id] === today) continue;
    await Notification.schedule({
      id: `refill-${med.id}`,
      title: `Refill ${med.name}`,
      body: `${med.pills} left, about ${Math.max(0, Math.floor(refill.daysLeft))} days of doses.`,
      after: 2,
    });
    notified[med.id] = today;
  }
  Storage.set("refillNotified", notified);
}

async function maintain() {
  try {
    await scheduleReminders();
    await checkRefills();
    Storage.remove("lastError");
  } catch (error) {
    Storage.set("lastError", error.message);
  }
}

// ───────────────────────── Adherence

function adherence(med) {
  const index = statusIndex();
  const now = Date.now();
  let expected = 0, taken = 0, skipped = 0;
  for (let i = 0; i < ADHERENCE_DAYS; i++) {
    const date = new Date(now - i * DAY);
    for (const slot of slotsFor(date)) {
      if (slot.med.id !== med.id || slot.at > now) continue;
      expected++;
      const status = index[slot.day]?.[slot.key]?.status;
      if (status === "taken") taken++;
      if (status === "skipped") skipped++;
    }
  }
  return { expected, taken, skipped, percent: expected ? Math.round((taken / expected) * 100) : null };
}

// ───────────────────────── Leaflet (openFDA)

const stripHtml = (text) => String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const searchName = (name) => name.replace(/\s*\d.*$/, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().toLowerCase();

async function fetchLeaflet(name) {
  const query = searchName(name);
  if (!query) throw new Error("Give the medication a name first.");
  const lookup = async (field) => {
    const url = new URL("https://api.fda.gov/drug/label.json");
    url.searchParams.set("search", `openfda.${field}:"${query}"`);
    url.searchParams.set("limit", "1");
    const response = await fetch(url, { timeout: 10000 });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`openFDA answered ${response.status}`);
    return (await response.json()).results?.[0] ?? null;
  };
  const result = (await lookup("brand_name")) ?? (await lookup("generic_name"));
  const leaflet = { query, time: Date.now(), missing: !result };
  if (result) {
    const excerpt = (...fields) => {
      for (const field of fields) {
        const value = result[field];
        const text = Array.isArray(value) ? value.join(" ") : value;
        if (text) return stripHtml(text).slice(0, 1500);
      }
      return null;
    };
    leaflet.brand = result.openfda?.brand_name?.[0] ?? null;
    leaflet.generic = result.openfda?.generic_name?.[0] ?? null;
    leaflet.purpose = excerpt("purpose", "indications_and_usage");
    leaflet.dosage = excerpt("dosage_and_administration");
    leaflet.warnings = excerpt("boxed_warning", "warnings", "warnings_and_cautions");
  }
  Storage.set(`leaflet:${query}`, leaflet);
  return leaflet;
}

// ───────────────────────── Run and background

Script.run(async (input) => {
  const words = String(input ?? "").trim().toLowerCase();
  const target = words && meds().find((m) => words.includes(m.name.toLowerCase()));
  if (target) {
    const slot = todaySlots().find((s) => s.med.id === target.id && !statusOf(s));
    if (slot) await setStatus(slot, "taken");
  }
  await maintain();
  const slots = todaySlots();
  const done = slots.filter((s) => statusOf(s)?.status === "taken").length;
  const next = nextDue();
  const lines = [`${done} of ${slots.length} doses taken today.`];
  if (next) lines.push(`Next: ${next.med.name}${next.med.dose ? ` ${next.med.dose}` : ""} at ${fmtTime(next.time)}.`);
  for (const med of meds()) {
    const refill = refillOf(med);
    if (refill?.low) lines.push(`Refill ${med.name}: ${refill.pills} left.`);
  }
  if (target && slots.some((s) => s.med.id === target.id)) lines.unshift(`Logged ${target.name} as taken.`);
  return lines.join(" ");
});

Script.background(maintain);

// ───────────────────────── Widget actions

Script.action("toggle", async ({ medId, time, day }) => {
  const med = medById(medId);
  if (!med) return;
  const slot = { med, time, day, key: `${medId}@${time}` };
  await setStatus(slot, statusOf(slot)?.status === "taken" ? null : "taken");
});

// ───────────────────────── Widget

const check = (status, size = 20) => Widget.symbol(
  status === "taken" ? "checkmark.circle.fill" : status === "skipped" ? "minus.circle.fill" : "circle",
  { size, color: status === "taken" ? "green" : status === "skipped" ? "orange" : "secondary", fallback: status === "taken" ? "✅" : status === "skipped" ? "➖" : "⚪️" },
);

function slotRow(slot, { font = "subheadline", detail = true } = {}) {
  const status = statusOf(slot)?.status ?? null;
  const overdue = !status && slot.at < Date.now();
  return Widget.button(Widget.hstack([
    check(status),
    Widget.vstack([
      Widget.text(slot.med.name, { font, weight: "semibold", color: status ? "secondary" : "primary", lineLimit: 1 }),
      detail ? Widget.text([slot.med.dose, fmtTime(slot.time)].filter(Boolean).join(" · "), { font: "caption2", color: overdue ? "orange" : "secondary", lineLimit: 1 }) : null,
    ], { alignment: "leading", spacing: 1 }),
    Widget.spacer(),
    Widget.text(status === "taken" ? "Taken" : status === "skipped" ? "Skipped" : overdue ? "Due" : fmtTime(slot.time), { font: "caption2", weight: "semibold", color: status === "taken" ? "green" : overdue ? "orange" : "secondary" }),
  ], { spacing: 8, padding: { horizontal: 8, vertical: 5 }, background: TILE, cornerRadius: 9, frame: { maxWidth: "infinity" } }), "toggle", { medId: slot.med.id, time: slot.time, day: slot.day }, { style: "plain" });
}

function ring(done, total, size) {
  return Widget.progress(total ? done / total : 0, { style: "ring", color: TEAL, label: `${done}/${total}`, frame: { width: size, height: size } });
}

function emptyWidget(family) {
  if (family === "inline") return Widget.text("Med Schedule: add a medication");
  return Widget.vstack([
    Widget.symbol("pills.fill", { size: 24, color: "teal", fallback: "💊" }),
    Widget.text("Add a medication in Med Schedule", { font: "caption", color: "secondary", align: "center", lineLimit: 3 }),
  ], { spacing: 6, url: APP_LINK });
}

Script.widget(({ family }) => {
  if (meds().length === 0) return emptyWidget(family);
  const slots = todaySlots();
  const done = slots.filter((s) => statusOf(s)?.status === "taken").length;
  const next = nextDue();
  const nextText = next ? `${next.med.name} ${fmtTime(next.time)}` : slots.length ? "All logged for today" : "Nothing due today";
  const lowRefills = meds().map((m) => ({ m, r: refillOf(m) })).filter(({ r }) => r?.low);
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const midnight = new Date();
  midnight.setHours(24, 0, 10, 0);
  let content;

  if (family === "inline") {
    content = Widget.text(next ? `Next: ${nextText}` : `${nextText} · ${done}/${slots.length}`);
  } else if (family === "rectangular") {
    content = Widget.vstack([
      Widget.text("MED SCHEDULE", { font: "caption2", weight: "bold" }),
      Widget.text(nextText, { font: "headline", lineLimit: 1, minimumScale: 0.7 }),
      Widget.progress(slots.length ? done / slots.length : 0),
      Widget.text(`${done} of ${slots.length} taken today`, { font: "caption" }),
    ], { alignment: "leading", spacing: 2 });
  } else if (family === "small") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("pills.fill", { size: 12, color: "teal", fallback: "💊" }),
        Widget.text("TODAY", { font: "caption2", weight: "bold", color: "secondary" }),
        Widget.spacer(),
        lowRefills.length ? Widget.symbol("exclamationmark.circle.fill", { size: 12, color: "orange", fallback: "❗️" }) : null,
      ], { spacing: 4 }),
      Widget.hstack([ring(done, slots.length, 46), Widget.spacer()]),
      Widget.spacer(),
      Widget.text(next ? "Next" : "", { font: "caption2", color: "secondary" }),
      Widget.text(nextText, { font: "footnote", weight: "semibold", lineLimit: 2, minimumScale: 0.8 }),
      next ? Widget.button("Taken", "toggle", { medId: next.med.id, time: next.time, day: next.day }, { style: "bordered", color: "teal" }) : null,
    ], { alignment: "leading", spacing: 3, url: APP_LINK, frame: fill });
  } else if (family === "medium") {
    content = Widget.hstack([
      Widget.vstack([
        ring(done, slots.length, 58),
        Widget.text(`${done} of ${slots.length}`, { font: "caption", weight: "semibold" }),
        Widget.text("taken today", { font: "caption2", color: "secondary" }),
        Widget.spacer(),
        lowRefills.length ? Widget.text(`Refill ${lowRefills[0].m.name}`, { font: "caption2", weight: "semibold", color: "orange", lineLimit: 2 }) : null,
      ], { alignment: "leading", spacing: 2, frame: { width: 84, maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack(slots.length ? slots.slice(0, 4).map((slot) => slotRow(slot, { font: "footnote", detail: false })) : [Widget.text("Nothing scheduled today.", { font: "caption", color: "secondary" })], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 10, url: APP_LINK, frame: fill });
  } else {
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("pills.fill", { size: 16, color: "teal", fallback: "💊" }),
        Widget.text(new Date().toLocaleDateString(Script.env.locale, { weekday: "long", day: "numeric", month: "long" }), { font: "headline" }),
        Widget.spacer(),
        Widget.text(`${done}/${slots.length} taken`, { font: "caption", weight: "semibold", color: "teal" }),
      ], { spacing: 6 }),
      ...(slots.length ? slots.slice(0, 8).map((slot) => slotRow(slot)) : [Widget.text("Nothing scheduled today.", { font: "footnote", color: "secondary" })]),
      slots.length > 8 ? Widget.text(`+${slots.length - 8} more in the app`, { font: "caption2", color: "secondary" }) : null,
      Widget.spacer(),
      ...lowRefills.slice(0, 2).map(({ m, r }) => Widget.hstack([
        Widget.symbol("exclamationmark.circle.fill", { size: 11, color: "orange", fallback: "❗️" }),
        Widget.text(`Refill ${m.name}: ${r.pills} left, about ${Math.max(0, Math.floor(r.daysLeft))} days`, { font: "caption2", color: "orange", lineLimit: 1 }),
      ], { spacing: 4 })),
      Widget.text("Tap a dose to log it · a log and reminders, not medical advice", { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
    ], { alignment: "leading", spacing: 5, url: APP_LINK, frame: fill });
  }
  // Half-hourly so "Due" labels keep up; the timeline rolls over at midnight anyway.
  return { content, refreshAfter: Math.min(30 * 60, Math.max(5 * 60, Math.round((midnight - Date.now()) / 1000))) };
});

// ───────────────────────── Mini-app actions

const blankDraft = () => ({ id: null, name: "", dose: "", times: ["08:00"], days: [...WEEKDAYS], notes: "", pills: 30, trackPills: false });
const draft = () => Storage.get("draft") ?? blankDraft();
const setDraft = (changes) => Storage.set("draft", { ...draft(), ...changes });

Script.action("page", ({ value }) => Storage.set("page", value));
Script.action("new", () => { Storage.set("draft", blankDraft()); Storage.set("page", "edit"); });
Script.action("cancel", () => { Storage.remove("draft"); Storage.set("page", "meds"); });
Script.action("field", ({ field, value }) => setDraft({ [field]: value }));
Script.action("trackPills", ({ isOn }) => setDraft({ trackPills: isOn }));
Script.action("days", ({ value }) => setDraft({ days: value }));

Script.action("edit", ({ id }) => {
  const med = medById(id);
  if (!med) return;
  Storage.set("draft", { id: med.id, name: med.name, dose: med.dose ?? "", times: [...med.times], days: [...med.days], notes: med.notes ?? "", pills: med.pills ?? 30, trackPills: med.pills != null });
  Storage.set("page", "edit");
});

Script.action("timesCount", ({ value }) => {
  const d = draft();
  const defaults = ["08:00", "20:00", "13:00", "22:00"];
  const times = [...d.times];
  while (times.length < value) times.push(defaults[times.length] ?? "12:00");
  setDraft({ times: times.slice(0, value) });
});

Script.action("time", ({ index, value }) => {
  const date = new Date(value);
  const hhmm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const times = [...draft().times];
  times[index] = hhmm;
  setDraft({ times });
});

Script.action("save", async () => {
  const d = draft();
  const name = d.name.trim();
  if (!name) { await UI.alert("Give the medication a name."); return; }
  if (d.days.length === 0) { await UI.alert("Choose at least one day of the week."); return; }
  const times = [...new Set(d.times)].sort();
  const med = { id: d.id ?? `m${Date.now().toString(36)}`, name, dose: d.dose.trim(), times, days: d.days, notes: d.notes.trim(), pills: d.trackPills ? Math.max(0, Math.round(d.pills)) : null, created: d.id ? medById(d.id)?.created ?? dayKey(new Date()) : dayKey(new Date()) };
  Storage.set("meds", d.id ? meds().map((m) => (m.id === d.id ? med : m)) : [...meds(), med]);
  Storage.remove("draft");
  Storage.set("page", "meds");
  await maintain();
});

Script.action("delete", async ({ id }) => {
  const med = medById(id);
  const choice = await UI.alert({ title: `Remove ${med?.name ?? "this medication"}?`, message: "Its reminders are cancelled. The log file keeps past entries.", buttons: ["Cancel", "Remove"] });
  if (choice !== 1) return;
  Storage.set("meds", meds().filter((m) => m.id !== id));
  Storage.remove("draft");
  Storage.set("page", "meds");
  await maintain();
});

Script.action("log", async ({ medId, time, day, status }) => {
  const med = medById(medId);
  if (med) await setStatus({ med, time, day, key: `${medId}@${time}` }, status);
  await UI.haptic(status ? "success" : "light");
});

Script.action("reschedule", async () => {
  await maintain();
  await UI.haptic(Storage.get("lastError") ? "error" : "success");
});

Script.action("leaflet", async ({ id }) => {
  const med = medById(id);
  if (!med) return;
  Storage.set("leafletMed", id);
  Storage.set("page", "leaflet");
  const cached = Storage.get(`leaflet:${searchName(med.name)}`);
  if (cached && Date.now() - cached.time < 7 * DAY) return;
  try { await fetchLeaflet(med.name); Storage.remove("leafletError"); }
  catch (error) { Storage.set("leafletError", error.message); }
});

Script.action("leafletRefresh", async ({ id }) => {
  try { await fetchLeaflet(medById(id)?.name ?? ""); Storage.remove("leafletError"); }
  catch (error) { Storage.set("leafletError", error.message); }
});

Script.action("section", ({ name }) => {
  const open = Storage.get("open", { purpose: true });
  Storage.set("open", { ...open, [name]: !open[name] });
});

Script.action("shareLog", async () => {
  let log = [];
  try { if (await Files.exists(LOG_FILE)) log = await Files.readJSON(LOG_FILE); } catch { log = []; }
  const csv = ["date,time,medication,dose,status,logged_at", ...log.map((e) => [e.day, e.time, e.name, e.dose ?? "", e.status, e.at].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
  await Files.write("exports/med-log.csv", csv);
  await UI.share({ file: "exports/med-log.csv" });
});

// ───────────────────────── Mini-app pages

function todayPage() {
  const slots = todaySlots();
  const done = slots.filter((s) => statusOf(s)?.status === "taken").length;
  const tomorrow = slotsFor(new Date(Date.now() + DAY));
  const error = Storage.get("lastError");
  const scheduled = Storage.get("scheduled");
  return Widget.vstack([
    Widget.hstack([
      ring(done, slots.length, 72),
      Widget.vstack([
        Widget.text(new Date().toLocaleDateString(Script.env.locale, { weekday: "long", day: "numeric", month: "long" }), { font: "headline" }),
        Widget.text(slots.length ? `${done} of ${slots.length} doses taken` : "Nothing scheduled today", { font: "subheadline", color: "secondary" }),
        scheduled ? Widget.hstack([Widget.text(`${scheduled.count} reminders set`, { font: "caption2", color: "secondary" }), Widget.date(scheduled.time, { style: "relative", font: "caption2", color: "secondary" })], { spacing: 4 }) : null,
      ], { alignment: "leading", spacing: 3 }),
    ], { spacing: 16 }),
    error ? Widget.text(`Reminders: ${error}`, { font: "caption", color: "red" }) : null,
    ...slots.map((slot) => {
      const status = statusOf(slot);
      const overdue = !status && slot.at < Date.now();
      return Widget.vstack([
        Widget.hstack([
          check(status?.status, 24),
          Widget.vstack([
            Widget.text(`${slot.med.name}${slot.med.dose ? ` · ${slot.med.dose}` : ""}`, { font: "headline", color: status ? "secondary" : "primary" }),
            Widget.text(`${fmtTime(slot.time)}${slot.med.notes ? ` · ${slot.med.notes}` : ""}`, { font: "caption", color: overdue ? "orange" : "secondary", lineLimit: 2 }),
            status ? Widget.hstack([Widget.text(status.status === "taken" ? "Taken" : "Skipped", { font: "caption2", weight: "semibold", color: status.status === "taken" ? "green" : "orange" }), Widget.date(status.at, { style: "time", font: "caption2", color: "secondary" })], { spacing: 4 }) : null,
          ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
        ], { spacing: 10, alignment: "top" }),
        Widget.hstack(status ? [
          Widget.button("Undo", "log", { medId: slot.med.id, time: slot.time, day: slot.day, status: null }, { style: "bordered" }),
        ] : [
          Widget.button("Taken", "log", { medId: slot.med.id, time: slot.time, day: slot.day, status: "taken" }, { style: "prominent", color: "teal" }),
          Widget.button("Skipped", "log", { medId: slot.med.id, time: slot.time, day: slot.day, status: "skipped" }, { style: "bordered", color: "orange" }),
        ], { spacing: 8 }),
      ], { alignment: "leading", spacing: 8, padding: 12, background: status ? TILE : TEAL_SOFT, cornerRadius: 12 });
    }),
    tomorrow.length ? Widget.card([
      Widget.list(tomorrow.slice(0, 10).map((slot) => ({ title: slot.med.name, subtitle: slot.med.dose || undefined, detail: fmtTime(slot.time), symbol: "clock", color: "teal" })), { style: "plain" }),
    ], { title: "Tomorrow", subtitle: `${tomorrow.length} dose${tomorrow.length === 1 ? "" : "s"} with reminders`, symbol: "calendar", color: "teal" }) : null,
    Widget.text(DISCLAIMER, { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 14 });
}

function medsPage() {
  return Widget.vstack([
    ...meds().map((med) => {
      const refill = refillOf(med);
      const a = adherence(med);
      return Widget.card([
        Widget.text(`${fmtTime(med.times[0])}${med.times.length > 1 ? ` + ${med.times.length - 1} more` : ""} · ${daysText(med.days)}`, { font: "footnote", color: "secondary" }),
        med.notes ? Widget.text(med.notes, { font: "footnote", color: "secondary", lineLimit: 2 }) : null,
        Widget.hstack([
          a.percent != null ? Widget.text(`${a.percent}% taken · 30 days`, { font: "caption", weight: "semibold", color: a.percent >= 80 ? "green" : "orange" }) : Widget.text("No doses logged yet", { font: "caption", color: "secondary" }),
          Widget.spacer(),
          refill ? Widget.text(`${refill.pills} left · ${Number.isFinite(refill.daysLeft) ? `${Math.floor(refill.daysLeft)} days` : "no doses"}`, { font: "caption", weight: "semibold", color: refill.low ? "orange" : "secondary" }) : null,
        ]),
        Widget.hstack([
          Widget.button("Edit", "edit", { id: med.id }, { style: "bordered" }),
          Widget.button("US label", "leaflet", { id: med.id }, { style: "bordered" }),
        ], { spacing: 8 }),
      ], { title: med.name, subtitle: med.dose || undefined, symbol: "pills.fill", color: "teal" });
    }),
    meds().length === 0 ? Widget.vstack([
      Widget.symbol("pills.fill", { size: 48, color: "teal", fallback: "💊" }),
      Widget.text("No medications yet", { font: "title3", weight: "semibold" }),
      Widget.text("Add one and reminders for today and tomorrow are scheduled right away.", { color: "secondary", align: "center" }),
    ], { spacing: 10, padding: 20, frame: { maxWidth: "infinity" } }) : null,
    Widget.button("Add medication", "new", null, { style: "prominent", color: "teal" }),
  ], { alignment: "leading", spacing: 14 });
}

function editPage() {
  const d = draft();
  const timeDate = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); const date = new Date(); date.setHours(h, m, 0, 0); return date.toISOString(); };
  return Widget.vstack([
    Widget.textField("For example Metformin", d.name, "field", { field: "name" }, { label: "Name" }),
    Widget.textField("For example 500 mg, 1 tablet", d.dose, "field", { field: "dose" }, { label: "Dose" }),
    Widget.stepper(`Times per day: ${d.times.length}`, d.times.length, "timesCount", null, { min: 1, max: 4 }),
    ...d.times.map((time, index) => Widget.datePicker(timeDate(time), "time", { index }, { label: `Dose ${index + 1}`, mode: "time" })),
    Widget.checklist(WEEKDAYS.map((day) => ({ label: weekdayName(day, "long"), value: day })), d.days, "days", null, { label: "Days" }),
    Widget.textField("With food, before bed…", d.notes, "field", { field: "notes" }, { label: "Notes (shown in the reminder)", multiline: true }),
    Widget.toggle("Count pills for a refill reminder", d.trackPills, "trackPills", null, { color: "teal" }),
    d.trackPills ? Widget.stepper(`Pills left: ${d.pills}`, d.pills, "field", { field: "pills" }, { min: 0, max: 500 }) : null,
    Widget.hstack([
      Widget.button("Save", "save", null, { style: "prominent", color: "teal" }),
      Widget.button("Cancel", "cancel", null, { style: "bordered" }),
      Widget.spacer(),
      d.id ? Widget.button("Remove", "delete", { id: d.id }, { style: "bordered", color: "red" }) : null,
    ], { spacing: 8 }),
  ], { alignment: "leading", spacing: 14 });
}

function statsPage() {
  const list = meds();
  const rows = list.map((med) => ({ med, a: adherence(med) }));
  const charted = rows.filter(({ a }) => a.percent != null);
  const refills = list.map((med) => ({ med, r: refillOf(med) })).filter(({ r }) => r);
  return Widget.vstack([
    Widget.card([
      charted.length
        ? Widget.chart(charted.map(({ med, a }) => ({ x: med.name, y: a.percent })), { color: TEAL, range: [0, 100], frame: { height: 180 } })
        : Widget.text("Log a few doses and the chart appears here.", { font: "footnote", color: "secondary" }),
      ...rows.map(({ med, a }) => Widget.hstack([
        Widget.text(med.name, { font: "subheadline", lineLimit: 1 }),
        Widget.spacer(),
        Widget.text(a.percent != null ? `${a.percent}% · ${a.taken} of ${a.expected}${a.skipped ? ` · ${a.skipped} skipped` : ""}` : "no doses yet", { font: "caption", color: "secondary" }),
      ])),
    ], { title: "Adherence", subtitle: "Doses marked taken, last 30 days", symbol: "chart.bar.fill", color: "teal" }),
    refills.length ? Widget.card(refills.map(({ med, r }) => Widget.vstack([
      Widget.hstack([
        Widget.text(med.name, { font: "subheadline", weight: "semibold" }),
        Widget.spacer(),
        Widget.text(`${r.pills} left`, { font: "subheadline", color: r.low ? "orange" : "primary" }),
      ]),
      Widget.progress(Math.min(1, r.daysLeft / 30), { color: r.low ? "orange" : TEAL }),
      Widget.hstack([
        Widget.text(Number.isFinite(r.daysLeft) ? `About ${Math.floor(r.daysLeft)} days of doses` : "No doses scheduled", { font: "caption", color: "secondary" }),
        Widget.spacer(),
        r.runsOut ? Widget.date(r.runsOut, { style: "date", font: "caption", color: "secondary" }) : null,
      ]),
    ], { alignment: "leading", spacing: 4 })), { title: "Refills", subtitle: `Reminder when ${REFILL_WARN_DAYS} days are left`, symbol: "cross.vial.fill", color: "orange" }) : null,
    Widget.hstack([
      Widget.button("Reschedule reminders", "reschedule", null, { style: "bordered" }),
      Widget.button("Share log (CSV)", "shareLog", null, { style: "bordered" }),
    ], { spacing: 8 }),
    Widget.text(DISCLAIMER, { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 14 });
}

function leafletPage() {
  const med = medById(Storage.get("leafletMed"));
  if (!med) return Widget.text("Choose a medication first.", { color: "secondary" });
  const leaflet = Storage.get(`leaflet:${searchName(med.name)}`);
  const error = Storage.get("leafletError");
  const open = Storage.get("open", { purpose: true });
  const section = (key, title, text) => Widget.vstack([
    Widget.button(Widget.hstack([
      Widget.text(title, { font: "headline", color: "primary" }),
      Widget.spacer(),
      Widget.symbol(open[key] ? "chevron.up" : "chevron.down", { size: 13, color: "secondary", fallback: open[key] ? "▲" : "▼" }),
    ], { frame: { maxWidth: "infinity" } }), "section", { name: key }, { style: "plain" }),
    open[key] ? Widget.text(text ?? "Not included in this label.", { font: "footnote", color: text ? "primary" : "secondary" }) : null,
  ], { alignment: "leading", spacing: 6, padding: 12, background: TILE, cornerRadius: 12 });

  return Widget.vstack([
    Widget.button("‹ Medications", "page", { value: "meds" }, { style: "plain" }),
    Widget.text(med.name, { font: "title2", weight: "bold" }),
    Widget.text("Excerpts from the US FDA label published by openFDA (api.fda.gov), matched by name. It describes the US product, which may differ from yours, and it is not advice for you. Your own pack leaflet, prescriber and pharmacist come first.", { font: "caption", color: "secondary" }),
    error ? Widget.text(`Could not load: ${error}`, { font: "footnote", color: "red" }) : null,
    !leaflet && !error ? Widget.text("Looking up the label…", { color: "secondary" }) : null,
    leaflet?.missing ? Widget.text(`openFDA has no label for "${leaflet.query}". Try the brand or generic name as the medication name.`, { font: "footnote", color: "secondary" }) : null,
    leaflet && !leaflet.missing ? Widget.text([leaflet.brand, leaflet.generic].filter(Boolean).join(" · "), { font: "subheadline", color: "secondary" }) : null,
    leaflet && !leaflet.missing ? section("purpose", "Purpose", leaflet.purpose) : null,
    leaflet && !leaflet.missing ? section("dosage", "Dosage and administration", leaflet.dosage) : null,
    leaflet && !leaflet.missing ? section("warnings", "Warnings", leaflet.warnings) : null,
    Widget.hstack([
      leaflet ? Widget.hstack([Widget.text("Fetched", { font: "caption2", color: "secondary" }), Widget.date(leaflet.time, { style: "relative", font: "caption2", color: "secondary" })], { spacing: 4 }) : null,
      Widget.spacer(),
      Widget.button("Look up again", "leafletRefresh", { id: med.id }, { style: "bordered" }),
    ]),
  ], { alignment: "leading", spacing: 12 });
}

// ───────────────────────── Mini-app

let maintainedOnce = false;

Script.ui(async () => {
  if (!maintainedOnce) {
    maintainedOnce = true;
    if (meds().length) await maintain();
  }
  const page = Storage.get("page", "today");
  const pages = { today: todayPage, meds: medsPage, edit: editPage, stats: statsPage, leaflet: leafletPage };
  const body = (pages[page] ?? todayPage)();
  const picker = page === "edit" || page === "leaflet" ? null : Widget.picker([
    { label: "Today", value: "today" },
    { label: "Medications", value: "meds" },
    { label: "Stats", value: "stats" },
  ], page, "page", null, { style: "segmented" });
  return {
    title: page === "edit" ? (draft().id ? "Edit medication" : "New medication") : page === "leaflet" ? "US label" : "Med Schedule",
    content: Widget.vstack([picker, body], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});
