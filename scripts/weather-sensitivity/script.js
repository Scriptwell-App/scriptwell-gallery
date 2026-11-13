// @name        Weather Sensitivity
// @description Small widget for weather-sensitive people: pressure trend, temperature swings, humidity and an overall strain level
// @icon        barometer
// @color       #F59E0B
// @permissions location
// @widget      small
// @version     1.0.1
// @author      va4w
// @category    utilities

// Widget Parameter: "F" or "C" to force a temperature unit.

const STALE_MS = 25 * 60 * 1000;

// ───────── helpers

const useFahrenheit = (parameter) => {
  const p = (parameter ?? "").trim().toUpperCase();
  if (p === "F") return true;
  if (p === "C") return false;
  return /-US$/i.test(Script.env.locale);
};

const fmtTemp = (c, f) => `${Math.round(f ? c * 9 / 5 + 32 : c)}°`;
const fmtDelta = (c, f) => {
  if (c === null || c === undefined) return "–";
  const v = Math.round(f ? c * 9 / 5 : c);
  return `${v > 0 ? "+" : ""}${v}°`;
};

function nearest(hours, target, field) {
  let best = null;
  let bestDiff = Infinity;
  for (const h of hours) {
    const value = h[field];
    if (value === null || value === undefined) continue;
    const diff = Math.abs(new Date(h.date).getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; best = value; }
  }
  // Only trust a reading within 90 minutes of what we asked for.
  return bestDiff <= 90 * 60 * 1000 ? best : null;
}

function level(score) {
  if (score <= 2) return { name: "Low", family: "emerald", color: "green" };
  if (score <= 4) return { name: "Moderate", family: "amber", color: "yellow" };
  if (score <= 6) return { name: "High", family: "orange", color: "orange" };
  return { name: "Very high", family: "red", color: "red" };
}

// ───────── analysis

function analyse(current, hours, now) {
  const H = 3600 * 1000;
  const pNow = current.pressure ?? nearest(hours, now, "pressure");
  const pPast = nearest(hours, now - 3 * H, "pressure");
  const pNext = nearest(hours, now + 3 * H, "pressure");
  const dp6 = pNow === null ? null : (pNext ?? pNow) - (pPast ?? pNow);

  const tYesterday = nearest(hours, now - 24 * H, "temperature");
  const dT = tYesterday === null ? null : current.temperature - tYesterday;

  const humidity = current.humidity;
  const wind = current.windSpeed ?? 0;
  const condition = (current.condition ?? "").toLowerCase();

  const factors = [];
  if (dp6 !== null) {
    const a = Math.abs(dp6);
    const pts = a >= 6 ? 4 : a >= 4 ? 3 : a >= 2.5 ? 2 : a >= 1.5 ? 1 : 0;
    if (pts) factors.push({ pts, text: dp6 < 0 ? "Pressure falling" : "Pressure rising" });
  }
  if (pNow !== null && pNow < 1000) factors.push({ pts: 1, text: "Low pressure" });
  if (dT !== null) {
    const a = Math.abs(dT);
    const pts = a >= 10 ? 3 : a >= 7 ? 2 : a >= 4 ? 1 : 0;
    if (pts) factors.push({ pts, text: dT < 0 ? "Sharp cool-down" : "Sharp warm-up" });
  }
  if (humidity !== null && humidity >= 0.75 && current.temperature >= 24) factors.push({ pts: 1, text: "Muggy air" });
  else if (humidity !== null && humidity >= 0.9) factors.push({ pts: 1, text: "Very damp air" });
  if (wind >= 40) factors.push({ pts: 1, text: "Gusty wind" });
  if (condition.includes("thunder")) factors.push({ pts: 1, text: "Thunderstorms" });

  factors.sort((a, b) => b.pts - a.pts);
  const score = Math.min(10, factors.reduce((s, f) => s + f.pts, 0));

  const series = hours
    .filter((h) => h.pressure !== null && h.pressure !== undefined)
    .map((h) => h.pressure);

  return {
    temperature: current.temperature,
    symbol: current.symbol,
    description: current.description,
    pressure: pNow,
    dp6,
    dT,
    humidity,
    score,
    mainFactor: factors[0]?.text ?? "Stable conditions",
    factors: factors.map((f) => f.text),
    series,
  };
}

// ───────── data loading

async function refresh() {
  let place = Storage.get("place");
  try {
    const here = await Location.current({ accuracy: "kilometer" });
    place = { latitude: here.latitude, longitude: here.longitude };
    Storage.set("place", place);
  } catch (error) {
    if (!place) throw error;
  }

  const now = Date.now();
  const [current, hours, credit] = await Promise.all([
    Weather.current(place),
    Weather.hourly(place, { start: new Date(now - 24 * 3600 * 1000), end: new Date(now + 7 * 3600 * 1000) }),
    Weather.attribution(),
  ]);

  const saved = { ...analyse(current, hours, now), credit, time: now };
  Storage.set("data", saved);
  return saved;
}

async function load() {
  const saved = Storage.get("data");
  if (saved && Date.now() - saved.time < STALE_MS) return saved;
  try {
    return await refresh();
  } catch (error) {
    Storage.set("lastError", `${new Date().toISOString()} ${error.name}: ${error.message}`);
    return saved; // may be null
  }
}

// ───────── JSON for Shortcuts

const round1 = (n) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);

function toJSON(d, f) {
  const lv = level(d.score);
  const toUnit = (c) => (c === null || c === undefined ? null : round1(f ? c * 9 / 5 + 32 : c));
  const deltaUnit = (c) => (c === null || c === undefined ? null : round1(f ? c * 9 / 5 : c));
  return {
    strain: {
      level: lv.name,
      score: d.score,
      maxScore: 10,
      mainFactor: d.mainFactor,
      factors: d.factors ?? [],
    },
    weather: {
      description: d.description,
      symbol: d.symbol,
      temperature: toUnit(d.temperature),
      temperatureUnit: f ? "F" : "C",
      temperatureChangeVsYesterday: deltaUnit(d.dT),
      humidity: d.humidity === null || d.humidity === undefined ? null : Math.round(d.humidity * 100),
      humidityUnit: "%",
    },
    pressure: {
      current: round1(d.pressure),
      changeOver6Hours: round1(d.dp6),
      trend: d.dp6 === null ? null : d.dp6 <= -1 ? "falling" : d.dp6 >= 1 ? "rising" : "steady",
      unit: "hPa",
      series: (d.series ?? []).map(round1),
    },
    updated: new Date(d.time).toISOString(),
    attribution: d.credit ? { text: d.credit.text, url: d.credit.url } : null,
  };
}

// ───────── entry points

Script.background(async () => {
  try { await refresh(); } catch (error) {
    Storage.set("lastError", `${new Date().toISOString()} ${error.name}: ${error.message}`);
  }
});

Script.run(async (input, context) => {
  if (context?.mode === "shortcut") {
    let d;
    try {
      d = await refresh();
    } catch (error) {
      Storage.set("lastError", `${new Date().toISOString()} ${error.name}: ${error.message}`);
      d = Storage.get("data");
      if (!d) return { error: `${error.name}: ${error.message}` };
    }
    return toJSON(d, useFahrenheit(input));
  }

  const d = await refresh();
  const f = useFahrenheit(null);
  const lv = level(d.score);
  return [
    `Strain: ${lv.name} (${d.score}/10) – ${d.mainFactor}`,
    `${fmtTemp(d.temperature, f)}, ${d.description}`,
    d.pressure !== null ? `Pressure ${Math.round(d.pressure)} hPa, ${d.dp6 >= 0 ? "+" : ""}${(d.dp6 ?? 0).toFixed(1)} hPa over 6 h` : "Pressure unknown",
    `Temperature vs. yesterday: ${fmtDelta(d.dT, f)}`,
    d.humidity !== null ? `Humidity ${Math.round(d.humidity * 100)}%` : "",
    d.credit?.text ?? "",
  ].filter(Boolean).join("\n");
});

Script.widget(async ({ parameter }) => {
  const d = await load();
  if (!d) {
    return Widget.vstack([
      Widget.symbol("barometer", { size: 26, color: "orange", fallback: "🌡" }),
      Widget.text("Open Scriptwell and run this script once", { font: "caption", color: "secondary", align: "center" }),
    ], { spacing: 6, padding: 8 });
  }

  const f = useFahrenheit(parameter);
  const lv = level(d.score);
  const dp = d.dp6 ?? 0;
  const trendSymbol = dp <= -1 ? "arrow.down.right" : dp >= 1 ? "arrow.up.right" : "arrow.right";

  const indicator = (symbol, text, fallback) => Widget.hstack([
    Widget.symbol(symbol, { size: 9, color: "secondary", fallback }),
    Widget.text(text, { font: 10, weight: "semibold", monospacedDigit: true, lineLimit: 1, minimumScale: 0.7 }),
  ], { spacing: 2 });

  const header = Widget.hstack([
    Widget.vstack([
      Widget.hstack([
        Widget.symbol(d.symbol || "cloud.sun.fill", { size: 16, rendering: "multicolor", fallback: "🌤" }),
        Widget.text(fmtTemp(d.temperature, f), { font: 22, weight: "bold", design: "rounded", transition: "numeric" }),
      ], { spacing: 4 }),
      Widget.text(lv.name, { font: 12, weight: "bold", color: `${lv.family}-500`, lineLimit: 1, accentable: true }),
      Widget.text(d.mainFactor, { font: 10, color: "secondary", lineLimit: 1, minimumScale: 0.8 }),
    ], { alignment: "leading", spacing: 1 }),
    Widget.spacer(),
    Widget.gauge(d.score, {
      min: 0, max: 10, style: "circularCapacity",
      valueLabel: String(d.score),
      colors: ["green", "yellow", "orange", "red"],
      scale: 0.8,
    }),
  ], { alignment: "top", spacing: 4 });

  const sparkline = d.series && d.series.length > 1
    ? Widget.chart(d.series, { kind: "line", axes: false, smooth: true, color: `${lv.family}-500`, lineWidth: 1.5, frame: { height: 18 } })
    : null;

  const indicators = Widget.hstack([
    indicator(trendSymbol, d.dp6 === null ? "–" : `${dp > 0 ? "+" : ""}${dp.toFixed(1)}`, "↗"),
    Widget.spacer(),
    indicator("thermometer.medium", fmtDelta(d.dT, f), "🌡"),
    Widget.spacer(),
    indicator("humidity.fill", d.humidity === null ? "–" : `${Math.round(d.humidity * 100)}%`, "💧"),
  ]);

  const footer = Widget.hstack([
    Widget.text(d.credit?.text ?? "Apple Weather", { font: 8, color: "secondary", lineLimit: 1, url: d.credit?.url }),
    Widget.spacer(),
    Widget.date(d.time, { style: "relative", font: 8, color: "secondary" }),
  ]);

  return {
    content: Widget.vstack([header, sparkline, indicators, Widget.spacer(0), footer], {
      alignment: "leading",
      spacing: 4,
      frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" },
      background: { light: `${lv.family}-50`, dark: "#1C1C1E" },
    }),
    refreshAfter: 30 * 60,
  };
});
