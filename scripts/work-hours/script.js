// @name        Work Hours
// @description Clock in and out, and see today's and this week's totals
// @widget      small, medium
// @icon        clock.badge.checkmark.fill
// @color       #1D4ED8
// @version     1.0.0
// @author      scriptwell
// @category    business

const sessions = () => Storage.get("sessions", []);       // [{ start, end }] in milliseconds
const running = () => Storage.get("running", null);       // start time, or null

const startOfDay = (offset = 0) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d.getTime(); };
const startOfWeek = () => startOfDay(-((new Date().getDay() + 6) % 7)); // Monday

function total(since) {
  const finished = sessions().filter((s) => s.end > since).reduce((sum, s) => sum + (s.end - Math.max(s.start, since)), 0);
  return finished + (running() ? Date.now() - Math.max(running(), since) : 0);
}

const hours = (ms) => {
  const minutes = Math.round(ms / 60000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
};

Script.action("toggle", () => {
  const start = running();
  if (start) {
    // Keep 60 days of history.
    Storage.set("sessions", [...sessions(), { start, end: Date.now() }].filter((s) => s.end > startOfDay(-60)));
    Storage.remove("running");
  } else {
    Storage.set("running", Date.now());
  }
});

Script.widget(({ family }) => {
  const start = running();
  const status = start
    ? Widget.vstack([
        Widget.text("WORKING", { font: "caption2", weight: "bold", color: "green" }),
        Widget.date(start, { style: "timer", font: "title2", weight: "bold", design: "rounded", align: "center" }),
      ], { spacing: 2 })
    : Widget.vstack([
        Widget.text("TODAY", { font: "caption2", weight: "bold", color: "secondary" }),
        Widget.text(hours(total(startOfDay())), { font: "title2", weight: "bold", design: "rounded" }),
      ], { spacing: 2 });

  const button = Widget.button(start ? "Clock out" : "Clock in", "toggle", null, { style: "bordered", color: start ? "red" : "green" });
  if (family === "small") return { content: Widget.vstack([status, button], { spacing: 10 }), refreshAfter: 15 * 60 };

  return {
    content: Widget.hstack([
      Widget.vstack([status, button], { spacing: 10 }),
      Widget.spacer(),
      Widget.vstack([
        Widget.text("Today", { font: "caption", color: "secondary" }),
        Widget.text(hours(total(startOfDay())), { font: "headline" }),
        Widget.text("This week", { font: "caption", color: "secondary" }),
        Widget.text(hours(total(startOfWeek())), { font: "headline" }),
      ], { alignment: "trailing", spacing: 2 }),
    ]),
    refreshAfter: 15 * 60,
  };
});

Script.ui(() => {
  const start = running();
  const today = sessions().filter((s) => s.end > startOfDay());
  const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return {
    title: "Work Hours",
    content: Widget.vstack([
      start
        ? Widget.date(start, { style: "timer", font: 64, weight: "bold", design: "rounded" })
        : Widget.text(hours(total(startOfDay())), { font: 56, weight: "bold", design: "rounded" }),
      Widget.text(start ? `Clocked in at ${time(start)}` : "Worked today", { color: "secondary" }),
      Widget.button(start ? "Clock out" : "Clock in", "toggle", null, { style: "prominent", color: start ? "red" : "green" }),
      Widget.divider(),
      Widget.hstack([Widget.text("This week"), Widget.spacer(), Widget.text(hours(total(startOfWeek())), { weight: "semibold" })]),
      ...today.map((s) => Widget.hstack([
        Widget.text(`${time(s.start)} – ${time(s.end)}`, { font: "subheadline", color: "secondary" }),
        Widget.spacer(),
        Widget.text(hours(s.end - s.start), { font: "subheadline" }),
      ])),
    ], { spacing: 12, padding: 20 }),
  };
});

Script.run(() => `${hours(total(startOfDay()))} today, ${hours(total(startOfWeek()))} this week${running() ? " (clocked in)" : ""}.`);
