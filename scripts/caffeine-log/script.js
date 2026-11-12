// @name        Caffeine Log
// @description Log coffee and tea, and see an estimate of the caffeine still in your system
// @widget      small, medium
// @icon        cup.and.saucer.fill
// @color       #78350F
// @version     1.0.0
// @author      scriptwell
// @category    food-drink

// The estimate assumes caffeine halves every five hours, a common average.
// People differ a lot; treat it as a rough guide, not medical advice.

const DRINKS = [
  { name: "Coffee", mg: 95, emoji: "☕️" },
  { name: "Espresso", mg: 63, emoji: "🫘" },
  { name: "Tea", mg: 47, emoji: "🍵" },
  { name: "Cola", mg: 34, emoji: "🥤" },
  { name: "Energy drink", mg: 80, emoji: "⚡️" },
];
const HALF_LIFE_HOURS = 5;
const DAILY_GUIDE_MG = 400;

const log = () => Storage.get("log", []); // [{ name, mg, time }]
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const todays = () => log().filter((entry) => entry.time >= startOfDay());
const todayTotal = () => todays().reduce((sum, entry) => sum + entry.mg, 0);
const inSystem = () => Math.round(log().reduce((sum, entry) => sum + entry.mg * 0.5 ** ((Date.now() - entry.time) / 3_600_000 / HALF_LIFE_HOURS), 0));

Script.action("drink", ({ name, mg }) => {
  // Two days of history is enough for the estimate.
  Storage.set("log", [...log(), { name, mg, time: Date.now() }].filter((entry) => entry.time > Date.now() - 48 * 3_600_000));
});
Script.action("undo", () => Storage.set("log", log().slice(0, -1)));

Script.widget(({ family }) => {
  const now = inSystem();
  const main = Widget.vstack([
    Widget.text("IN YOUR SYSTEM", { font: "caption2", weight: "bold", color: "secondary" }),
    Widget.text(`${now} mg`, { font: "title", weight: "bold", design: "rounded", color: now > 200 ? "orange" : "brown" }),
    Widget.text(`${todays().length} drink${todays().length === 1 ? "" : "s"} · ${todayTotal()} mg today`, { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 3 });

  return {
    content: family === "small"
      ? Widget.vstack([main, Widget.button("+ Coffee", "drink", DRINKS[0], { style: "bordered", color: "brown" })], { alignment: "leading", spacing: 8 })
      : Widget.hstack([
          main,
          Widget.spacer(),
          Widget.vstack(DRINKS.slice(0, 3).map((drink) => Widget.button(`${drink.emoji} ${drink.name}`, "drink", drink, { style: "bordered", color: "brown" })), { spacing: 5 }),
        ]),
    // The estimate falls over time, so redraw it now and then.
    refreshAfter: 30 * 60,
  };
});

Script.ui(() => ({
  title: "Caffeine",
  content: Widget.vstack([
    Widget.text(`${inSystem()} mg`, { font: 56, weight: "bold", design: "rounded", color: "brown" }),
    Widget.text("estimated in your system now", { color: "secondary" }),
    Widget.progress(Math.min(1, todayTotal() / DAILY_GUIDE_MG), { color: todayTotal() > DAILY_GUIDE_MG ? "red" : "brown" }),
    Widget.text(`${todayTotal()} of ${DAILY_GUIDE_MG} mg, a common daily guide for adults`, { font: "caption", color: "secondary" }),
    ...DRINKS.map((drink) => Widget.button(`${drink.emoji}  ${drink.name} · ${drink.mg} mg`, "drink", drink, { style: "bordered", color: "brown", frame: { maxWidth: "infinity" } })),
    todays().length ? Widget.button("Undo last drink", "undo", null, { color: "secondary" }) : null,
    Widget.divider(),
    ...todays().slice().reverse().map((entry) => Widget.hstack([
      Widget.text(entry.name, { font: "subheadline" }),
      Widget.spacer(),
      Widget.date(entry.time, { style: "time", font: "subheadline", color: "secondary" }),
    ])),
  ], { spacing: 10, padding: 20 }),
}));

Script.run(() => `About ${inSystem()} mg of caffeine in your system; ${todayTotal()} mg today.`);
