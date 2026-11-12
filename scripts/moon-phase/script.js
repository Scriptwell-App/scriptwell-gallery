// @name        Moon Phase
// @description Tonight's moon, how much is lit, and the next full and new moon
// @widget      small, medium, circular, inline
// @icon        moon.stars.fill
// @color       #312E81
// @version     1.0.0
// @author      va4w
// @category    lifestyle

// Worked out on the device from the average length of a lunar month, so it
// needs no network. Dates are accurate to within about a day.

const DAY = 86400000;
const MONTH = 29.530588853; // days from one new moon to the next
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a known new moon
const NAMES = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous", "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
const EMOJI = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];

function moon(date = new Date()) {
  const age = ((((date.getTime() - NEW_MOON) / DAY) % MONTH) + MONTH) % MONTH; // days since the new moon
  const index = Math.floor((age / MONTH) * 8 + 0.5) % 8;
  const until = (target) => new Date(date.getTime() + ((target - age + MONTH) % MONTH) * DAY);
  return {
    name: NAMES[index],
    emoji: EMOJI[index],
    lit: Math.round(((1 - Math.cos((2 * Math.PI * age) / MONTH)) / 2) * 100),
    age,
    nextFull: until(MONTH / 2),
    nextNew: until(0),
  };
}

const day = (date) => date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

const upcoming = (m) => Widget.vstack([
  Widget.hstack([Widget.text("🌕"), Widget.text(`Full ${day(m.nextFull)}`, { font: "caption", color: "#C7D2FE", lineLimit: 1 })], { spacing: 6 }),
  Widget.hstack([Widget.text("🌑"), Widget.text(`New ${day(m.nextNew)}`, { font: "caption", color: "#C7D2FE", lineLimit: 1 })], { spacing: 6 }),
], { alignment: "leading", spacing: 4 });

Script.widget(({ family }) => {
  const m = moon();
  const refreshAfter = 3 * 60 * 60;

  if (family === "inline") return { content: Widget.text(`${m.emoji} ${m.name} · ${m.lit}%`), refreshAfter };
  if (family === "circular") {
    return { content: Widget.vstack([Widget.text(m.emoji, { font: 24 }), Widget.text(`${m.lit}%`, { font: "caption2" })], { spacing: 0 }), refreshAfter };
  }

  const face = Widget.vstack([
    Widget.text(m.emoji, { font: family === "small" ? 54 : 60 }),
    Widget.text(m.name, { font: "subheadline", weight: "semibold", color: "white", lineLimit: 1, minimumScale: 0.7 }),
    Widget.text(`${m.lit}% lit`, { font: "caption", color: "#C7D2FE" }),
  ], { spacing: 3 });

  return {
    // The outermost background fills the whole widget, edge to edge.
    content: Widget.zstack([
      family === "small" ? face : Widget.hstack([face, upcoming(m)], { spacing: 14 }),
    ], { background: Widget.gradient(["#0B1026", "#312E81"]), frame: { maxWidth: "infinity", maxHeight: "infinity" } }),
    refreshAfter,
  };
});

Script.ui(() => {
  const m = moon();
  // The week ahead, one moon per evening.
  const week = Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * DAY)).map((date) => Widget.vstack([
    Widget.text(date.toLocaleDateString(undefined, { weekday: "narrow" }), { font: "caption2", color: "#C7D2FE" }),
    Widget.text(moon(date).emoji, { font: 26 }),
  ], { spacing: 4 }));

  return {
    title: "Moon",
    content: Widget.vstack([
      Widget.text(m.emoji, { font: 110 }),
      Widget.text(m.name, { font: "title", weight: "bold", color: "white" }),
      Widget.text(`${m.lit}% lit · day ${Math.floor(m.age) + 1} of the cycle`, { color: "#C7D2FE" }),
      Widget.hstack(week, { spacing: 14 }),
      upcoming(m),
    ], { spacing: 14, padding: 28, background: Widget.gradient(["#0B1026", "#312E81"]), cornerRadius: 24 }),
  };
});

Script.run(() => {
  const m = moon();
  return `${m.emoji} ${m.name}, ${m.lit}% lit. Next full moon ${day(m.nextFull)}, next new moon ${day(m.nextNew)}.`;
});
