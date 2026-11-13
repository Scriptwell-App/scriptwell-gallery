// @name        Airthings Wave Plus
// @description Reads radon, CO₂, VOC, humidity, temperature and pressure from an Airthings Wave Plus over Bluetooth, keeps a history and shows it with sparklines
// @permissions bluetooth
// @widget      small, medium, large, rectangular, inline
// @icon        aqi.medium
// @color       #0EA5E9
// @version     1.0.0
// @author      va4w
// @category    utilities

// How it works
// • Bluetooth is not available inside a widget, so readings are taken when you tap "Read now"
//   in the mini-app, when the script runs (▶, Shortcuts, Siri), and in background runs.
// • iOS only gives background runs a few times a day. For a denser history, add a Shortcuts
//   automation (for example every hour) that runs this script with "Run Script".
// • Widget parameter: the metric to feature, one of "radon", "co2", "voc", "humidity", "temp"
//   or "pressure" (radon if empty). Add "pci" to show radon in pCi/L instead of Bq/m³,
//   for example "co2" or "radon pci".
// • When connecting, the script checks the characteristics the device actually has. Devices
//   without the Wave Plus sensor characteristic (another Airthings model, or something else
//   named "Wave") are skipped and remembered, and the next candidate is tried.
// • Every reading works against a time budget (30 s in the app, 20 s from Shortcuts, 15 s in
//   the background), so a slow connection stops cleanly instead of hitting the time limit.

// ─────────────────────────────────────────── Constants

const SENSOR_CHAR = "b42e2a68-ade7-11e4-89d3-123b93f75cba"; // Wave Plus current values
const OTHER_MODELS = {
  "b42e4dcc-ade7-11e4-89d3-16a7eb1d4b8e": "Airthings Wave (2nd gen)",
  "b42e3b98-ade7-11e4-89d3-16a7eb1d4b8e": "Airthings Wave Mini",
};
const DAY = 86_400_000;
const HISTORY_DAYS = 14;
const SPARK_DAYS = 7;
const MAX_HISTORY = 500;

// Time limits per run, in milliseconds, with a safety margin taken off below.
const TIME_LIMITS = { app: 30_000, pwa: 30_000, shortcut: 20_000, background: 15_000, widget: 8_000 };
const TIME_MARGIN = 4_000;

const RATING_COLORS = ["green", "orange", "red"];
const RATING_HEX = ["#22C55E", "#F59E0B", "#EF4444"];
const RATING_LABELS = ["Good", "Fair", "Poor"];
const NEUTRAL_HEX = "#3B82F6";
const MISSING_HEX = "#94A3B8";

const METRICS = [
  { key: "radonST", label: "Radon", unit: "Bq/m³", symbol: "atom", fallback: "☢️",
    rate: (v) => (v < 100 ? 0 : v < 150 ? 1 : 2) },
  { key: "co2", label: "CO₂", unit: "ppm", symbol: "carbon.dioxide.cloud.fill", fallback: "🫧",
    rate: (v) => (v < 800 ? 0 : v < 1000 ? 1 : 2) },
  { key: "voc", label: "VOC", unit: "ppb", symbol: "aqi.medium", fallback: "🌫",
    rate: (v) => (v < 250 ? 0 : v < 2000 ? 1 : 2) },
  { key: "humidity", label: "Humidity", unit: "%", symbol: "humidity.fill", fallback: "💧",
    rate: (v) => (v >= 30 && v < 60 ? 0 : v >= 25 && v < 70 ? 1 : 2) },
  { key: "temp", label: "Temp", unit: "°C", symbol: "thermometer.medium", fallback: "🌡",
    rate: (v) => (v >= 18 && v <= 25 ? 0 : v >= 16 && v <= 27 ? 1 : 2) },
  { key: "pressure", label: "Pressure", unit: "hPa", symbol: "gauge.medium", fallback: "⏲",
    rate: () => null },
];
const metric = (key) => METRICS.find((m) => m.key === key);

// Order used when picking companion metrics for small widgets.
const COMPANION_ORDER = ["radonST", "co2", "temp", "humidity", "voc", "pressure"];

// ─────────────────────────────────────────── Storage helpers

// Earlier versions looked for the wrong sensor characteristic and skipped real Wave Plus
// devices. Clear that skip list once so they are tried again.
if (Storage.get("ignoredVersion") !== 2) {
  Storage.remove("ignored");
  Storage.set("ignoredVersion", 2);
}

const history = () => Storage.get("history", []);
const latest = () => history().at(-1) ?? null;

function addReading(reading) {
  const cutoff = Date.now() - HISTORY_DAYS * DAY;
  const list = [...history(), reading].filter((r) => r.t >= cutoff).slice(-MAX_HISTORY);
  Storage.set("history", list);
}

function downsample(values, n) {
  if (values.length <= n) return values;
  return Array.from({ length: n }, (_, i) => values[Math.round((i * (values.length - 1)) / (n - 1))]);
}

function series(key, points = 60) {
  const cutoff = Date.now() - SPARK_DAYS * DAY;
  const values = history().filter((r) => r.t >= cutoff && r[key] != null).map((r) => r[key]);
  return downsample(values, points);
}

// ─────────────────────────────────────────── Formatting

function usePci(parameter) {
  return /pci/i.test(parameter ?? "") || Storage.get("unitPci", false);
}

// Which metric the widget features, from its Parameter. Radon by default.
function primaryKey(parameter) {
  const words = String(parameter ?? "").toLowerCase().replace(/₂/g, "2").split(/[^a-z0-9]+/).filter(Boolean);
  for (const w of words) {
    if (w.startsWith("rad") || w === "rn") return "radonST";
    if (w.startsWith("co2") || w === "co" || w.startsWith("carbon")) return "co2";
    if (w.startsWith("voc")) return "voc";
    if (w.startsWith("hum") || w === "rh") return "humidity";
    if (w.startsWith("temp")) return "temp";
    if (w.startsWith("press") || w === "hpa") return "pressure";
  }
  return "radonST";
}

function display(key, value, pci = false) {
  if (value == null) return "–";
  switch (key) {
    case "radonST":
    case "radonLT":
      return pci ? (value / 37).toFixed(1) : String(Math.round(value));
    case "temp":
      return value.toFixed(1);
    case "humidity":
      return String(Math.round(value));
    default:
      return String(Math.round(value));
  }
}

function unitFor(key, pci = false) {
  if (key === "radonST" || key === "radonLT") return pci ? "pCi/L" : "Bq/m³";
  return metric(key).unit;
}

function ratingOf(key, value) {
  if (value == null) return null;
  return metric(key)?.rate(value) ?? null;
}

function colorFor(key, value) {
  if (value == null) return "secondary";
  const r = ratingOf(key, value);
  return r == null ? "blue" : RATING_COLORS[r];
}

function hexFor(key, value) {
  if (value == null) return MISSING_HEX;
  const r = ratingOf(key, value);
  return r == null ? NEUTRAL_HEX : RATING_HEX[r];
}

// Short text with a label, for inline widgets and companion values.
function compact(key, r, pci) {
  const v = display(key, r[key], pci);
  switch (key) {
    case "radonST": return `Rn ${v}`;
    case "co2": return `CO₂ ${v}`;
    case "voc": return `VOC ${v}`;
    case "temp": return `${v}°`;
    case "humidity": return `${v}%`;
    default: return `${v} hPa`;
  }
}

// ─────────────────────────────────────────── Time budget

function makeBudget() {
  const limit = TIME_LIMITS[Script.env.mode] ?? 20_000;
  const end = Date.now() + limit - TIME_MARGIN;
  return { left: () => end - Date.now() };
}

function timeoutError(message) {
  const error = new Error(message);
  error.timedOut = true;
  return error;
}

function withTimeout(promise, ms, message) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(message)), Math.max(0, ms));
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

// ─────────────────────────────────────────── Bluetooth

function bytesFromBase64(b64) {
  try {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

// Airthings advertises manufacturer data with company id 0x0334 followed by the serial number.
function airthingsSerial(device) {
  if (!device.manufacturerData) return null;
  const bytes = bytesFromBase64(device.manufacturerData);
  if (bytes.length < 6 || bytes[0] !== 0x34 || bytes[1] !== 0x03) return null;
  return String(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(2, true));
}

const sameUuid = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const ignoredIds = () => Storage.get("ignored", []);

function ignoreDevice(id) {
  Storage.set("ignored", [...new Set([...ignoredIds(), id])].slice(-20));
  if (Storage.get("device")?.id === id) Storage.remove("device");
}

// Devices worth trying, best first: the saved sensor, then Wave Plus serials (2930…) or names, then other Airthings.
async function findCandidates(budget) {
  const { state } = await Bluetooth.state();
  if (state !== "poweredOn") throw new Error(`Bluetooth is ${state}`);

  const saved = Storage.get("device");
  const ignored = ignoredIds();
  // Leave at least ~8 s after the scan for connecting and reading.
  const spare = Math.floor((budget.left() - 8_000) / 1000);
  const duration = Math.max(2, Math.min(saved ? 4 : 6, spare));
  const devices = await Bluetooth.scan({ duration });

  const list = [];
  if (saved && devices.some((d) => d.id === saved.id)) list.push(saved);

  const isPlus = (c) => c.serial?.startsWith("2930") || /wave\s*(\+|plus)/i.test(c.name);
  const rank = (c) => (isPlus(c) ? 0 : c.serial ? 1 : 2);
  const others = devices
    .filter((d) => d.id !== saved?.id && !ignored.includes(d.id))
    .map((d) => ({ id: d.id, name: d.name ?? "Wave Plus", serial: airthingsSerial(d) }))
    .filter((c) => c.serial !== null || /airthings|wave/i.test(c.name))
    .sort((a, b) => rank(a) - rank(b));
  list.push(...others);

  if (list.length === 0) {
    throw new Error("No Airthings Wave Plus found nearby. Move closer and make sure no other app is connected to it.");
  }
  return list.slice(0, Script.env.mode === "background" ? 2 : 3);
}

function decode(bytes) {
  if (bytes.length < 16) throw new Error(`Unexpected sensor data (${bytes.length} bytes)`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = v.getUint8(0);
  if (version !== 1) throw new Error(`Unsupported sensor data version ${version}`);
  const radon = (x) => (x > 16383 ? null : x); // not yet available after power-up
  return {
    t: Date.now(),
    humidity: v.getUint8(1) / 2,
    radonST: radon(v.getUint16(4, true)),
    radonLT: radon(v.getUint16(6, true)),
    temp: v.getUint16(8, true) / 100,
    pressure: v.getUint16(10, true) / 50,
    co2: v.getUint16(12, true),
    voc: v.getUint16(14, true),
  };
}

async function readOnce(device, budget) {
  if (budget.left() < 5_000) throw timeoutError("Ran out of time before connecting");
  const info = await withTimeout(
    Bluetooth.connect(device.id),
    Math.min(budget.left() - 2_000, 12_000),
    `Connecting to ${device.name} took too long`,
  );
  try {
    const uuids = (info.characteristics ?? []).map((c) => c.uuid);
    const sensor = uuids.find((u) => sameUuid(u, SENSOR_CHAR));
    if (!sensor) {
      console.log(`${device.name} (${device.id}) characteristics:\n${uuids.join("\n")}`);
      if (uuids.length === 0) throw new Error(`${device.name} did not list its characteristics`);
      const model = Object.entries(OTHER_MODELS).find(([uuid]) => uuids.some((u) => sameUuid(u, uuid)))?.[1];
      const error = new Error(model
        ? `${device.name} is an ${model}, not a Wave Plus`
        : `${device.name} has no Wave Plus sensor data`);
      error.wrongDevice = true;
      throw error;
    }
    const bytes = await withTimeout(
      Bluetooth.read(device.id, sensor),
      Math.min(budget.left() - 1_000, 6_000),
      `Reading from ${device.name} took too long`,
    );
    return decode(bytes);
  } finally {
    try { await withTimeout(Bluetooth.disconnect(device.id), 1_500, "disconnect"); } catch {}
  }
}

async function readWithRetry(device, budget) {
  try {
    return await readOnce(device, budget);
  } catch (first) {
    // No point retrying a wrong device, and no retry when time is short.
    if (first.wrongDevice || Script.env.mode === "background" || budget.left() < 9_000) throw first;
    return await readOnce(device, budget); // one retry: the sensor sometimes drops the first connection
  }
}

async function refresh() {
  const budget = makeBudget();
  try {
    const candidates = await findCandidates(budget);
    const wrong = [];
    let otherError = null;

    for (const device of candidates) {
      if (budget.left() < 5_000) {
        otherError ??= timeoutError("Ran out of time before the Wave Plus answered. Move closer and try again.");
        break;
      }
      try {
        const reading = await readWithRetry(device, budget);
        Storage.set("device", device);
        addReading(reading);
        Storage.set("lastError", null);
        return reading;
      } catch (error) {
        if (error.wrongDevice) {
          ignoreDevice(device.id);
          wrong.push(error.message);
        } else {
          otherError ??= error;
        }
      }
    }

    if (otherError) throw otherError;
    if (wrong.length) throw new Error(`${wrong.join("; ")}. No Wave Plus found nearby; move closer and try again.`);
    throw new Error("No Wave Plus answered. Move closer and try again.");
  } catch (error) {
    Storage.set("lastError", { message: error.message ?? String(error), time: Date.now() });
    throw error;
  }
}

function summary(r, pci = false) {
  return [
    `Radon ${display("radonST", r.radonST, pci)} ${unitFor("radonST", pci)} (long-term ${display("radonLT", r.radonLT, pci)})`,
    `CO₂ ${display("co2", r.co2)} ppm`,
    `VOC ${display("voc", r.voc)} ppb`,
    `Humidity ${display("humidity", r.humidity)} %`,
    `Temperature ${display("temp", r.temp)} °C`,
    `Pressure ${display("pressure", r.pressure)} hPa`,
  ].join("\n");
}

// ─────────────────────────────────────────── Entry points: run and background

Script.run(async () => {
  try {
    const r = await refresh();
    return summary(r, usePci(null));
  } catch (error) {
    return `Could not read the Wave Plus: ${error.message}`;
  }
});

Script.background(async () => {
  try { await refresh(); } catch { /* stored in lastError */ }
});

// ─────────────────────────────────────────── Widget pieces

const TILE_BG = { light: "#F1F5F9", dark: "#1E293B" };
const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

function sparkline(key, color, { height = 22, width, kind = "line" } = {}) {
  const values = series(key);
  if (values.length < 2) {
    return Widget.text("history builds up", {
      font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7,
      frame: width ? { width, alignment: "trailing" } : undefined,
    });
  }
  return Widget.chart(values, { kind, axes: false, smooth: true, color, frame: width ? { width, height } : { height } });
}

function badge(key, value) {
  const rating = ratingOf(key, value);
  if (rating == null) return null;
  return Widget.text(RATING_LABELS[rating], {
    font: "caption2", weight: "bold", color: RATING_COLORS[rating], lineLimit: 1,
    padding: { horizontal: 6, vertical: 2 },
    background: { light: `${RATING_HEX[rating]}26`, dark: `${RATING_HEX[rating]}40` },
    cornerRadius: 6,
  });
}

function tint(key, value) {
  const hex = hexFor(key, value);
  return { light: `${hex}1A`, dark: `${hex}33` };
}

// A warning sign when the most recent attempt to read failed.
function warning(r) {
  const error = Storage.get("lastError");
  return error && error.time > r.t
    ? Widget.symbol("exclamationmark.triangle.fill", { size: 10, color: "orange", fallback: "⚠️" })
    : null;
}

function rangeText(key, pci) {
  const values = series(key);
  return values.length >= 2
    ? `7 days ${display(key, Math.min(...values), pci)}–${display(key, Math.max(...values), pci)}`
    : null;
}

function companions(primary, count) {
  return COMPANION_ORDER.filter((k) => k !== primary).slice(0, count);
}

function others(primary) {
  return METRICS.map((m) => m.key).filter((k) => k !== primary);
}

function overallRating(r) {
  const ratings = METRICS.map((m) => ratingOf(m.key, r[m.key])).filter((x) => x != null);
  return ratings.length ? Math.max(...ratings) : null;
}

function heroValue(key, r, pci, size) {
  const color = colorFor(key, r[key]);
  return Widget.hstack([
    Widget.text(display(key, r[key], pci), { font: size, weight: "bold", design: "rounded", color, lineLimit: 1, minimumScale: 0.5 }),
    Widget.text(unitFor(key, pci), { font: "caption", weight: "medium", color: "secondary", lineLimit: 1, minimumScale: 0.6 }),
  ], { spacing: 3, alignment: "bottom" });
}

function heroHeader(key, r, size = 12) {
  const m = metric(key);
  const color = colorFor(key, r[key]);
  return Widget.hstack([
    Widget.symbol(m.symbol, { size, color, fallback: m.fallback }),
    Widget.text(m.label, { font: "caption", weight: "semibold", color: "secondary", lineLimit: 1 }),
    Widget.spacer(),
    warning(r),
    badge(key, r[key]),
  ], { spacing: 4 });
}

function compactRow(key, r, pci) {
  const m = metric(key);
  const color = colorFor(key, r[key]);
  return Widget.hstack([
    Widget.symbol(m.symbol, { size: 11, color, fallback: m.fallback, frame: { width: 16 } }),
    Widget.text(m.label, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
    Widget.spacer(),
    Widget.text(display(key, r[key], pci), { font: "caption", weight: "semibold", design: "rounded", color, lineLimit: 1 }),
    Widget.text(unitFor(key, pci), { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.6 }),
  ], { spacing: 3 });
}

function largeRow(key, r, pci) {
  const m = metric(key);
  const color = colorFor(key, r[key]);
  return Widget.hstack([
    Widget.symbol(m.symbol, { size: 13, color, fallback: m.fallback, frame: { width: 20 } }),
    Widget.text(m.label, { font: "subheadline", weight: "medium", lineLimit: 1, minimumScale: 0.7 }),
    Widget.spacer(),
    sparkline(key, color, { height: 18, width: 72 }),
    Widget.hstack([
      Widget.text(display(key, r[key], pci), { font: "subheadline", weight: "bold", design: "rounded", color, lineLimit: 1 }),
      Widget.text(unitFor(key, pci), { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.6 }),
    ], { spacing: 2, alignment: "bottom", frame: { width: 86, alignment: "trailing" } }),
  ], {
    spacing: 6, padding: { horizontal: 8, vertical: 4 },
    background: TILE_BG, cornerRadius: 9,
  });
}

function emptyWidget(family) {
  const error = Storage.get("lastError");
  if (family === "inline") return Widget.text("Wave Plus: no reading yet");
  return Widget.vstack([
    Widget.symbol("aqi.medium", { size: 24, color: "blue", fallback: "🌫" }),
    Widget.text(error ? error.message : "Open Airthings Wave Plus and tap Read now", { font: "caption", color: "secondary", align: "center", lineLimit: 4, minimumScale: 0.7 }),
  ], { spacing: 6, url: appLink });
}

// ─────────────────────────────────────────── Widget

Script.widget(({ family, parameter }) => {
  const r = latest();
  if (!r) return emptyWidget(family);
  const pci = usePci(parameter);
  const key = primaryKey(parameter);
  const m = metric(key);
  const color = colorFor(key, r[key]);
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  let content;

  switch (family) {
    case "inline":
      content = Widget.text(`${m.label} ${display(key, r[key], pci)} ${unitFor(key, pci)} · ${companions(key, 2).map((k) => compact(k, r, pci)).join(" · ")}`);
      break;

    case "rectangular": {
      const [second] = companions(key, 1);
      content = Widget.vstack([
        Widget.hstack([
          Widget.symbol(m.symbol, { size: 12, fallback: m.fallback }),
          Widget.text(`${m.label} ${display(key, r[key], pci)}`, { font: "headline", lineLimit: 1, minimumScale: 0.7 }),
          Widget.text(unitFor(key, pci), { font: "caption2", lineLimit: 1 }),
          Widget.spacer(),
          Widget.text(compact(second, r, pci), { font: "caption", lineLimit: 1 }),
        ], { spacing: 3, alignment: "bottom" }),
        sparkline(key, "primary", { height: 22 }),
      ], { alignment: "leading", spacing: 2 });
      break;
    }

    case "small":
      content = Widget.vstack([
        heroHeader(key, r),
        heroValue(key, r, pci, 36),
        sparkline(key, color, { height: 32, kind: "area" }),
        Widget.spacer(),
        Widget.hstack(companions(key, 2).flatMap((k, i) => {
          const cm = metric(k);
          const item = Widget.hstack([
            Widget.symbol(cm.symbol, { size: 10, color: colorFor(k, r[k]), fallback: cm.fallback }),
            Widget.text(compact(k, r, pci), { font: "caption2", weight: "semibold", lineLimit: 1, minimumScale: 0.7 }),
          ], { spacing: 3 });
          return i === 0 ? [item, Widget.spacer()] : [item];
        })),
      ], { alignment: "leading", spacing: 3, url: appLink, frame: fill });
      break;

    case "medium":
      content = Widget.hstack([
        Widget.vstack([
          heroHeader(key, r),
          heroValue(key, r, pci, 34),
          Widget.spacer(),
          sparkline(key, color, { height: 38, kind: "area" }),
        ], {
          alignment: "leading", spacing: 3, padding: 10,
          background: tint(key, r[key]), cornerRadius: 14,
          frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" },
        }),
        Widget.vstack(others(key).map((k) => compactRow(k, r, pci)), {
          alignment: "leading", spacing: 5,
          frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" },
        }),
      ], { spacing: 10, url: appLink, frame: fill });
      break;

    default: { // large and extraLarge
      const device = Storage.get("device");
      const overall = overallRating(r);
      const detail = [
        rangeText(key, pci),
        key === "radonST" ? `long-term ${display("radonLT", r.radonLT, pci)} ${unitFor("radonLT", pci)}` : null,
      ].filter(Boolean).join(" · ");

      content = Widget.vstack([
        Widget.hstack([
          Widget.text("Indoor air", { font: "headline" }),
          overall != null
            ? Widget.text(`${RATING_LABELS[overall]} overall`, { font: "caption2", weight: "semibold", color: RATING_COLORS[overall] })
            : null,
          Widget.spacer(),
          Widget.text(device?.serial ? `Wave Plus ${device.serial}` : "Wave Plus", { font: "caption2", color: "secondary", lineLimit: 1 }),
        ], { spacing: 6, alignment: "bottom" }),
        Widget.vstack([
          heroHeader(key, r, 13),
          heroValue(key, r, pci, 38),
          sparkline(key, color, { height: 44, kind: "area" }),
          detail ? Widget.text(detail, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }) : null,
        ], {
          alignment: "leading", spacing: 3, padding: 10,
          background: tint(key, r[key]), cornerRadius: 14,
          frame: { maxWidth: "infinity", alignment: "leading" },
        }),
        ...others(key).map((k) => largeRow(k, r, pci)),
        Widget.spacer(),
      ], { alignment: "leading", spacing: 5, url: appLink, frame: fill });
    }
  }

  return { content, refreshAfter: 30 * 60 };
});

// ─────────────────────────────────────────── Mini-app

Script.action("read", async () => {
  try {
    await refresh();
    await UI.haptic("success");
  } catch {
    await UI.haptic("error");
  }
});

Script.action("forget", async () => {
  const choice = await UI.alert({ title: "Forget this sensor?", message: "The next reading will search for a Wave Plus again, including devices skipped earlier.", buttons: ["Cancel", "Forget"] });
  if (choice === 1) {
    Storage.remove("device");
    Storage.remove("ignored");
  }
});

Script.action("clear", async () => {
  const choice = await UI.alert({ title: "Delete all history?", message: "This cannot be undone.", buttons: ["Cancel", "Delete"] });
  if (choice === 1) Storage.set("history", []);
});

Script.action("unit", ({ value }) => Storage.set("unitPci", value === "pci"));

function historyChart(key, pci) {
  const now = Date.now();
  const cutoff = now - SPARK_DAYS * DAY;
  const points = history()
    .filter((r) => r.t >= cutoff && r[key] != null)
    .map((r) => ({
      x: Number(((r.t - now) / 3_600_000).toFixed(1)), // hours ago (negative)
      y: (key === "radonST" && pci) ? r[key] / 37 : r[key],
    }));
  const latestValue = latest()?.[key];
  if (points.length < 2) return Widget.text("Not enough history yet. Readings build up over time.", { color: "secondary", font: "footnote" });
  return Widget.vstack([
    Widget.chart(points, { kind: "line", smooth: true, color: colorFor(key, latestValue), frame: { height: 200 } }),
    Widget.text("Hours ago · last 7 days", { font: "caption2", color: "secondary" }),
  ], { spacing: 4 });
}

Script.ui(() => {
  const r = latest();
  const device = Storage.get("device");
  const error = Storage.get("lastError");
  const pci = Storage.get("unitPci", false);
  const skipped = ignoredIds().length;

  const status = Widget.vstack([
    Widget.text(device ? `${device.name}${device.serial ? ` · ${device.serial}` : ""}` : "No sensor paired yet", { font: "footnote", color: "secondary" }),
    r ? Widget.hstack([
      Widget.text("Last reading", { font: "footnote", color: "secondary" }),
      Widget.date(r.t, { style: "relative", font: "footnote", color: "secondary" }),
    ], { spacing: 4 }) : null,
    error ? Widget.text(`⚠️ ${error.message}`, { font: "footnote", color: "orange" }) : null,
    Widget.text(`${history().length} readings stored${skipped ? ` · ${skipped} other device${skipped === 1 ? "" : "s"} skipped` : ""}`, { font: "caption", color: "secondary" }),
  ], { alignment: "leading", spacing: 2 });

  const buttons = Widget.hstack([
    Widget.button("Read now", "read", null, { style: "prominent" }),
    Widget.spacer(),
    Widget.menu("ellipsis.circle", [
      { title: "Forget sensor", symbol: "antenna.radiowaves.left.and.right.slash", action: "forget" },
      { title: "Delete history", symbol: "trash", action: "clear", destructive: true },
    ]),
  ]);

  if (!r) {
    return {
      title: "Wave Plus",
      content: Widget.vstack([
        Widget.symbol("aqi.medium", { size: 56, color: "blue", fallback: "🌫" }),
        Widget.text("Stand near your Airthings Wave Plus and tap Read now.", { align: "center" }),
        status,
        buttons,
      ], { spacing: 16, padding: 20 }),
    };
  }

  const rows = [
    ...METRICS.map((m) => ({
      title: m.label,
      symbol: m.symbol,
      color: colorFor(m.key, r[m.key]),
      detail: `${display(m.key, r[m.key], pci)} ${unitFor(m.key, pci)}`,
    })),
    { title: "Radon long-term", symbol: "clock.arrow.circlepath", color: colorFor("radonST", r.radonLT), detail: `${display("radonLT", r.radonLT, pci)} ${unitFor("radonLT", pci)}` },
  ];

  return {
    title: "Wave Plus",
    content: Widget.vstack([
      status,
      buttons,
      Widget.list(rows, { title: "Now" }),
      Widget.picker([{ label: "Bq/m³", value: "bq" }, { label: "pCi/L", value: "pci" }], pci ? "pci" : "bq", "unit", null, { style: "segmented", label: "Radon unit" }),
      Widget.tabs(METRICS.map((m) => ({ title: m.label, content: historyChart(m.key, pci) })), { selected: 0 }),
    ], { alignment: "leading", spacing: 16, padding: 16 }),
  };
});
