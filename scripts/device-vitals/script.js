// @name        Device Vitals
// @description Battery with a 24-hour charge history and time left, thermal state, free storage as a donut and uptime, on the Home Screen and Lock Screen; nothing leaves the device and no permissions are needed
// @widget      small, medium, large, circular, rectangular, inline
// @icon        waveform.path.ecg.rectangle.fill
// @color       #10B981
// @version     1.0.0
// @author      scriptwell
// @category    utilities

// How it works
// • Reads the battery, thermal state, free storage and uptime with Device, which needs no permission,
//   and shows them as a dashboard in the mini-app and in every widget size.
// • Every run, background run and widget refresh logs the battery level and whether it was charging.
//   The log stays in the script's own Storage for 48 hours and feeds the chart and the time-left estimate.
// • The estimate comes from the slope of the most recent stretch of samples in the same state, so it
//   needs about 20 minutes of history before it appears.
// • Nothing is sent anywhere: there is no network access and no permission to approve.
// • Tip: add a widget soon after installing; widget refreshes are what build the history quickly.

// ─────────────────────────────────────────── Constants

const HOUR = 3_600_000;
const HISTORY_HOURS = 48;
const MAX_POINTS = 720;
const MIN_GAP_MS = 3 * 60_000;
const WINDOWS = [12, 24, 48];

const locale = Script.env.locale;
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const TILE_BG = { light: "#F1F5F9", dark: "#1E293B" };
const DIM = { light: "#0F172A14", dark: "#FFFFFF1F" };
const CHARGE_HEX = "#22C55E";

const THERMAL = {
  nominal: { label: "Normal", color: "green", hex: "#22C55E", symbol: "thermometer.low", note: "Running cool." },
  fair: { label: "Warm", color: "yellow", hex: "#EAB308", symbol: "thermometer.medium", note: "A little warm. Nothing to worry about." },
  serious: { label: "Hot", color: "orange", hex: "#F97316", symbol: "thermometer.high", note: "iOS may slow things down. Close heavy apps or let the device cool." },
  critical: { label: "Critical", color: "red", hex: "#EF4444", symbol: "flame.fill", note: "The device is throttling hard. Stop charging and let it cool down." },
};
const thermalInfo = (state) => THERMAL[state] ?? { label: state ?? "Unknown", color: "secondary", hex: "#94A3B8", symbol: "thermometer", note: "" };

// ─────────────────────────────────────────── Formatting

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function fmtBytes(bytes) {
  if (bytes == null) return "–";
  const gb = bytes / 1e9;
  return `${gb.toLocaleString(locale, { maximumFractionDigits: gb < 10 ? 1 : 0 })} GB`;
}

function fmtDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days >= 1) return `${days} d ${hours} h`;
  if (hours >= 1) return `${hours} h ${mins} m`;
  return `${mins} m`;
}

function stateLabel(v) {
  if (v.level == null) return "No battery reading";
  if (v.state === "full") return "Fully charged";
  if (v.state === "charging") return "Charging";
  return "On battery";
}

function batteryColor(v) {
  if (v.level == null) return "secondary";
  if (v.state === "charging" || v.state === "full") return "green";
  return v.level <= 20 ? "red" : v.level <= 50 ? "orange" : "green";
}

function batterySymbol(v) {
  if (v.level == null) return "battery.0percent";
  if (v.state === "charging") return "battery.100percent.bolt";
  const step = v.level > 87 ? 100 : v.level > 62 ? 75 : v.level > 37 ? 50 : v.level > 12 ? 25 : 0;
  return `battery.${step}percent`;
}

// ─────────────────────────────────────────── Battery log

const batteryLog = () => Storage.get("battery", []);
const isCharging = (v) => v.state === "charging" || v.state === "full";

function logBattery(v) {
  if (v.level == null) return;
  const log = batteryLog();
  const last = log.at(-1);
  const entry = { t: v.t, l: v.level, c: isCharging(v) };
  if (last && v.t - last.t < MIN_GAP_MS && last.l === entry.l && last.c === entry.c) return;
  const cutoff = v.t - HISTORY_HOURS * HOUR;
  Storage.set("battery", [...log.filter((e) => e.t >= cutoff), entry].slice(-MAX_POINTS));
}

function downsample(values, n) {
  if (values.length <= n) return values;
  return Array.from({ length: n }, (_, i) => values[Math.round((i * (values.length - 1)) / (n - 1))]);
}

function chartPoints(hours, now = Date.now()) {
  const cutoff = now - hours * HOUR;
  const points = batteryLog().filter((e) => e.t >= cutoff);
  return downsample(points, 96).map((e) => ({ x: Number(((e.t - now) / HOUR).toFixed(2)), y: e.l }));
}

// One flag per hour: was the device charging at any point in that hour?
function chargingHours(hours, now = Date.now()) {
  const flags = Array.from({ length: hours }, () => false);
  for (const e of batteryLog()) {
    const idx = hours - 1 - Math.floor((now - e.t) / HOUR);
    if (idx >= 0 && idx < hours && e.c) flags[idx] = true;
  }
  return flags;
}

// Least-squares slope (% per hour) over the most recent stretch in the same charging state.
function estimate(v) {
  if (v.level == null) return null;
  const log = batteryLog();
  const charging = isCharging(v);
  const run = [];
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].c !== charging) break;
    run.unshift(log[i]);
  }
  if (run.length < 3 || run.at(-1).t - run[0].t < 20 * 60_000) return null;
  const n = run.length;
  const mx = run.reduce((s, r) => s + r.t, 0) / n;
  const my = run.reduce((s, r) => s + r.l, 0) / n;
  let num = 0, den = 0;
  for (const r of run) {
    const dx = (r.t - mx) / HOUR;
    num += dx * (r.l - my);
    den += dx * dx;
  }
  if (!den) return null;
  const slope = num / den;
  if (charging) {
    if (v.state === "full" || slope < 0.5) return null;
    return { charging: true, slope, hours: (100 - v.level) / slope };
  }
  if (slope > -0.3) return null;
  return { charging: false, slope, hours: v.level / -slope };
}

function estimateText(v, short = false) {
  const est = estimate(v);
  if (!est) return v.state === "full" ? "Charged" : short ? "Learning…" : "Estimate appears after ~20 min of history";
  const when = fmtDuration(est.hours * 3600);
  return est.charging ? `${when} to full` : `~${when} left`;
}

// ─────────────────────────────────────────── Reading the device

async function readVitals() {
  try {
    const [battery, thermal, disk, uptime] = await Promise.all([
      Device.battery(), Device.thermalState(), Device.disk(), Device.uptime(),
    ]);
    const vitals = {
      level: battery.level == null ? null : Math.round(battery.level * 100),
      state: battery.state,
      lowPower: Boolean(battery.lowPowerMode || Script.env.lowPowerMode),
      thermal,
      free: disk.free,
      total: disk.total,
      uptime,
      t: Date.now(),
    };
    logBattery(vitals);
    Storage.set("vitals", vitals);
    Storage.set("lastError", null);
    return vitals;
  } catch (error) {
    Storage.set("lastError", { message: error.message, time: Date.now() });
    return Storage.get("vitals");
  }
}

function summary(v) {
  if (!v) return "Could not read the device.";
  const parts = [
    v.level == null ? "Battery unknown" : `Battery ${v.level}% (${stateLabel(v).toLowerCase()}, ${estimateText(v)})`,
    `thermal state ${thermalInfo(v.thermal).label.toLowerCase()}`,
    `${fmtBytes(v.free)} free of ${fmtBytes(v.total)}`,
    `up ${fmtDuration(v.uptime)}`,
  ];
  return parts.join(", ") + (v.lowPower ? ", Low Power Mode on" : "") + ".";
}

// ─────────────────────────────────────────── Entry points: run and background

Script.run(async () => summary(await readVitals()));

Script.background(async () => {
  await readVitals();
  Storage.set("lastBackground", Date.now());
});

// ─────────────────────────────────────────── Shared pieces

function ring(v, size) {
  const label = v.level == null ? "–" : `${v.level}%`;
  return Widget.progress((v.level ?? 0) / 100, { style: "ring", color: batteryColor(v), label, frame: { width: size, height: size } });
}

function tile(title, symbol, color, value, sub, { fill = true, big = "title3" } = {}) {
  return Widget.vstack([
    Widget.hstack([
      Widget.symbol(symbol, { size: 11, color, fallback: "•" }),
      Widget.text(title, { font: "caption2", weight: "semibold", color: "secondary", lineLimit: 1 }),
    ], { spacing: 4 }),
    Widget.text(value, { font: big, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
    sub ? Widget.text(sub, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }) : null,
  ], {
    alignment: "leading", spacing: 2, padding: 9,
    background: TILE_BG, cornerRadius: 12,
    frame: fill ? { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } : { maxWidth: "infinity", alignment: "topLeading" },
  });
}

function tileGrid(v, opts) {
  const th = thermalInfo(v.thermal);
  const freeFraction = v.total ? v.free / v.total : 0;
  return Widget.vstack([
    Widget.hstack([
      tile("Battery", batterySymbol(v), batteryColor(v), v.level == null ? "–" : `${v.level}%`, estimateText(v, true), opts),
      tile("Storage", "internaldrive.fill", "blue", fmtBytes(v.free), `${Math.round(freeFraction * 100)}% free of ${fmtBytes(v.total)}`, opts),
    ], { spacing: 6 }),
    Widget.hstack([
      tile("Thermal", th.symbol, th.color, th.label, v.lowPower ? "Low Power Mode" : stateLabel(v), opts),
      tile("Uptime", "clock.arrow.circlepath", "purple", fmtDuration(v.uptime), `${Script.env.device} · ${Script.env.osVersion}`, opts),
    ], { spacing: 6 }),
  ], { spacing: 6 });
}

function chargeStrip(hours, height = 5) {
  return Widget.hstack(chargingHours(hours).map((on) => ({
    type: "stack", direction: "horizontal", children: [],
    background: on ? CHARGE_HEX : DIM, cornerRadius: 2,
    frame: { maxWidth: "infinity", height },
  })), { spacing: 1 });
}

function axisLabels(hours) {
  return Widget.hstack([
    Widget.text(`${hours} h ago`, { font: "caption2", color: "secondary" }),
    Widget.spacer(),
    Widget.text(`${hours / 2} h`, { font: "caption2", color: "secondary" }),
    Widget.spacer(),
    Widget.text("now", { font: "caption2", color: "secondary" }),
  ]);
}

function historyChart(v, hours, height, axes = false) {
  const points = chartPoints(hours);
  if (points.length < 2) {
    return Widget.text("History builds up as the widget refreshes.", {
      font: "caption2", color: "secondary", align: "center",
      frame: { maxWidth: "infinity", height },
    });
  }
  return Widget.vstack([
    Widget.chart(points, { kind: "area", smooth: true, axes, color: batteryColor(v), range: [0, 100], frame: { height } }),
    chargeStrip(hours),
    axisLabels(hours),
  ], { spacing: 3 });
}

function placeholder(family) {
  if (family === "inline") return Widget.text("Device Vitals: open once");
  return Widget.vstack([
    Widget.symbol("waveform.path.ecg.rectangle.fill", { size: 22, color: "green", fallback: "💚" }),
    Widget.text("Open Device Vitals once", { font: "caption", color: "secondary", align: "center" }),
  ], { spacing: 6, url: APP_LINK });
}

// ─────────────────────────────────────────── Widget

Script.widget(async ({ family }) => {
  const v = await readVitals();
  if (!v) return placeholder(family);
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const th = thermalInfo(v.thermal);
  let content;

  switch (family) {
    case "inline":
      content = Widget.text(`${v.level == null ? "–" : `${v.level}%`} · ${fmtBytes(v.free)} free`);
      break;

    case "circular":
      content = Widget.progress((v.level ?? 0) / 100, { style: "ring", label: v.level == null ? "–" : `${v.level}%` });
      break;

    case "rectangular":
      content = Widget.vstack([
        Widget.hstack([
          Widget.symbol(batterySymbol(v), { size: 12, fallback: "🔋" }),
          Widget.text(`${v.level == null ? "–" : `${v.level}%`} · ${stateLabel(v)}`, { font: "headline", lineLimit: 1, minimumScale: 0.7 }),
        ], { spacing: 4 }),
        Widget.progress((v.level ?? 0) / 100),
        Widget.text(`${estimateText(v, true)} · ${fmtBytes(v.free)} free`, { font: "caption", lineLimit: 1, minimumScale: 0.7 }),
      ], { alignment: "leading", spacing: 2 });
      break;

    case "small":
      content = Widget.vstack([
        Widget.hstack([
          ring(v, 62),
          Widget.spacer(),
          Widget.vstack([
            Widget.symbol(v.state === "charging" ? "bolt.fill" : th.symbol, { size: 16, color: v.state === "charging" ? "yellow" : th.color, fallback: "⚡️" }),
            v.lowPower ? Widget.symbol("battery.25percent", { size: 14, color: "yellow", fallback: "🪫" }) : null,
          ], { spacing: 6 }),
        ], { alignment: "top" }),
        Widget.text(estimateText(v, true), { font: "caption", weight: "semibold", lineLimit: 1, minimumScale: 0.7 }),
        Widget.spacer(),
        Widget.divider(),
        Widget.hstack([
          Widget.symbol("internaldrive.fill", { size: 12, color: "blue", fallback: "💾" }),
          Widget.text(`${fmtBytes(v.free)} free`, { font: "caption", weight: "medium", lineLimit: 1, minimumScale: 0.7 }),
        ], { spacing: 4 }),
        Widget.progress(v.total ? 1 - v.free / v.total : 0, { color: "blue" }),
      ], { alignment: "leading", spacing: 4, url: APP_LINK, frame: fill });
      break;

    case "medium":
      content = Widget.vstack([tileGrid(v, { big: "title3" })], { url: APP_LINK, frame: fill });
      break;

    default: // large and extraLarge
      content = Widget.vstack([
        Widget.hstack([
          Widget.text("Device Vitals", { font: "headline" }),
          Widget.spacer(),
          Widget.text("updated", { font: "caption2", color: "secondary" }),
          Widget.date(v.t, { style: "relative", font: "caption2", color: "secondary" }),
        ], { spacing: 3 }),
        tileGrid(v, { fill: false, big: "title2" }),
        Widget.vstack([
          Widget.hstack([
            Widget.text("Battery · 24 h", { font: "caption", weight: "semibold", color: "secondary" }),
            Widget.spacer(),
            Widget.hstack([
              { type: "stack", direction: "horizontal", children: [], background: CHARGE_HEX, cornerRadius: 2, frame: { width: 10, height: 5 } },
              Widget.text("charging", { font: "caption2", color: "secondary" }),
            ], { spacing: 3 }),
          ]),
          historyChart(v, 24, 92),
        ], { alignment: "leading", spacing: 4, padding: 9, background: TILE_BG, cornerRadius: 12, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      ], { alignment: "leading", spacing: 8, url: APP_LINK, frame: fill });
  }

  return { content, refreshAfter: 15 * 60 };
});

// ─────────────────────────────────────────── Mini-app

Script.action("refresh", async () => {
  await readVitals();
  await UI.haptic("light");
});

Script.action("window", ({ value }) => Storage.set("window", value));

Script.action("share", async () => {
  await UI.share(`${Script.env.device} vitals: ${summary(Storage.get("vitals"))}`);
});

Script.action("clear", async () => {
  const choice = await UI.alert({ title: "Clear battery history?", message: "The chart and the time-left estimate start again from now.", buttons: ["Cancel", "Clear"] });
  if (choice === 1) {
    Storage.set("battery", []);
    await UI.haptic("success");
  }
});

function diskDonut(v) {
  const used = Math.max(0, (v.total ?? 0) - (v.free ?? 0));
  return Widget.chart([{ x: "Used", y: used }, { x: "Free", y: v.free ?? 0 }], {
    kind: "donut", axes: false, colors: ["#64748B", "#3B82F6"], frame: { width: 84, height: 84 },
  });
}

function hero(v) {
  const est = estimate(v);
  return Widget.hstack([
    ring(v, 92),
    Widget.vstack([
      Widget.text(stateLabel(v), { font: "title3", weight: "bold" }),
      Widget.text(estimateText(v), { font: "subheadline", color: "secondary", lineLimit: 2 }),
      est ? Widget.text(`${Math.abs(est.slope).toLocaleString(locale, { maximumFractionDigits: 1 })}% per hour`, { font: "caption", color: "secondary" }) : null,
      v.lowPower ? Widget.label("Low Power Mode", "battery.25percent", { color: "yellow" }) : null,
    ], { alignment: "leading", spacing: 3 }),
    Widget.spacer(),
  ], { spacing: 16, alignment: "center" });
}

function infoRows(v) {
  const log = batteryLog();
  const last = Storage.get("lastBackground");
  const err = Storage.get("lastError");
  return [
    { title: "Device", symbol: "iphone", detail: `${Script.env.device} · ${Script.env.platform === "ios" ? "iOS" : Script.env.platform} ${Script.env.osVersion}` },
    { title: "Appearance", symbol: Script.env.appearance === "dark" ? "moon.fill" : "sun.max.fill", detail: Script.env.appearance === "dark" ? "Dark" : "Light" },
    { title: "Locale", symbol: "globe", detail: `${locale} · ${Script.env.timeZone}` },
    { title: "Samples stored", symbol: "chart.xyaxis.line", detail: `${log.length} over ${log.length ? fmtDuration((Date.now() - log[0].t) / 1000) : "0 m"}` },
    { title: "Last background run", symbol: "arrow.triangle.2.circlepath", detail: last ? new Date(last).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "none yet" },
    err ? { title: "Last error", symbol: "exclamationmark.triangle.fill", color: "orange", subtitle: err.message, detail: "" } : null,
  ].filter(Boolean);
}

Script.ui(async () => {
  const v = (await readVitals()) ?? Storage.get("vitals");
  const hours = Storage.get("window", 24);
  const th = thermalInfo(v?.thermal);

  if (!v) {
    return {
      title: "Device Vitals",
      content: Widget.vstack([
        Widget.symbol("waveform.path.ecg.rectangle.fill", { size: 56, color: "green", fallback: "💚" }),
        Widget.text("Could not read the device.", { font: "headline" }),
        Widget.text(Storage.get("lastError")?.message ?? "", { font: "footnote", color: "secondary", align: "center" }),
        Widget.button("Try again", "refresh", null, { style: "prominent" }),
      ], { spacing: 14, padding: 24 }),
    };
  }

  return {
    title: "Device Vitals",
    content: Widget.vstack([
      Widget.card([hero(v)], { title: "Battery", symbol: batterySymbol(v), color: batteryColor(v) }),

      Widget.hstack([
        Widget.card([
          Widget.hstack([
            diskDonut(v),
            Widget.vstack([
              Widget.text(fmtBytes(v.free), { font: "title2", weight: "bold", design: "rounded", color: "blue" }),
              Widget.text(`free of ${fmtBytes(v.total)}`, { font: "caption", color: "secondary" }),
              Widget.text(`${v.total ? Math.round((1 - v.free / v.total) * 100) : 0}% used`, { font: "caption", color: "secondary" }),
            ], { alignment: "leading", spacing: 2 }),
          ], { spacing: 12 }),
        ], { title: "Storage", symbol: "internaldrive.fill", color: "blue" }),
      ]),

      Widget.hstack([
        Widget.card([
          Widget.text(th.label, { font: "title3", weight: "bold", color: th.color }),
          Widget.text(th.note, { font: "caption", color: "secondary", lineLimit: 3 }),
        ], { title: "Thermal", symbol: th.symbol, color: th.color }),
        Widget.card([
          Widget.text(fmtDuration(v.uptime), { font: "title3", weight: "bold" }),
          Widget.text("since last restart", { font: "caption", color: "secondary" }),
        ], { title: "Uptime", symbol: "clock.arrow.circlepath", color: "purple" }),
      ], { spacing: 10, alignment: "top" }),

      Widget.card([
        Widget.picker(WINDOWS.map((h) => ({ label: `${h} h`, value: h })), hours, "window", null, { style: "segmented" }),
        historyChart(v, hours, 180, true),
        Widget.hstack([
          { type: "stack", direction: "horizontal", children: [], background: CHARGE_HEX, cornerRadius: 2, frame: { width: 12, height: 6 } },
          Widget.text("green marks hours with charging", { font: "caption2", color: "secondary" }),
          Widget.spacer(),
          Widget.button("Clear history", "clear", null, { style: "plain", color: "red" }),
        ], { spacing: 4 }),
      ], { title: "Battery history", subtitle: `last ${hours} hours`, symbol: "chart.xyaxis.line", color: "green" }),

      Widget.list(infoRows(v), { title: "About this device" }),

      Widget.hstack([
        Widget.button("Refresh", "refresh", null, { style: "prominent" }),
        Widget.button("Share", "share", null, { style: "bordered" }),
        Widget.spacer(),
        Widget.date(v.t, { style: "relative", font: "caption", color: "secondary" }),
      ], { spacing: 10 }),

      Widget.text("Everything stays on this device. The script has no permissions and no network access.", { font: "caption2", color: "secondary", align: "center" }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});
