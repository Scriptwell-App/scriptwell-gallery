// @name        World Clock
// @description The time in the cities you care about, on your Home Screen, always to the minute
// @widget      small, medium
// @icon        globe
// @color       #1D4ED8
// @version     1.0.0
// @author      scriptwell
// @category    travel

// Choose cities in the app. The widget hands the system a page for every
// minute of the next half hour, so the clocks stay right between refreshes.

const PLACES = {
  "Los Angeles": "America/Los_Angeles", "New York": "America/New_York", "São Paulo": "America/Sao_Paulo", London: "Europe/London",
  Berlin: "Europe/Berlin", Lagos: "Africa/Lagos", Dubai: "Asia/Dubai", Mumbai: "Asia/Kolkata", Singapore: "Asia/Singapore",
  Tokyo: "Asia/Tokyo", Sydney: "Australia/Sydney", Auckland: "Pacific/Auckland",
};

const cities = () => Storage.get("cities", ["New York", "London", "Tokyo"]).filter((city) => city in PLACES);

// The wall-clock time in a zone, as if it were UTC, so two zones can be subtracted.
function wall(date, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
  }).formatToParts(date).map((part) => [part.type, Number(part.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
}

function clock(city, date) {
  const zone = PLACES[city];
  const there = wall(date, zone), here = wall(date, undefined);
  const hours = (there - here) / 3600000;
  const days = Math.round((Math.floor(there / 86400000) * 86400000 - Math.floor(here / 86400000) * 86400000) / 86400000);
  const hour = new Date(there).getUTCHours();
  return {
    city,
    time: date.toLocaleTimeString(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit" }),
    offset: hours === 0 ? "same time" : `${hours > 0 ? "+" : "−"}${Math.abs(hours)} h`,
    day: days === 0 ? "" : days > 0 ? "tomorrow" : "yesterday",
    emoji: hour >= 6 && hour < 18 ? "☀️" : "🌙",
  };
}

const row = (c, big) => Widget.hstack([
  Widget.vstack([
    Widget.text(c.city, { font: big ? "headline" : "subheadline", weight: "semibold", lineLimit: 1 }),
    Widget.text([c.offset, c.day].filter(Boolean).join(" · "), { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 0 }),
  Widget.spacer(),
  Widget.text(c.emoji, { font: "caption" }),
  Widget.text(c.time, { font: big ? "title2" : "headline", design: "rounded", weight: "medium" }),
], { spacing: 6 });

Script.widget(({ family }) => {
  const shown = cities().slice(0, family === "small" ? 2 : 3);
  if (shown.length === 0) return Widget.text("Choose cities in Scriptwell", { font: "caption", color: "secondary" });

  const page = (date) => (family === "small"
    ? Widget.vstack(shown.map((city) => clock(city, date)).map((c) => Widget.vstack([
      Widget.text(`${c.emoji} ${c.city}`, { font: "caption", color: "secondary", lineLimit: 1 }),
      Widget.text(c.time, { font: "title2", design: "rounded", weight: "semibold" }),
    ], { alignment: "leading", spacing: 0 })), { alignment: "leading", spacing: 8, frame: { maxWidth: "infinity", alignment: "leading" } })
    : Widget.vstack(shown.map((city) => row(clock(city, date), false)), { spacing: 8 }));

  const start = new Date();
  start.setSeconds(0, 0);
  return {
    timeline: Array.from({ length: 30 }, (_, minute) => new Date(start.getTime() + minute * 60000)).map((date) => ({ date, content: page(date) })),
    refreshAfter: 25 * 60,
  };
});

Script.action("toggle", ({ city, isOn }) => {
  const set = new Set(cities());
  if (isOn ?? !set.has(city)) set.add(city); else set.delete(city);
  // Keep the order of the list above, west to east.
  Storage.set("cities", Object.keys(PLACES).filter((name) => set.has(name)));
});
Script.action("refresh", () => {});

Script.ui(() => {
  const now = new Date();
  return {
    title: "World Clock",
    content: Widget.vstack([
      ...cities().map((city) => row(clock(city, now), true)),
      cities().length ? Widget.button("Update", "refresh", null, { style: "bordered" }) : Widget.text("Choose some cities below.", { color: "secondary" }),
      Widget.divider(),
      Widget.text("Cities", { font: "caption", color: "secondary" }),
      ...Object.keys(PLACES).map((city) => Widget.toggle(city, cities().includes(city), "toggle", { city }, { color: "blue" })),
    ], { spacing: 12, padding: 20 }),
  };
});

Script.run(() => cities().map((city) => clock(city, new Date())).map((c) => `${c.city}: ${c.time}${c.day ? ` (${c.day})` : ""}`).join("\n") || "No cities chosen.");
