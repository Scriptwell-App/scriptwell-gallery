// @name        Habit Tracker
// @description Tick off daily habits from a widget, the app, or the web
// @widget      small, medium, large
// @icon        checkmark.circle.fill
// @color       #10B981
// @version     1.0.0
// @author      scriptwell
// @category    health-fitness

// No permissions needed: everything is kept in this script's own Storage.
// The same code powers the interactive widget, the mini-app (Script.ui) and the
// exported web app.

const DEFAULT_HABITS = [
  { id: "water", name: "Drink water", emoji: "💧" },
  { id: "move", name: "Move 30 min", emoji: "🏃" },
  { id: "read", name: "Read", emoji: "📚" },
];

const today = () => new Date().toLocaleDateString("en-CA");
const habits = () => Storage.get("habits", DEFAULT_HABITS);
const doneOn = (day) => Storage.get(`done:${day}`, []);

function streak(habitId) {
  let count = 0;
  const day = new Date();
  if (!doneOn(today()).includes(habitId)) day.setDate(day.getDate() - 1); // today not ticked yet: keep yesterday's streak
  for (let i = 0; i < 366; i++) {
    if (!doneOn(day.toLocaleDateString("en-CA")).includes(habitId)) break;
    count++;
    day.setDate(day.getDate() - 1);
  }
  return count;
}

// ── Actions: shared by widget buttons, the mini-app and the web app ──────────

Script.action("toggle", ({ id, isOn }) => {
  const done = new Set(doneOn(today()));
  const turnOn = isOn === undefined ? !done.has(id) : isOn;
  if (turnOn) done.add(id); else done.delete(id);
  Storage.set(`done:${today()}`, [...done]);
});

Script.action("add", async () => {
  const name = await UI.prompt({ title: "New habit", placeholder: "Meditate" });
  if (!name || !name.trim()) return;
  const list = habits();
  list.push({ id: `h${Date.now()}`, name: name.trim(), emoji: "✅" });
  Storage.set("habits", list);
});

Script.action("remove", async ({ id }) => {
  const habit = habits().find((h) => h.id === id);
  if (!habit) return;
  const choice = await UI.alert({ title: `Remove "${habit.name}"?`, buttons: ["Cancel", "Remove"] });
  if (choice === 1) Storage.set("habits", habits().filter((h) => h.id !== id));
});

// ── Views ────────────────────────────────────────────────────────────────────

function progress() {
  const list = habits();
  const done = doneOn(today());
  const completed = list.filter((h) => done.includes(h.id)).length;
  return { list, done, completed, fraction: list.length ? completed / list.length : 0 };
}

Script.widget(({ family }) => {
  const { list, done, completed, fraction } = progress();

  if (family === "small") {
    return {
      content: Widget.vstack([
        Widget.progress(fraction, { style: "ring", color: "green", label: `${completed}/${list.length}` }),
        Widget.text(completed === list.length ? "All done" : "habits today", { font: "caption", color: "secondary" }),
      ], { spacing: 8 }),
      refreshAfter: 60 * 60,
    };
  }

  const rows = list.slice(0, family === "large" ? 7 : 3).map((habit) => {
    const isDone = done.includes(habit.id);
    return Widget.button(
      Widget.hstack([
        Widget.symbol(isDone ? "checkmark.circle.fill" : "circle", { size: 20, color: isDone ? "green" : "secondary", fallback: isDone ? "✅" : "⚪️" }),
        Widget.text(habit.name, { font: "subheadline", color: isDone ? "secondary" : "primary", lineLimit: 1 }),
        Widget.spacer(),
        Widget.text(`${streak(habit.id)}🔥`, { font: "caption", color: "secondary" }),
      ], { spacing: 8 }),
      "toggle",
      { id: habit.id },
    );
  });

  return {
    content: Widget.vstack([
      Widget.hstack([
        Widget.text("Habits", { font: "headline" }),
        Widget.spacer(),
        Widget.text(`${completed}/${list.length}`, { font: "subheadline", weight: "semibold", color: "green", design: "rounded" }),
      ]),
      Widget.progress(fraction, { color: "green" }),
      ...rows,
      Widget.spacer(),
    ], { alignment: "leading", spacing: 8, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    // Roll over to a fresh day shortly after midnight.
    refreshAt: new Date(new Date().setHours(24, 0, 30, 0)),
  };
});

Script.ui(() => {
  const { list, done, completed, fraction } = progress();

  const rows = list.map((habit) => Widget.hstack([
    Widget.text(habit.emoji, { font: "title2" }),
    Widget.vstack([
      Widget.toggle(habit.name, done.includes(habit.id), "toggle", { id: habit.id }, { color: "green" }),
      Widget.text(`${streak(habit.id)} day streak`, { font: "caption", color: "secondary" }),
    ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
    Widget.button(Widget.symbol("trash", { size: 15, color: "secondary", fallback: "🗑" }), "remove", { id: habit.id }),
  ], { spacing: 12, padding: 14, background: { light: "#FFFFFF", dark: "#1C1C1E" }, cornerRadius: 14 }));

  return {
    title: "Habit Tracker",
    content: Widget.vstack([
      Widget.hstack([
        Widget.progress(fraction, { style: "ring", color: "green", label: `${completed}/${list.length}` }),
        Widget.vstack([
          Widget.text(completed === list.length && list.length > 0 ? "All done today" : "Today", { font: "title2", weight: "bold" }),
          Widget.date(new Date(), { style: "date", font: "subheadline", color: "secondary" }),
        ], { alignment: "leading", spacing: 2 }),
        Widget.spacer(),
      ], { spacing: 14, padding: { bottom: 6 } }),
      ...rows,
      Widget.button("Add habit", "add", null, { style: "bordered", color: "green", frame: { maxWidth: "infinity" } }),
    ], { alignment: "leading", spacing: 10, padding: 4 }),
  };
});

Script.run(() => {
  const { completed, list } = progress();
  return `${completed} of ${list.length} habits done today.`;
});
