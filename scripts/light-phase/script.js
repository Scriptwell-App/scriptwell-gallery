// @name        Light Phase
// @description Golden hour, blue hour and twilight for photographers, worked out for where you are
// @icon        sun.horizon.fill
// @color       #F59E0B
// @permissions location
// @widget      small, medium, large, circular, rectangular, inline
// @version     1.0.0
// @author      va4w
// @category    photo-video

// ─── Sun position (NOAA-style approximation, accurate to a fraction of a degree) ───

function sunElevation(date, latitude, longitude) {
  const rad = Math.PI / 180;
  const n = date.getTime() / 86_400_000 + 2440587.5 - 2451545.0;
  const L = 280.46 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmstHours = 18.697374558 + 24.06570982441908 * n;
  const hourAngle = (gmstHours * 15 + longitude) * rad - ra;
  const el = Math.asin(
    Math.sin(latitude * rad) * Math.sin(dec) +
    Math.cos(latitude * rad) * Math.cos(dec) * Math.cos(hourAngle),
  );
  return el / rad;
}

// ─── Light phases ───

const PHASES = {
  night:    { order: 0, name: "Night",                 short: "Night",    symbol: "moon.stars.fill",   emoji: "🌌", colors: ["#0B1026", "#1E1B4B"], tip: "Dark sky. Time for stars." },
  astro:    { order: 1, name: "Astronomical twilight", short: "Astro",    symbol: "sparkles",          emoji: "✨", colors: ["#111827", "#312E81"], tip: "Faint glow, stars appear." },
  nautical: { order: 2, name: "Nautical twilight",     short: "Nautical", symbol: "moon.haze.fill",    emoji: "🌘", colors: ["#1E3A8A", "#3730A3"], tip: "Horizon still visible, deep blues." },
  blue:     { order: 3, name: "Blue hour",             short: "Blue",     symbol: "camera.aperture",   emoji: "🔵", colors: ["#1D4ED8", "#6366F1"], tip: "Even blue sky, city lights glow." },
  golden:   { order: 4, name: "Golden hour",           short: "Golden",   symbol: "sun.horizon.fill",  emoji: "🌅", colors: ["#F59E0B", "#EA580C"], tip: "Warm, soft light, long shadows." },
  day:      { order: 5, name: "Daylight",              short: "Day",      symbol: "sun.max.fill",      emoji: "☀️", colors: ["#38BDF8", "#2563EB"], tip: "Hard light. Look for shade." },
};

function phaseFor(elevation) {
  if (elevation > 6) return "day";
  if (elevation > -4) return "golden";
  if (elevation > -8) return "blue";
  if (elevation > -12) return "nautical";
  if (elevation > -18) return "astro";
  return "night";
}

// Minute-by-minute scan of the next 24 hours for phase changes.
function transitions(start, place) {
  const out = [];
  let prev = phaseFor(sunElevation(start, place.latitude, place.longitude));
  for (let m = 1; m <= 1440; m++) {
    const time = new Date(start.getTime() + m * 60_000);
    const phase = phaseFor(sunElevation(time, place.latitude, place.longitude));
    if (phase !== prev) {
      out.push({ time, from: prev, to: phase, rising: PHASES[phase].order > PHASES[prev].order });
      prev = phase;
    }
  }
  return out;
}

const clock = (date) => new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// ─── Location ───

async function getPlace(parameter) {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(parameter ?? "");
  if (match) return { latitude: Number(match[1]), longitude: Number(match[2]) };
  try {
    const here = await Location.current({ accuracy: "kilometer" });
    const place = { latitude: here.latitude, longitude: here.longitude };
    Storage.set("place", place);
    return place;
  } catch (error) {
    return Storage.get("place");
  }
}

// ─── Widget content for one moment ───

function state(time, place, all) {
  const elevation = sunElevation(time, place.latitude, place.longitude);
  const key = phaseFor(elevation);
  const rising = sunElevation(new Date(time.getTime() + 10 * 60_000), place.latitude, place.longitude) > elevation;
  const when = key === "day" || key === "night" ? null : rising ? "Morning" : "Evening";
  const upcoming = all.filter((t) => t.time > time);
  return { key, phase: PHASES[key], when, next: upcoming[0] ?? null, upcoming };
}

function background(phase) {
  return Widget.gradient(phase.colors, { direction: "topLeadingToBottomTrailing" });
}

function headline(s, big) {
  return Widget.vstack([
    Widget.hstack([
      Widget.symbol(s.phase.symbol, { size: big ? 22 : 18, color: "white", fallback: s.phase.emoji }),
      s.when ? Widget.text(s.when.toUpperCase(), { font: "caption2", weight: "bold", color: "#FFFFFFB3", tracking: 1 }) : null,
    ], { spacing: 6 }),
    big
      ? Widget.text(s.phase.name, { font: "title2", weight: "bold", color: "white", lineLimit: 2, minimumScale: 0.7 })
      : Widget.text(s.phase.name, { font: "headline", weight: "bold", color: "white", lineLimit: 3, fixedSize: "vertical", layoutPriority: 1, frame: { maxWidth: "infinity", alignment: "leading" } }),
  ], { alignment: "leading", spacing: 4 });
}

function nextLine(s, wrap = false) {
  if (!s.next) return Widget.text("No change in the next 24 h", { font: "caption", color: "#FFFFFFCC" });
  return Widget.vstack([
    wrap
      ? Widget.text(`${PHASES[s.next.to].name}`, { font: "caption", weight: "semibold", color: "white", lineLimit: 3, fixedSize: "vertical", layoutPriority: 1, frame: { maxWidth: "infinity", alignment: "leading" } })
      : Widget.text(`${PHASES[s.next.to].name}`, { font: "caption", weight: "semibold", color: "white", lineLimit: 1 }),
    Widget.hstack([
      Widget.date(s.next.time, { style: "relative", font: "caption2", color: "#FFFFFFCC" }),
      Widget.text(`· ${clock(s.next.time)}`, { font: "caption2", color: "#FFFFFFCC" }),
    ], { spacing: 3 }),
  ], { alignment: "leading", spacing: 1 });
}

function upcomingList(s, count) {
  return Widget.vstack([
    Widget.text("COMING UP", { font: "caption2", weight: "bold", color: "#FFFFFFB3", tracking: 1 }),
    ...s.upcoming.slice(0, count).map((t) => Widget.hstack([
      Widget.symbol(t.rising ? "arrow.up.right" : "arrow.down.right", { size: 10, color: "#FFFFFFB3", fallback: t.rising ? "↑" : "↓" }),
      Widget.text(PHASES[t.to].short, { font: "caption", color: "white", lineLimit: 1 }),
      Widget.spacer(),
      Widget.text(clock(t.time), { font: "caption", weight: "semibold", color: "white", monospacedDigit: true }),
    ], { spacing: 4 })),
  ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", alignment: "topLeading" } });
}

function render(family, time, place, all) {
  const s = state(time, place, all);

  if (family === "inline") {
    return Widget.text(s.next ? `${s.phase.short} · ${PHASES[s.next.to].short} at ${clock(s.next.time)}` : s.phase.name);
  }

  if (family === "circular") {
    return Widget.vstack([
      Widget.symbol(s.phase.symbol, { size: 18, fallback: s.phase.emoji }),
      s.next ? Widget.text(clock(s.next.time), { font: "caption2", weight: "semibold", minimumScale: 0.6, lineLimit: 1 }) : null,
    ], { spacing: 2 });
  }

  if (family === "rectangular") {
    return Widget.vstack([
      Widget.label(s.phase.name, s.phase.symbol, { spacing: 4 }),
      s.next
        ? Widget.text(`${PHASES[s.next.to].name} at ${clock(s.next.time)}`, { font: "caption", lineLimit: 1 })
        : Widget.text(s.phase.tip, { font: "caption", lineLimit: 1 }),
      s.upcoming[1] ? Widget.text(`${PHASES[s.upcoming[1].to].name} at ${clock(s.upcoming[1].time)}`, { font: "caption2", color: "secondary", lineLimit: 1 }) : null,
    ], { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", alignment: "leading" } });
  }

  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };

  if (family === "small") {
    return Widget.vstack([
      headline(s, false),
      Widget.spacer(),
      nextLine(s, true),
    ], { alignment: "leading", spacing: 4, padding: 2, frame: fill, background: background(s.phase) });
  }

  const left = Widget.vstack([
    headline(s, true),
    Widget.text(s.phase.tip, { font: "caption", color: "#FFFFFFCC", lineLimit: 2 }),
    Widget.spacer(),
    nextLine(s),
  ], { alignment: "leading", spacing: 4, frame: fill });

  if (family === "medium") {
    return Widget.hstack([left, upcomingList(s, 4)], { spacing: 14, padding: 2, frame: fill, background: background(s.phase) });
  }

  // large and extraLarge: add the sun's path over the next 24 hours
  const curve = Array.from({ length: 25 }, (_, h) => {
    const t = new Date(time.getTime() + h * 3_600_000);
    return { x: `${String(t.getHours()).padStart(2, "0")}${h === 0 ? "•" : ""}`, y: Math.round(sunElevation(t, place.latitude, place.longitude)) };
  });

  return Widget.vstack([
    Widget.hstack([left, upcomingList(s, 6)], { spacing: 14, alignment: "top" }),
    Widget.text("SUN OVER THE NEXT 24 H", { font: "caption2", weight: "bold", color: "#FFFFFFB3", tracking: 1 }),
    Widget.chart(curve, {
      kind: "area", smooth: true, axes: false, color: "#FFFFFF99",
      rule: { value: 0, color: "white", label: "Horizon" },
      frame: { height: 110 },
    }),
  ], { alignment: "leading", spacing: 10, padding: 2, frame: fill, background: background(s.phase) });
}

// ─── Entry points ───

Script.widget(async ({ family, parameter }) => {
  const place = await getPlace(parameter);
  if (!place) {
    return Widget.vstack([
      Widget.symbol("location.slash", { size: 22, color: "orange", fallback: "📍" }),
      Widget.text("Open Light Phase in Scriptwell once to find your location.", { font: "caption", color: "secondary", align: "center" }),
    ], { spacing: 6 });
  }

  const now = new Date();
  const all = transitions(now, place);

  // One timeline entry now and one at every phase change, so the widget switches on time by itself.
  const timeline = [{ date: now, content: render(family, now, place, all) }];
  for (const t of all.slice(0, 16)) {
    timeline.push({ date: t.time, content: render(family, t.time, place, all) });
  }

  return { timeline, refreshAt: new Date(now.getTime() + 3 * 3_600_000) };
});

Script.run(async (input) => {
  const place = await getPlace(input);
  if (!place) return "Could not find your location. Allow location access, or pass \"latitude,longitude\" as input.";

  const now = new Date();
  const all = transitions(now, place);
  const s = state(now, place, all);
  const elevation = sunElevation(now, place.latitude, place.longitude);

  const lines = [
    `${s.when ? `${s.when} ` : ""}${s.phase.name.toLowerCase()} now (sun at ${elevation.toFixed(1)}°). ${s.phase.tip}`,
    ...all.slice(0, 6).map((t) => `${clock(t.time)}  ${PHASES[t.to].name}${t.rising ? " ↑" : " ↓"}`),
  ];
  return lines.join("\n");
});
