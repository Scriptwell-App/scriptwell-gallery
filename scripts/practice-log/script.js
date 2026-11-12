// @name        Practice Log
// @description Log instrument practice, hit a daily goal and watch the week fill up
// @widget      small, medium
// @icon        music.note.list
// @color       #4F46E5
// @version     1.0.0
// @author      va4w
// @category    music

// From Shortcuts, pass a number of minutes to log them, for example "20".

const DAY = 86400000;
const key = (date = new Date()) => date.toLocaleDateString("en-CA"); // 2026-03-14, local time
const goal = () => Storage.get("goal", 30);
const minutes = (date) => Storage.get(`min:${key(date)}`, 0);
const add = (amount) => Storage.set(`min:${key()}`, Math.max(0, minutes() + amount));

// The last seven days, oldest first.
const week = () => Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * DAY)).map((date) => ({
  day: date.toLocaleDateString(undefined, { weekday: "narrow" }), minutes: minutes(date),
}));

// Days in a row with any practice; today does not break a streak until it is over.
function streak() {
  let count = 0;
  for (let i = minutes() > 0 ? 0 : 1; i < 400; i++) {
    if (minutes(new Date(Date.now() - i * DAY)) <= 0) break;
    count++;
  }
  return count;
}

const pretty = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

Script.action("add", ({ amount }) => add(amount));
Script.action("custom", async () => {
  const amount = Number(await UI.prompt({ title: "Minutes practised", placeholder: "25" }));
  if (Number.isFinite(amount) && amount > 0 && amount <= 600) add(Math.round(amount));
});
Script.action("goal", ({ by }) => Storage.set("goal", Math.min(240, Math.max(5, goal() + by))));

function bars(height) {
  const days = week();
  const top = Math.max(goal(), ...days.map((d) => d.minutes));
  return Widget.hstack(days.map((d) => Widget.vstack([
    Widget.spacer(),
    { type: "stack", direction: "vertical", children: [], background: d.minutes >= goal() ? "indigo" : "#A5B4FC", cornerRadius: 3, frame: { width: 14, height: Math.max(3, (d.minutes / top) * height) } },
    Widget.text(d.day, { font: "caption2", color: "secondary" }),
  ], { spacing: 3, frame: { height: height + 18 } })), { spacing: 6, alignment: "bottom" });
}

Script.widget(({ family }) => {
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 5, 0);
  const ring = Widget.vstack([
    Widget.progress(Math.min(1, minutes() / goal()), { style: "ring", color: "indigo", label: String(minutes()), frame: { width: 74, height: 74 } }),
    Widget.text(`of ${goal()} min · 🔥 ${streak()}`, { font: "caption2", color: "secondary" }),
  ], { spacing: 8 });
  return {
    content: family === "small" ? ring : Widget.hstack([ring, bars(64), Widget.button("+10", "add", { amount: 10 }, { style: "bordered", color: "indigo" })], { spacing: 16 }),
    refreshAt: tomorrow,
  };
});

Script.ui(() => {
  const total = week().reduce((sum, d) => sum + d.minutes, 0);
  return {
    title: "Practice Log",
    content: Widget.vstack([
      Widget.progress(Math.min(1, minutes() / goal()), { style: "ring", color: "indigo", label: `${minutes()} min`, frame: { width: 150, height: 150 } }),
      Widget.text(minutes() >= goal() ? "Goal reached today 🎉" : `${goal() - minutes()} minutes to go`, { font: "headline" }),
      Widget.hstack([5, 15, 30].map((amount) => Widget.button(`+${amount}`, "add", { amount }, { style: "prominent", color: "indigo" })), { spacing: 10 }),
      Widget.hstack([
        Widget.button("Other…", "custom", null, { style: "bordered" }),
        Widget.button("−5", "add", { amount: -5 }, { style: "bordered", color: "secondary" }),
      ], { spacing: 10 }),
      Widget.divider(),
      bars(90),
      Widget.text(`${pretty(total)} this week · 🔥 ${streak()} day streak`, { font: "subheadline", color: "secondary" }),
      Widget.hstack([
        Widget.text("Daily goal"),
        Widget.spacer(),
        Widget.button("−", "goal", { by: -5 }, { style: "bordered" }),
        Widget.text(`${goal()} min`, { font: "headline", frame: { width: 76 } }),
        Widget.button("+", "goal", { by: 5 }, { style: "bordered" }),
      ], { spacing: 8 }),
    ], { spacing: 14, padding: 20 }),
  };
});

Script.run((input) => {
  const amount = Number(input);
  if (input && Number.isFinite(amount) && amount > 0 && amount <= 600) add(Math.round(amount));
  return `${pretty(minutes())} practised today, goal ${goal()} min. ${streak()} day streak.`;
});
