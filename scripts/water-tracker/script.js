// @name        Water Tracker
// @description Tap to log a glass of water and reach your daily goal
// @widget      small, medium
// @icon        drop.fill
// @color       #0EA5E9
// @version     1.0.0
// @author      va4w
// @category    food-drink

const day = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString("en-CA"); };
const goal = () => Storage.get("goal", 8);
const glasses = (date = day()) => Storage.get(`glasses:${date}`, 0);

Script.action("drink", ({ by }) => Storage.set(`glasses:${day()}`, Math.max(0, glasses() + by)));
Script.action("goal", ({ by }) => Storage.set("goal", Math.min(20, Math.max(1, goal() + by))));

const ring = () => Widget.progress(Math.min(1, glasses() / goal()), { style: "ring", color: "blue", label: `${glasses()}/${goal()}` });

Script.widget(({ family }) => {
  const midnight = new Date();
  midnight.setHours(24, 0, 10, 0);
  const add = Widget.button("+ Glass", "drink", { by: 1 }, { style: "bordered", color: "blue" });

  const content = family === "small"
    ? Widget.vstack([ring(), add], { spacing: 8 })
    : Widget.hstack([
        ring(),
        Widget.vstack([
          Widget.text(glasses() >= goal() ? "Goal reached" : `${goal() - glasses()} to go`, { font: "headline" }),
          Widget.hstack([add, Widget.button("Undo", "drink", { by: -1 }, { color: "secondary" })], { spacing: 12 }),
        ], { alignment: "leading", spacing: 10 }),
      ], { spacing: 20 });

  return { content, refreshAt: midnight };
});

Script.ui(() => {
  const week = [-6, -5, -4, -3, -2, -1, 0].map((offset) => ({ date: day(offset), count: glasses(day(offset)) }));
  return {
    title: "Water",
    content: Widget.vstack([
      ring(),
      Widget.text(glasses() >= goal() ? "Goal reached. Well done." : `${goal() - glasses()} more to reach today's goal`, { font: "headline" }),
      Widget.hstack([
        Widget.button("Undo", "drink", { by: -1 }, { style: "bordered" }),
        Widget.button("Drink a glass", "drink", { by: 1 }, { style: "prominent", color: "blue" }),
      ], { spacing: 10 }),
      Widget.divider(),
      Widget.hstack(week.map((d) => Widget.vstack([
        Widget.text(d.count >= goal() ? "💧" : "·", { font: "title3" }),
        Widget.text(String(d.count), { font: "caption", weight: "medium" }),
        Widget.text(d.date.slice(8), { font: "caption2", color: "secondary" }),
      ], { spacing: 2 })), { spacing: 14 }),
      Widget.hstack([
        Widget.text("Daily goal"),
        Widget.spacer(),
        Widget.button("−", "goal", { by: -1 }, { style: "bordered" }),
        Widget.text(`${goal()}`, { font: "headline", frame: { width: 32 } }),
        Widget.button("+", "goal", { by: 1 }, { style: "bordered" }),
      ], { spacing: 8 }),
    ], { spacing: 14, padding: 20 }),
  };
});

Script.run(() => `${glasses()} of ${goal()} glasses today.`);
