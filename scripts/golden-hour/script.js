// @name        Golden Hour
// @description When the light is best for photos today: golden hour, blue hour, sunrise and sunset
// @permissions network, location
// @widget      small, medium, rectangular, inline
// @icon        sun.horizon.fill
// @color       #D97706
// @version     1.0.0
// @author      scriptwell
// @category    photo-video

// Sunrise and sunset come from https://open-meteo.com (free, no key) for your
// location, rounded to about a kilometre. Golden hour is taken as the hour
// after sunrise and the hour before sunset, and blue hour as the 30 minutes
// outside them. That is a good rule of thumb, not an exact calculation.

const MINUTE = 60000;

async function sun() {
  const saved = Storage.get("sun");
  try {
    const { latitude, longitude } = await Location.current({ accuracy: "kilometer" });
    const query = new URLSearchParams({
      latitude: latitude.toFixed(2), longitude: longitude.toFixed(2),
      daily: "sunrise,sunset", timeformat: "unixtime", timezone: "auto", forecast_days: 2,
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { timeout: 8000 });
    if (!response.ok) throw new Error(`Open-Meteo answered ${response.status}`);
    const { daily } = await response.json();
    const days = daily.sunrise.map((rise, i) => ({ sunrise: rise * 1000, sunset: daily.sunset[i] * 1000 }));
    Storage.set("sun", days);
    return days;
  } catch (error) {
    if (saved?.some((day) => day.sunset > Date.now())) return saved;
    throw error;
  }
}

// Every window of good light in the next two days, in order.
function windows(days) {
  return days.flatMap(({ sunrise, sunset }) => [
    { name: "Blue hour", emoji: "🌌", start: sunrise - 30 * MINUTE, end: sunrise },
    { name: "Golden hour", emoji: "🌅", start: sunrise, end: sunrise + 60 * MINUTE },
    { name: "Golden hour", emoji: "🌇", start: sunset - 60 * MINUTE, end: sunset },
    { name: "Blue hour", emoji: "🌌", start: sunset, end: sunset + 30 * MINUTE },
  ]).filter((w) => w.end > Date.now());
}

const clock = (time) => new Date(time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

Script.widget(async ({ family }) => {
  const days = await sun();
  const list = windows(days);
  const next = list.find((w) => w.name === "Golden hour") ?? list[0];
  const now = next.start <= Date.now();
  const refreshAt = new Date((now ? next.end : next.start) + 30000);

  if (family === "inline") return { content: Widget.text(`${next.emoji} ${now ? "Golden hour until" : "Golden hour"} ${clock(now ? next.end : next.start)}`), refreshAt };
  if (family === "rectangular") {
    return {
      content: Widget.vstack([
        Widget.text(now ? "Golden hour now" : "Golden hour", { font: "headline" }),
        Widget.text(`${clock(next.start)} – ${clock(next.end)}`, { font: "subheadline" }),
      ], { alignment: "leading", spacing: 1 }),
      refreshAt,
    };
  }

  const main = Widget.vstack([
    Widget.symbol("sun.horizon.fill", { size: 30, color: "white", fallback: next.emoji }),
    Widget.text(now ? "Golden hour now" : "Golden hour", { font: "subheadline", weight: "semibold", color: "white" }),
    Widget.text(now ? `until ${clock(next.end)}` : clock(next.start), { font: "title2", weight: "bold", design: "rounded", color: "white" }),
    now ? null : Widget.date(next.start, { style: "relative", font: "caption2", color: "#FFFFFFCC" }),
  ], { spacing: 3 });

  const today = days.find((day) => day.sunset > Date.now()) ?? days[0];
  return {
    // The outermost background fills the whole widget, edge to edge.
    content: Widget.zstack([
      family === "small" ? main : Widget.hstack([
        main,
        Widget.vstack([
          Widget.text(`Sunrise ${clock(today.sunrise)}`, { font: "caption", color: "white" }),
          Widget.text(`Sunset ${clock(today.sunset)}`, { font: "caption", color: "white" }),
          Widget.text(`Blue hour ${clock(today.sunset)}`, { font: "caption", color: "#FFFFFFCC" }),
        ], { alignment: "leading", spacing: 5 }),
      ], { spacing: 22 }),
    ], { background: Widget.gradient(["#F59E0B", "#DB2777", "#4C1D95"], { direction: "topLeadingToBottomTrailing" }), frame: { maxWidth: "infinity", maxHeight: "infinity" } }),
    refreshAt,
  };
});

Script.ui(async () => {
  const list = windows(await sun()).slice(0, 6);
  return {
    title: "Golden Hour",
    content: Widget.vstack([
      Widget.text("The next good light", { font: "title3", weight: "semibold" }),
      ...list.map((w) => Widget.hstack([
        Widget.text(w.emoji, { font: "title2" }),
        Widget.vstack([
          Widget.text(w.start <= Date.now() ? `${w.name} · now` : w.name, { font: "headline", color: w.name === "Golden hour" ? "orange" : "indigo" }),
          Widget.text(`${new Date(w.start).toLocaleDateString(undefined, { weekday: "long" })}, ${clock(w.start)} – ${clock(w.end)}`, { font: "subheadline", color: "secondary" }),
        ], { alignment: "leading", spacing: 2 }),
        Widget.spacer(),
      ], { spacing: 12, padding: 12, background: { light: "#FFFFFF", dark: "#1C1C1E" }, cornerRadius: 12 })),
      Widget.text("Golden hour: the hour after sunrise and before sunset. Blue hour: the half hour outside them.", { font: "caption", color: "secondary", align: "center" }),
    ], { spacing: 10, padding: 16 }),
  };
});

Script.run(async () => {
  const next = windows(await sun()).find((w) => w.name === "Golden hour");
  return next ? `Golden hour: ${clock(next.start)} to ${clock(next.end)}.` : "No golden hour found.";
});
