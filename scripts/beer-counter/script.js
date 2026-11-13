// @name        Beer Counter
// @description Count your beers, see an estimated blood alcohol level (‰) and reset the session
// @icon        mug.fill
// @color       #F59E0B
// @widget      small, medium, rectangular, circular, inline

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

const BG = { light: "#FFFBEB", dark: "#1C1917" };

function widgetContent(family, time) {
  const list = drinks();
  const count = list.length;
  const bac = bacAt(time, list);
  const color = bacColor(bac);

  if (family === "inline") return Widget.text(`🍺 ${count} · ${fmt(bac)}`);

  if (family === "circular") {
    return Widget.gauge(Math.min(bac, 1.5), {
      min: 0, max: 1.5, style: "circular", valueLabel: String(count), label: "‰",
    });
  }

  if (family === "rectangular") {
    const sober = bac > 0 ? new Date(time + (bac / ELIMINATION) * HOUR) : null;
    return Widget.vstack([
      Widget.text(`🍺 ${count} beer${count === 1 ? "" : "s"}`, { font: "headline" }),
      Widget.text(fmt(bac), { font: "title3", weight: "bold", design: "rounded" }),
      sober
        ? Widget.text(`sober ~${sober.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, { font: "caption" })
        : Widget.text("sober", { font: "caption" }),
    ], { alignment: "leading", spacing: 0 });
  }

  const header = Widget.hstack([
    Widget.symbol("mug.fill", { size: 16, color: "amber-500", fallback: "🍺" }),
    Widget.text("Beer Counter", { font: "caption", weight: "semibold", color: "secondary" }),
    Widget.spacer(),
  ], { spacing: 4 });

  const countText = Widget.text(count, {
    font: family === "small" ? 40 : 48, weight: "bold", design: "rounded",
    transition: "numeric", invalidates: true, color: "amber-500", accentable: true,
  });

  const bacText = Widget.text(fmt(bac), {
    font: "headline", weight: "semibold", design: "rounded", color, monospacedDigit: true, invalidates: true,
  });

  if (family === "small") {
    return Widget.vstack([
      header,
      Widget.hstack([countText, Widget.spacer(), bacText], { alignment: "bottom" }),
      Widget.spacer(),
      Widget.hstack([
        Widget.button("−", "remove", null, { style: "bordered", id: "minus" }),
        Widget.spacer(),
        Widget.button("+ 🍺", "add", null, { style: "prominent", color: "amber-500", id: "plus" }),
      ]),
    ], {
      alignment: "leading", spacing: 4, background: BG,
      frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" },
    });
  }

  // medium (and larger)
  const sober = bac > 0 ? new Date(time + (bac / ELIMINATION) * HOUR) : null;
  return Widget.hstack([
    Widget.vstack([
      header,
      countText,
      bacText,
      Widget.text(sober ? `sober ~${sober.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : `${litres(list)} l total`,
        { font: "caption2", color: "secondary" }),
    ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    Widget.vstack([
      Widget.button("+ 1 Beer", "add", null, { style: "prominent", color: "amber-500", id: "plus", frame: { maxWidth: "infinity" } }),
      Widget.button("− 1", "remove", null, { style: "bordered", id: "minus", frame: { maxWidth: "infinity" } }),
      Widget.button("Reset", "reset", null, { style: "bordered", color: "red", id: "reset", frame: { maxWidth: "infinity" } }),
    ], { spacing: 6, frame: { width: 120 } }),
  ], { spacing: 12, background: BG, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
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
    kind: "area", smooth: true, color: "amber-500",
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

  return {
    title: "🍺 Beer Counter",
    content: Widget.vstack([
      Widget.card([
        Widget.hstack([
          Widget.stat("Beers", list.length, { symbol: "mug.fill", color: "amber-500", detail: `${litres(list)} l` }),
          Widget.spacer(),
          Widget.stat("Promille", fmt(bac), { symbol: "drop.fill", color: bacColor(bac), detail: sober ? "estimated" : "sober" }),
        ], { alignment: "top" }),
        sober
          ? Widget.hstack([
              Widget.text("Sober", { font: "footnote", color: "secondary" }),
              Widget.date(sober, { style: "relative", font: "footnote", weight: "semibold" }),
              Widget.spacer(),
              Widget.date(sober, { style: "time", font: "footnote", color: "secondary" }),
            ], { spacing: 4 })
          : null,
      ], { title: "This session", symbol: "sparkles", color: "amber-500" }),

      Widget.hstack([
        Widget.button("− 1", "remove", null, { style: "bordered", frame: { maxWidth: "infinity" } }),
        Widget.button(`+ 1 Beer (${s.size} ml)`, "add", null, { style: "prominent", color: "amber-500", frame: { maxWidth: "infinity" } }),
      ], { spacing: 10 }),

      promilleChart(),

      list.length
        ? Widget.list(list.slice(-8).reverse().map((d, i) => ({
            title: new Date(d.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            subtitle: `${d.ml} ml · ${d.abv}%`,
            detail: `#${list.length - i}`,
            symbol: "mug",
            color: "amber-500",
          })), { title: "Latest beers" })
        : Widget.text("No beers yet. Cheers! 🍻", { color: "secondary", align: "center" }),

      Widget.card([
        Widget.stepper(`Body weight: ${s.weight} kg`, s.weight, "set", { field: "weight" }, { min: 40, max: 200 }),
        Widget.picker([{ label: "Male", value: "male" }, { label: "Female", value: "female" }], s.sex, "set", { field: "sex" }, { style: "segmented" }),
        Widget.text("Beer size", { font: "caption", color: "secondary" }),
        Widget.picker(SIZES, s.size, "set", { field: "size" }, { style: "menu" }),
        Widget.text(`Alcohol: ${s.abv.toFixed(1)} %`, { font: "caption", color: "secondary" }),
        Widget.slider(s.abv, "set", { field: "abv" }, { min: 0, max: 12, step: 0.1, color: "amber-500" }),
      ], { title: "Settings", symbol: "gearshape.fill", color: "gray" }),

      Widget.button("Reset session", "reset", null, { style: "bordered", color: "red", frame: { maxWidth: "infinity" } }),
      Widget.text("Promille is a rough Widmark estimate. Never use it to decide whether you can drive.", { font: "caption2", color: "secondary", align: "center" }),
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
