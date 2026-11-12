// @name        Budget
// @description Log spending against a monthly budget and see what is left
// @widget      small, medium
// @icon        chart.pie.fill
// @color       #0891B2
// @version     1.0.0
// @author      va4w
// @category    finance

const month = () => new Date().toISOString().slice(0, 7); // "2026-11"
const budget = () => Storage.get("budget", 500);
const expenses = () => Storage.get(`expenses:${month()}`, []); // [{ id, amount, note, time }]
const spent = () => expenses().reduce((sum, e) => sum + e.amount, 0);

const money = (n) => n.toLocaleString(Script.env.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function daysLeft() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
}

Script.action("add", async () => {
  const text = await UI.prompt({ title: "How much?", placeholder: "12.50" });
  const amount = Number(String(text).replace(",", "."));
  if (text === null || !(amount > 0)) return;
  const note = await UI.prompt({ title: "What for?", placeholder: "Groceries" });
  Storage.set(`expenses:${month()}`, [{ id: Date.now(), amount, note: note?.trim() || "Expense", time: Date.now() }, ...expenses()]);
});

Script.action("quick", ({ amount }) => {
  Storage.set(`expenses:${month()}`, [{ id: Date.now(), amount, note: "Quick add", time: Date.now() }, ...expenses()]);
});

Script.action("remove", ({ id }) => Storage.set(`expenses:${month()}`, expenses().filter((e) => e.id !== id)));

Script.action("budget", async () => {
  const text = await UI.prompt({ title: "Monthly budget", defaultValue: String(budget()) });
  const value = Number(String(text).replace(",", "."));
  if (text !== null && value > 0) Storage.set("budget", value);
});

function summary() {
  const left = budget() - spent();
  return { left, fraction: Math.min(1, spent() / budget()), color: left < 0 ? "red" : left < budget() * 0.2 ? "orange" : "cyan" };
}

Script.widget(({ family }) => {
  const { left, fraction, color } = summary();
  const main = Widget.vstack([
    Widget.text(left >= 0 ? "LEFT THIS MONTH" : "OVER BUDGET", { font: "caption2", weight: "bold", color: "secondary" }),
    Widget.text(money(Math.abs(left)), { font: "title2", weight: "bold", design: "rounded", color, minimumScale: 0.6, lineLimit: 1 }),
    Widget.progress(fraction, { color }),
    Widget.text(left > 0 ? `${money(left / daysLeft())} a day for ${daysLeft()} days` : `${daysLeft()} days to go`, { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 5 });
  if (family === "small") return main;

  return Widget.hstack([
    main,
    Widget.vstack([5, 10, 20].map((amount) => Widget.button(`+${amount}`, "quick", { amount }, { style: "bordered", color: "cyan" })), { spacing: 6 }),
  ], { spacing: 16 });
});

Script.ui(() => {
  const { left, fraction, color } = summary();
  return {
    title: new Date().toLocaleDateString(Script.env.locale, { month: "long", year: "numeric" }),
    content: Widget.vstack([
      Widget.text(money(Math.abs(left)), { font: 52, weight: "bold", design: "rounded", color, minimumScale: 0.5, lineLimit: 1 }),
      Widget.text(left >= 0 ? `left of ${money(budget())}` : `over your ${money(budget())} budget`, { color: "secondary" }),
      Widget.progress(fraction, { color }),
      Widget.hstack([
        Widget.button("Add expense", "add", null, { style: "prominent", color: "cyan" }),
        Widget.button("Set budget", "budget", null, { style: "bordered" }),
      ], { spacing: 10 }),
      Widget.divider(),
      ...expenses().slice(0, 30).map((e) => Widget.hstack([
        Widget.vstack([
          Widget.text(e.note, { font: "subheadline", lineLimit: 1 }),
          Widget.date(e.time, { style: "date", font: "caption2", color: "secondary" }),
        ], { alignment: "leading", spacing: 1 }),
        Widget.spacer(),
        Widget.text(money(e.amount), { font: "subheadline", weight: "medium" }),
        Widget.button(Widget.symbol("minus.circle", { size: 18, color: "red", fallback: "✕" }), "remove", { id: e.id }),
      ], { spacing: 10 })),
      expenses().length === 0 ? Widget.text("No expenses yet this month.", { color: "secondary" }) : null,
    ], { spacing: 12, padding: 20 }),
  };
});

Script.run(() => `${money(budget() - spent())} left of ${money(budget())} this month.`);
