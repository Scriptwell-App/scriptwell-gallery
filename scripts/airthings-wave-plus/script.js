// @name        Airthings Wave Plus test
// @description Reads your Airthings Wave Plus directly over Bluetooth. Returns the JSON in Shortcuts and shows every reading in a widget.
// @icon        aqi.medium
// @color       #0EA5E9
// @permissions bluetooth
// @widget      small, medium, large
// @version     1.0.0
// @author      va4weblah
// @category    utilities

// Setup: keep your phone near the Wave Plus and run this script once in the Scriptwell app,
// so Bluetooth is allowed. The nearest Wave Plus is found and remembered.
// Widgets cannot use Bluetooth: they show the last reading, which is refreshed whenever the script
// runs (▶, Shortcuts, tapping the widget) and during iOS background refreshes.
// Optional: put another device's serial number in the widget's Parameter field or the Shortcuts input.

const COMPANY_ID = 0x0334; // Airthings, in the advertised manufacturer data
const CURRENT_VALUES = "B42E2A68-ADE7-11E4-89D3-123B93F75CBA";

const scanSeconds = () => (Script.env.mode === "background" ? 4 : 6);

// ───────────── Bluetooth

function base64Bytes(b64) {
  const s = atob(b64);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// Manufacturer data: company id (little-endian), then the serial number as a little-endian uint32.
function airthingsSerial(device) {
  if (!device.manufacturerData) return null;
  try {
    const b = base64Bytes(device.manufacturerData);
    if (b.length < 6 || (b[0] | (b[1] << 8)) !== COMPANY_ID) return null;
    return String((b[2] | (b[3] << 8) | (b[4] << 16) | (b[5] << 24)) >>> 0);
  } catch {
    return null;
  }
}

async function findDevice(serialWanted) {
  const { state } = await Bluetooth.state();
  if (state === "poweredOff") throw new Error("Bluetooth is turned off.");
  if (state === "unauthorized") throw new Error("Bluetooth access is off for Scriptwell in Settings.");
  if (state === "unsupported") throw new Error("This device has no Bluetooth Low Energy.");

  const devices = await Bluetooth.scan({ duration: scanSeconds() });
  const candidates = devices
    .map((device) => ({ device, serial: airthingsSerial(device) }))
    .filter((c) => c.serial || /airthings|wave/i.test(c.device.name ?? ""));

  if (serialWanted) {
    const match = candidates.find((c) => c.serial === serialWanted);
    if (!match) throw new Error(`No Wave Plus with serial ${serialWanted} nearby.`);
    return match;
  }

  const remembered = Storage.get("serial");
  const match = candidates.find((c) => remembered && c.serial === remembered)
    ?? candidates.find((c) => c.device.connectable !== false);
  if (!match) throw new Error("No Airthings Wave Plus found nearby. Move closer and try again.");
  return match;
}

// Wave Plus current values: version, humidity/2, light, waves, radon short, radon long,
// temp/100, pressure/50, CO₂, VOC (little-endian uint16 after four bytes).
function decode(bytes) {
  if (bytes.length < 16) throw new Error("The Wave Plus sent an unexpected reply.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== 1) throw new Error(`Unsupported sensor format version ${view.getUint8(0)}.`);
  const radon = (v) => (v > 16383 ? null : v);
  const u16 = (o) => view.getUint16(o, true);
  return {
    humidity: view.getUint8(1) / 2,
    light: view.getUint8(2),
    radonShortTermAvg: radon(u16(4)),
    radonLongTermAvg: radon(u16(6)),
    temp: u16(8) / 100,
    pressure: u16(10) / 50,
    co2: u16(12) === 0xffff ? null : u16(12),
    voc: u16(14) === 0xffff ? null : u16(14),
    time: Math.floor(Date.now() / 1000),
  };
}

async function readDevice(serialWanted) {
  const { device, serial } = await findDevice(serialWanted);
  await Bluetooth.connect(device.id);
  try {
    const bytes = await Bluetooth.read(device.id, CURRENT_VALUES);
    return { serial: serial ?? device.name ?? device.id, data: decode(bytes) };
  } finally {
    try { await Bluetooth.disconnect(device.id); } catch { /* already gone */ }
  }
}

// Read fresh values; fall back to the last good ones if the read fails.
// Inside a widget there is no Bluetooth, so the widget only reads the cache.
async function refresh(serialOverride = null) {
  const cacheKey = `latest:${serialOverride ?? "default"}`;
  const cached = Storage.get(cacheKey);

  if (Script.env.mode === "widget") {
    if (cached) return { ...cached, stale: Date.now() - cached.fetchedAt > 3 * 60 * 60 * 1000 };
    throw new Error("Run this script in the Scriptwell app once to read your Wave Plus over Bluetooth.");
  }

  try {
    const { serial, data } = await readDevice(serialOverride);
    const result = { serial, data, fetchedAt: Date.now() };
    Storage.set(cacheKey, result);
    if (!serialOverride && /^\d+$/.test(serial)) Storage.set("serial", serial);
    return result;
  } catch (error) {
    if (cached) return { ...cached, stale: true, error: error.message };
    throw error;
  }
}

const serialFrom = (text) => (/^\s*\d{6,}\s*$/.test(text ?? "") ? text.trim() : null);

// ───────────── Shortcuts / Siri / ▶

Script.run(async (input) => {
  const result = await refresh(serialFrom(input));
  return {
    serial: result.serial,
    ...result.data,
    fetchedAt: new Date(result.fetchedAt).toISOString(),
    ...(result.stale ? { stale: true, error: result.error } : {}),
  };
});

// Keeps the cache fresh while the app is closed.
Script.background(() => refresh());

// ───────────── Widget

const LEVEL_COLOR = { good: "green", fair: "orange", poor: "red" };
const RANK = { good: 0, fair: 1, poor: 2 };

const METRICS = [
  { key: "radonShortTermAvg", label: "Radon", unit: "Bq/m³", symbol: "atom", fallback: "☢︎",
    format: (v) => String(Math.round(v)), level: (v) => (v < 100 ? "good" : v < 150 ? "fair" : "poor") },
  { key: "co2", label: "CO₂", unit: "ppm", symbol: "carbon.dioxide.cloud.fill", fallback: "☁︎",
    format: (v) => String(Math.round(v)), level: (v) => (v < 800 ? "good" : v < 1000 ? "fair" : "poor") },
  { key: "voc", label: "VOC", unit: "ppb", symbol: "aqi.medium", fallback: "≋",
    format: (v) => String(Math.round(v)), level: (v) => (v < 250 ? "good" : v < 2000 ? "fair" : "poor") },
  { key: "temp", label: "Temp", unit: "°C", symbol: "thermometer.medium", fallback: "🌡",
    format: (v) => v.toFixed(1), level: (v) => (v >= 18 && v <= 25 ? "good" : "fair") },
  { key: "humidity", label: "Humidity", unit: "%", symbol: "humidity.fill", fallback: "💧",
    format: (v) => String(Math.round(v)), level: (v) => (v >= 30 && v < 60 ? "good" : v >= 25 && v < 70 ? "fair" : "poor") },
  { key: "pressure", label: "Pressure", unit: "hPa", symbol: "barometer", fallback: "◎",
    format: (v) => String(Math.round(v)), level: null },
];

const levelOf = (metric, data) => {
  const v = data[metric.key];
  return v == null || !metric.level ? null : metric.level(v);
};

const overall = (data) => {
  const levels = METRICS.map((m) => levelOf(m, data)).filter(Boolean);
  if (!levels.length) return null;
  return levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
};

const STATUS_TEXT = { good: "Good", fair: "Fair", poor: "Poor" };

const tile = (metric, data, compact) => {
  const v = data[metric.key];
  const color = LEVEL_COLOR[levelOf(metric, data)] ?? "secondary";
  return Widget.vstack([
    Widget.hstack([
      Widget.symbol(metric.symbol, { size: compact ? 11 : 14, color, fallback: metric.fallback }),
      Widget.text(metric.label, { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { spacing: 4 }),
    Widget.rich([
      { text: v == null ? "–" : metric.format(v), font: compact ? "headline" : "title2", weight: "semibold", design: "rounded" },
      { text: ` ${metric.unit}`, font: "caption2", color: "secondary" },
    ], { lineLimit: 1, minimumScale: 0.6, monospacedDigit: true }),
  ], {
    alignment: "leading", spacing: compact ? 1 : 3, padding: compact ? 6 : 10,
    background: { light: "#F1F5F9", dark: "#1E293B" }, cornerRadius: 10,
    frame: { maxWidth: "infinity", alignment: "leading" },
  });
};

const header = (data, font = "headline") => {
  const status = overall(data);
  return Widget.hstack([
    Widget.symbol("aqi.medium", { size: 14, color: "sky-500", fallback: "≋" }),
    Widget.text("Wave Plus", { font, weight: "semibold", lineLimit: 1 }),
    Widget.spacer(),
    status ? Widget.badge(STATUS_TEXT[status], { color: LEVEL_COLOR[status] }) : null,
  ], { spacing: 5 });
};

const footer = (result) => {
  const d = result.data;
  const sampleTime = d.time ? d.time * 1000 : result.fetchedAt;
  return Widget.hstack([
    Widget.symbol("dot.radiowaves.left.and.right", { size: 10, color: "secondary", fallback: "ᛒ" }),
    result.stale ? Widget.text("not refreshed lately", { font: "caption2", color: "orange" }) : null,
    Widget.spacer(),
    Widget.date(sampleTime, { style: "relative", font: "caption2", color: "secondary" }),
  ], { spacing: 6, class: "text-caption2" });
};

const errorView = (message) => Widget.vstack([
  Widget.symbol("exclamationmark.triangle.fill", { size: 22, color: "orange", fallback: "⚠️" }),
  Widget.text("Airthings", { font: "headline" }),
  Widget.text(message, { font: "caption2", color: "secondary", lineLimit: 4, align: "center" }),
], { spacing: 4 });

// Tapping the widget runs the script in the app, which reads the sensor over Bluetooth.
const runLink = (serial) =>
  `scriptwell://run?id=${encodeURIComponent(Script.id)}${serial ? `&input=${encodeURIComponent(serial)}` : ""}`;

Script.widget(async ({ family, parameter }) => {
  const serial = serialFrom(parameter);
  let result;
  try {
    result = await refresh(serial);
  } catch (error) {
    return { content: { ...errorView(error.message), url: runLink(serial) }, refreshAfter: 15 * 60 };
  }
  const d = result.data;
  let content;

  if (family === "small") {
    const radon = METRICS[0];
    const radonColor = LEVEL_COLOR[levelOf(radon, d)] ?? "primary";
    const status = overall(d);
    const mini = (m) => Widget.rich([
      { text: `${m.label} `, color: "secondary" },
      { text: d[m.key] == null ? "–" : `${m.format(d[m.key])} ${m.unit}`, weight: "semibold",
        color: LEVEL_COLOR[levelOf(m, d)] ?? "primary" },
    ], { font: "caption2", lineLimit: 1, minimumScale: 0.7 });

    content = Widget.vstack([
      Widget.hstack([
        Widget.text("Radon", { font: "caption2", color: "secondary" }),
        Widget.spacer(),
        status ? Widget.badge(STATUS_TEXT[status], { color: LEVEL_COLOR[status] }) : null,
      ], { spacing: 5 }),
      Widget.rich([
        { text: d.radonShortTermAvg == null ? "–" : radon.format(d.radonShortTermAvg), font: 38, weight: "bold", design: "rounded", color: radonColor },
        { text: " Bq/m³", font: "caption2", color: "secondary" },
      ], { lineLimit: 1, minimumScale: 0.5 }),
      Widget.spacer(),
      mini(METRICS[1]),
      mini(METRICS[3]),
      mini(METRICS[4]),
    ], { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
  } else if (family === "medium") {
    content = Widget.vstack([
      header(d, "subheadline"),
      Widget.grid(METRICS.map((m) => tile(m, d, true)), { columns: 3, spacing: 6 }),
      footer(result),
    ], { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
  } else {
    content = Widget.vstack([
      header(d),
      Widget.text(`Serial ${result.serial}`, { font: "caption2", color: "secondary" }),
      Widget.grid(METRICS.map((m) => tile(m, d, false)), { columns: 2, spacing: 8 }),
      Widget.spacer(),
      footer(result),
    ], { alignment: "leading", spacing: 8, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
  }

  return {
    content: { ...content, url: runLink(serial) },
    refreshAfter: 30 * 60,
  };
});
