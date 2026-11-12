// @name        Chore Chart
// @description Tick off chores each day and collect stars through the week
// @widget      small, medium
// @icon        star.circle.fill
// @color       #F59E0B
// @version     1.0.0
// @author      va4w
// @category    kids

const STARTER = ["Make the bed", "Brush teeth", "Tidy toys", "Feed the pet"];

const today = () => new Date().toLocaleDateString("en-CA");
const chores = () => Storage.get("chores", STARTER);
const done = (date = today()) => Storage.get(`done:${date}`, []);

// Stars this week, counting from Monday.
function weekStars() {
  const d = new Date();
  let stars = 0;
  for (let i = (d.getDay() + 6) % 7; i >= 0; i--) {
    stars += done(d.toLocaleDateString("en-CA")).length;
    d.setDate(d.getDate() - 1);
  }
  return stars;
}

Script.action("tick", ({ chore, isOn }) => {
  const set = new Set(done());
  const on = isOn === undefined ? !set.has(chore) : isOn;
  if (on) set.add(chore); else set.delete(chore);
  Storage.set(`done:${today()}`, [...set]);
});

Script.action("add", async () => {
  const name = await UI.prompt({ title: "New chore", placeholder: "Water the plants" });
  if (name?.trim() && !chores().includes(name.trim())) Storage.set("chores", [...chores(), name.trim()]);
});

Script.action("remove", ({ chore }) => Storage.set("chores", chores().filter((c) => c !== chore)));

Script.widget(({ family }) => {
  const list = chores();
  const finished = done().filter((c) => list.includes(c)).length;
  const midnight = new Date();
  midnight.setHours(24, 0, 10, 0);

  if (family === "small") {
    return {
      content: Widget.vstack([
        Widget.text(finished === list.length && list.length ? "🌟" : "⭐️", { font: 34 }),
        Widget.text(`${finished} of ${list.length}`, { font: "title2", weight: "bold", design: "rounded" }),
        Widget.text(`${weekStars()} stars this week`, { font: "caption2", color: "secondary" }),
      ], { spacing: 4 }),
      refreshAt: midnight,
    };
  }

  return {
    content: Widget.vstack([
      Widget.hstack([Widget.text("Today's chores", { font: "headline" }), Widget.spacer(), Widget.text(`⭐️ ${weekStars()}`, { font: "subheadline", color: "orange" })]),
      ...list.slice(0, 3).map((chore) => {
        const ticked = done().includes(chore);
        return Widget.button(Widget.hstack([
          Widget.symbol(ticked ? "star.fill" : "star", { size: 18, color: ticked ? "yellow" : "secondary", fallback: ticked ? "⭐️" : "☆" }),
          Widget.text(chore, { font: "subheadline", color: ticked ? "secondary" : "primary", lineLimit: 1 }),
          Widget.spacer(),
        ], { spacing: 8 }), "tick", { chore });
      }),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 7, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    refreshAt: midnight,
  };
});

Script.ui(() => {
  const list = chores();
  const finished = done().filter((c) => list.includes(c)).length;
  return {
    title: "Chore Chart",
    content: Widget.vstack([
      Widget.text(finished === list.length && list.length ? "All done! 🌟" : `${finished} of ${list.length} done today`, { font: "title2", weight: "bold" }),
      Widget.text(`⭐️ ${weekStars()} stars this week`, { font: "headline", color: "orange" }),
      ...list.map((chore) => Widget.hstack([
        Widget.toggle(chore, done().includes(chore), "tick", { chore }, { color: "orange", frame: { maxWidth: "infinity" } }),
        Widget.button(Widget.symbol("trash", { size: 15, color: "secondary", fallback: "🗑" }), "remove", { chore }),
      ], { spacing: 10, padding: 12, background: { light: "#FFFFFF", dark: "#1C1C1E" }, cornerRadius: 12 })),
      Widget.button("Add a chore", "add", null, { style: "bordered", color: "orange" }),
    ], { spacing: 10, padding: 16 }),
  };
});
