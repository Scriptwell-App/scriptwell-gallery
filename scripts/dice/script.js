// @name        Dice
// @description Roll dice from the Home Screen or the app: one to five dice, any size
// @widget      small, medium
// @icon        dice.fill
// @color       #DC2626
// @version     1.0.0
// @author      scriptwell
// @category    games

const FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const setup = () => Storage.get("setup", { count: 2, sides: 6 });
const last = () => Storage.get("last", null); // { values, sides }

Script.action("roll", () => {
  const { count, sides } = setup();
  Storage.set("last", { sides, values: Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides)) });
});

Script.action("count", ({ by }) => Storage.set("setup", { ...setup(), count: Math.min(5, Math.max(1, setup().count + by)) }));
Script.action("sides", ({ sides }) => Storage.set("setup", { ...setup(), sides }));

function faces(size) {
  const roll = last();
  if (!roll) return Widget.text("Tap Roll", { font: "headline", color: "secondary" });
  // Six-sided dice are drawn as dice; other sizes as numbers.
  return Widget.hstack(roll.values.map((value) => roll.sides === 6
    ? Widget.text(FACES[value - 1], { font: size })
    : Widget.text(String(value), { font: size * 0.6, weight: "bold", design: "rounded", padding: { horizontal: 6 } })),
  { spacing: 4 });
}

const total = () => (last() ? last().values.reduce((a, b) => a + b, 0) : 0);

Script.widget(({ family }) => Widget.vstack([
  faces(family === "small" ? 34 : 44),
  last() && last().values.length > 1 ? Widget.text(`Total ${total()}`, { font: "caption", color: "secondary" }) : null,
  Widget.button("Roll", "roll", null, { style: "bordered", color: "red" }),
], { spacing: 6 }));

Script.ui(() => {
  const { count, sides } = setup();
  return {
    title: "Dice",
    content: Widget.vstack([
      faces(64),
      last() ? Widget.text(`Total ${total()}`, { font: "title3", color: "secondary" }) : null,
      Widget.button(`Roll ${count}d${sides}`, "roll", null, { style: "prominent", color: "red" }),
      Widget.divider(),
      Widget.hstack([
        Widget.text("Dice"),
        Widget.spacer(),
        Widget.button("−", "count", { by: -1 }, { style: "bordered" }),
        Widget.text(String(count), { font: "headline", frame: { width: 30 } }),
        Widget.button("+", "count", { by: 1 }, { style: "bordered" }),
      ], { spacing: 8 }),
      Widget.hstack([4, 6, 8, 10, 12, 20].map((n) =>
        Widget.button(`d${n}`, "sides", { sides: n }, { style: n === sides ? "prominent" : "bordered", color: "red" })), { spacing: 6 }),
    ], { spacing: 14, padding: 20 }),
  };
});

Script.run(() => {
  const { count, sides } = setup();
  const values = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  return `${values.join(" + ")} = ${values.reduce((a, b) => a + b, 0)}`;
});
