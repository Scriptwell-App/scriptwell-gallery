// @name        Meeting Cost
// @description See what a meeting is costing from headcount and hourly rate
// @icon        person.3.fill
// @color       #9333EA
// @version     1.0.0
// @author      scriptwell
// @category    business

const settings = () => Storage.get("settings", { people: 5, rate: 60 });
let started = null;   // when the current meeting began
let finalCost = null; // cost of the meeting that just ended

const costSoFar = () => (started ? ((Date.now() - started) / 3_600_000) * settings().people * settings().rate : 0);
const money = (n) => n.toLocaleString(Script.env.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

Script.action("people", ({ by }) => Storage.set("settings", { ...settings(), people: Math.max(1, settings().people + by) }));

Script.action("rate", async () => {
  const text = await UI.prompt({ title: "Average hourly rate", defaultValue: String(settings().rate) });
  const value = Number(String(text).replace(",", "."));
  if (text !== null && value > 0) Storage.set("settings", { ...settings(), rate: value });
});

Script.action("start", () => { started = Date.now(); finalCost = null; });
Script.action("stop", () => { finalCost = costSoFar(); started = null; });
Script.action("refresh", () => {});

Script.ui(() => {
  const { people, rate } = settings();
  const perMinute = (people * rate) / 60;

  return {
    title: "Meeting Cost",
    content: Widget.vstack([
      Widget.text(money(started ? costSoFar() : finalCost ?? 0), { font: 60, weight: "bold", design: "rounded", color: started ? "red" : "primary", minimumScale: 0.5, lineLimit: 1 }),
      started
        ? Widget.date(started, { style: "timer", font: "title3", color: "secondary" })
        : Widget.text(finalCost === null ? "Ready when you are" : "Final cost", { color: "secondary" }),
      started
        ? Widget.hstack([
            Widget.button("Update", "refresh", null, { style: "bordered" }),
            Widget.button("End meeting", "stop", null, { style: "prominent", color: "red" }),
          ], { spacing: 10 })
        : Widget.button("Start meeting", "start", null, { style: "prominent", color: "purple" }),
      Widget.divider(),
      Widget.hstack([
        Widget.text("People"),
        Widget.spacer(),
        Widget.button("−", "people", { by: -1 }, { style: "bordered" }),
        Widget.text(String(people), { font: "headline", frame: { width: 36 } }),
        Widget.button("+", "people", { by: 1 }, { style: "bordered" }),
      ], { spacing: 8 }),
      Widget.hstack([Widget.text("Hourly rate"), Widget.spacer(), Widget.button(money(rate), "rate", null, { style: "bordered" })]),
      Widget.text(`This meeting costs ${money(perMinute)} a minute.`, { font: "footnote", color: "secondary" }),
    ], { spacing: 14, padding: 20 }),
  };
});
