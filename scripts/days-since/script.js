// @name        Days Since
// @description Count the days since, or until, the moments that matter to you
// @widget      small, medium, rectangular, inline
// @icon        calendar.badge.clock
// @color       #DB2777
// @version     1.0.0
// @author      va4w
// @category    lifestyle

// Add dates in the app. To pick which one a widget shows, type its name in
// the widget's Parameter field; otherwise the first one is shown.

const DAY = 86400000;
const starter = () => [{ name: "This year began", date: `${new Date().getFullYear()}-01-01` }];
const events = () => Storage.get("events", starter());

// "2026-03-14" as a local date, or null.
function parse(text) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(text ?? "").trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getMonth() === Number(match[2]) - 1 ? date : null;
}

function count(event) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.round((midnight - parse(event.date)) / DAY);
  return { days: Math.abs(days), label: days === 0 ? "today" : days > 0 ? "days since" : "days until", past: days >= 0 };
}

const chosen = (parameter) => events().find((e) => e.name.toLowerCase() === (parameter ?? "").trim().toLowerCase()) ?? events()[0];

Script.action("add", async () => {
  const name = (await UI.prompt({ title: "What happened, or will happen?", placeholder: "Moved to Lisbon" }))?.trim();
  if (!name) return;
  const answer = await UI.prompt({ title: "When?", message: "Year-month-day", placeholder: "2024-06-01" });
  if (answer === null) return;
  const date = parse(answer);
  if (!date) { await UI.alert({ title: "Not a date", message: "Write the date like 2024-06-01." }); return; }
  Storage.set("events", [...events().filter((e) => e.name !== name), { name, date: answer.trim() }]);
});

Script.action("remove", ({ name }) => Storage.set("events", events().filter((e) => e.name !== name)));

Script.widget(({ family, parameter }) => {
  const event = chosen(parameter);
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 5, 0);
  if (!event) return Widget.text("Add a date in Scriptwell", { font: "caption", color: "secondary" });
  const { days, label } = count(event);

  if (family === "inline") return { content: Widget.text(`${days} ${label}: ${event.name}`), refreshAt: tomorrow };
  if (family === "rectangular") {
    return {
      content: Widget.vstack([
        Widget.text(`${days} ${label}`, { font: "headline" }),
        Widget.text(event.name, { font: "caption", lineLimit: 2 }),
      ], { alignment: "leading", spacing: 1 }),
      refreshAt: tomorrow,
    };
  }

  const others = events().filter((e) => e !== event).slice(0, 3);
  const main = Widget.vstack([
    Widget.text(String(days), { font: 46, weight: "bold", design: "rounded", color: "pink", minimumScale: 0.5, lineLimit: 1 }),
    Widget.text(label, { font: "caption", color: "secondary" }),
    Widget.text(event.name, { font: "subheadline", weight: "semibold", lineLimit: 2, align: "center" }),
  ], { spacing: 2 });

  return {
    content: family === "small" || others.length === 0 ? main : Widget.hstack([
      main,
      Widget.vstack(others.map((e) => Widget.hstack([
        Widget.text(String(count(e).days), { font: "headline", design: "rounded", color: "pink" }),
        Widget.text(e.name, { font: "caption", lineLimit: 1 }),
        Widget.spacer(),
      ], { spacing: 6 })), { alignment: "leading", spacing: 8 }),
    ], { spacing: 16 }),
    refreshAt: tomorrow,
  };
});

Script.ui(() => ({
  title: "Days Since",
  content: Widget.vstack([
    ...events().map((event) => {
      const { days, label } = count(event);
      return Widget.hstack([
        Widget.text(String(days), { font: "title", weight: "bold", design: "rounded", color: "pink", frame: { width: 84 }, minimumScale: 0.5, lineLimit: 1 }),
        Widget.vstack([
          Widget.text(event.name, { font: "headline" }),
          Widget.text(`${label} · ${parse(event.date).toLocaleDateString(undefined, { dateStyle: "medium" })}`, { font: "caption", color: "secondary" }),
        ], { alignment: "leading", spacing: 2 }),
        Widget.spacer(),
        Widget.button(Widget.symbol("trash", { size: 15, color: "secondary", fallback: "🗑" }), "remove", { name: event.name }),
      ], { spacing: 10, padding: 12, background: { light: "#FFFFFF", dark: "#1C1C1E" }, cornerRadius: 12 });
    }),
    events().length === 0 ? Widget.text("Nothing yet. Add a first date.", { color: "secondary" }) : null,
    Widget.button("Add a date", "add", null, { style: "prominent", color: "pink" }),
  ], { spacing: 10, padding: 16 }),
}));

Script.run((input) => {
  const event = chosen(input);
  if (!event) return "No dates saved yet.";
  const { days, label } = count(event);
  return label === "today" ? `${event.name} is today.` : `${days} ${label} ${event.name}.`;
});
