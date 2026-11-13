// @name        Days Left
// @description Today's date and how many days are left in the year
// @icon        calendar.badge.clock
// @color       #6366F1
// @widget      small

function info() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfYear = new Date(now.getFullYear() + 1, 0, 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  // Days remaining after today (round to absorb daylight-saving shifts).
  const daysLeft = Math.round((endOfYear - today) / 86_400_000) - 1;
  const fraction = (now - startOfYear) / (endOfYear - startOfYear);
  return { now, daysLeft, fraction };
}

Script.widget(() => {
  const { now, daysLeft, fraction } = info();
  const weekday = now.toLocaleDateString(Script.env.locale, { weekday: "long" });
  const date = now.toLocaleDateString(Script.env.locale, { day: "numeric", month: "long" });

  const midnight = new Date(now);
  midnight.setHours(24, 0, 10, 0);

  return {
    content: Widget.vstack([
      Widget.text(weekday.toUpperCase(), { font: "caption", weight: "bold", color: "red", lineLimit: 1, minimumScale: 0.6 }),
      Widget.text(date, { font: "title3", weight: "semibold", lineLimit: 1, minimumScale: 0.6 }),
      Widget.spacer(),
      Widget.text(String(daysLeft), { font: 40, weight: "bold", design: "rounded", color: "indigo", lineLimit: 1, minimumScale: 0.5 }),
      Widget.text(daysLeft === 1 ? "day left this year" : "days left this year", { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
      Widget.progress(fraction, { color: "indigo" }),
    ], {
      alignment: "leading",
      spacing: 2,
      frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" },
    }),
    refreshAt: midnight,
  };
});

Script.run(() => {
  const { now, daysLeft } = info();
  const date = now.toLocaleDateString(Script.env.locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `${date}: ${daysLeft} day${daysLeft === 1 ? "" : "s"} left this year`;
});
