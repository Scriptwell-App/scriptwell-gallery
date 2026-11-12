// @name        Trip Countdown
// @description Count the sleeps until your next trip and tick off a packing list on the way
// @widget      small, medium
// @icon        airplane.departure
// @color       #0EA5E9
// @version     1.0.0
// @author      scriptwell
// @category    travel

const DAY = 86400000;
const STARTER = ["Passport or ID", "Tickets", "Phone charger", "Toothbrush", "Medication"];
const trip = () => Storage.get("trip", null); // { place, date: "2026-07-18", packing: [{ name, done }] }

// "2026-07-18" as a local date, or null.
function parse(text) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(text ?? "").trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getMonth() === Number(match[2]) - 1 ? date : null;
}

function sleeps(t) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return Math.round((parse(t.date) - midnight) / DAY);
}

const headline = (n) => (n > 1 ? `${n} sleeps` : n === 1 ? "1 sleep" : n === 0 ? "Today!" : "Welcome back");
const packed = (t) => t.packing.filter((item) => item.done).length;
const save = (changes) => Storage.set("trip", { ...trip(), ...changes });

Script.action("plan", async () => {
  const place = (await UI.prompt({ title: "Where are you going?", placeholder: "Lisbon" }))?.trim();
  if (!place) return;
  const answer = await UI.prompt({ title: "When do you leave?", message: "Year-month-day", placeholder: "2026-07-18" });
  if (answer === null) return;
  if (!parse(answer)) { await UI.alert({ title: "Not a date", message: "Write the date like 2026-07-18." }); return; }
  Storage.set("trip", { place, date: answer.trim(), packing: STARTER.map((name) => ({ name, done: false })) });
});

Script.action("pack", ({ name, isOn }) => save({ packing: trip().packing.map((item) => (item.name === name ? { ...item, done: isOn ?? !item.done } : item)) }));
Script.action("addItem", async () => {
  const name = (await UI.prompt({ title: "Add to the packing list", placeholder: "Sunglasses" }))?.trim();
  if (name && !trip().packing.some((item) => item.name === name)) save({ packing: [...trip().packing, { name, done: false }] });
});
Script.action("removeItem", ({ name }) => save({ packing: trip().packing.filter((item) => item.name !== name) }));
Script.action("cancel", () => Storage.remove("trip"));

Script.widget(({ family }) => {
  const t = trip();
  if (!t) return Widget.vstack([Widget.text("✈️", { font: 32 }), Widget.text("Plan a trip in Scriptwell", { font: "caption", color: "secondary", align: "center" })], { spacing: 6 });
  const n = sleeps(t);
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 5, 0);

  const main = Widget.vstack([
    Widget.symbol("airplane.departure", { size: 20, color: "white", fallback: "✈️" }),
    Widget.text(n > 0 ? String(n) : headline(n), { font: n > 0 ? 44 : "title2", weight: "bold", design: "rounded", color: "white", lineLimit: 1, minimumScale: 0.6 }),
    Widget.text(n > 0 ? `sleep${n === 1 ? "" : "s"} to ${t.place}` : t.place, { font: "caption", weight: "medium", color: "white", lineLimit: 2, align: "center" }),
  ], { spacing: 2 });

  const todo = t.packing.filter((item) => !item.done);
  return {
    // The outermost background fills the whole widget, edge to edge.
    content: Widget.zstack([
      family === "small" ? main : Widget.hstack([
        main,
        Widget.vstack([
          Widget.text(todo.length ? `Still to pack (${todo.length})` : "All packed 🎒", { font: "caption", weight: "semibold", color: "white" }),
          ...todo.slice(0, 3).map((item) => Widget.button(Widget.hstack([
            Widget.symbol("circle", { size: 14, color: "white", fallback: "⚪️" }),
            Widget.text(item.name, { font: "caption", color: "white", lineLimit: 1 }),
          ], { spacing: 6 }), "pack", { name: item.name })),
        ], { alignment: "leading", spacing: 6 }),
      ], { spacing: 20 }),
    ], { background: Widget.gradient(["#0EA5E9", "#6366F1"], { direction: "topLeadingToBottomTrailing" }), frame: { maxWidth: "infinity", maxHeight: "infinity" } }),
    refreshAt: tomorrow,
  };
});

Script.ui(() => {
  const t = trip();
  if (!t) {
    return { title: "Trip Countdown", content: Widget.vstack([
      Widget.text("✈️", { font: 64 }),
      Widget.text("Where to next?", { font: "title2", weight: "bold" }),
      Widget.button("Plan a trip", "plan", null, { style: "prominent", color: "blue" }),
    ], { spacing: 14, padding: 24 }) };
  }
  const n = sleeps(t);
  return {
    title: t.place,
    content: Widget.vstack([
      Widget.vstack([
        Widget.text(headline(n), { font: 48, weight: "bold", design: "rounded", color: "white" }),
        Widget.text(`${n > 0 ? "until" : "to"} ${t.place} · ${parse(t.date).toLocaleDateString(undefined, { dateStyle: "full" })}`, { color: "white", align: "center" }),
      ], { spacing: 4, padding: 24, background: Widget.gradient(["#0EA5E9", "#6366F1"], { direction: "topLeadingToBottomTrailing" }), cornerRadius: 20, frame: { maxWidth: "infinity" } }),
      Widget.hstack([Widget.text("Packing list", { font: "headline" }), Widget.spacer(), Widget.text(`${packed(t)} of ${t.packing.length}`, { color: "secondary" })]),
      Widget.progress(t.packing.length ? packed(t) / t.packing.length : 0, { color: "blue" }),
      ...t.packing.map((item) => Widget.hstack([
        Widget.toggle(item.name, item.done, "pack", { name: item.name }, { color: "blue", frame: { maxWidth: "infinity" } }),
        Widget.button(Widget.symbol("trash", { size: 15, color: "secondary", fallback: "🗑" }), "removeItem", { name: item.name }),
      ], { spacing: 10 })),
      Widget.button("Add an item", "addItem", null, { style: "bordered", color: "blue" }),
      Widget.button("Plan a different trip", "plan", null, { color: "secondary" }),
    ], { spacing: 12, padding: 16 }),
  };
});

Script.run(() => {
  const t = trip();
  if (!t) return "No trip planned yet.";
  const n = sleeps(t);
  return `${n > 0 ? `${headline(n)} until ${t.place}` : `${headline(n)} ${t.place}`}. ${packed(t)} of ${t.packing.length} things packed.`;
});
