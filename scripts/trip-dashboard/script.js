// @name        Trip Dashboard
// @description Countdown, destination weather, exchange rate, tip calculator, country essentials and a smart packing list for your next trip, using restcountries.com, api.frankfurter.app, flag images from flagcdn.com and Apple Weather
// @permissions network
// @widget      small, medium, large, rectangular, inline
// @icon        airplane.departure
// @color       #0EA5E9
// @version     1.0.0
// @author      va4w
// @category    travel

// How it works
// • Type a destination; Apple's place search geocodes it (no location permission needed). Country facts come from restcountries.com (only the country code is sent), exchange rates from api.frankfurter.app (only the two currency codes), flags from flagcdn.com, and the 10-day forecast from Apple Weather.
// • The mini-app has a trip picker with date pickers, and tabs for Essentials (currency, languages, dialling code, driving side, typical plug type, time difference), Money (converter and 10/15/20% tips), Weather, and a Packing checklist with suggestions drawn from the forecast.
// • The widget counts down to the trip, shows the weather for your first day there and the exchange rate; the large size adds a five-day strip, essentials and packing progress. The inline Lock Screen size reads "Tokyo in 12 days".
// • Widgets only read the cache; the mini-app, Shortcuts runs and background runs refresh it. Set the widget Parameter to a destination name to show a particular trip.
// • Open the mini-app once before adding the widget so the network permission is approved and the first trip is saved.

// ───────────────────────── Constants

const COUNTRIES = "https://restcountries.com/v3.1/alpha/";
const FRANKFURTER = "https://api.frankfurter.app/latest";
const DAY = 86_400_000;
const SKY = "#0EA5E9";
const BG = Widget.gradient([{ light: "#F0F9FF", dark: "#082F49" }, { light: "#E0F2FE", dark: "#0C3B5E" }], { direction: "topToBottom" });
const TILE = { light: "#FFFFFFB3", dark: "#FFFFFF14" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const useF = /-US$/i.test(Script.env.locale);

// Home currency guessed from the locale's region; changeable in the mini-app.
const REGION_CURRENCY = {
  US: "USD", GB: "GBP", CA: "CAD", AU: "AUD", NZ: "NZD", JP: "JPY", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", HU: "HUF",
  IN: "INR", CN: "CNY", KR: "KRW", BR: "BRL", MX: "MXN", ZA: "ZAR", SG: "SGD", HK: "HKD", IL: "ILS", TR: "TRY", TH: "THB", MY: "MYR", PH: "PHP", ID: "IDR", RO: "RON", BG: "BGN", IS: "ISK",
};

// Typical mains plug types by country code; the first match wins.
const PLUGS = [
  ["G", "GB IE MT CY HK SG MY AE QA BH KW OM SA KE UG TZ NG GH ZM ZW MU LK BD IQ JO BN"],
  ["A/B", "US CA MX JP PH TW TH CO VE PA CR GT HN NI SV CU DO PR BS JM EC PE"],
  ["I", "AU NZ CN AR PG FJ UY"],
  ["D/M", "IN ZA NP BT NA BW LS"],
  ["C/J", "CH LI"],
  ["C/K", "DK GL"],
  ["C/L", "IT CL"],
  ["C/N", "BR"],
  ["C/H", "IL"],
  ["C/E", "FR BE CZ SK MA TN DZ MC"],
  ["C/F", "DE NL ES PT AT SE NO FI PL HU RO GR TR RU UA RS HR SI BG IS LU EE LV LT ID KR VN EG KZ GE AM AZ BA ME MK AL MD BY AD"],
];
const plugFor = (cc) => PLUGS.find(([, list]) => list.split(" ").includes(cc))?.[0] ?? null;

const BASE_PACKING = ["Passport or ID", "Phone charger", "Travel adapter", "Toiletries", "Medication", "Payment cards", "Headphones"];

// ───────────────────────── Storage helpers

const trips = () => Storage.get("trips", []);
const saveTrips = (list) => Storage.set("trips", list);
const activeId = () => Storage.get("active") ?? trips()[0]?.id ?? null;
const tripById = (id) => trips().find((t) => t.id === id) ?? null;
const activeTrip = () => tripById(activeId()) ?? trips()[0] ?? null;
const home = () => ({ currency: REGION_CURRENCY[(Script.env.locale.split("-")[1] ?? "").toUpperCase()] ?? "EUR", ...Storage.get("home", {}) });
const dayKey = (d) => new Date(d).toLocaleDateString("en-CA");
const midnight = (d) => new Date(`${d}T00:00:00`);
const fmtTemp = (c) => (c == null ? "–" : useF ? `${Math.round(c * 9 / 5 + 32)}°` : `${Math.round(c)}°`);
const fmtMoney = (n, code) => (Number.isFinite(n) ? n.toLocaleString(Script.env.locale, { style: "currency", currency: code, maximumFractionDigits: n >= 100 ? 0 : 2 }) : "–");
const shortDate = (d) => new Date(d).toLocaleDateString(Script.env.locale, { day: "numeric", month: "short" });
const weekday = (d) => new Date(d).toLocaleDateString(Script.env.locale, { weekday: "short" });

// Where the trip stands: days until it starts, which day of it this is, or finished.
function phase(trip) {
  const today = midnight(dayKey(new Date()));
  const start = midnight(trip.start), end = midnight(trip.end);
  const length = Math.max(1, Math.round((end - start) / DAY) + 1);
  if (today < start) return { kind: "before", days: Math.round((start - today) / DAY), length };
  if (today <= end) return { kind: "during", day: Math.round((today - start) / DAY) + 1, length };
  return { kind: "after", days: Math.round((today - end) / DAY), length };
}

function phaseText(trip, p = phase(trip)) {
  if (p.kind === "before") return p.days === 1 ? `${trip.city} tomorrow` : `${trip.city} in ${p.days} days`;
  if (p.kind === "during") return `${trip.city}: day ${p.day} of ${p.length}`;
  return `${trip.city} was ${p.days} days ago`;
}

// ───────────────────────── Country, rates and weather

const countryInfo = (cc) => Storage.get(`country:${cc}`)?.data ?? null;

async function loadCountry(cc) {
  const saved = Storage.get(`country:${cc}`);
  if (saved && Date.now() - saved.time < 30 * DAY) return saved.data;
  const url = new URL(`${COUNTRIES}${cc}`);
  url.searchParams.set("fields", "name,currencies,languages,car,idd,timezones,flags,capital");
  const response = await fetch(url, { timeout: 8000 });
  if (!response.ok) throw new Error(`restcountries.com returned ${response.status}`);
  const raw = await response.json();
  const c = Array.isArray(raw) ? raw[0] : raw;
  const [code, cur] = Object.entries(c.currencies ?? {})[0] ?? [null, {}];
  const suffixes = c.idd?.suffixes ?? [];
  const data = {
    name: c.name?.common ?? cc,
    capital: c.capital?.[0] ?? null,
    currency: code ? { code, name: cur.name ?? code, symbol: cur.symbol ?? code } : null,
    languages: Object.values(c.languages ?? {}),
    driving: c.car?.side ?? null,
    dialling: c.idd?.root ? `${c.idd.root}${suffixes.length === 1 ? suffixes[0] : ""}` : null,
    timezones: c.timezones ?? [],
    flag: typeof c.flags?.png === "string" && c.flags.png.startsWith("https://") ? c.flags.png : null,
    plug: plugFor(cc),
  };
  Storage.set(`country:${cc}`, { data, time: Date.now() });
  return data;
}

const fxKey = (from, to) => `fx:${from}:${to}`;
const fxInfo = (from, to) => (from === to ? { rate: 1, date: dayKey(new Date()), time: Date.now() } : Storage.get(fxKey(from, to)));

async function loadRate(from, to) {
  if (!from || !to || from === to) return fxInfo(from, to);
  const url = new URL(FRANKFURTER);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  const response = await fetch(url, { timeout: 8000 });
  if (!response.ok) throw new Error(response.status === 404 ? `No rate for ${from} to ${to}` : `frankfurter.app returned ${response.status}`);
  const data = await response.json();
  const rate = data.rates?.[to];
  if (!rate) throw new Error(`No rate for ${from} to ${to}`);
  const value = { rate, date: data.date, time: Date.now() };
  Storage.set(fxKey(from, to), value);
  return value;
}

const weatherInfo = (trip) => Storage.get(`weather:${trip.id}`);

async function loadWeather(trip) {
  const days = await Weather.daily({ latitude: trip.latitude, longitude: trip.longitude }, { days: 10 });
  let credit = Storage.get("credit");
  if (!credit) {
    try { credit = await Weather.attribution(); Storage.set("credit", credit); }
    catch { credit = { text: "Apple Weather", url: "https://weatherkit.apple.com/legal-attribution.html" }; }
  }
  const value = {
    days: days.map((d) => ({ date: dayKey(d.date), high: d.high, low: d.low, condition: d.condition, symbol: d.symbol ?? "cloud.fill", chance: d.precipitationChance ?? 0, uv: d.uvIndex ?? null })),
    credit, time: Date.now(),
  };
  Storage.set(`weather:${trip.id}`, value);
  return value;
}

// Refresh everything for one trip, tolerating each source failing on its own.
async function refresh(trip, { force = false } = {}) {
  if (!trip) return [];
  const errors = [];
  const stale = (saved, hours) => force || !saved || Date.now() - saved.time > hours * 3_600_000;
  try { await loadCountry(trip.countryCode); } catch (error) { errors.push(error.message); }
  const there = countryInfo(trip.countryCode)?.currency?.code;
  if (there && stale(fxInfo(home().currency, there), 6)) {
    try { await loadRate(home().currency, there); } catch (error) { errors.push(error.message); }
  }
  if (stale(weatherInfo(trip), 3)) {
    try { await loadWeather(trip); } catch (error) { errors.push(`Weather: ${error.message}`); }
  }
  Storage.set("lastError", errors.length ? { message: errors.join(" · "), time: Date.now() } : null);
  return errors;
}

// ───────────────────────── Time difference

function offsetMinutes(tz) {
  const m = /^UTC(?:([+-])(\d{2}):(\d{2}))?$/.exec(tz ?? "");
  if (!m) return null;
  if (!m[1]) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function timeDifference(info) {
  const there = offsetMinutes(info?.timezones?.[0]);
  if (there == null) return null;
  const here = -new Date().getTimezoneOffset();
  const diff = there - here;
  const h = Math.abs(diff) / 60;
  const label = diff === 0 ? "Same time as home" : `${h % 1 ? h.toFixed(1) : h} h ${diff > 0 ? "ahead" : "behind"}`;
  const local = new Date(Date.now() + there * 60_000).toLocaleTimeString(Script.env.locale, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return { diff, label, local, several: (info.timezones?.length ?? 0) > 1 };
}

// ───────────────────────── Packing

function tripDays(trip, weather) {
  const days = weather?.days ?? [];
  const inTrip = days.filter((d) => d.date >= trip.start && d.date <= trip.end);
  return inTrip.length ? inTrip : days.slice(0, 5);
}

function suggestions(trip) {
  const days = tripDays(trip, weatherInfo(trip));
  const items = [];
  if (days.some((d) => d.chance >= 0.5 || /rain|drizzle|storm/i.test(d.condition ?? ""))) items.push({ label: "Umbrella or rain jacket", why: "rain likely" });
  if (days.some((d) => (d.uv ?? 0) >= 6)) items.push({ label: "Sunscreen and sunglasses", why: "high UV" });
  if (days.some((d) => d.low != null && d.low < 10)) items.push({ label: "Warm layer", why: `lows around ${fmtTemp(Math.min(...days.map((d) => d.low ?? 99)))}` });
  if (days.some((d) => d.high != null && d.high >= 27)) items.push({ label: "Light clothes and a water bottle", why: `highs around ${fmtTemp(Math.max(...days.map((d) => d.high ?? -99)))}` });
  if (days.some((d) => /snow|sleet|blizzard/i.test(d.condition ?? ""))) items.push({ label: "Gloves and a hat", why: "snow in the forecast" });
  const info = countryInfo(trip.countryCode);
  if (info?.driving === "left") items.push({ label: "Driving licence (they drive on the left)", why: "if you plan to drive" });
  return items;
}

const packedKey = (trip) => `packed:${trip.id}`;
const extraKey = (trip) => `extra:${trip.id}`;
function packingList(trip) {
  const smart = suggestions(trip);
  return [
    ...BASE_PACKING.map((label) => ({ label, value: label })),
    ...smart.map((s) => ({ label: `${s.label} · ${s.why}`, value: s.label, symbol: "sparkles" })),
    ...Storage.get(extraKey(trip), []).map((label) => ({ label, value: label, symbol: "plus" })),
  ];
}

// ───────────────────────── Actions

let tab = 0;
let searching = false;
let query = "";
let results = [];
let notice = null;

Script.action("tab", ({ value }) => { tab = value; });
Script.action("startSearch", () => { searching = true; results = []; query = ""; });
Script.action("cancelSearch", () => { searching = false; });
Script.action("pick", ({ value }) => { Storage.set("active", value); tab = tab; });
Script.action("home", ({ value }) => {
  const code = String(value ?? "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) Storage.set("home", { currency: code });
});

Script.action("search", async ({ value }) => {
  query = String(value ?? "").trim();
  if (!query) return;
  try {
    results = (await Location.search(query, { limit: 6 })).filter((p) => p.countryCode).map((p) => ({
      name: p.name ?? p.city ?? query, city: p.city ?? p.name ?? query, country: p.country ?? "", countryCode: p.countryCode.toUpperCase(),
      latitude: p.latitude, longitude: p.longitude, address: p.address,
    }));
    notice = results.length ? null : `Nothing found for “${query}”.`;
  } catch (error) {
    notice = `Search failed: ${error.message}`;
  }
});

Script.action("create", async ({ index }) => {
  const place = results[index];
  if (!place) return;
  const start = new Date(Date.now() + 30 * DAY), end = new Date(Date.now() + 37 * DAY);
  const trip = { id: `${Date.now()}`, name: place.name, city: place.city, country: place.country, countryCode: place.countryCode, latitude: place.latitude, longitude: place.longitude, start: dayKey(start), end: dayKey(end) };
  saveTrips([...trips(), trip].slice(-10));
  Storage.set("active", trip.id);
  searching = false;
  await refresh(trip, { force: true });
});

Script.action("date", ({ key, value }) => {
  const trip = activeTrip();
  if (!trip) return;
  const day = dayKey(value);
  const next = { ...trip, [key]: day };
  if (next.end < next.start) next[key === "start" ? "end" : "start"] = day;
  saveTrips(trips().map((t) => (t.id === trip.id ? next : t)));
});

Script.action("delete", async () => {
  const trip = activeTrip();
  if (!trip) return;
  const choice = await UI.alert({ title: `Delete the trip to ${trip.city}?`, buttons: ["Cancel", "Delete"] });
  if (choice !== 1) return;
  saveTrips(trips().filter((t) => t.id !== trip.id));
  for (const key of [`weather:${trip.id}`, packedKey(trip), extraKey(trip)]) Storage.remove(key);
  Storage.remove("active");
});

Script.action("refresh", async () => {
  const errors = await refresh(activeTrip(), { force: true });
  notice = errors.length ? errors.join(" · ") : null;
  await UI.haptic(errors.length ? "error" : "success");
});

Script.action("amount", ({ value }) => { const n = Number(String(value).replace(",", ".")); if (Number.isFinite(n)) Storage.set("amount", n); });
Script.action("direction", ({ value }) => Storage.set("direction", value));
Script.action("bill", ({ value }) => { const n = Number(String(value).replace(",", ".")); if (Number.isFinite(n)) Storage.set("bill", n); });
Script.action("packed", ({ value }) => { const trip = activeTrip(); if (trip) Storage.set(packedKey(trip), value); });
Script.action("addItem", ({ value }) => {
  const trip = activeTrip(); const item = String(value ?? "").trim();
  if (trip && item) Storage.set(extraKey(trip), [...new Set([...Storage.get(extraKey(trip), []), item])].slice(0, 30));
});
Script.action("resetPacked", () => { const trip = activeTrip(); if (trip) Storage.remove(packedKey(trip)); });
Script.action("maps", async () => { const t = activeTrip(); if (t) await UI.openURL(`maps://?ll=${t.latitude},${t.longitude}&q=${encodeURIComponent(t.name)}`); });

// ───────────────────────── Mini-app tabs

const row = (title, detail, symbol, color = "blue") => ({ title, detail: detail ?? "–", symbol, color });

function essentialsTab(trip) {
  const info = countryInfo(trip.countryCode);
  if (!info) return Widget.text("Country facts have not loaded yet. Tap Refresh.", { color: "secondary" });
  const td = timeDifference(info);
  return Widget.vstack([
    Widget.list([
      row("Capital", info.capital, "building.columns"),
      row("Languages", info.languages.join(", "), "character.bubble"),
      row("Currency", info.currency ? `${info.currency.name} (${info.currency.code})` : null, "banknote"),
      row("Dialling code", info.dialling, "phone"),
      row("Drives on the", info.driving ? `${info.driving}` : null, "car"),
      row("Plug type (typical)", info.plug ?? "Check before you go", "powerplug"),
      row("Time", td ? `${td.local} there · ${td.label}${td.several ? " (first zone)" : ""}` : info.timezones.join(", "), "clock"),
    ]),
    Widget.button("Open in Maps", "maps", null, { style: "bordered" }),
  ], { alignment: "leading", spacing: 12 });
}

function moneyTab(trip) {
  const info = countryInfo(trip.countryCode);
  const there = info?.currency?.code;
  const fx = there ? fxInfo(home().currency, there) : null;
  const amount = Storage.get("amount", 100);
  const direction = Storage.get("direction", "home");
  const bill = Storage.get("bill", 60);
  const converted = fx ? (direction === "home" ? amount * fx.rate : amount / fx.rate) : null;
  return Widget.vstack([
    Widget.textField("USD", home().currency, "home", null, { label: "Home currency (3-letter code)" }),
    !there ? Widget.text("No currency information yet.", { color: "secondary" }) : Widget.card([
      Widget.text(fx ? `1 ${home().currency} = ${fx.rate.toLocaleString(Script.env.locale, { maximumFractionDigits: 4 })} ${there}` : `No rate available for ${home().currency} to ${there}`, { font: "title3", weight: "bold", design: "rounded", color: SKY }),
      fx ? Widget.text(`1 ${there} = ${(1 / fx.rate).toLocaleString(Script.env.locale, { maximumFractionDigits: 4 })} ${home().currency} · ECB reference rate from ${fx.date}`, { font: "caption", color: "secondary" }) : Widget.text("Frankfurter covers about 30 major currencies.", { font: "caption", color: "secondary" }),
      Widget.picker([{ label: `${home().currency} → ${there}`, value: "home" }, { label: `${there} → ${home().currency}`, value: "there" }], direction, "direction", null, { style: "segmented" }),
      Widget.textField("Amount", String(amount), "amount", null, { label: `Amount in ${direction === "home" ? home().currency : there}`, keyboard: "decimal" }),
      Widget.text(converted != null ? fmtMoney(converted, direction === "home" ? there : home().currency) : "–", { font: 34, weight: "heavy", design: "rounded" }),
    ], { title: "Exchange", symbol: "arrow.left.arrow.right", color: "blue" }),
    there ? Widget.card([
      Widget.textField("Bill", String(bill), "bill", null, { label: `Bill in ${there}`, keyboard: "decimal" }),
      Widget.hstack([10, 15, 20].map((pct) => Widget.vstack([
        Widget.text(`${pct}%`, { font: "caption", weight: "bold", color: "secondary" }),
        Widget.text(fmtMoney(bill * pct / 100, there), { font: "subheadline", weight: "semibold", lineLimit: 1, minimumScale: 0.6 }),
        Widget.text(fmtMoney(bill * (1 + pct / 100), there), { font: "caption", lineLimit: 1, minimumScale: 0.6 }),
        fx ? Widget.text(`≈ ${fmtMoney(bill * (1 + pct / 100) / fx.rate, home().currency)}`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.6 }) : null,
      ], { spacing: 2, padding: 8, background: TILE, cornerRadius: 10, frame: { maxWidth: "infinity" } })), { spacing: 8 }),
      Widget.text("Tip · total · total in your currency", { font: "caption2", color: "secondary" }),
    ], { title: "Tip calculator", symbol: "percent", color: "green" }) : null,
  ], { alignment: "leading", spacing: 14 });
}

function weatherTab(trip) {
  const w = weatherInfo(trip);
  if (!w) return Widget.text("The forecast has not loaded yet. Tap Refresh.", { color: "secondary" });
  const rows = w.days.map((d) => {
    const inTrip = d.date >= trip.start && d.date <= trip.end;
    return Widget.hstack([
      Widget.text(`${weekday(d.date)} ${shortDate(d.date)}`, { font: "subheadline", weight: inTrip ? "semibold" : "regular", color: inTrip ? "primary" : "secondary", frame: { width: 92, alignment: "leading" } }),
      Widget.symbol(d.symbol, { size: 18, color: inTrip ? SKY : "secondary", fallback: "🌤" }),
      Widget.text(d.chance >= 0.2 ? `${Math.round(d.chance * 100)}%` : "", { font: "caption", color: "blue", frame: { width: 36, alignment: "leading" } }),
      Widget.spacer(),
      d.uv != null && d.uv >= 6 ? Widget.text(`UV ${d.uv}`, { font: "caption2", weight: "bold", color: "orange" }) : null,
      Widget.text(`${fmtTemp(d.high)} / ${fmtTemp(d.low)}`, { font: "subheadline", weight: "semibold", design: "rounded" }),
    ], { spacing: 8, padding: { vertical: 2 }, background: inTrip ? TILE : null, cornerRadius: 8 });
  });
  return Widget.vstack([
    Widget.card(rows, { title: "10-day forecast", subtitle: `${trip.city} · trip days highlighted`, symbol: "cloud.sun.fill", color: "orange" }),
    Widget.hstack([
      Widget.text(w.credit?.text ?? "Apple Weather", { font: "caption2", color: "secondary", url: w.credit?.url }),
      Widget.spacer(),
      Widget.date(w.time, { style: "relative", font: "caption2", color: "secondary" }),
    ]),
  ], { alignment: "leading", spacing: 10 });
}

function packingTab(trip) {
  const items = packingList(trip);
  const packed = Storage.get(packedKey(trip), []).filter((v) => items.some((i) => i.value === v));
  const smart = suggestions(trip);
  return Widget.vstack([
    Widget.hstack([
      Widget.progress(items.length ? packed.length / items.length : 0, { color: SKY }),
      Widget.text(`${packed.length}/${items.length}`, { font: "caption", weight: "semibold" }),
    ], { spacing: 10 }),
    smart.length ? Widget.text(`${smart.length} suggestion${smart.length === 1 ? "" : "s"} from the forecast and country facts are marked with ✦.`, { font: "caption", color: "secondary" }) : Widget.text("Suggestions appear once the forecast has loaded.", { font: "caption", color: "secondary" }),
    Widget.checklist(items, packed, "packed"),
    Widget.textField("Add your own item", "", "addItem", null, { label: "Custom item" }),
    Widget.button("Reset ticks", "resetPacked", null, { style: "bordered", color: "red" }),
  ], { alignment: "leading", spacing: 12 });
}

function searchView() {
  return Widget.vstack([
    Widget.textField("City or place, e.g. Tokyo", query, "search", null, { label: "Where are you going?", keyboard: "search" }),
    results.length ? Widget.list(results.map((r, index) => ({ title: r.name, subtitle: r.address ?? r.country, symbol: "mappin.and.ellipse", color: "blue", args: { index } })), { action: "create", title: "Choose a destination" }) : null,
    notice ? Widget.text(notice, { font: "footnote", color: "orange" }) : null,
    trips().length ? Widget.button("Cancel", "cancelSearch", null, { style: "plain" }) : Widget.text("Searches go to Apple's map servers; nothing else about you is sent.", { font: "caption", color: "secondary" }),
  ], { alignment: "leading", spacing: 12 });
}

Script.ui(async () => {
  const trip = activeTrip();
  if (trip && (!weatherInfo(trip) || Date.now() - weatherInfo(trip).time > 3 * 3_600_000) && !Script.env.lowPowerMode) await refresh(trip);
  if (!trip || searching) {
    return { title: "Trip Dashboard", content: Widget.vstack([
      !trip ? Widget.vstack([
        Widget.symbol("airplane.departure", { size: 56, color: SKY, fallback: "✈️" }),
        Widget.text("Plan your next trip", { font: "title2", weight: "bold" }),
      ], { spacing: 8, frame: { maxWidth: "infinity" } }) : null,
      searchView(),
    ], { alignment: "leading", spacing: 16, padding: 16 }) };
  }

  const info = countryInfo(trip.countryCode);
  const p = phase(trip);
  const error = Storage.get("lastError");
  return {
    title: "Trip Dashboard",
    content: Widget.vstack([
      Widget.hstack([
        Widget.picker(trips().map((t) => ({ label: `${t.city}, ${t.country}`, value: t.id })), trip.id, "pick"),
        Widget.spacer(),
        Widget.button("New trip", "startSearch", null, { style: "bordered" }),
        Widget.menu("ellipsis.circle", [
          { title: "Refresh data", symbol: "arrow.clockwise", action: "refresh" },
          { title: "Delete trip", symbol: "trash", action: "delete", destructive: true },
        ]),
      ], { spacing: 8 }),
      Widget.card([
        Widget.hstack([
          info?.flag ? Widget.image({ src: info.flag, size: 44, cornerRadius: 6 }) : Widget.symbol("flag.fill", { size: 30, color: SKY, fallback: "🏳️" }),
          Widget.vstack([
            Widget.text(trip.name, { font: "title2", weight: "bold", lineLimit: 1, minimumScale: 0.7 }),
            Widget.text(info?.name ?? trip.country, { font: "subheadline", color: "secondary" }),
          ], { alignment: "leading", spacing: 1 }),
          Widget.spacer(),
          Widget.vstack([
            p.kind === "before" ? Widget.date(midnight(trip.start), { style: "relative", font: "headline", weight: "bold", color: SKY }) : Widget.text(p.kind === "during" ? `Day ${p.day} of ${p.length}` : "Trip over", { font: "headline", weight: "bold", color: SKY }),
            Widget.text(`${p.length} day${p.length === 1 ? "" : "s"}`, { font: "caption", color: "secondary" }),
          ], { alignment: "trailing", spacing: 1 }),
        ], { spacing: 12 }),
        Widget.hstack([
          Widget.datePicker(midnight(trip.start).toISOString(), "date", { key: "start" }, { label: "From", mode: "date" }),
          Widget.datePicker(midnight(trip.end).toISOString(), "date", { key: "end" }, { label: "To", mode: "date" }),
        ], { spacing: 12 }),
        error ? Widget.text(error.message, { font: "caption", color: "orange" }) : null,
      ]),
      Widget.tabs([
        { title: "Essentials", symbol: "info.circle", content: essentialsTab(trip) },
        { title: "Money", symbol: "banknote", content: moneyTab(trip) },
        { title: "Weather", symbol: "cloud.sun", content: weatherTab(trip) },
        { title: "Packing", symbol: "checklist", content: packingTab(trip) },
      ], { selected: tab, action: "tab" }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});

// ───────────────────────── Widget

function tripFor(parameter) {
  const needle = String(parameter ?? "").trim().toLowerCase();
  if (needle) {
    const match = trips().find((t) => `${t.name} ${t.city} ${t.country}`.toLowerCase().includes(needle));
    if (match) return match;
  }
  // The active trip, unless it is over and another one is coming up.
  const upcoming = trips().filter((t) => phase(t).kind !== "after").sort((a, b) => a.start.localeCompare(b.start));
  const active = activeTrip();
  return active && phase(active).kind !== "after" ? active : upcoming[0] ?? active;
}

function firstDay(trip) {
  const days = weatherInfo(trip)?.days ?? [];
  const p = phase(trip);
  const want = p.kind === "during" ? dayKey(new Date()) : trip.start;
  return days.find((d) => d.date === want) ?? null;
}

function countdown(trip, font) {
  const p = phase(trip);
  if (p.kind === "before") return Widget.date(midnight(trip.start), { style: "relative", font, weight: "heavy", design: "rounded", color: SKY, lineLimit: 1, minimumScale: 0.5 });
  return Widget.text(p.kind === "during" ? `Day ${p.day}/${p.length}` : "Trip over", { font, weight: "heavy", design: "rounded", color: SKY, lineLimit: 1, minimumScale: 0.5 });
}

function weatherLine(day, font = "caption") {
  if (!day) return Widget.text("Forecast not loaded yet", { font, color: "secondary", lineLimit: 1 });
  return Widget.hstack([
    Widget.symbol(day.symbol, { size: 14, color: "orange", fallback: "🌤" }),
    Widget.text(`${fmtTemp(day.high)} / ${fmtTemp(day.low)}`, { font, weight: "semibold" }),
    day.chance >= 0.2 ? Widget.text(`${Math.round(day.chance * 100)}% rain`, { font, color: "secondary" }) : null,
  ], { spacing: 4 });
}

function fxLine(trip, font = "caption2") {
  const there = countryInfo(trip.countryCode)?.currency?.code;
  const fx = there ? fxInfo(home().currency, there) : null;
  if (!fx) return null;
  return Widget.text(`1 ${home().currency} = ${fx.rate.toLocaleString(Script.env.locale, { maximumFractionDigits: fx.rate >= 100 ? 0 : 2 })} ${there}`, { font, color: "secondary", lineLimit: 1 });
}

Script.widget(({ family, parameter }) => {
  const trip = tripFor(parameter);
  const tomorrow = new Date(); tomorrow.setHours(24, 0, 10, 0);
  if (!trip) {
    if (family === "inline") return Widget.text("Trip Dashboard: add a trip");
    return Widget.vstack([
      Widget.symbol("airplane.departure", { size: 26, color: SKY, fallback: "✈️" }),
      Widget.text("Open Trip Dashboard to add a trip", { font: "caption", color: "secondary", align: "center" }),
    ], { spacing: 8, padding: 12, background: family === "rectangular" ? null : BG, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
  }
  const info = countryInfo(trip.countryCode);
  const day = firstDay(trip);
  const p = phase(trip);
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const dates = `${shortDate(midnight(trip.start))} – ${shortDate(midnight(trip.end))}`;
  const header = Widget.hstack([
    info?.flag ? Widget.image({ src: info.flag, size: 22, cornerRadius: 3 }) : Widget.symbol("airplane", { size: 14, color: SKY, fallback: "✈️" }),
    Widget.text(trip.city.toUpperCase(), { font: "caption2", weight: "bold", color: SKY, lineLimit: 1, minimumScale: 0.7 }),
    Widget.spacer(),
    Widget.text(dates, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
  ], { spacing: 6 });

  let content;
  if (family === "inline") {
    content = Widget.text(phaseText(trip, p));
  } else if (family === "rectangular") {
    content = Widget.vstack([
      Widget.text(trip.city, { font: "headline", lineLimit: 1 }),
      p.kind === "before" ? Widget.hstack([Widget.text("Leaving", { font: "caption" }), Widget.date(midnight(trip.start), { style: "relative", font: "caption", weight: "semibold" })], { spacing: 4 }) : Widget.text(p.kind === "during" ? `Day ${p.day} of ${p.length}` : "Trip over", { font: "caption", weight: "semibold" }),
      day ? Widget.hstack([Widget.symbol(day.symbol, { size: 12, fallback: "🌤" }), Widget.text(`${fmtTemp(day.high)} / ${fmtTemp(day.low)}${day.chance >= 0.2 ? ` · ${Math.round(day.chance * 100)}%` : ""}`, { font: "caption" })], { spacing: 4 }) : Widget.text(dates, { font: "caption2" }),
    ], { alignment: "leading", spacing: 1 });
  } else if (family === "small") {
    content = Widget.vstack([
      header,
      Widget.spacer(),
      Widget.text(p.kind === "before" ? "Leaving" : p.kind === "during" ? "You are there" : "Back home", { font: "caption2", color: "secondary" }),
      countdown(trip, 24),
      Widget.spacer(),
      weatherLine(day, "caption2"),
      fxLine(trip),
    ], { alignment: "leading", spacing: 2, padding: 12, background: BG, url: APP_LINK, frame: fill });
  } else if (family === "medium") {
    const td = timeDifference(info);
    content = Widget.hstack([
      Widget.vstack([
        header,
        Widget.spacer(),
        Widget.text(p.kind === "before" ? "Leaving" : p.kind === "during" ? "You are there" : "Back home", { font: "caption2", color: "secondary" }),
        countdown(trip, 26),
        Widget.text(info?.name ?? trip.country, { font: "caption", color: "secondary", lineLimit: 1 }),
      ], { alignment: "leading", spacing: 2, padding: 10, background: TILE, cornerRadius: 14, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack([
        Widget.text(p.kind === "during" ? "TODAY THERE" : "FIRST DAY", { font: "caption2", weight: "bold", color: "secondary" }),
        day ? Widget.hstack([
          Widget.symbol(day.symbol, { size: 26, color: "orange", fallback: "🌤" }),
          Widget.vstack([
            Widget.text(`${fmtTemp(day.high)} / ${fmtTemp(day.low)}`, { font: "headline", design: "rounded" }),
            Widget.text(day.chance >= 0.2 ? `${Math.round(day.chance * 100)}% rain` : "Dry", { font: "caption2", color: "secondary" }),
          ], { alignment: "leading", spacing: 0 }),
        ], { spacing: 8 }) : Widget.text("Forecast not loaded", { font: "caption", color: "secondary" }),
        Widget.spacer(),
        fxLine(trip, "caption"),
        td ? Widget.text(`${td.local} there · ${td.label}`, { font: "caption2", color: "secondary", lineLimit: 1 }) : null,
        info?.dialling ? Widget.text(`${info.dialling} · drives ${info.driving ?? "–"}${info.plug ? ` · plug ${info.plug}` : ""}`, { font: "caption2", color: "secondary", lineLimit: 1 }) : null,
      ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 10, padding: 12, background: BG, url: APP_LINK, frame: fill });
  } else {
    const days = tripDays(trip, weatherInfo(trip)).slice(0, 5);
    const items = packingList(trip);
    const packed = Storage.get(packedKey(trip), []).filter((v) => items.some((i) => i.value === v)).length;
    const td = timeDifference(info);
    const fact = (label, value) => Widget.hstack([Widget.text(label, { font: "caption", color: "secondary" }), Widget.spacer(), Widget.text(value ?? "–", { font: "caption", weight: "semibold", lineLimit: 1, minimumScale: 0.7 })]);
    content = Widget.vstack([
      header,
      Widget.hstack([
        Widget.vstack([
          Widget.text(trip.name, { font: "title3", weight: "bold", lineLimit: 1, minimumScale: 0.7 }),
          Widget.text(info?.name ?? trip.country, { font: "caption", color: "secondary" }),
        ], { alignment: "leading", spacing: 0 }),
        Widget.spacer(),
        countdown(trip, 24),
      ], { alignment: "center" }),
      days.length ? Widget.hstack(days.map((d) => Widget.vstack([
        Widget.text(weekday(d.date), { font: "caption2", weight: "semibold", color: "secondary" }),
        Widget.symbol(d.symbol, { size: 18, color: "orange", fallback: "🌤" }),
        Widget.text(fmtTemp(d.high), { font: "caption", weight: "bold" }),
        Widget.text(fmtTemp(d.low), { font: "caption2", color: "secondary" }),
        Widget.text(d.chance >= 0.2 ? `${Math.round(d.chance * 100)}%` : " ", { font: "caption2", color: "blue" }),
      ], { spacing: 2, padding: 6, background: TILE, cornerRadius: 10, frame: { maxWidth: "infinity" } })), { spacing: 6 }) : Widget.text("Open the mini-app to load the forecast.", { font: "caption", color: "secondary" }),
      Widget.vstack([
        fxLine(trip, "subheadline") ?? Widget.text("Exchange rate not loaded", { font: "caption", color: "secondary" }),
        fact("Currency", info?.currency ? `${info.currency.name} (${info.currency.symbol})` : null),
        fact("Languages", info?.languages?.slice(0, 3).join(", ")),
        fact("Dialling · driving · plug", info ? `${info.dialling ?? "–"} · ${info.driving ?? "–"} · ${info.plug ?? "?"}` : null),
        fact("Time there", td ? `${td.local} · ${td.label}` : null),
      ], { alignment: "leading", spacing: 4, padding: 10, background: TILE, cornerRadius: 12, frame: { maxWidth: "infinity", alignment: "leading" } }),
      Widget.hstack([
        Widget.text("Packing", { font: "caption", weight: "semibold" }),
        Widget.progress(items.length ? packed / items.length : 0, { color: SKY }),
        Widget.text(`${packed}/${items.length}`, { font: "caption", weight: "semibold" }),
      ], { spacing: 8 }),
      Widget.spacer(),
      Widget.text(weatherInfo(trip)?.credit?.text ?? "Apple Weather", { font: "caption2", color: "secondary", url: weatherInfo(trip)?.credit?.url }),
    ], { alignment: "leading", spacing: 8, padding: 14, background: BG, url: APP_LINK, frame: fill });
  }
  return { content, refreshAt: tomorrow, refreshAfter: 3 * 60 * 60 };
});

// ───────────────────────── Run and background

Script.run(async (input) => {
  const trip = tripFor(input);
  if (!trip) return "No trips yet. Open Trip Dashboard in Scriptwell to add one.";
  await refresh(trip);
  const info = countryInfo(trip.countryCode);
  const day = firstDay(trip);
  const there = info?.currency?.code;
  const fx = there ? fxInfo(home().currency, there) : null;
  const td = timeDifference(info);
  return [
    `${phaseText(trip)} (${shortDate(midnight(trip.start))} to ${shortDate(midnight(trip.end))}).`,
    day ? `Weather on your first day: ${day.condition ?? ""} ${fmtTemp(day.high)}/${fmtTemp(day.low)}${day.chance >= 0.2 ? `, ${Math.round(day.chance * 100)}% chance of rain` : ""}.` : null,
    fx ? `1 ${home().currency} is ${fx.rate.toLocaleString(Script.env.locale, { maximumFractionDigits: 2 })} ${there}.` : null,
    td ? `It is ${td.local} there, ${td.label.toLowerCase()}.` : null,
    info ? `They drive on the ${info.driving}, dial ${info.dialling ?? "–"}, speak ${info.languages.slice(0, 2).join(" and ")}.` : null,
  ].filter(Boolean).join(" ");
});

Script.background(async () => {
  const trip = tripFor(null);
  if (trip) await refresh(trip);
});
