// @name        Tip & Split
// @description Work out the tip and what each person owes, with optional rounding up
// @icon        person.2.fill
// @color       #16A34A
// @version     1.0.0
// @author      scriptwell
// @category    utilities

// From Shortcuts, pass the bill, the number of people and, if you like, the
// tip in percent: "84.50 4" or "84.50 4 18".

const state = () => Storage.get("state", { bill: 0, tip: 15, people: 2, roundUp: false });
const save = (changes) => Storage.set("state", { ...state(), ...changes });
const money = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function work({ bill, tip, people, roundUp }) {
  const exact = (bill * (1 + tip / 100)) / people;
  const each = roundUp ? Math.ceil(exact) : Math.round(exact * 100) / 100;
  const total = each * people;
  return { each, total, tipAmount: total - bill, tipPercent: bill ? ((total - bill) / bill) * 100 : 0 };
}

Script.action("bill", async () => {
  const answer = await UI.prompt({ title: "Bill total", placeholder: "84.50", defaultValue: state().bill ? String(state().bill) : "" });
  const bill = Number(String(answer ?? "").replace(",", "."));
  if (answer !== null && Number.isFinite(bill) && bill >= 0) save({ bill });
});
Script.action("tip", ({ percent }) => save({ tip: percent }));
Script.action("people", ({ by }) => save({ people: Math.min(30, Math.max(1, state().people + by)) }));
Script.action("round", ({ isOn }) => save({ roundUp: isOn ?? !state().roundUp }));

Script.ui(() => {
  const s = state();
  const result = work(s);
  return {
    title: "Tip & Split",
    content: Widget.vstack([
      Widget.button(Widget.vstack([
        Widget.text(s.bill ? money(s.bill) : "Enter the bill", { font: s.bill ? 48 : "title2", weight: "bold", design: "rounded", color: s.bill ? "primary" : "green" }),
        s.bill ? Widget.text("bill · tap to change", { font: "caption", color: "secondary" }) : null,
      ], { spacing: 2 }), "bill"),
      Widget.hstack([0, 10, 15, 18, 20, 25].map((percent) => Widget.button(`${percent}%`, "tip", { percent }, { style: percent === s.tip ? "prominent" : "bordered", color: "green" })), { spacing: 4 }),
      Widget.hstack([
        Widget.text("People"),
        Widget.spacer(),
        Widget.button("−", "people", { by: -1 }, { style: "bordered" }),
        Widget.text(String(s.people), { font: "headline", frame: { width: 36 } }),
        Widget.button("+", "people", { by: 1 }, { style: "bordered" }),
      ], { spacing: 8 }),
      Widget.toggle("Round each share up", s.roundUp, "round", null, { color: "green" }),
      Widget.divider(),
      Widget.text(s.people > 1 ? "Each person pays" : "You pay", { color: "secondary" }),
      Widget.text(money(result.each), { font: 56, weight: "bold", design: "rounded", color: "green" }),
      Widget.hstack([
        Widget.vstack([Widget.text(money(result.tipAmount), { font: "headline" }), Widget.text(`tip (${result.tipPercent.toFixed(0)}%)`, { font: "caption", color: "secondary" })], { spacing: 2, frame: { maxWidth: "infinity" } }),
        Widget.vstack([Widget.text(money(result.total), { font: "headline" }), Widget.text("total", { font: "caption", color: "secondary" })], { spacing: 2, frame: { maxWidth: "infinity" } }),
      ]),
    ], { spacing: 14, padding: 20 }),
  };
});

Script.run((input) => {
  const numbers = (String(input ?? "").replace(/,/g, ".").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (numbers.length < 2 || numbers[1] < 1) return 'Pass the bill and the number of people, like "84.50 4". Add a tip percentage if you like: "84.50 4 18".';
  const [bill, people, tip = state().tip] = numbers;
  const result = work({ bill, tip, people: Math.round(people), roundUp: false });
  return `${money(result.each)} each for ${Math.round(people)} people. Total ${money(result.total)} with a ${tip}% tip of ${money(result.tipAmount)}.`;
});
