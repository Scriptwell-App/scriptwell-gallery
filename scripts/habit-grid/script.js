// @name        Habit Grid
// @description Tick habits off from an interactive widget, watch 12-week heatmaps and streaks grow, and get one evening reminder that lists only what is still unfinished
// @permissions notifications
// @widget      small, medium, large
// @icon        checkmark.square.fill
// @color       #10B981
// @version     1.0.0
// @author      va4w
// @category    productivity

// How it works
// • Add habits in the mini-app with a name, colour, SF Symbol and schedule (every day or chosen weekdays). Everything is stored on the device; nothing is sent anywhere.
// • The widget shows today's habits as toggles. Medium adds a GitHub-style heatmap of the last 12 weeks for one habit (set the widget Parameter to a habit's name to choose it); large shows up to three compressed 8-week grids with streaks.
// • The mini-app has streaks, this month's completion rate, a monthly calendar per habit, and a JSON export.
// • A background run schedules one evening notification (time of your choice) that lists the habits still unfinished today, and cancels it when everything is done. iOS decides when background runs happen, so the list is as fresh as the last run.
// • Run the script once in the app to allow notifications before adding the widget.

// ───────────────────────── Data

const REMINDER_ID = "habit-evening";
const locale = Script.env.locale;
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // index 0 = Monday
const SYMBOLS = [
  ["figure.walk", "Walk"], ["figure.run", "Run"], ["dumbbell.fill", "Workout"], ["drop.fill", "Water"],
  ["book.fill", "Read"], ["pencil", "Write"], ["brain.head.profile", "Meditate"], ["bed.double.fill", "Sleep early"],
  ["leaf.fill", "Vegetables"], ["pills.fill", "Medication"], ["sun.max.fill", "Daylight"], ["music.note", "Practise"],
  ["globe", "Language"], ["phone.fill", "Call someone"], ["sparkles", "Tidy up"], ["star.fill", "Other"],
];
const PALETTE = ["#10B981", "#3B82F6", "#8B5CF6", "#EC4899", "#F59E0B", "#EF4444", "#14B8A6", "#F97316"];
const MISSED = { light: "#E5E7EB", dark: "#2A2A2E" };
const UNSCHEDULED = { light: "#F3F4F6", dark: "#1C1C1E" };
const CARD_BG = { light: "#FFFFFF", dark: "#1C1C1E" };
const PAGE_BG = { light: "#F2F4F8", dark: "#000000" };

const habits = () => Storage.get("habits", []);
const log = () => Storage.get("log", {});
const settings = () => ({ reminderOn: true, reminderTime: "20:00", ...Storage.get("settings", {}) });
const save = (changes) => Storage.set("settings", { ...settings(), ...changes });
const ui = () => Storage.get("ui", { tab: 0, editing: null, statsHabit: null, monthOffset: 0 });
const setUI = (changes) => Storage.set("ui", { ...ui(), ...changes });

const dayKey = (d = new Date()) => d.toLocaleDateString("en-CA");
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayIndex = (d) => (d.getDay() + 6) % 7;
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c ?? "");
const fmtClock = (iso) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
const alpha = (hex, a) => (isHex(hex) ? `${hex}${a}` : hex);

function isScheduled(habit, date) {
  if (dayKey(date) < habit.created) return false;
  return !habit.days || habit.days.includes(mondayIndex(date));
}
const isDone = (id, key = dayKey()) => (log()[id] ?? []).includes(key);
const todaysHabits = () => habits().filter((h) => isScheduled(h, new Date()));
const scheduleText = (h) => (!h.days ? "Every day" : h.days.length === 7 ? "Every day" : h.days.map((i) => WEEKDAYS[i]).join(" "));

function setDone(id, key, done) {
  const all = log();
  const days = new Set(all[id] ?? []);
  if (done) days.add(key); else days.delete(key);
  all[id] = [...days].sort();
  Storage.set("log", all);
}

// ───────────────────────── Statistics

function scheduledDays(habit, from, to) {
  const out = [];
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) if (isScheduled(habit, d)) out.push(new Date(d));
  return out;
}

function stats(habit) {
  const done = new Set(log()[habit.id] ?? []);
  const today = startOfToday();
  const created = new Date(`${habit.created}T00:00:00`);
  const from = created > addDays(today, -366) ? created : addDays(today, -366);
  const days = scheduledDays(habit, from, today);

  let best = 0;
  let run = 0;
  for (const d of days) {
    if (done.has(dayKey(d))) { run += 1; best = Math.max(best, run); } else run = 0;
  }

  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const key = dayKey(days[i]);
    if (done.has(key)) current += 1;
    else if (i === days.length - 1 && key === dayKey(today)) continue; // today is still open
    else break;
  }

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthDays = days.filter((d) => d >= monthStart);
  const monthDone = monthDays.filter((d) => done.has(dayKey(d))).length;
  return { current, best, rate: monthDays.length ? monthDone / monthDays.length : 0, monthDone, monthScheduled: monthDays.length, total: done.size };
}

function todayProgress() {
  const list = todaysHabits();
  const done = list.filter((h) => isDone(h.id)).length;
  return { done, total: list.length, fraction: list.length ? done / list.length : 0 };
}

// ───────────────────────── Heatmap and calendar

// Columns are weeks (Monday at the top), the last column ends today. Each cell is one node.
function heatmap(habit, weeks, cell, gap) {
  const done = new Set(log()[habit.id] ?? []);
  const today = startOfToday();
  const firstMonday = addDays(today, -mondayIndex(today) - (weeks - 1) * 7);
  const columns = [];
  for (let w = 0; w < weeks; w++) {
    const cells = [];
    for (let r = 0; r < 7; r++) {
      const d = addDays(firstMonday, w * 7 + r);
      const key = dayKey(d);
      let background = null;
      if (d <= today) {
        if (done.has(key)) background = isScheduled(habit, d) ? habit.color : alpha(habit.color, "80");
        else background = isScheduled(habit, d) ? MISSED : UNSCHEDULED;
      }
      const node = { type: "stack", direction: "vertical", children: [], cornerRadius: Math.max(1, Math.round(cell / 4)), frame: { width: cell, height: cell } };
      if (background) node.background = background;
      cells.push(node);
    }
    columns.push(Widget.vstack(cells, { spacing: gap }));
  }
  return Widget.hstack(columns, { spacing: gap });
}

function monthGrid(habit, offset) {
  const today = startOfToday();
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const done = new Set(log()[habit.id] ?? []);
  const lead = mondayIndex(first);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(first.getFullYear(), first.getMonth(), day));
  while (cells.length % 7) cells.push(null);

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(Widget.hstack(cells.slice(i, i + 7).map((d) => {
      if (!d) return Widget.text("", { frame: { maxWidth: "infinity", height: 34 } });
      const key = dayKey(d);
      const scheduled = isScheduled(habit, d);
      const did = done.has(key);
      const future = d > today;
      const isToday = key === dayKey(today);
      const props = {
        font: "footnote", weight: isToday ? "bold" : "regular", align: "center",
        color: did ? "white" : future || !scheduled ? "secondary" : "primary",
        cornerRadius: 8, frame: { maxWidth: "infinity", height: 34 },
      };
      if (did) props.background = habit.color;
      else if (scheduled && !future) props.background = MISSED;
      return Widget.text(String(d.getDate()), props);
    }), { spacing: 4 }));
  }
  return Widget.vstack([
    Widget.hstack(WEEKDAYS.map((w) => Widget.text(w.slice(0, 1), { font: "caption2", weight: "bold", color: "secondary", align: "center", frame: { maxWidth: "infinity" } })), { spacing: 4 }),
    ...rows,
  ], { spacing: 4 });
}

// ───────────────────────── Evening reminder

async function syncReminder() {
  const s = settings();
  const pending = todaysHabits().filter((h) => !isDone(h.id));
  const [hh, mm] = s.reminderTime.split(":").map(Number);
  const at = new Date();
  at.setHours(hh, mm, 0, 0);
  const future = at.getTime() > Date.now() + 1000;

  if (!s.reminderOn || pending.length === 0 || !future) {
    await Notification.cancel(REMINDER_ID);
    Storage.set("reminderState", { day: dayKey(), scheduled: false, pending: pending.length, time: Date.now() });
    return;
  }
  await Notification.schedule({
    id: REMINDER_ID,
    title: pending.length === 1 ? "1 habit left today" : `${pending.length} habits left today`,
    body: pending.map((h) => h.name).join(", "),
    at,
  });
  Storage.set("reminderState", { day: dayKey(), scheduled: true, pending: pending.length, at: at.toISOString(), time: Date.now() });
}

Script.background(async () => {
  try { await syncReminder(); } catch (error) { Storage.set("lastError", `${new Date().toISOString()} ${error.message}`); }
});

// ───────────────────────── Actions

Script.action("toggle", async ({ id, isOn }) => {
  setDone(id, dayKey(), isOn);
  // Notifications are not available from a widget action; the next background run catches up.
  if (Script.env.mode === "app" || Script.env.mode === "pwa") {
    try { await syncReminder(); } catch { /* reported in Settings */ }
  }
});

Script.action("add", async () => {
  const name = await UI.prompt({ title: "New habit", placeholder: "Drink water" });
  if (!name?.trim()) return;
  const list = habits();
  const habit = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 30),
    color: PALETTE[list.length % PALETTE.length],
    symbol: SYMBOLS[list.length % SYMBOLS.length][0],
    days: null,
    created: dayKey(),
  };
  Storage.set("habits", [...list, habit]);
  setUI({ editing: habit.id });
});

Script.action("tab", ({ value }) => setUI({ tab: value }));
Script.action("edit", ({ id }) => setUI({ editing: ui().editing === id ? null : id }));
Script.action("doneEditing", () => setUI({ editing: null }));

function updateHabit(id, changes) {
  Storage.set("habits", habits().map((h) => (h.id === id ? { ...h, ...changes } : h)));
}

Script.action("name", ({ id, value }) => { if (value?.trim()) updateHabit(id, { name: value.trim().slice(0, 30) }); });
Script.action("color", ({ id, value }) => updateHabit(id, { color: value.slice(0, 7) }));
Script.action("symbol", ({ id, value }) => updateHabit(id, { symbol: value }));
Script.action("schedule", ({ id, value }) => updateHabit(id, { days: value === "daily" ? null : [0, 1, 2, 3, 4] }));
Script.action("days", ({ id, value }) => updateHabit(id, { days: value.length ? [...value].sort() : null }));

Script.action("move", ({ id, by }) => {
  const list = habits();
  const index = list.findIndex((h) => h.id === id);
  const target = index + by;
  if (index < 0 || target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  Storage.set("habits", list);
});

Script.action("delete", async ({ id }) => {
  const habit = habits().find((h) => h.id === id);
  const choice = await UI.alert({ title: `Delete “${habit?.name}”?`, message: "Its history goes with it. This cannot be undone.", buttons: ["Cancel", "Delete"] });
  if (choice !== 1) return;
  Storage.set("habits", habits().filter((h) => h.id !== id));
  const all = log();
  delete all[id];
  Storage.set("log", all);
  setUI({ editing: null, statsHabit: null });
});

Script.action("statsHabit", ({ value }) => setUI({ statsHabit: value, monthOffset: 0 }));
Script.action("month", ({ by }) => setUI({ monthOffset: by === 0 ? 0 : Math.min(0, ui().monthOffset + by) }));

Script.action("reminderOn", async ({ isOn }) => { save({ reminderOn: isOn }); try { await syncReminder(); } catch { /* shown below */ } });
Script.action("reminderTime", async ({ value }) => {
  const d = new Date(value);
  save({ reminderTime: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` });
  try { await syncReminder(); } catch { /* shown below */ }
});
Script.action("testNotification", async () => {
  try {
    await Notification.schedule({ title: "Habit Grid", body: "This is how the evening reminder looks.", after: 5 });
    await UI.alert("Lock the screen or leave the app. A test notification arrives in five seconds.");
  } catch (error) {
    await UI.alert({ title: "Could not schedule", message: error.message });
  }
});

Script.action("export", async () => {
  const data = { exported: new Date().toISOString(), habits: habits(), log: log() };
  await Files.write("exports/habit-grid.json", JSON.stringify(data, null, 2));
  await UI.share({ file: "exports/habit-grid.json" });
});

Script.action("reset", async () => {
  const choice = await UI.alert({ title: "Delete all habits and history?", message: "This cannot be undone.", buttons: ["Cancel", "Delete everything"] });
  if (choice !== 1) return;
  Storage.remove("habits");
  Storage.remove("log");
  Storage.remove("ui");
  try { await Notification.cancel(REMINDER_ID); } catch { /* nothing scheduled */ }
});

// ───────────────────────── Widget

function habitToggle(habit) {
  return Widget.toggle(habit.name, isDone(habit.id), "toggle", { id: habit.id }, {
    color: habit.color, padding: { horizontal: 8, vertical: 4 },
    background: alpha(habit.color, isDone(habit.id) ? "33" : "14"), cornerRadius: 10,
  });
}

function streakLine(habit, font = "caption2") {
  const s = stats(habit);
  return Widget.hstack([
    Widget.symbol("flame.fill", { size: 10, color: s.current > 0 ? "orange" : "secondary", fallback: "🔥" }),
    Widget.text(`${s.current} day${s.current === 1 ? "" : "s"} · best ${s.best} · ${Math.round(s.rate * 100)}% this month`, { font, color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
  ], { spacing: 3 });
}

function featured(parameter) {
  const list = habits();
  const wanted = (parameter ?? "").trim().toLowerCase();
  const match = wanted ? list.find((h) => h.name.toLowerCase() === wanted || h.name.toLowerCase().startsWith(wanted)) : null;
  return match ?? list[0] ?? null;
}

function emptyWidget() {
  return Widget.vstack([
    Widget.symbol("checkmark.square.fill", { size: 28, color: "#10B981", fallback: "☑️" }),
    Widget.text("Open Habit Grid to add your first habit", { font: "caption", color: "secondary", align: "center", lineLimit: 3 }),
  ], { spacing: 8, url: APP_LINK });
}

Script.widget(({ family, parameter }) => {
  if (!habits().length) return emptyWidget();
  const today = todaysHabits();
  const progress = todayProgress();
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const title = Widget.hstack([
    Widget.text(new Date().toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }).toUpperCase(), { font: "caption2", weight: "bold", color: "secondary" }),
    Widget.spacer(),
    Widget.text(progress.total ? `${progress.done}/${progress.total}` : "rest day", { font: "caption2", weight: "bold", color: progress.done === progress.total && progress.total ? "#10B981" : "secondary" }),
  ]);
  const toggles = (max) => [
    ...today.slice(0, max).map((h) => habitToggle(h)),
    today.length > max ? Widget.text(`+${today.length - max} more in the app`, { font: "caption2", color: "secondary" }) : null,
    today.length === 0 ? Widget.text("Nothing scheduled today", { font: "caption", color: "secondary" }) : null,
  ];
  let content;

  if (family === "small") {
    content = Widget.vstack([
      title,
      ...toggles(3),
      Widget.spacer(),
      Widget.progress(progress.fraction, { color: "#10B981" }),
    ], { alignment: "leading", spacing: 5, padding: 12, frame: fill, url: APP_LINK });
  } else if (family === "medium") {
    const habit = featured(parameter);
    content = Widget.hstack([
      Widget.vstack([title, ...toggles(4), Widget.spacer()], { alignment: "leading", spacing: 5, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack([
        Widget.hstack([
          Widget.symbol(habit.symbol, { size: 11, color: habit.color, fallback: "•" }),
          Widget.text(habit.name, { font: "caption", weight: "semibold", lineLimit: 1 }),
        ], { spacing: 4 }),
        heatmap(habit, 12, 8, 2),
        streakLine(habit),
      ], { alignment: "leading", spacing: 5, frame: { width: 126, maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 12, padding: 12, frame: fill, url: APP_LINK });
  } else {
    const shown = habits().slice(0, 3);
    const first = featured(parameter);
    const grids = [first, ...shown.filter((h) => h.id !== first.id)].slice(0, 3);
    content = Widget.vstack([
      Widget.hstack([
        Widget.text("Habit Grid", { font: "headline" }),
        Widget.spacer(),
        Widget.text(progress.total ? `${progress.done} of ${progress.total} done` : "Nothing scheduled today", { font: "caption", color: "secondary" }),
      ]),
      Widget.progress(progress.fraction, { color: "#10B981" }),
      ...toggles(5),
      Widget.divider(),
      ...grids.map((h) => Widget.hstack([
        Widget.vstack([
          Widget.hstack([
            Widget.symbol(h.symbol, { size: 11, color: h.color, fallback: "•" }),
            Widget.text(h.name, { font: "caption", weight: "semibold", lineLimit: 1 }),
          ], { spacing: 4 }),
          streakLine(h),
          Widget.text("8 weeks", { font: "caption2", color: "secondary" }),
        ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
        heatmap(h, 8, 7, 2),
      ], { spacing: 10, alignment: "center" })),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 6, padding: 14, frame: fill, url: APP_LINK });
  }

  return { content, refreshAfter: 30 * 60 };
});

// ───────────────────────── Mini-app tabs

function todayTab() {
  const today = todaysHabits();
  const progress = todayProgress();
  const state = Storage.get("reminderState");
  return Widget.vstack([
    Widget.hstack([
      Widget.progress(progress.fraction, { style: "ring", color: "#10B981", label: `${progress.done}/${progress.total}` }),
      Widget.vstack([
        Widget.text(new Date().toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }), { font: "headline" }),
        Widget.text(progress.total === 0 ? "No habits scheduled today." : progress.done === progress.total ? "Everything done. Nicely." : `${progress.total - progress.done} to go.`, { font: "subheadline", color: "secondary" }),
        state?.scheduled && state.day === dayKey()
          ? Widget.hstack([Widget.text("Reminder", { font: "caption2", color: "secondary" }), Widget.date(state.at, { style: "relative", font: "caption2", color: "secondary" })], { spacing: 3 })
          : null,
      ], { alignment: "leading", spacing: 2 }),
    ], { spacing: 14, padding: 14, background: CARD_BG, cornerRadius: 16 }),
    ...today.map((h) => Widget.hstack([
      Widget.symbol(h.symbol, { size: 18, color: h.color, fallback: "•", frame: { width: 26 } }),
      Widget.vstack([
        Widget.toggle(h.name, isDone(h.id), "toggle", { id: h.id }, { color: h.color }),
        streakLine(h),
      ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
    ], { spacing: 8, padding: { horizontal: 12, vertical: 8 }, background: CARD_BG, cornerRadius: 12 })),
    habits().length === 0 ? Widget.text("Add your first habit in the Habits tab.", { color: "secondary", padding: 12 }) : null,
  ], { alignment: "leading", spacing: 10 });
}

function editor(h) {
  const scheduleValue = h.days ? "days" : "daily";
  return Widget.card([
    Widget.textField("Habit name", h.name, "name", { id: h.id }, { label: "Name" }),
    Widget.colorPicker(h.color, "color", { id: h.id }, { label: "Colour" }),
    Widget.picker(SYMBOLS.map(([symbol, label]) => ({ label: `${label} (${symbol})`, value: symbol })), h.symbol, "symbol", { id: h.id }, { label: "Symbol" }),
    Widget.picker([{ label: "Every day", value: "daily" }, { label: "Chosen days", value: "days" }], scheduleValue, "schedule", { id: h.id }, { style: "segmented" }),
    h.days ? Widget.checklist(WEEKDAYS.map((w, i) => ({ label: w, value: i })), h.days, "days", { id: h.id }) : null,
    Widget.hstack([
      Widget.button("Move up", "move", { id: h.id, by: -1 }, { style: "bordered" }),
      Widget.button("Move down", "move", { id: h.id, by: 1 }, { style: "bordered" }),
      Widget.spacer(),
      Widget.button("Delete", "delete", { id: h.id }, { style: "bordered", color: "red" }),
      Widget.button("Done", "doneEditing", null, { style: "prominent" }),
    ], { spacing: 8 }),
  ], { title: "Edit habit", symbol: "pencil", color: h.color });
}

function habitsTab() {
  const editing = ui().editing;
  return Widget.vstack([
    ...habits().map((h) => Widget.vstack([
      Widget.button(Widget.hstack([
        Widget.symbol(h.symbol, { size: 18, color: h.color, fallback: "•", frame: { width: 26 } }),
        Widget.vstack([
          Widget.text(h.name, { font: "subheadline", weight: "medium" }),
          Widget.text(`${scheduleText(h)} · since ${new Date(`${h.created}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" })}`, { font: "caption2", color: "secondary" }),
        ], { alignment: "leading", spacing: 1 }),
        Widget.spacer(),
        Widget.symbol(editing === h.id ? "chevron.down" : "chevron.right", { size: 11, color: "secondary", fallback: "›" }),
      ], { spacing: 8, padding: { horizontal: 12, vertical: 10 }, background: CARD_BG, cornerRadius: 12, frame: { maxWidth: "infinity" } }), "edit", { id: h.id }, { style: "plain" }),
      editing === h.id ? editor(h) : null,
    ], { spacing: 8 })),
    Widget.button("Add habit", "add", null, { style: "prominent", color: "#10B981" }),
  ], { alignment: "leading", spacing: 10 });
}

function statsTab() {
  const list = habits();
  if (!list.length) return Widget.text("Add a habit to see statistics.", { color: "secondary", padding: 12 });
  const habit = list.find((h) => h.id === ui().statsHabit) ?? list[0];
  const s = stats(habit);
  const offset = ui().monthOffset;
  const month = new Date(startOfToday().getFullYear(), startOfToday().getMonth() + offset, 1);
  const tile = (label, value) => Widget.vstack([
    Widget.text(value, { font: "title2", weight: "bold", design: "rounded", color: habit.color }),
    Widget.text(label, { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 1, padding: 10, background: CARD_BG, cornerRadius: 12, frame: { maxWidth: "infinity", alignment: "leading" } });
  return Widget.vstack([
    Widget.picker(list.map((h) => ({ label: h.name, value: h.id })), habit.id, "statsHabit", null, { style: list.length <= 3 ? "segmented" : "menu", label: "Habit" }),
    Widget.hstack([tile("current streak", `${s.current}`), tile("best streak", `${s.best}`)], { spacing: 8 }),
    Widget.hstack([tile("this month", `${Math.round(s.rate * 100)}%`), tile("done in total", `${s.total}`)], { spacing: 8 }),
    Widget.card([
      heatmap(habit, 12, 16, 3),
      Widget.text(`${s.monthDone} of ${s.monthScheduled} scheduled days this month`, { font: "caption2", color: "secondary" }),
    ], { title: "Last 12 weeks", symbol: "square.grid.3x3.fill", color: habit.color }),
    Widget.card([
      Widget.hstack([
        Widget.button("‹", "month", { by: -1 }, { style: "bordered" }),
        Widget.spacer(),
        Widget.text(month.toLocaleDateString(locale, { month: "long", year: "numeric" }), { font: "headline" }),
        Widget.spacer(),
        offset < 0 ? Widget.button("›", "month", { by: 1 }, { style: "bordered" }) : Widget.button("Today", "month", { by: 0 }, { style: "plain" }),
      ]),
      monthGrid(habit, offset),
    ], { title: "Calendar", symbol: "calendar", color: habit.color }),
  ], { alignment: "leading", spacing: 12 });
}

function settingsTab() {
  const s = settings();
  const [hh, mm] = s.reminderTime.split(":").map(Number);
  const time = new Date();
  time.setHours(hh, mm, 0, 0);
  const state = Storage.get("reminderState");
  const error = Storage.get("lastError");
  return Widget.vstack([
    Widget.card([
      Widget.toggle("Evening reminder", s.reminderOn, "reminderOn"),
      s.reminderOn ? Widget.datePicker(time.toISOString(), "reminderTime", null, { label: "Time", mode: "time" }) : null,
      Widget.text("One notification listing the habits still unfinished. It is scheduled by background runs, which iOS allows a few times a day, and cancelled once everything is ticked off.", { font: "caption2", color: "secondary" }),
      state ? Widget.text(`Last check ${new Date(state.time).toLocaleString(locale, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}: ${state.scheduled ? `reminder set for ${fmtClock(state.at)}` : state.pending ? "time already passed" : "nothing pending"}`, { font: "caption2", color: "secondary" }) : null,
      error ? Widget.text(`Last background error: ${error}`, { font: "caption2", color: "orange" }) : null,
      Widget.button("Send a test notification", "testNotification", null, { style: "bordered" }),
    ], { title: "Reminder", symbol: "bell.fill", color: "#F59E0B" }),
    Widget.card([
      Widget.text(`${habits().length} habits · ${Object.values(log()).reduce((n, days) => n + days.length, 0)} ticks recorded`, { font: "footnote", color: "secondary" }),
      Widget.hstack([
        Widget.button("Export JSON", "export", null, { style: "bordered" }),
        Widget.spacer(),
        Widget.button("Delete everything", "reset", null, { style: "bordered", color: "red" }),
      ]),
    ], { title: "Data", symbol: "externaldrive.fill", color: "#3B82F6" }),
  ], { alignment: "leading", spacing: 14 });
}

// ───────────────────────── Mini-app

// Only the open tab is built, so the tree stays small however many habits there are.
Script.ui(() => {
  const tab = ui().tab ?? 0;
  const pane = (index, build) => (tab === index ? build() : Widget.text(""));
  return {
    title: "Habit Grid",
    content: Widget.vstack([
      Widget.tabs([
        { title: "Today", symbol: "checkmark.circle", content: pane(0, todayTab) },
        { title: "Habits", symbol: "list.bullet", content: pane(1, habitsTab) },
        { title: "Stats", symbol: "chart.bar.fill", content: pane(2, statsTab) },
        { title: "Settings", symbol: "gearshape", content: pane(3, settingsTab) },
      ], { selected: tab, action: "tab" }),
    ], { padding: 16, background: PAGE_BG, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "top" } }),
  };
});

// ───────────────────────── Shortcuts and Siri

Script.run(async (input) => {
  const text = (input ?? "").trim().toLowerCase();
  if (text) {
    const habit = habits().find((h) => h.name.toLowerCase() === text || h.name.toLowerCase().startsWith(text));
    if (!habit) return `No habit called “${input.trim()}”.`;
    setDone(habit.id, dayKey(), true);
    try { await syncReminder(); } catch { /* no screen to report on */ }
    const s = stats(habit);
    return `${habit.name} done. Streak: ${s.current} day${s.current === 1 ? "" : "s"}.`;
  }
  const progress = todayProgress();
  const pending = todaysHabits().filter((h) => !isDone(h.id)).map((h) => h.name);
  if (!progress.total) return "No habits scheduled today.";
  return pending.length ? `${progress.done} of ${progress.total} done. Still to do: ${pending.join(", ")}.` : `All ${progress.total} habits done today.`;
});
