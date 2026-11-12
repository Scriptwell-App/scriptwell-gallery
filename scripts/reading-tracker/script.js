// @name        Reading Tracker
// @description Log pages toward a daily reading goal and keep a streak going
// @widget      small, medium
// @icon        book.fill
// @color       #B45309
// @version     1.0.0
// @author      va4w
// @category    books

// Everything is kept in this script's own Storage. No permissions needed.

const day = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA");
};
const goal = () => Storage.get("goal", 20);
const log = () => Storage.get("log", {});
const pagesOn = (date) => log()[date] ?? 0;

function streak() {
  // Today counts once the goal is met; otherwise the streak runs up to yesterday.
  let count = 0;
  for (let i = pagesOn(day()) >= goal() ? 0 : -1; pagesOn(day(i)) >= goal(); i--) count++;
  return count;
}

Script.action("add", ({ pages }) => {
  const entries = log();
  entries[day()] = Math.max(0, pagesOn(day()) + pages);
  Storage.set("log", entries);
});

Script.action("goal", async () => {
  const text = await UI.prompt({ title: "Pages per day", defaultValue: String(goal()) });
  const value = Number(text);
  if (text !== null && value > 0) Storage.set("goal", Math.round(value));
});

const ring = () => Widget.progress(Math.min(1, pagesOn(day()) / goal()), {
  style: "ring", color: "orange", label: `${pagesOn(day())}`,
});

Script.widget(({ family }) => {
  const summary = Widget.vstack([
    ring(),
    Widget.text(`of ${goal()} pages`, { font: "caption", color: "secondary" }),
  ], { spacing: 6 });
  if (family === "small") return summary;

  return Widget.hstack([
    summary,
    Widget.vstack([
      Widget.text(`${streak()} day streak`, { font: "headline" }),
      Widget.hstack([
        Widget.button("+1", "add", { pages: 1 }, { style: "bordered", color: "orange" }),
        Widget.button("+10", "add", { pages: 10 }, { style: "bordered", color: "orange" }),
      ], { spacing: 8 }),
    ], { alignment: "leading", spacing: 10 }),
  ], { spacing: 20 });
});

Script.ui(() => {
  const week = [-6, -5, -4, -3, -2, -1, 0].map((offset) => ({ date: day(offset), pages: pagesOn(day(offset)) }));
  const tallest = Math.max(goal(), ...week.map((d) => d.pages));

  return {
    title: "Reading",
    content: Widget.vstack([
      ring(),
      Widget.text(`${pagesOn(day())} of ${goal()} pages today`, { font: "title3", weight: "semibold" }),
      Widget.text(`${streak()} day streak`, { color: "secondary" }),
      Widget.hstack([1, 5, 10, 25].map((pages) =>
        Widget.button(`+${pages}`, "add", { pages }, { style: "bordered", color: "orange" })), { spacing: 8 }),
      Widget.button("Undo one page", "add", { pages: -1 }, { color: "secondary" }),
      Widget.divider(),
      Widget.text("Last 7 days", { font: "caption", color: "secondary" }),
      Widget.hstack(week.map((d) => Widget.vstack([
        { type: "stack", direction: "vertical", children: [], cornerRadius: 4,
          background: d.pages >= goal() ? "orange" : "gray",
          frame: { width: 22, height: Math.max(4, Math.round((d.pages / tallest) * 80)) } },
        Widget.text(d.date.slice(8), { font: "caption2", color: "secondary" }),
      ], { spacing: 4 })), { spacing: 10, alignment: "bottom" }),
      Widget.button(`Daily goal: ${goal()} pages`, "goal", null, { style: "bordered" }),
    ], { spacing: 12, padding: 20 }),
  };
});

Script.run(() => `${pagesOn(day())} of ${goal()} pages today, ${streak()} day streak.`);
