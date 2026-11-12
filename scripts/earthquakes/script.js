// @name        Earthquakes
// @description Significant earthquakes around the world in the last 24 hours, from the USGS
// @permissions network
// @widget      small, medium, large
// @icon        waveform.path.ecg
// @color       #B91C1C
// @version     1.0.0
// @author      va4w
// @category    news

// Data: the U.S. Geological Survey's public feed (free, no key) of every
// earthquake of magnitude 4.5 and above in the past day.
// To show only stronger ones, put a magnitude such as "6" in the widget's
// Parameter field.

const FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";

async function quakes(minimum) {
  const floor = Number(minimum) >= 4.5 && Number(minimum) <= 9.5 ? Number(minimum) : 4.5;
  let saved = Storage.get("quakes");
  try {
    const response = await fetch(FEED, { timeout: 8000 });
    if (!response.ok) throw new Error(`USGS answered ${response.status}`);
    const list = (await response.json()).features
      .map(({ properties: p }) => ({ mag: p.mag, place: p.place ?? "Unknown place", time: p.time, url: p.url, tsunami: p.tsunami === 1 }))
      .filter((q) => typeof q.mag === "number");
    saved = { list, time: Date.now(), offline: false };
    Storage.set("quakes", saved);
  } catch (error) {
    if (!saved) throw error;
    saved = { ...saved, offline: true };
  }
  return { ...saved, floor, list: saved.list.filter((q) => q.mag >= floor) };
}

const color = (mag) => (mag >= 7 ? "red" : mag >= 6 ? "orange" : "yellow");
// "112 km SSW of Tual, Indonesia" → "Tual, Indonesia"
const short = (place) => place.replace(/^.*? of /, "");

const row = (q) => Widget.hstack([
  Widget.text(q.mag.toFixed(1), { font: "headline", design: "rounded", color: color(q.mag), frame: { width: 38, alignment: "leading" } }),
  Widget.vstack([
    Widget.text(short(q.place), { font: "footnote", weight: "medium", lineLimit: 1 }),
    Widget.date(q.time, { style: "relative", font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 0 }),
  Widget.spacer(),
], { spacing: 6, url: q.url });

Script.widget(async ({ family, parameter }) => {
  const { list, floor, offline } = await quakes(parameter);
  const strongest = [...list].sort((a, b) => b.mag - a.mag)[0];
  const refreshAfter = 20 * 60;

  if (!strongest) return { content: Widget.text(`No earthquakes of magnitude ${floor}+ in the last day`, { font: "caption", color: "secondary", align: "center" }), refreshAfter };

  if (family === "small") {
    return {
      content: Widget.vstack([
        Widget.text("Strongest today", { font: "caption2", color: "secondary" }),
        Widget.text(strongest.mag.toFixed(1), { font: 42, weight: "bold", design: "rounded", color: color(strongest.mag) }),
        Widget.text(short(strongest.place), { font: "caption", lineLimit: 2, align: "center" }),
        Widget.text(`${list.length} of M${floor}+`, { font: "caption2", color: "secondary" }),
      ], { spacing: 2, url: strongest.url }),
      refreshAfter,
    };
  }

  return {
    content: Widget.vstack([
      Widget.hstack([
        Widget.text(`Earthquakes M${floor}+`, { font: "caption", weight: "semibold", color: "secondary" }),
        Widget.spacer(),
        Widget.text(offline ? "offline" : `${list.length} in 24 h`, { font: "caption2", color: offline ? "orange" : "secondary" }),
      ]),
      ...list.slice(0, family === "large" ? 7 : 3).map(row),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    refreshAfter,
  };
});

Script.action("open", ({ url }) => UI.openURL(url));
Script.action("refresh", () => {});

Script.ui(async () => {
  const { list, offline } = await quakes();
  return {
    title: "Earthquakes",
    content: Widget.vstack([
      Widget.text(offline ? "Offline. Showing the last list." : `${list.length} of magnitude 4.5 or more in the last 24 hours`, { font: "footnote", color: offline ? "orange" : "secondary" }),
      ...list.slice(0, 25).map((q) => Widget.button(Widget.hstack([
        Widget.text(q.mag.toFixed(1), { font: "title3", weight: "bold", design: "rounded", color: color(q.mag), frame: { width: 48, alignment: "leading" } }),
        Widget.vstack([
          Widget.text(q.place, { font: "subheadline", color: "primary", align: "leading" }),
          Widget.hstack([
            Widget.date(q.time, { style: "relative", font: "caption", color: "secondary" }),
            q.tsunami ? Widget.text("tsunami information issued", { font: "caption", color: "blue" }) : null,
          ], { spacing: 6 }),
        ], { alignment: "leading", spacing: 2 }),
        Widget.spacer(),
      ], { spacing: 8 }), "open", { url: q.url })),
      Widget.button("Refresh", "refresh", null, { style: "bordered", color: "red" }),
    ], { alignment: "leading", spacing: 12, padding: 16 }),
  };
});

Script.run(async (input) => {
  const { list, floor } = await quakes(input);
  if (list.length === 0) return `No earthquakes of magnitude ${floor} or more in the last 24 hours.`;
  const strongest = [...list].sort((a, b) => b.mag - a.mag)[0];
  return `${list.length} earthquakes of magnitude ${floor}+ in the last 24 hours. Strongest: ${strongest.mag.toFixed(1)}, ${strongest.place}.`;
});
