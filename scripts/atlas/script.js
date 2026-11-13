// @name        Atlas
// @description Country facts from restcountries.com with flags (flagcdn.com), maps, local time, exchange rates from api.frankfurter.app and Apple Weather for the capital; search, compare two countries, keep favourites, and a country of the day widget
// @permissions network
// @widget      small, medium, large
// @icon        globe.europe.africa.fill
// @color       #0F766E
// @version     1.0.0
// @author      scriptwell
// @category    reference

// How it works
// • Country data (name, capital, population, area, languages, currencies, flag, time zones, borders) comes from restcountries.com. Only the name or country code you look up is sent.
// • Exchange rates between your home currency and the country's come from api.frankfurter.app, which covers about thirty major currencies; others are shown as unavailable.
// • Weather for the capital is Apple Weather, fetched in the mini-app and cached for the widget.
// • The widget shows a country of the day: set the widget Parameter to a country code such as JPN or a name, otherwise it rotates through your favourites, or a built-in list of sixty countries.
// • Flags are loaded as images from flagcdn.com (the address restcountries.com provides). Local time comes from the country's UTC offset and is refreshed every 15 minutes in the widget.

// ───────────────────────── Constants and helpers

const API = "https://restcountries.com/v3.1";
const FIELDS = "name,capital,region,subregion,population,area,languages,currencies,flags,latlng,capitalInfo,timezones,car,idd,borders,cca3,cca2";
const FEATURED = [
  "JPN", "FRA", "BRA", "KEN", "NZL", "ISL", "PER", "VNM", "MAR", "CAN", "ITA", "IND", "ARG", "NOR", "EGY", "THA", "MEX", "PRT", "ZAF", "KOR",
  "GRC", "CHL", "IDN", "TUR", "IRL", "COL", "AUS", "ESP", "NPL", "GHA", "FIN", "JOR", "CUB", "DEU", "PHL", "TZA", "URY", "CHE", "MNG", "SEN",
  "NLD", "LKA", "ECU", "POL", "MDG", "CRI", "AUT", "BTN", "NGA", "SWE", "GEO", "MYS", "HRV", "BOL", "DNK", "UZB", "ETH", "CZE", "OMN", "GBR",
];
const HOME_BY_REGION = {
  US: "USD", GB: "GBP", JP: "JPY", CN: "CNY", IN: "INR", CA: "CAD", AU: "AUD", NZ: "NZD", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN",
  CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN", TR: "TRY", BR: "BRL", MX: "MXN", KR: "KRW", SG: "SGD", HK: "HKD", ZA: "ZAR", IL: "ILS", ID: "IDR",
  MY: "MYR", PH: "PHP", TH: "THB", IS: "ISK", AR: "ARS", CL: "CLP", CO: "COP", AE: "AED", SA: "SAR", EG: "EGP", NG: "NGN", KE: "KES", PK: "PKR",
  VN: "VND", UA: "UAH", TW: "TWD",
};
const locale = Script.env.locale;
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const HOUR = 3_600_000;
const TEAL = "#0F766E";
const CARD_BG = { light: "#FFFFFF", dark: "#1C1C1E" };
const PAGE_BG = { light: "#F2F4F8", dark: "#000000" };
const SEA = Widget.gradient([{ light: "#E0F2F1", dark: "#0B2B2A" }, { light: "#F0FDFA", dark: "#111D1C" }], { direction: "topToBottom" });

const settings = () => ({ home: HOME_BY_REGION[(/[-_]([A-Za-z]{2})\b/.exec(locale) ?? [])[1]?.toUpperCase()] ?? "EUR", ...Storage.get("settings", {}) });
const favourites = () => Storage.get("favourites", []);
const ui = () => Storage.get("ui", { tab: 0, country: null, results: [], query: "", error: null, a: null, b: null });
const setUI = (changes) => Storage.set("ui", { ...ui(), ...changes });
const dayNumber = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60_000) / 86_400_000);

const emojiFlag = (cca2) => [...String(cca2 ?? "").toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
const number = (n, digits = 0) => Number(n ?? 0).toLocaleString(locale, { maximumFractionDigits: digits });
const compact = (n) => (n >= 1e9 ? `${number(n / 1e9, 2)} bn` : n >= 1e6 ? `${number(n / 1e6, 1)} M` : n >= 1e4 ? `${number(n / 1e3, 0)} k` : number(n));

function localTime(zone, now = new Date()) {
  if (!zone) return null;
  if (zone.includes("/")) {
    try { return now.toLocaleTimeString(locale, { timeZone: zone, hour: "2-digit", minute: "2-digit" }); } catch { /* fall through to offsets */ }
  }
  const match = /^UTC(?:([+-])(\d{1,2}):?(\d{2})?)?$/.exec(zone.trim());
  if (!match) return null;
  const minutes = match[1] ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 0;
  return new Date(now.getTime() + minutes * 60_000).toLocaleTimeString(locale, { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
}

// ───────────────────────── REST Countries

async function getJSON(url, timeout = 8000) {
  const response = await fetch(url, { timeout });
  if (!response.ok) {
    const error = new Error(`${new URL(url).hostname} returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function slim(c) {
  const suffixes = c.idd?.suffixes ?? [];
  return {
    cca3: c.cca3, cca2: c.cca2,
    name: c.name?.common ?? c.cca3, official: c.name?.official ?? "",
    capital: c.capital?.[0] ?? null,
    region: c.region ?? "", subregion: c.subregion ?? "",
    population: c.population ?? 0, area: c.area ?? 0,
    languages: Object.values(c.languages ?? {}),
    currencies: Object.entries(c.currencies ?? {}).map(([code, v]) => ({ code, name: v?.name ?? code, symbol: v?.symbol ?? "" })),
    flag: c.flags?.png ?? null, flagAlt: c.flags?.alt ?? "",
    latlng: c.latlng ?? null, capitalLatLng: c.capitalInfo?.latlng ?? c.latlng ?? null,
    timezones: c.timezones ?? [],
    drive: c.car?.side ?? null,
    calling: c.idd?.root ? `${c.idd.root}${suffixes.length === 1 ? suffixes[0] : ""}` : null,
    borders: c.borders ?? [],
    time: Date.now(),
  };
}

function cacheCountry(country) {
  const all = Storage.get("countries", {});
  all[country.cca3] = country;
  const keys = Object.keys(all).sort((a, b) => all[a].time - all[b].time);
  while (keys.length > 40) delete all[keys.shift()];
  Storage.set("countries", all);
  const names = Storage.get("names", {});
  names[country.cca3] = { name: country.name, cca2: country.cca2 };
  Storage.set("names", names);
}

async function countryByCode(code) {
  const cached = Storage.get("countries", {})[code];
  if (cached && Date.now() - cached.time < 24 * HOUR) return cached;
  try {
    const data = await getJSON(`${API}/alpha/${encodeURIComponent(code)}?fields=${FIELDS}`);
    const country = slim(Array.isArray(data) ? data[0] : data);
    cacheCountry(country);
    return country;
  } catch (error) {
    if (cached) return { ...cached, stale: true };
    throw error;
  }
}

async function searchCountries(query) {
  const q = query.trim();
  if (!q) return [];
  if (/^[A-Za-z]{2,3}$/.test(q)) {
    try { return [await countryByCode(q.toUpperCase())]; } catch (error) { if (error.status !== 404 && error.status !== 400) throw error; }
  }
  try {
    const data = await getJSON(`${API}/name/${encodeURIComponent(q)}?fields=${FIELDS}`);
    const list = (Array.isArray(data) ? data : []).map(slim);
    list.sort((a, b) => (a.name.toLowerCase() === q.toLowerCase() ? -1 : b.name.toLowerCase() === q.toLowerCase() ? 1 : a.name.localeCompare(b.name)));
    list.slice(0, 10).forEach(cacheCountry);
    return list.slice(0, 10);
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }
}

// Names for border chips: one request for every code not seen before.
async function borderNames(codes) {
  const names = Storage.get("names", {});
  const missing = codes.filter((c) => !names[c]);
  if (missing.length) {
    try {
      const data = await getJSON(`${API}/alpha?codes=${missing.join(",")}&fields=name,cca2,cca3`);
      for (const c of data) names[c.cca3] = { name: c.name?.common ?? c.cca3, cca2: c.cca2 };
      Storage.set("names", names);
    } catch { /* chips fall back to the code */ }
  }
  return codes.map((c) => ({ code: c, name: names[c]?.name ?? c, cca2: names[c]?.cca2 ?? "" }));
}

// ───────────────────────── Exchange rate and weather

async function exchange(from, to) {
  if (!from || !to) return null;
  if (from === to) return { from, to, same: true };
  const key = `fx:${from}:${to}`;
  const cached = Storage.get(key);
  if (cached && Date.now() - cached.time < 6 * HOUR) return cached;
  const url = new URL("https://api.frankfurter.app/latest");
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  let result;
  try {
    const data = await getJSON(url.href);
    const rate = data.rates?.[to];
    result = rate ? { from, to, rate, date: data.date, time: Date.now() } : { from, to, unsupported: true, time: Date.now() };
  } catch (error) {
    if (error.status === 404 || error.status === 422) result = { from, to, unsupported: true, time: Date.now() };
    else return cached ?? { from, to, error: error.message };
  }
  Storage.set(key, result);
  return result;
}

async function weatherFor(country, force = false) {
  if (!country.capitalLatLng) return null;
  const key = `wx:${country.cca3}`;
  const cached = Storage.get(key);
  if (!force && cached && Date.now() - cached.time < 30 * 60_000) return cached;
  try {
    const [latitude, longitude] = country.capitalLatLng;
    const now = await Weather.current({ latitude, longitude });
    let credit = Storage.get("credit");
    if (!credit) { credit = await Weather.attribution(); Storage.set("credit", credit); }
    const data = { temperature: now.temperature, symbol: now.symbol, description: now.description, humidity: now.humidity, windSpeed: now.windSpeed, time: Date.now() };
    Storage.set(key, data);
    return data;
  } catch {
    return cached ?? null;
  }
}

// ───────────────────────── Widget

function flagImage(country, size, cornerRadius = 6) {
  return country.flag
    ? Widget.image({ src: country.flag, size, cornerRadius })
    : Widget.text(emojiFlag(country.cca2), { font: Math.round(size * 0.6) });
}

function fact(label, value, { font = "caption" } = {}) {
  return Widget.vstack([
    Widget.text(label.toUpperCase(), { font: "caption2", weight: "bold", color: "secondary" }),
    Widget.text(value ?? "–", { font, weight: "semibold", lineLimit: 1, minimumScale: 0.7 }),
  ], { alignment: "leading", spacing: 0 });
}

function zoneText(country) {
  const time = localTime(country.timezones[0]);
  return time ? `${time}${country.timezones.length > 1 ? ` (+${country.timezones.length - 1} zones)` : ""}` : "–";
}

function pickCode(parameter) {
  const p = (parameter ?? "").trim();
  if (p) return p;
  const pool = favourites().length ? favourites() : FEATURED;
  return pool[dayNumber() % pool.length];
}

function widgetError(message) {
  return Widget.vstack([
    Widget.symbol("globe.europe.africa.fill", { size: 24, color: TEAL, fallback: "🌍" }),
    Widget.text(message, { font: "caption", color: "secondary", align: "center", lineLimit: 4 }),
  ], { spacing: 6, url: APP_LINK });
}

Script.widget(async ({ family, parameter }) => {
  const code = pickCode(parameter);
  let country;
  try {
    country = /^[A-Za-z]{2,3}$/.test(code) ? await countryByCode(code.toUpperCase()) : (await searchCountries(code))[0];
    if (!country) return widgetError(`No country matches “${code}”`);
  } catch (error) {
    return widgetError(`Could not load ${code}: ${error.message}`);
  }
  const wx = Storage.get(`wx:${country.cca3}`);
  const credit = Storage.get("credit");
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const currency = country.currencies[0];
  const clock = localTime(country.timezones[0]) ?? "–";
  const eyebrow = Widget.text(parameter ? country.region.toUpperCase() : "COUNTRY OF THE DAY", { font: "caption2", weight: "bold", color: TEAL });
  let content;

  if (family === "small") {
    content = Widget.vstack([
      Widget.hstack([flagImage(country, 44), Widget.spacer(), eyebrow], { alignment: "top" }),
      Widget.text(country.name, { font: "headline", lineLimit: 2, minimumScale: 0.7 }),
      Widget.text(country.capital ?? country.subregion, { font: "caption", color: "secondary", lineLimit: 1 }),
      Widget.spacer(),
      Widget.text(clock, { font: "title2", weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
      Widget.text(`local time · ${compact(country.population)} people`, { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 2, padding: 12, background: SEA, frame: fill, url: APP_LINK });
  } else if (family === "medium") {
    content = Widget.hstack([
      Widget.vstack([
        flagImage(country, 96, 8),
        Widget.text(country.name, { font: "headline", lineLimit: 2, minimumScale: 0.7 }),
        Widget.text(`${emojiFlag(country.cca2)} ${country.subregion || country.region}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
      ], { alignment: "leading", spacing: 3, frame: { width: 110, maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack([
        eyebrow,
        Widget.hstack([fact("Capital", country.capital), Widget.spacer(), fact("Local time", clock)], { spacing: 8 }),
        Widget.hstack([fact("Population", compact(country.population)), Widget.spacer(), fact("Area", `${compact(country.area)} km²`)], { spacing: 8 }),
        Widget.hstack([fact("Currency", currency ? `${currency.code}${currency.symbol ? ` ${currency.symbol}` : ""}` : null), Widget.spacer(), fact("Calling", country.calling)], { spacing: 8 }),
        Widget.spacer(),
        wx ? Widget.hstack([
          Widget.symbol(wx.symbol ?? "cloud.fill", { size: 12, color: "secondary", fallback: "☁️" }),
          Widget.text(`${country.capital ?? "Capital"} ${Math.round(wx.temperature)}° · ${wx.description ?? ""}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
          Widget.spacer(),
          Widget.text(credit?.text ?? "Apple Weather", { font: "caption2", color: "secondary", url: credit?.url }),
        ], { spacing: 4 }) : Widget.text(country.languages.slice(0, 3).join(", "), { font: "caption2", color: "secondary", lineLimit: 1 }),
      ], { alignment: "leading", spacing: 5, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 12, padding: 12, background: SEA, frame: fill, url: APP_LINK });
  } else {
    const [lat, lng] = country.capitalLatLng ?? country.latlng ?? [0, 0];
    const names = Storage.get("names", {});
    const borders = country.borders.map((b) => names[b]?.name ?? b);
    content = Widget.vstack([
      Widget.hstack([
        flagImage(country, 72, 8),
        Widget.vstack([
          eyebrow,
          Widget.text(country.name, { font: "title2", weight: "bold", lineLimit: 1, minimumScale: 0.7 }),
          Widget.text(country.official, { font: "caption", color: "secondary", lineLimit: 1 }),
          Widget.text(`${emojiFlag(country.cca2)} ${country.subregion || country.region}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
        ], { alignment: "leading", spacing: 1 }),
        Widget.spacer(),
      ], { spacing: 12, alignment: "top" }),
      Widget.hstack([fact("Capital", country.capital, { font: "subheadline" }), Widget.spacer(), fact("Local time", zoneText(country), { font: "subheadline" })], { spacing: 8 }),
      Widget.hstack([fact("Population", number(country.population), { font: "subheadline" }), Widget.spacer(), fact("Area", `${number(country.area)} km²`, { font: "subheadline" })], { spacing: 8 }),
      Widget.hstack([fact("Languages", country.languages.slice(0, 3).join(", ")), Widget.spacer(), fact("Currency", currency ? `${currency.name} (${currency.code})` : null)], { spacing: 8 }),
      Widget.map({ center: { latitude: lat, longitude: lng }, span: 250_000, pins: [{ latitude: lat, longitude: lng, title: country.capital ?? country.name, color: "teal" }], frame: { height: 96 } }),
      borders.length ? Widget.text(`Borders: ${borders.join(", ")}`, { font: "caption2", color: "secondary", lineLimit: 2 }) : Widget.text("No land borders", { font: "caption2", color: "secondary" }),
      Widget.spacer(),
      Widget.hstack([
        wx ? Widget.symbol(wx.symbol ?? "cloud.fill", { size: 12, color: "secondary", fallback: "☁️" }) : null,
        wx ? Widget.text(`${country.capital ?? "Capital"} ${Math.round(wx.temperature)}° · ${wx.description ?? ""}`, { font: "caption2", color: "secondary", lineLimit: 1 }) : Widget.text("restcountries.com", { font: "caption2", color: "secondary" }),
        Widget.spacer(),
        wx ? Widget.text(credit?.text ?? "Apple Weather", { font: "caption2", color: "secondary", url: credit?.url }) : null,
      ], { spacing: 4 }),
    ], { alignment: "leading", spacing: 8, padding: 14, background: SEA, frame: fill, url: APP_LINK });
  }

  return { content, refreshAfter: 15 * 60 };
});

// ───────────────────────── Mini-app actions

Script.action("tab", ({ value }) => setUI({ tab: value }));
Script.action("search", async ({ value }) => {
  try {
    const results = await searchCountries(value ?? "");
    if (results.length === 1) setUI({ country: results[0].cca3, results: [], query: "", error: null });
    else setUI({ results: results.map((c) => c.cca3), query: value, country: null, error: results.length ? null : `No country matches “${value}”.` });
  } catch (error) {
    setUI({ error: error.message });
  }
});
Script.action("open", ({ code }) => setUI({ tab: 0, country: code, results: [], error: null }));
Script.action("back", () => setUI({ country: null }));
Script.action("fav", ({ code }) => Storage.set("favourites", favourites().includes(code) ? favourites().filter((c) => c !== code) : [...favourites(), code]));
Script.action("compare", async ({ slot, value }) => {
  try {
    const [first] = await searchCountries(value ?? "");
    setUI({ [slot]: first?.cca3 ?? null, error: first ? null : `No country matches “${value}”.` });
  } catch (error) {
    setUI({ error: error.message });
  }
});
Script.action("swap", () => setUI({ a: ui().b, b: ui().a }));
Script.action("home", ({ value }) => { const code = String(value ?? "").trim().toUpperCase(); if (/^[A-Z]{3}$/.test(code)) Storage.set("settings", { ...settings(), home: code }); });
Script.action("refreshWeather", async ({ code }) => { const country = await countryByCode(code); await weatherFor(country, true); });
Script.action("directions", ({ lat, lng, name }) => UI.openURL(`maps://?ll=${lat},${lng}&q=${encodeURIComponent(name)}`));

// ───────────────────────── Mini-app pieces

function tile(label, value, symbol) {
  return Widget.vstack([
    Widget.hstack([
      Widget.symbol(symbol, { size: 11, color: TEAL, fallback: "•" }),
      Widget.text(label.toUpperCase(), { font: "caption2", weight: "bold", color: "secondary" }),
    ], { spacing: 4 }),
    Widget.text(value ?? "–", { font: "subheadline", weight: "semibold", lineLimit: 2, minimumScale: 0.7 }),
  ], { alignment: "leading", spacing: 3, padding: 10, background: CARD_BG, cornerRadius: 12, frame: { maxWidth: "infinity", alignment: "leading" } });
}

function chunk(list, size) {
  const rows = [];
  for (let i = 0; i < list.length; i += size) rows.push(list.slice(i, i + size));
  return rows;
}

async function countryPage(country) {
  const s = settings();
  const [lat, lng] = country.capitalLatLng ?? country.latlng ?? [0, 0];
  const currency = country.currencies[0];
  const [fx, wx, borders] = await Promise.all([
    exchange(s.home, currency?.code).catch(() => null),
    Script.env.mode === "app" ? weatherFor(country) : Promise.resolve(Storage.get(`wx:${country.cca3}`)),
    borderNames(country.borders),
  ]);
  const credit = Storage.get("credit");
  const fav = favourites().includes(country.cca3);
  const density = country.area ? country.population / country.area : 0;

  return Widget.vstack([
    Widget.hstack([
      Widget.button("‹ Search", "back", null, { style: "plain" }),
      Widget.spacer(),
      Widget.button(Widget.symbol(fav ? "heart.fill" : "heart", { size: 22, color: fav ? "red" : "secondary", fallback: fav ? "♥" : "♡" }), "fav", { code: country.cca3 }, { style: "plain" }),
    ]),
    Widget.hstack([
      flagImage(country, 110, 10),
      Widget.vstack([
        Widget.text(country.name, { font: "title2", weight: "bold", lineLimit: 2, minimumScale: 0.7 }),
        Widget.text(country.official, { font: "caption", color: "secondary", lineLimit: 2 }),
        Widget.text(`${emojiFlag(country.cca2)} ${[country.subregion, country.region].filter(Boolean).join(" · ")}`, { font: "caption", color: "secondary" }),
        country.stale ? Widget.text("Offline: cached data", { font: "caption2", color: "orange" }) : null,
      ], { alignment: "leading", spacing: 3 }),
    ], { spacing: 14, alignment: "top" }),
    Widget.hstack([tile("Capital", country.capital, "building.columns"), tile("Local time", zoneText(country), "clock")], { spacing: 8 }),
    Widget.hstack([tile("Population", number(country.population), "person.2"), tile("Area", `${number(country.area)} km²`, "square.dashed")], { spacing: 8 }),
    Widget.hstack([tile("Density", `${number(density, density < 10 ? 1 : 0)} per km²`, "chart.bar"), tile("Languages", country.languages.join(", ") || "–", "character.bubble")], { spacing: 8 }),
    Widget.hstack([tile("Currency", currency ? `${currency.name} (${currency.code}${currency.symbol ? ` ${currency.symbol}` : ""})` : null, "banknote"), tile("Calling code", country.calling, "phone")], { spacing: 8 }),
    Widget.hstack([tile("Drives on the", country.drive ? `${country.drive}` : null, "car"), tile("Time zones", country.timezones.slice(0, 3).join(", ") + (country.timezones.length > 3 ? ` +${country.timezones.length - 3}` : ""), "globe")], { spacing: 8 }),
    Widget.card([
      fx?.rate
        ? Widget.vstack([
            Widget.text(`1 ${fx.from} = ${number(fx.rate, fx.rate < 1 ? 4 : 2)} ${fx.to}`, { font: "title3", weight: "bold", design: "rounded" }),
            Widget.text(`100 ${fx.to} = ${number(100 / fx.rate, 2)} ${fx.from} · rate from ${fx.date} · api.frankfurter.app`, { font: "caption2", color: "secondary" }),
          ], { alignment: "leading", spacing: 2 })
        : Widget.text(fx?.same ? `${country.name} uses your home currency, ${fx.from}.` : fx?.unsupported ? `${currency?.code ?? "This currency"} is not covered by api.frankfurter.app.` : fx?.error ? `Rate unavailable: ${fx.error}` : "No currency information.", { font: "footnote", color: "secondary" }),
      Widget.textField("Home currency code, e.g. USD", s.home, "home", null, { label: "Home currency" }),
    ], { title: "Exchange rate", symbol: "arrow.left.arrow.right", color: TEAL }),
    Widget.card([
      wx ? Widget.hstack([
        Widget.symbol(wx.symbol ?? "cloud.fill", { size: 30, color: TEAL, fallback: "☁️" }),
        Widget.vstack([
          Widget.text(`${Math.round(wx.temperature)}° · ${wx.description ?? ""}`, { font: "title3", weight: "semibold" }),
          Widget.text(`Humidity ${Math.round((wx.humidity ?? 0) * 100)}% · wind ${Math.round(wx.windSpeed ?? 0)} km/h`, { font: "caption", color: "secondary" }),
        ], { alignment: "leading", spacing: 1 }),
        Widget.spacer(),
        Widget.button(Widget.symbol("arrow.clockwise", { size: 16, color: "secondary", fallback: "↻" }), "refreshWeather", { code: country.cca3 }, { style: "plain" }),
      ], { spacing: 10 }) : Widget.text("Weather is not available right now.", { font: "footnote", color: "secondary" }),
      Widget.hstack([
        wx ? Widget.hstack([Widget.text("Updated", { font: "caption2", color: "secondary" }), Widget.date(wx.time, { style: "relative", font: "caption2", color: "secondary" })], { spacing: 3 }) : null,
        Widget.spacer(),
        Widget.text(credit?.text ?? "Apple Weather", { font: "caption2", color: "secondary", url: credit?.url }),
      ]),
    ], { title: `Weather in ${country.capital ?? country.name}`, symbol: "cloud.sun.fill", color: "#F59E0B" }),
    Widget.map({ center: { latitude: lat, longitude: lng }, span: 400_000, pins: [{ latitude: lat, longitude: lng, title: country.capital ?? country.name, color: "teal" }], frame: { height: 240 } }),
    Widget.button("Open in Maps", "directions", { lat, lng, name: country.capital ?? country.name }, { style: "bordered" }),
    Widget.text(borders.length ? "BORDERS" : "NO LAND BORDERS", { font: "caption2", weight: "bold", color: "secondary" }),
    ...chunk(borders, 3).map((row) => Widget.hstack(row.map((b) => Widget.button(`${emojiFlag(b.cca2)} ${b.name}`, "open", { code: b.code }, { style: "bordered" })), { spacing: 6 })),
    Widget.text("Data: restcountries.com · flags: flagcdn.com", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 10 });
}

function chips(codes, label) {
  const names = Storage.get("names", {});
  if (!codes.length) return null;
  return Widget.vstack([
    Widget.text(label, { font: "caption2", weight: "bold", color: "secondary" }),
    ...chunk(codes.slice(0, 9), 3).map((row) => Widget.hstack(row.map((c) => Widget.button(`${emojiFlag(names[c]?.cca2)} ${names[c]?.name ?? c}`, "open", { code: c }, { style: "bordered" })), { spacing: 6 })),
  ], { alignment: "leading", spacing: 6 });
}

async function exploreTab(state) {
  if (state.country) {
    try { return await countryPage(await countryByCode(state.country)); }
    catch (error) { return Widget.vstack([Widget.text(`Could not load ${state.country}: ${error.message}`, { color: "orange" }), Widget.button("Back", "back", null, { style: "bordered" })], { spacing: 10 }); }
  }
  const all = Storage.get("countries", {});
  const recent = Object.values(all).sort((a, b) => b.time - a.time).slice(0, 6).map((c) => c.cca3);
  const todayCode = favourites().length ? favourites()[dayNumber() % favourites().length] : FEATURED[dayNumber() % FEATURED.length];
  return Widget.vstack([
    Widget.textField("Country name or code", state.query ?? "", "search", null, { keyboard: "search", label: "Search" }),
    state.error ? Widget.text(state.error, { font: "footnote", color: "orange" }) : null,
    state.results.length ? Widget.list(state.results.map((code) => ({
      title: all[code]?.name ?? code, subtitle: all[code]?.capital ?? undefined, detail: emojiFlag(all[code]?.cca2), action: "open", args: { code },
    })), { title: "Results" }) : null,
    Widget.button(Widget.hstack([
      Widget.symbol("sparkles", { size: 16, color: TEAL, fallback: "✦" }),
      Widget.vstack([
        Widget.text("Country of the day", { font: "subheadline", weight: "semibold" }),
        Widget.text(`${Storage.get("names", {})[todayCode]?.name ?? todayCode} · tap to explore`, { font: "caption", color: "secondary" }),
      ], { alignment: "leading", spacing: 1 }),
      Widget.spacer(),
      Widget.symbol("chevron.right", { size: 11, color: "secondary", fallback: "›" }),
    ], { spacing: 10, padding: 12, background: CARD_BG, cornerRadius: 12, frame: { maxWidth: "infinity" } }), "open", { code: todayCode }, { style: "plain" }),
    chips(recent, "RECENTLY VIEWED"),
    chips(FEATURED.slice(0, 9), "TRY ONE OF THESE"),
  ], { alignment: "leading", spacing: 12 });
}

async function compareTab(state) {
  const load = async (code) => { try { return code ? await countryByCode(code) : null; } catch { return null; } };
  const [a, b] = await Promise.all([load(state.a), load(state.b)]);
  const column = (c) => Widget.vstack([
    flagImage(c, 80, 8),
    Widget.text(c.name, { font: "headline", lineLimit: 2, minimumScale: 0.7 }),
    Widget.text(c.capital ?? "–", { font: "caption", color: "secondary" }),
  ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", alignment: "leading" } });
  const row = (label, va, vb) => Widget.vstack([
    Widget.text(label.toUpperCase(), { font: "caption2", weight: "bold", color: "secondary" }),
    Widget.hstack([
      Widget.text(va ?? "–", { font: "subheadline", weight: "medium", lineLimit: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
      Widget.text(vb ?? "–", { font: "subheadline", weight: "medium", lineLimit: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
    ], { spacing: 12 }),
  ], { alignment: "leading", spacing: 2 });
  const bars = (label, x, y, unit) => Widget.vstack([
    Widget.text(label.toUpperCase(), { font: "caption2", weight: "bold", color: "secondary" }),
    Widget.hstack([
      Widget.vstack([Widget.progress(x / Math.max(x, y, 1), { color: TEAL }), Widget.text(`${compact(x)}${unit}`, { font: "caption2", color: "secondary" })], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity" } }),
      Widget.vstack([Widget.progress(y / Math.max(x, y, 1), { color: "#F59E0B" }), Widget.text(`${compact(y)}${unit}`, { font: "caption2", color: "secondary" })], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity" } }),
    ], { spacing: 12 }),
  ], { alignment: "leading", spacing: 4 });

  return Widget.vstack([
    Widget.hstack([
      Widget.textField("First country", a?.name ?? "", "compare", { slot: "a" }, { keyboard: "search" }),
      Widget.textField("Second country", b?.name ?? "", "compare", { slot: "b" }, { keyboard: "search" }),
    ], { spacing: 8 }),
    state.error ? Widget.text(state.error, { font: "footnote", color: "orange" }) : null,
    a && b ? Widget.vstack([
      Widget.hstack([column(a), column(b)], { spacing: 12, alignment: "top" }),
      Widget.divider(),
      bars("Population", a.population, b.population, ""),
      bars("Area", a.area, b.area, " km²"),
      row("Density", `${number(a.population / (a.area || 1))} per km²`, `${number(b.population / (b.area || 1))} per km²`),
      row("Region", [a.subregion, a.region].filter(Boolean).join(", "), [b.subregion, b.region].filter(Boolean).join(", ")),
      row("Languages", a.languages.slice(0, 3).join(", "), b.languages.slice(0, 3).join(", ")),
      row("Currency", a.currencies.map((c) => c.code).join(", "), b.currencies.map((c) => c.code).join(", ")),
      row("Local time", zoneText(a), zoneText(b)),
      row("Calling code", a.calling, b.calling),
      row("Drives on the", a.drive, b.drive),
      Widget.hstack([
        Widget.button("Swap", "swap", null, { style: "bordered" }),
        Widget.button(`Open ${a.name}`, "open", { code: a.cca3 }, { style: "bordered" }),
        Widget.button(`Open ${b.name}`, "open", { code: b.cca3 }, { style: "bordered" }),
      ], { spacing: 8 }),
    ], { alignment: "leading", spacing: 12, padding: 14, background: CARD_BG, cornerRadius: 16 }) : Widget.vstack([
      Widget.symbol("arrow.left.arrow.right.square", { size: 36, color: "secondary", fallback: "⇄" }),
      Widget.text("Type two countries to compare them side by side.", { font: "footnote", color: "secondary", align: "center" }),
    ], { spacing: 8, padding: 24, frame: { maxWidth: "infinity" } }),
  ], { alignment: "leading", spacing: 12 });
}

function favouritesTab() {
  const names = Storage.get("names", {});
  const all = Storage.get("countries", {});
  if (!favourites().length) {
    return Widget.vstack([
      Widget.symbol("heart", { size: 36, color: "secondary", fallback: "♡" }),
      Widget.text("Tap the heart on a country to keep it here. The widget rotates through your favourites.", { font: "footnote", color: "secondary", align: "center" }),
    ], { spacing: 8, padding: 24, frame: { maxWidth: "infinity" } });
  }
  return Widget.vstack([
    Widget.list(favourites().map((code) => ({
      title: names[code]?.name ?? code,
      subtitle: all[code] ? `${all[code].capital ?? ""} · ${compact(all[code].population)} people` : undefined,
      detail: emojiFlag(names[code]?.cca2),
      action: "open", args: { code },
    }))),
    Widget.text(`${favourites().length} favourite${favourites().length === 1 ? "" : "s"}. Open one and tap the heart to remove it.`, { font: "caption", color: "secondary" }),
  ], { alignment: "leading", spacing: 10 });
}

// ───────────────────────── Mini-app

Script.ui(async () => {
  const state = ui();
  const panes = [
    { title: "Explore", symbol: "magnifyingglass", content: state.tab === 0 ? await exploreTab(state) : Widget.text("") },
    { title: "Compare", symbol: "arrow.left.arrow.right", content: state.tab === 1 ? await compareTab(state) : Widget.text("") },
    { title: "Favourites", symbol: "heart", content: state.tab === 2 ? favouritesTab() : Widget.text("") },
  ];
  return {
    title: "Atlas",
    content: Widget.vstack([
      Widget.tabs(panes, { selected: state.tab, action: "tab" }),
    ], { padding: 16, background: PAGE_BG, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "top" } }),
  };
});

// ───────────────────────── Shortcuts and Siri

Script.run(async (input) => {
  const query = (input ?? "").trim() || pickCode(null);
  let country;
  try {
    [country] = await searchCountries(query);
  } catch (error) {
    return `Could not reach restcountries.com: ${error.message}`;
  }
  if (!country) return `No country matches “${query}”.`;
  const currency = country.currencies[0];
  return `${country.name} (${country.cca3}): capital ${country.capital ?? "none"}, ${number(country.population)} people, ${number(country.area)} km², ${country.languages.slice(0, 3).join(", ") || "no listed languages"}, currency ${currency ? `${currency.name} (${currency.code})` : "none"}, local time ${zoneText(country)}.`;
});
