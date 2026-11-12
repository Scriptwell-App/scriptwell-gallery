// @name        Weather
// @description Current conditions and today's range for where you are
// @permissions network, location
// @widget      small, medium, circular, rectangular, inline
// @icon        cloud.sun.fill
// @color       #3B82F6
// @version     1.0.0
// @author      va4w
// @category    weather

// Weather data: https://open-meteo.com (free, no API key).

const CONDITIONS = {
  0: ["Clear", "sun.max.fill", "☀️"], 1: ["Mostly clear", "sun.max.fill", "🌤"], 2: ["Partly cloudy", "cloud.sun.fill", "⛅️"],
  3: ["Cloudy", "cloud.fill", "☁️"], 45: ["Fog", "cloud.fog.fill", "🌫"], 48: ["Fog", "cloud.fog.fill", "🌫"],
  51: ["Drizzle", "cloud.drizzle.fill", "🌦"], 53: ["Drizzle", "cloud.drizzle.fill", "🌦"], 55: ["Drizzle", "cloud.drizzle.fill", "🌦"],
  61: ["Rain", "cloud.rain.fill", "🌧"], 63: ["Rain", "cloud.rain.fill", "🌧"], 65: ["Heavy rain", "cloud.heavyrain.fill", "🌧"],
  71: ["Snow", "cloud.snow.fill", "🌨"], 73: ["Snow", "cloud.snow.fill", "🌨"], 75: ["Heavy snow", "cloud.snow.fill", "❄️"],
  80: ["Showers", "cloud.sun.rain.fill", "🌦"], 81: ["Showers", "cloud.sun.rain.fill", "🌦"], 82: ["Showers", "cloud.heavyrain.fill", "🌧"],
  95: ["Thunderstorm", "cloud.bolt.rain.fill", "⛈"], 96: ["Thunderstorm", "cloud.bolt.rain.fill", "⛈"], 99: ["Thunderstorm", "cloud.bolt.rain.fill", "⛈"],
};

async function loadWeather() {
  const here = await Location.current({ accuracy: "kilometer" });
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", here.latitude.toFixed(3));
  url.searchParams.set("longitude", here.longitude.toFixed(3));
  url.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");
  url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Weather service returned ${response.status}`);
  const data = await response.json();
  const [label, symbol, emoji] = CONDITIONS[data.current.weather_code] ?? ["Unknown", "questionmark.circle", "❔"];
  return {
    temperature: Math.round(data.current.temperature_2m),
    high: Math.round(data.daily.temperature_2m_max[0]),
    low: Math.round(data.daily.temperature_2m_min[0]),
    wind: Math.round(data.current.wind_speed_10m),
    unit: data.current_units.temperature_2m,
    label, symbol, emoji,
    updated: new Date().toISOString(),
  };
}

// Use the last good reading when the network or location is unavailable.
async function weather() {
  try {
    const fresh = await loadWeather();
    Storage.set("last", fresh);
    return fresh;
  } catch (error) {
    const last = Storage.get("last");
    if (last) return last;
    throw error;
  }
}

Script.widget(async ({ family }) => {
  const w = await weather();
  const sky = { type: "gradient", colors: ["#3B82F6", "#1D4ED8"], direction: "topToBottom" };
  const refreshAfter = 30 * 60;

  if (family === "inline") {
    return { content: Widget.text(`${w.temperature}° ${w.label}`), refreshAfter };
  }
  if (family === "circular") {
    return {
      content: Widget.vstack([Widget.symbol(w.symbol, { size: 16, fallback: w.emoji }), Widget.text(`${w.temperature}°`, { font: "headline" })], { spacing: 1 }),
      refreshAfter,
    };
  }
  if (family === "rectangular") {
    return {
      content: Widget.hstack([
        Widget.symbol(w.symbol, { size: 24, fallback: w.emoji }),
        Widget.vstack([
          Widget.text(`${w.temperature}° ${w.label}`, { font: "headline" }),
          Widget.text(`H ${w.high}°  L ${w.low}°`, { font: "caption", color: "secondary" }),
        ], { alignment: "leading", spacing: 1 }),
        Widget.spacer(),
      ], { spacing: 8 }),
      refreshAfter,
    };
  }

  const summary = Widget.vstack([
    Widget.hstack([Widget.symbol(w.symbol, { size: 26, color: "white", fallback: w.emoji }), Widget.spacer()]),
    Widget.spacer(),
    Widget.text(`${w.temperature}°`, { font: 44, weight: "semibold", design: "rounded", color: "white" }),
    Widget.text(w.label, { font: "subheadline", weight: "medium", color: "white" }),
    Widget.text(`H ${w.high}°  L ${w.low}°`, { font: "caption", color: "#FFFFFFCC" }),
  ], { alignment: "leading", spacing: 2 });

  if (family === "small") {
    return { content: Widget.vstack([summary], { alignment: "leading", background: sky, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" } }), refreshAfter };
  }

  const details = Widget.vstack([
    Widget.text("Wind", { font: "caption", color: "#FFFFFFCC" }),
    Widget.text(`${w.wind} km/h`, { font: "headline", color: "white" }),
    Widget.spacer(),
    Widget.text("Updated", { font: "caption", color: "#FFFFFFCC" }),
    Widget.date(w.updated, { style: "time", font: "headline", color: "white" }),
  ], { alignment: "trailing", spacing: 2 });

  return {
    content: Widget.hstack([summary, Widget.spacer(), details], { background: sky, frame: { maxWidth: "infinity", maxHeight: "infinity" } }),
    refreshAfter,
  };
});

// Running the script in the app (or from Shortcuts) returns a one-line report.
Script.run(async () => {
  const w = await weather();
  return `${w.temperature}${w.unit} and ${w.label.toLowerCase()}. High ${w.high}°, low ${w.low}°.`;
});
