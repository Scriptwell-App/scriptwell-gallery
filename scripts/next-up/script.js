// @name        Next Up
// @description Your next calendar events, with a live countdown to the one that starts soonest
// @permissions calendar
// @widget      small, medium, rectangular, inline
// @icon        calendar
// @color       #E11D48
// @version     1.0.0
// @author      scriptwell
// @category    productivity

// Reads your calendars on the device; nothing leaves it (this script has no
// network permission). All-day events are left out of the countdown.

const DAY = 86400000;

async function upcoming() {
  const events = await Calendar.events({ start: new Date(), end: new Date(Date.now() + 2 * DAY) });
  return events.filter((e) => !e.allDay && new Date(e.end) > Date.now());
}

const clock = (time) => new Date(time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const running = (event) => new Date(event.start) <= Date.now();

function when(event) {
  const start = new Date(event.start);
  const today = start.toDateString() === new Date().toDateString();
  return `${today ? "" : `${start.toLocaleDateString(undefined, { weekday: "short" })} `}${clock(start)}`;
}

const row = (event) => Widget.hstack([
  { type: "stack", direction: "vertical", children: [], background: event.color, cornerRadius: 2, frame: { width: 4, height: 28 } },
  Widget.vstack([
    Widget.text(event.title, { font: "footnote", weight: "medium", lineLimit: 1 }),
    Widget.text(when(event), { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 0 }),
  Widget.spacer(),
], { spacing: 8 });

Script.widget(async ({ family }) => {
  const events = await upcoming();
  const next = events[0];
  // Redraw when the next thing starts or ends, and at least every half hour.
  const refreshAt = new Date(Math.min(Date.now() + 30 * 60000, next ? new Date(running(next) ? next.end : next.start).getTime() + 5000 : Infinity));

  if (!next) {
    const free = family === "inline" ? Widget.text("Nothing coming up") : Widget.vstack([
      Widget.symbol("calendar", { size: 26, color: "secondary", fallback: "📅" }),
      Widget.text("Nothing in the next two days", { font: "caption", color: "secondary", align: "center" }),
    ], { spacing: 6 });
    return { content: free, refreshAt };
  }

  if (family === "inline") return { content: Widget.text(`${when(next)} ${next.title}`), refreshAt };
  if (family === "rectangular") {
    return {
      content: Widget.vstack([
        Widget.text(next.title, { font: "headline", lineLimit: 1 }),
        Widget.text(running(next) ? `Now, until ${clock(next.end)}` : when(next), { font: "caption" }),
        next.location ? Widget.text(next.location, { font: "caption2", lineLimit: 1 }) : null,
      ], { alignment: "leading", spacing: 1 }),
      refreshAt,
    };
  }

  const main = Widget.vstack([
    Widget.text(running(next) ? "NOW" : "NEXT", { font: "caption2", weight: "heavy", color: next.color }),
    Widget.text(next.title, { font: "headline", lineLimit: 2 }),
    running(next)
      ? Widget.text(`until ${clock(next.end)}`, { font: "subheadline", color: "secondary" })
      : Widget.date(next.start, { style: "relative", font: "subheadline", color: "secondary" }),
    Widget.text(when(next), { font: "caption", color: "secondary" }),
    next.location ? Widget.text(next.location, { font: "caption2", color: "secondary", lineLimit: 1 }) : null,
    Widget.spacer(),
  ], { alignment: "leading", spacing: 3, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });

  return {
    content: family === "small" || events.length < 2 ? main : Widget.hstack([
      main,
      Widget.vstack([...events.slice(1, 4).map(row), Widget.spacer()], { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 12 }),
    refreshAt,
  };
});

Script.ui(async () => {
  const events = await upcoming();
  return {
    title: "Next Up",
    content: Widget.vstack([
      events.length === 0 ? Widget.text("Nothing in the next two days.", { color: "secondary" }) : null,
      ...events.slice(0, 12).map((event) => Widget.hstack([
        { type: "stack", direction: "vertical", children: [], background: event.color, cornerRadius: 2, frame: { width: 5, height: 40 } },
        Widget.vstack([
          Widget.text(event.title, { font: "headline" }),
          Widget.text(`${running(event) ? "Now · " : ""}${when(event)} – ${clock(event.end)} · ${event.calendar}`, { font: "caption", color: "secondary" }),
          event.location ? Widget.text(event.location, { font: "caption", color: "secondary", lineLimit: 1 }) : null,
        ], { alignment: "leading", spacing: 2 }),
        Widget.spacer(),
      ], { spacing: 10, padding: 12, background: { light: "#FFFFFF", dark: "#1C1C1E" }, cornerRadius: 12 })),
    ], { spacing: 10, padding: 16 }),
  };
});

Script.run(async () => {
  const next = (await upcoming())[0];
  if (!next) return "Nothing in the next two days.";
  return running(next) ? `${next.title} is on now, until ${clock(next.end)}.` : `Next: ${next.title}, ${when(next)}${next.location ? `, ${next.location}` : ""}.`;
});
