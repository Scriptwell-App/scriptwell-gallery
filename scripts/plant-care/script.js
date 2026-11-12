// @name        Plant Care
// @description Remember which plant needs water, with a reminder on the day
// @permissions notifications
// @widget      small, medium
// @icon        leaf.fill
// @color       #15803D
// @version     1.0.0
// @author      va4w
// @category    lifestyle

// Each plant has its own watering interval. Tapping "Watered" restarts its
// clock and schedules a reminder for 9:00 on the day it is next due.

const DAY = 86400000;
const plants = () => Storage.get("plants", []); // [{ name, every, watered }]

function due(plant) {
  const date = new Date(plant.watered + plant.every * DAY);
  date.setHours(9, 0, 0, 0);
  return date;
}

// Whole days until the plant is due; zero or less means it is thirsty.
function daysLeft(plant) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return Math.floor((due(plant) - midnight) / DAY);
}

const sorted = () => [...plants()].sort((a, b) => daysLeft(a) - daysLeft(b));
const status = (plant) => { const d = daysLeft(plant); return d < 0 ? `${-d} day${d === -1 ? "" : "s"} late` : d === 0 ? "Water today" : d === 1 ? "Tomorrow" : `In ${d} days`; };

async function remind(plant) {
  if (due(plant) <= Date.now()) return;
  await Notification.schedule({ id: `plant-${plant.name}`, at: due(plant), title: `${plant.name} is thirsty`, body: `Time to water. Every ${plant.every} days.` });
}

Script.action("add", async () => {
  const name = (await UI.prompt({ title: "Which plant?", placeholder: "Monstera" }))?.trim();
  if (!name) return;
  const every = Number(await UI.prompt({ title: "Water every how many days?", placeholder: "7", defaultValue: "7" }));
  if (!Number.isInteger(every) || every < 1 || every > 365) { await UI.alert({ title: "Use a number of days from 1 to 365." }); return; }
  const plant = { name, every, watered: Date.now() };
  Storage.set("plants", [...plants().filter((p) => p.name !== name), plant]);
  await remind(plant);
});

Script.action("water", async ({ name }) => {
  const list = plants().map((p) => (p.name === name ? { ...p, watered: Date.now() } : p));
  Storage.set("plants", list);
  const plant = list.find((p) => p.name === name);
  if (plant) await remind(plant);
});

Script.action("remove", async ({ name }) => {
  Storage.set("plants", plants().filter((p) => p.name !== name));
  await Notification.cancel(`plant-${name}`);
});

Script.widget(({ family }) => {
  const list = sorted();
  const thirsty = list.filter((p) => daysLeft(p) <= 0);
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 5, 0);

  if (list.length === 0) return Widget.vstack([Widget.text("🪴", { font: 34 }), Widget.text("Add plants in Scriptwell", { font: "caption", color: "secondary", align: "center" })], { spacing: 6 });

  if (family === "small") {
    return {
      content: Widget.vstack([
        Widget.text(thirsty.length ? "💧" : "🌿", { font: 34 }),
        Widget.text(thirsty.length ? `${thirsty.length} thirsty` : "All watered", { font: "headline" }),
        Widget.text(thirsty.length ? thirsty.map((p) => p.name).join(", ") : `Next: ${list[0].name}, ${status(list[0]).toLowerCase()}`, { font: "caption2", color: "secondary", lineLimit: 2, align: "center" }),
      ], { spacing: 4 }),
      refreshAt: tomorrow,
    };
  }

  return {
    content: Widget.vstack([
      Widget.text(thirsty.length ? `${thirsty.length} to water` : "All watered", { font: "headline" }),
      ...list.slice(0, 4).map((p) => Widget.hstack([
        Widget.text(daysLeft(p) <= 0 ? "💧" : "🌿", { font: "caption" }),
        Widget.text(p.name, { font: "subheadline", lineLimit: 1 }),
        Widget.spacer(),
        Widget.text(status(p), { font: "caption", color: daysLeft(p) <= 0 ? "blue" : "secondary" }),
      ], { spacing: 6 })),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    refreshAt: tomorrow,
  };
});

Script.ui(() => ({
  title: "Plant Care",
  content: Widget.vstack([
    ...sorted().map((p) => Widget.hstack([
      Widget.text(daysLeft(p) <= 0 ? "💧" : "🌿", { font: "title2" }),
      Widget.vstack([
        Widget.text(p.name, { font: "headline" }),
        Widget.text(`${status(p)} · every ${p.every} days`, { font: "caption", color: daysLeft(p) <= 0 ? "blue" : "secondary" }),
      ], { alignment: "leading", spacing: 2 }),
      Widget.spacer(),
      Widget.button("Watered", "water", { name: p.name }, { style: daysLeft(p) <= 0 ? "prominent" : "bordered", color: "green" }),
      Widget.button(Widget.symbol("trash", { size: 15, color: "secondary", fallback: "🗑" }), "remove", { name: p.name }),
    ], { spacing: 10, padding: 12, background: { light: "#FFFFFF", dark: "#1C1C1E" }, cornerRadius: 12 })),
    plants().length === 0 ? Widget.vstack([Widget.text("🪴", { font: 56 }), Widget.text("Add your first plant", { color: "secondary" })], { spacing: 8, padding: 20 }) : null,
    Widget.button("Add a plant", "add", null, { style: "bordered", color: "green" }),
  ], { spacing: 10, padding: 16 }),
}));
