// @name        Air Quality
// @description The air quality index where you are, with fine-dust levels and plain advice
// @permissions network, location
// @widget      small, medium, circular, inline
// @icon        aqi.medium
// @color       #65A30D
// @version     1.0.0
// @author      scriptwell
// @category    weather

// Data: https://open-meteo.com air quality API (free, no key), for your
// location rounded to about a kilometre. The index is the US AQI. General
// guidance only; follow local health advice.

const LEVELS = [
  [50, "Good", "#16A34A", "A good day to be outside."],
  [100, "Moderate", "#CA8A04", "Fine for most people."],
  [150, "Unhealthy for sensitive groups", "#EA580C", "Take it easier outdoors if you are sensitive to pollution."],
  [200, "Unhealthy", "#DC2626", "Consider shorter or lighter activity outdoors."],
  [300, "Very unhealthy", "#9333EA", "Best to keep outdoor activity short."],
  [Infinity, "Hazardous", "#7F1D1D", "Stay indoors if you can."],
];
const level = (aqi) => { const [, name, color, advice] = LEVELS.find(([max]) => aqi <= max); return { name, color, advice }; };

async function air() {
  const saved = Storage.get("air");
  try {
    const { latitude, longitude } = await Location.current({ accuracy: "kilometer" });
    const query = new URLSearchParams({ latitude: latitude.toFixed(2), longitude: longitude.toFixed(2), current: "us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide" });
    const response = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${query}`, { timeout: 8000 });
    if (!response.ok) throw new Error(`Open-Meteo answered ${response.status}`);
    const { current } = await response.json();
    const fresh = { aqi: Math.round(current.us_aqi), pm25: current.pm2_5, pm10: current.pm10, ozone: current.ozone, no2: current.nitrogen_dioxide, time: Date.now() };
    Storage.set("air", fresh);
    return fresh;
  } catch (error) {
    if (saved && saved.time > Date.now() - 6 * 3600000) return { ...saved, offline: true }; // old readings would mislead
    throw error;
  }
}

Script.widget(async ({ family }) => {
  const a = await air();
  const l = level(a.aqi);
  const refreshAfter = 30 * 60;

  if (family === "inline") return { content: Widget.text(`AQI ${a.aqi} · ${l.name}`), refreshAfter };
  if (family === "circular") return { content: Widget.progress(Math.min(1, a.aqi / 300), { style: "ring", label: String(a.aqi) }), refreshAfter };

  const main = Widget.vstack([
    Widget.text("AIR QUALITY", { font: "caption2", weight: "heavy", color: "secondary" }),
    Widget.text(String(a.aqi), { font: 46, weight: "bold", design: "rounded", color: l.color }),
    Widget.text(l.name, { font: "caption", weight: "semibold", color: l.color, lineLimit: 2, align: "center", minimumScale: 0.8 }),
    a.offline ? Widget.text("offline", { font: "caption2", color: "orange" }) : null,
  ], { spacing: 2 });

  return {
    content: family === "small" ? main : Widget.hstack([
      main,
      Widget.vstack([
        Widget.text(l.advice, { font: "caption", lineLimit: 3 }),
        Widget.text(`PM2.5  ${a.pm25.toFixed(0)} µg/m³`, { font: "caption2", color: "secondary" }),
        Widget.text(`PM10  ${a.pm10.toFixed(0)} µg/m³`, { font: "caption2", color: "secondary" }),
      ], { alignment: "leading", spacing: 5 }),
    ], { spacing: 18 }),
    refreshAfter,
  };
});

Script.action("refresh", () => {});

Script.ui(async () => {
  const a = await air();
  const l = level(a.aqi);
  const row = (name, value) => Widget.hstack([Widget.text(name, { color: "secondary" }), Widget.spacer(), Widget.text(`${value.toFixed(0)} µg/m³`, { design: "rounded" })]);
  return {
    title: "Air Quality",
    content: Widget.vstack([
      Widget.progress(Math.min(1, a.aqi / 300), { style: "ring", color: l.color, label: String(a.aqi), frame: { width: 150, height: 150 } }),
      Widget.text(l.name, { font: "title2", weight: "bold", color: l.color, align: "center" }),
      Widget.text(l.advice, { color: "secondary", align: "center" }),
      Widget.vstack([
        row("Fine particles (PM2.5)", a.pm25),
        row("Coarse particles (PM10)", a.pm10),
        row("Ozone", a.ozone),
        row("Nitrogen dioxide", a.no2),
      ], { spacing: 10, padding: 14, background: { light: "#FFFFFF", dark: "#1C1C1E" }, cornerRadius: 12 }),
      Widget.hstack([Widget.text(a.offline ? "Offline. Measured" : "Updated", { font: "caption", color: "secondary" }), Widget.date(a.time, { style: "relative", font: "caption", color: "secondary" })], { spacing: 4 }),
      Widget.button("Update", "refresh", null, { style: "bordered" }),
    ], { spacing: 14, padding: 20 }),
  };
});

Script.run(async () => {
  const a = await air();
  const l = level(a.aqi);
  return `Air quality index ${a.aqi}: ${l.name}. ${l.advice}`;
});
