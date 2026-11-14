// @name        Beer Counter
// @description Count your beers, see an estimated blood alcohol level (‰) and reset the session
// @icon        mug.fill
// @color       #F59E0B
// @widget      small, medium, rectangular, circular, inline
// @version     1.0.1
// @author      va4w
// @category    utilities

// ───────────────────────── Settings and data

const DEFAULTS = { weight: 80, sex: "male", size: 500, abv: 5.0 };
const settings = () => ({ ...DEFAULTS, ...Storage.get("settings", {}) });
const saveSettings = (changes) => Storage.set("settings", { ...settings(), ...changes });

const drinks = () => Storage.get("drinks", []);
const saveDrinks = (list) => Storage.set("drinks", list);

const ELIMINATION = 0.15; // ‰ per hour
const HOUR = 3_600_000;
const SIZES = [
  { label: "0.25 l", value: 250 },
  { label: "0.33 l", value: 330 },
  { label: "0.4 l", value: 400 },
  { label: "0.5 l", value: 500 },
  { label: "Pint", value: 568 },
  { label: "1 l", value: 1000 },
];

// ───────────────────────── Promille (Widmark estimate)

function gramsOf(drink) {
  return drink.ml * (drink.abv / 100) * 0.789;
}

function bacAt(time, list = drinks(), s = settings()) {
  const r = s.sex === "female" ? 0.55 : 0.68;
  const sorted = list.filter((d) => d.t <= time).sort((a, b) => a.t - b.t);
  let bac = 0;
  let last = null;
  for (const d of sorted) {
    if (last !== null) bac = Math.max(0, bac - ELIMINATION * (d.t - last) / HOUR);
    bac += gramsOf(d) / (s.weight * r);
    last = d.t;
  }
  if (last !== null) bac = Math.max(0, bac - ELIMINATION * (time - last) / HOUR);
  return bac;
}

function soberAt(now = Date.now()) {
  const bac = bacAt(now);
  return bac > 0 ? new Date(now + (bac / ELIMINATION) * HOUR) : null;
}

const fmt = (bac) => `${bac.toFixed(2)} ‰`;
const bacColor = (bac) => (bac < 0.3 ? "green" : bac < 0.5 ? "yellow" : bac < 1.0 ? "orange" : "red");
const litres = (list = drinks()) => (list.reduce((sum, d) => sum + d.ml, 0) / 1000).toFixed(2);

// ───────────────────────── Actions

Script.action("add", () => {
  const s = settings();
  saveDrinks([...drinks(), { t: Date.now(), ml: s.size, abv: s.abv }]);
});

Script.action("remove", () => {
  saveDrinks(drinks().slice(0, -1));
});

Script.action("reset", async () => {
  if (Script.env.mode === "app") {
    try {
      const choice = await UI.alert({ title: "Reset the counter?", message: "All beers of this session are removed.", buttons: ["Cancel", "Reset"] });
      if (choice !== 1) return;
    } catch {
      // No dialog available: reset straight away.
    }
  }
  saveDrinks([]);
});

Script.action("set", ({ field, value }) => {
  if (field === "abv") value = Math.round(Number(value) * 10) / 10;
  if (field === "weight") value = Math.round(Number(value));
  saveSettings({ [field]: value });
});

// ───────────────────────── Widget

const BG = { light: "#F5F5F4", dark: "#1C1917" };
const btnLabel = (text, symbol) => Widget.hstack([
  Widget.symbol(symbol, { size: 10, weight: "semibold" }),
  Widget.text(text, { font: "caption", weight: "semibold" }),
], { spacing: 3 });
const AMBER = { light: "#D97706", dark: "#FBBF24" };
const GAUGE_MAX = 1.5;
const GAUGE_COLORS = ["green", "yellow", "orange", "red"];
const clock = (date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const plural = (n) => (n === 1 ? "beer" : "beers");
const pillColor = (bac) => (bac < 0.3 ? "emerald-500" : bac < 0.5 ? "amber-500" : bac < 1.0 ? "orange-500" : "red-500");

function bacPill(bac, font = "subheadline") {
  return Widget.text(fmt(bac), {
    font, weight: "bold", design: "rounded", color: "white", monospacedDigit: true, invalidates: true,
    padding: { horizontal: 10, vertical: 3 }, background: pillColor(bac), clip: "capsule",
  });
}

function soberLine(sober, list) {
  return Widget.hstack([
    Widget.symbol(sober ? "moon.zzz.fill" : "checkmark.seal.fill", { size: 11, color: sober ? "indigo" : "green", fallback: sober ? "💤" : "✓" }),
    Widget.text(sober ? `sober ~${clock(sober)}` : `sober · ${litres(list)} l total`, { font: "caption2", color: "secondary", lineLimit: 1 }),
  ], { spacing: 4 });
}

function widgetContent(family, time) {
  const list = drinks();
  const count = list.length;
  const bac = bacAt(time, list);
  const sober = bac > 0 ? new Date(time + (bac / ELIMINATION) * HOUR) : null;

  if (family === "inline") return Widget.text(`🍺 ${count} · ${fmt(bac)}`);

  if (family === "circular") {
    return Widget.gauge(Math.min(bac, GAUGE_MAX), {
      min: 0, max: GAUGE_MAX, style: "circular", valueLabel: String(count), label: "‰", colors: GAUGE_COLORS,
    });
  }

  if (family === "rectangular") {
    return Widget.hstack([
      Widget.gauge(Math.min(bac, GAUGE_MAX), { min: 0, max: GAUGE_MAX, style: "circularCapacity", valueLabel: String(count) }),
      Widget.vstack([
        Widget.text(fmt(bac), { font: "headline", weight: "bold", design: "rounded", monospacedDigit: true }),
        Widget.text(`${count} ${plural(count)}`, { font: "caption" }),
        Widget.text(sober ? `sober ~${clock(sober)}` : "sober", { font: "caption2", opacity: 0.8 }),
      ], { alignment: "leading", spacing: 0 }),
      Widget.spacer(),
    ], { spacing: 8 });
  }

  const header = Widget.hstack([
    Widget.symbol("mug.fill", { size: 12, color: AMBER, fallback: "🍺", accentable: true }),
    Widget.text("BEER COUNTER", { font: "caption2", weight: "bold", color: "secondary", tracking: 0.8 }),
    Widget.spacer(),
  ], { spacing: 4 });

  const countBlock = Widget.hstack([
    Widget.text(count, {
      font: family === "small" ? 38 : 30, weight: "heavy", design: "rounded",
      transition: "numeric", invalidates: true, color: AMBER, accentable: true,
    }),
    Widget.text(plural(count), { font: "caption", weight: "medium", color: "secondary", padding: { bottom: family === "small" ? 7 : 4 } }),
  ], { alignment: "bottom", spacing: 4 });

  if (family === "small") {
    return Widget.vstack([
      header,
      countBlock,
      bacPill(bac, "caption"),
      Widget.spacer(), 
      Widget.hstack([
        Widget.button(Widget.symbol("minus", { size: 10, weight: "bold", fallback: "−" }), "remove", null, { style: "bordered", color: "amber-500", id: "minus" }),
        Widget.button(btnLabel("Beer", "plus"), "add", null, { style: "prominent", color: "amber-500", id: "plus" }),
      ], { spacing: 6 }),
    ], {
      alignment: "leading", spacing: 4,
      frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" },
    });
  }

  // medium (and larger): header with pill, count and sober info side by side,
  // a full-width gauge, and a full-width row of buttons along the bottom.
  const mediumHeader = Widget.hstack([
    Widget.symbol("mug.fill", { size: 12, color: AMBER, fallback: "🍺", accentable: true }),
    Widget.text("BEER COUNTER", { font: "caption2", weight: "bold", color: "secondary", tracking: 0.8 }),
    Widget.spacer(),
    bacPill(bac, "caption"),
  ], { spacing: 4 });

  const infoRow = Widget.hstack([
    countBlock,
    Widget.spacer(),
    Widget.vstack([
      soberLine(sober, list),
      Widget.text(`${litres(list)} l this session`, { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { alignment: "trailing", spacing: 1, padding: { bottom: 4 } }),
  ], { alignment: "bottom", spacing: 8 });

  return Widget.vstack([
    mediumHeader,
    infoRow,
    Widget.gauge(Math.min(bac, GAUGE_MAX), { min: 0, max: GAUGE_MAX, style: "linearCapacity", colors: GAUGE_COLORS }),
    Widget.spacer(0),
    Widget.hstack([
      Widget.button(btnLabel("Undo", "arrow.uturn.backward"), "remove", null, { style: "bordered", color: "amber-500", id: "minus", frame: { maxWidth: "infinity" } }),
      Widget.button(btnLabel("Beer", "plus"), "add", null, { style: "prominent", color: "amber-500", id: "plus", frame: { maxWidth: "infinity" }, layoutPriority: 1 }),
      Widget.button(btnLabel("Reset", "arrow.counterclockwise"), "reset", null, { style: "bordered", color: "red", id: "reset", frame: { maxWidth: "infinity" } }),
    ], { spacing: 6 }),
  ], { alignment: "leading", spacing: 3, padding: { horizontal: 14, vertical: 0 }, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
}

Script.widget(({ family }) => {
  const now = Date.now();
  const bac = bacAt(now);
  // Promille drops over time: plan entries every 15 minutes until sober (max 6 hours).
  const steps = bac > 0 ? Math.min(24, Math.ceil((bac / ELIMINATION) * 4) + 1) : 0;
  const timeline = [{ date: new Date(now), content: widgetContent(family, now) }];
  for (let i = 1; i <= steps; i++) {
    const t = now + i * 15 * 60_000;
    timeline.push({ date: new Date(t), content: widgetContent(family, t) });
  }
  return { timeline, refreshAfter: 60 * 60 };
});

// ───────────────────────── Mini-app

function promilleChart() {
  const list = drinks();
  if (list.length === 0) return null;
  const start = Math.min(...list.map((d) => d.t));
  const sober = soberAt();
  const end = Math.max(Date.now(), sober ? sober.getTime() : Date.now());
  const stepMs = Math.max(5 * 60_000, Math.ceil((end - start) / 120));
  const points = [];
  for (let t = start; t <= end + stepMs; t += stepMs) {
    points.push({ x: (t - start) / HOUR, y: Math.round(bacAt(t, list) * 100) / 100 });
  }
  return Widget.chart(points, {
    kind: "area", smooth: true, color: "amber-500", lineWidth: 3,
    rule: { value: 0.5, color: "red", label: "0.5 ‰" },
    xTitle: "hours since first beer", yTitle: "‰",
    frame: { height: 180 },
  });
}

Script.ui(() => {
  const s = settings();
  const list = drinks();
  const now = Date.now();
  const bac = bacAt(now, list, s);
  const sober = soberAt(now);
  const chart = promilleChart();

  const hero = Widget.vstack([
    Widget.hstack([
      Widget.vstack([
        Widget.text("This session", { font: "caption", weight: "semibold", color: "secondary", transform: "uppercase", tracking: 1 }),
        Widget.text(list.length, { font: 72, weight: "heavy", design: "rounded", color: AMBER, transition: "numeric" }),
        Widget.text(`${plural(list.length)} · ${litres(list)} l`, { font: "subheadline", color: "secondary" }),
      ], { alignment: "leading", spacing: 0 }),
      Widget.spacer(),
      Widget.vstack([
        Widget.gauge(Math.min(bac, GAUGE_MAX), {
          min: 0, max: GAUGE_MAX, style: "circularCapacity", valueLabel: bac.toFixed(2), colors: GAUGE_COLORS,
          scale: 1.5, padding: 18,
        }),
        bacPill(bac, "caption"),
      ], { spacing: 2 }),
    ], { alignment: "center" }),
    Widget.hstack(sober ? [
      Widget.symbol("moon.zzz.fill", { size: 14, color: "indigo", fallback: "💤" }),
      Widget.text("Sober", { font: "footnote", color: "secondary" }),
      Widget.date(sober, { style: "relative", font: "footnote", weight: "semibold" }),
      Widget.spacer(),
      Widget.date(sober, { style: "time", font: "footnote", color: "secondary" }),
    ] : [
      Widget.symbol("checkmark.seal.fill", { size: 14, color: "green", fallback: "✓" }),
      Widget.text("You're sober", { font: "footnote", weight: "semibold" }),
      Widget.spacer(),
    ], { spacing: 6, padding: { horizontal: 12, vertical: 10 }, background: "thinMaterial", cornerRadius: 12 }),
  ], { spacing: 14, padding: 18, background: BG, cornerRadius: 20 });

  return {
    title: "🍺 Beer Counter",
    content: Widget.vstack([
      hero,

      Widget.hstack([
        Widget.button(btnLabel("Undo", "arrow.uturn.backward"), "remove", null, { style: "bordered", color: "amber-500" }),
        Widget.button(btnLabel(`Beer · ${s.size} ml`, "plus"), "add", null, { style: "prominent", color: "amber-500" }),
      ], { spacing: 10 }),

      chart ? Widget.card([chart], { title: "Promille curve", symbol: "chart.xyaxis.line", color: "amber-500" }) : null,

      list.length
        ? Widget.list(list.slice(-8).reverse().map((d, i) => ({
            title: new Date(d.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            subtitle: `${d.ml} ml · ${d.abv}%`,
            detail: `#${list.length - i}`,
            symbol: "mug.fill",
            color: "amber-500",
          })), { title: "Latest beers" })
        : Widget.vstack([
            Widget.text("🍻", { font: 44 }),
            Widget.text("No beers yet. Cheers!", { font: "headline" }),
            Widget.text("Tap “Beer” to log your first one.", { font: "footnote", color: "secondary" }),
          ], { spacing: 4, padding: 20, frame: { maxWidth: "infinity" } }),

      Widget.card([
        Widget.stepper(`Body weight: ${s.weight} kg`, s.weight, "set", { field: "weight" }, { min: 40, max: 200 }),
        Widget.picker([{ label: "Male", value: "male" }, { label: "Female", value: "female" }], s.sex, "set", { field: "sex" }, { style: "segmented" }),
        Widget.divider(),
        Widget.hstack([
          Widget.label("Beer size", "ruler", { color: "secondary" }),
          Widget.spacer(),
          Widget.picker(SIZES, s.size, "set", { field: "size" }, { style: "menu" }),
        ]),
        Widget.hstack([
          Widget.label("Alcohol", "percent", { color: "secondary" }),
          Widget.spacer(),
          Widget.text(`${s.abv.toFixed(1)} %`, { font: "subheadline", weight: "semibold", design: "rounded", monospacedDigit: true }),
        ]),
        Widget.slider(s.abv, "set", { field: "abv" }, { min: 0, max: 12, step: 0.1, color: "amber-500" }),
      ], { title: "Settings", symbol: "gearshape.fill", color: "gray" }),

      Widget.button(btnLabel("Reset session", "arrow.counterclockwise"), "reset", null, { style: "plain", color: "red" }),
      Widget.hstack([
        Widget.symbol("exclamationmark.triangle.fill", { size: 12, color: "orange", fallback: "⚠️" }),
        Widget.text("Promille is a rough Widmark estimate. Never use it to decide whether you can drive.", { font: "caption2", color: "secondary" }),
      ], { spacing: 6, alignment: "top", padding: { horizontal: 4 } }),
    ], { spacing: 16, padding: 16 }),
  };
});

// ───────────────────────── Shortcuts / Siri

Script.run((input) => {
  const command = (input ?? "").trim().toLowerCase();
  if (command === "add" || command === "+1") {
    const s = settings();
    saveDrinks([...drinks(), { t: Date.now(), ml: s.size, abv: s.abv }]);
  } else if (command === "reset") {
    saveDrinks([]);
  }
  const count = drinks().length;
  const sober = soberAt();
  return `${count} beer${count === 1 ? "" : "s"}, about ${fmt(bacAt(Date.now()))}` +
    (sober ? `, sober around ${sober.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : ".");
});
