// @name        Portfolio Pulse
// @description Your stocks, ETFs and crypto in one place: total value, today's change, allocation, gain per holding and a 30-day history, all in the currency you choose. Contacts stooq.com, api.coingecko.com and api.frankfurter.app.
// @permissions network
// @widget      small, medium, large, rectangular, inline
// @icon        chart.line.uptrend.xyaxis
// @color       #0F766E
// @version     1.0.0
// @author      va4w
// @category    finance

// How it works
// • Enter holdings in the mini-app: symbol, quantity, cost per unit and kind. Stocks and ETFs use
//   Stooq symbols with an exchange suffix, for example AAPL.US, VUSA.UK, SAP.DE, 7203.JP. Crypto uses
//   CoinGecko ids such as bitcoin, ethereum, solana.
// • Prices come from stooq.com (one small CSV per symbol) and api.coingecko.com (one request for all
//   coins). Exchange rates come from api.frankfurter.app. Only symbols, coin ids and currency codes
//   are sent; quantities and costs never leave the device.
// • Quotes are cached for 10 minutes to stay well inside each service's limits. Today's change for
//   stocks is the move since the day's open; for crypto it is the 24-hour change.
// • A snapshot of the total is kept once a day in Storage for the 30-day chart. Set the widget
//   Parameter to "private" to hide amounts and show only percentages.

// ───────────────────────────────────────────── Constants

const STOOQ = "https://stooq.com/q/l/";
const COINGECKO = "https://api.coingecko.com/api/v3/simple/price";
const FRANKFURTER = "https://api.frankfurter.app/latest";
const QUOTE_FRESH = 10 * 60 * 1000;
const FX_FRESH = 6 * 60 * 60 * 1000;
const HISTORY_DAYS = 30;
const MAX_HOLDINGS = 30;

const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "JPY", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN", "HKD", "SGD", "NZD"];
const SUFFIX_CURRENCY = {
  us: "USD", uk: "GBP", de: "EUR", fr: "EUR", nl: "EUR", it: "EUR", es: "EUR", be: "EUR", pt: "EUR", fi: "EUR", at: "EUR",
  jp: "JPY", hk: "HKD", pl: "PLN", ca: "CAD", au: "AUD", ch: "CHF", se: "SEK", no: "NOK", dk: "DKK", sg: "SGD", nz: "NZD",
};
const TABS = ["Overview", "Holdings", "Add", "Settings"];
const TAB_SYMBOLS = ["chart.pie.fill", "list.bullet.rectangle", "plus.circle", "gearshape"];
const PALETTE = ["#0D9488", "#2563EB", "#F59E0B", "#DB2777", "#7C3AED", "#EA580C", "#16A34A", "#0891B2", "#9333EA", "#CA8A04"];
const UP = "#16A34A";
const DOWN = "#DC2626";
const TILE = { light: "#F0FDFA", dark: "#042F2E" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────────────────────────── Storage helpers

const settings = () => ({ currency: "USD", ...Storage.get("settings", {}) });
const holdings = () => Storage.get("holdings", []);
const quotes = () => Storage.get("quotes", { stocks: {}, crypto: {}, time: 0 });
const fxCache = () => Storage.get("fx", null);
const today = () => new Date().toLocaleDateString("en-CA");

const currencyFor = (symbol, kind) => {
  if (kind === "crypto") return "USD";
  const suffix = symbol.split(".").pop().toLowerCase();
  return SUFFIX_CURRENCY[suffix] ?? "USD";
};

function money(value, currency = settings().currency, compact = false) {
  if (value == null || Number.isNaN(value)) return "–";
  const digits = compact && Math.abs(value) >= 10_000 ? 0 : 2;
  try {
    return value.toLocaleString(Script.env.locale, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

const signed = (value, digits = 2) => `${value > 0 ? "+" : ""}${value.toLocaleString(Script.env.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const pct = (value) => (value == null || !Number.isFinite(value) ? "–" : `${signed(value * 100, 1)}%`);
const toneOf = (value) => (value > 0 ? UP : value < 0 ? DOWN : "secondary");
const parseNumber = (text) => {
  const n = Number(String(text ?? "").trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

// ───────────────────────────────────────────── Quotes

function parseStooq(csv) {
  const [header, row] = csv.trim().split(/\r?\n/);
  if (!header || !row) throw new Error("Empty answer from Stooq");
  const keys = header.split(",").map((k) => k.trim().toLowerCase());
  const values = row.split(",");
  const record = Object.fromEntries(keys.map((k, i) => [k, values[i]?.trim()]));
  const close = Number(record.close);
  if (!Number.isFinite(close)) throw new Error("No quote (check the symbol and its suffix)");
  const open = Number(record.open);
  return { price: close, open: Number.isFinite(open) && open > 0 ? open : close, date: record.date ?? "", time: record.time ?? "" };
}

async function fetchStock(symbol, timeout) {
  // Stooq wants a bare "h" flag, which URLSearchParams cannot express, so the query is written out.
  const url = `${STOOQ}?s=${encodeURIComponent(symbol.toLowerCase())}&f=sd2t2ohlcv&h&e=csv`;
  const response = await fetch(url, { timeout });
  if (!response.ok) throw new Error(`Stooq answered ${response.status}`);
  return parseStooq(await response.text());
}

async function fetchCrypto(ids, timeout) {
  const url = new URL(COINGECKO);
  url.searchParams.set("ids", ids.join(","));
  url.searchParams.set("vs_currencies", "usd");
  url.searchParams.set("include_24hr_change", "true");
  const response = await fetch(url, { timeout });
  if (!response.ok) throw new Error(`CoinGecko answered ${response.status}`);
  const data = await response.json();
  const out = {};
  for (const id of ids) {
    const entry = data[id];
    if (entry?.usd != null) out[id] = { price: entry.usd, change24h: (entry.usd_24h_change ?? 0) / 100 };
  }
  return out;
}

// Rates from the display currency to every other currency a holding uses.
async function fetchFx(base, others, timeout) {
  const url = new URL(FRANKFURTER);
  url.searchParams.set("from", base);
  url.searchParams.set("to", others.join(","));
  const response = await fetch(url, { timeout });
  if (!response.ok) throw new Error(`Frankfurter answered ${response.status}`);
  const data = await response.json();
  return { base, rates: data.rates ?? {}, time: Date.now() };
}

async function refreshQuotes(force = false) {
  const list = holdings();
  const cached = quotes();
  const errors = [];
  if (list.length === 0) return { ...cached, errors };
  const fresh = !force && Date.now() - cached.time < QUOTE_FRESH;
  const timeout = Script.env.mode === "widget" ? 5000 : 10000;
  const next = { stocks: { ...cached.stocks }, crypto: { ...cached.crypto }, time: cached.time, errors: [] };

  // While the cache is fresh, only symbols that have never been quoted are fetched.
  const stockSymbols = [...new Set(list.filter((h) => h.kind === "stock").map((h) => h.symbol.toUpperCase()))].filter((s) => !fresh || !next.stocks[s]);
  const coinIds = [...new Set(list.filter((h) => h.kind === "crypto").map((h) => h.symbol.toLowerCase()))].filter((id) => !fresh || !next.crypto[id]);
  if (stockSymbols.length || coinIds.length) {
    // A failed symbol is remembered as an error entry, so it is not retried until the cache expires.
    const jobs = stockSymbols.map(async (symbol) => {
      try { next.stocks[symbol] = { ...(await fetchStock(symbol, timeout)), time: Date.now() }; }
      catch (error) { next.stocks[symbol] = { error: error.message, time: Date.now() }; }
    });
    if (coinIds.length) {
      jobs.push((async () => {
        try {
          const prices = await fetchCrypto(coinIds, timeout);
          for (const id of coinIds) next.crypto[id] = prices[id] ? { ...prices[id], time: Date.now() } : { error: "unknown coin id", time: Date.now() };
        } catch (error) { errors.push(`Crypto: ${error.message}`); }
      })());
    }
    await Promise.all(jobs);
    if (!fresh) next.time = Date.now();
  }

  // Exchange rates, only for currencies that differ from the display currency.
  const base = settings().currency;
  const needed = [...new Set(list.map((h) => h.currency ?? currencyFor(h.symbol, h.kind)))].filter((c) => c !== base);
  const fx = fxCache();
  const fxStale = !fx || fx.base !== base || Date.now() - fx.time > FX_FRESH || needed.some((c) => !(c in fx.rates));
  if (needed.length && fxStale) {
    try { Storage.set("fx", await fetchFx(base, needed, timeout)); }
    catch (error) { errors.push(`Rates: ${error.message}`); }
  }

  for (const [symbol, q] of [...Object.entries(next.stocks), ...Object.entries(next.crypto)]) {
    if (q.error) errors.push(`${symbol}: ${q.error}`);
  }
  next.errors = errors;
  Storage.set("quotes", next);
  return next;
}

// ───────────────────────────────────────────── Valuation

function valuation(q = quotes()) {
  const base = settings().currency;
  const fx = fxCache();
  const rateTo = (currency) => {
    if (currency === base) return 1;
    const rate = fx?.base === base ? fx.rates[currency] : null;
    return rate ? 1 / rate : null;
  };
  const rows = holdings().map((h, i) => {
    const currency = h.currency ?? currencyFor(h.symbol, h.kind);
    const cached = h.kind === "crypto" ? q.crypto[h.symbol.toLowerCase()] : q.stocks[h.symbol.toUpperCase()];
    const quote = cached && !cached.error ? cached : null;
    const rate = rateTo(currency);
    if (!quote || rate == null) return { ...h, currency, color: PALETTE[i % PALETTE.length], value: null, missing: !quote ? "no quote" : "no rate" };
    const previous = h.kind === "crypto" ? quote.price / (1 + quote.change24h) : quote.open;
    const value = h.qty * quote.price * rate;
    const cost = h.qty * h.cost * rate;
    return {
      ...h, currency, quote, rate, color: PALETTE[i % PALETTE.length],
      price: quote.price, value, cost,
      dayChange: h.qty * (quote.price - previous) * rate,
      dayPct: previous ? quote.price / previous - 1 : 0,
      gain: value - cost,
      gainPct: cost ? value / cost - 1 : null,
    };
  });
  const priced = rows.filter((r) => r.value != null);
  const total = priced.reduce((s, r) => s + r.value, 0);
  const cost = priced.reduce((s, r) => s + r.cost, 0);
  const dayChange = priced.reduce((s, r) => s + r.dayChange, 0);
  const previousTotal = total - dayChange;
  return {
    rows, total, cost, dayChange,
    dayPct: previousTotal ? dayChange / previousTotal : 0,
    gain: total - cost,
    gainPct: cost ? total / cost - 1 : null,
    priced: priced.length,
    time: q.time,
  };
}

// One point per day; today's point is overwritten on every refresh.
function recordHistory(v) {
  if (v.priced === 0) return;
  const currency = settings().currency;
  const day = today();
  const history = Storage.get("history", []).filter((p) => p.day !== day && p.currency === currency);
  history.push({ day, value: Math.round(v.total * 100) / 100, currency });
  Storage.set("history", history.sort((a, b) => a.day.localeCompare(b.day)).slice(-HISTORY_DAYS));
}

const historyValues = () => Storage.get("history", []).filter((p) => p.currency === settings().currency);

async function load(force = false) {
  const q = await refreshQuotes(force);
  const v = valuation(q);
  recordHistory(v);
  return { v, errors: q.errors ?? [] };
}

// ───────────────────────────────────────────── Actions

const draft = () => ({ kind: "stock", symbol: "", qty: "", cost: "", currency: "", ...Storage.get("draft", {}) });
const setDraft = (changes) => Storage.set("draft", { ...draft(), ...changes });

Script.action("tab", ({ value }) => Storage.set("tab", value));
Script.action("field", ({ field, value }) => setDraft({ [field]: value }));
Script.action("kind", ({ value }) => setDraft({ kind: value, currency: "" }));
Script.action("currency", async ({ value }) => {
  Storage.set("settings", { ...settings(), currency: value });
  Storage.remove("fx");
  await load();
});

Script.action("save", async () => {
  const d = draft();
  const symbol = d.symbol.trim().replace(/\s+/g, "");
  const qty = parseNumber(d.qty);
  const cost = parseNumber(d.cost);
  if (!symbol) return UI.alert({ title: "Symbol missing", message: d.kind === "crypto" ? "Type a CoinGecko id such as bitcoin." : "Type a Stooq symbol such as AAPL.US." });
  if (d.kind === "stock" && !/\.[a-z]{2}$/i.test(symbol)) return UI.alert({ title: "Add the exchange suffix", message: "Stooq symbols end with the market, for example AAPL.US, VUSA.UK or SAP.DE." });
  if (qty == null || qty <= 0) return UI.alert({ title: "Quantity missing", message: "How many units do you hold?" });
  if (cost == null || cost < 0) return UI.alert({ title: "Cost missing", message: "What did one unit cost you? Use 0 if you do not know." });
  const list = holdings();
  if (!d.id && list.length >= MAX_HOLDINGS) return UI.alert({ title: "Portfolio full", message: `Up to ${MAX_HOLDINGS} holdings are supported.` });
  const entry = {
    id: d.id ?? crypto.randomUUID(),
    kind: d.kind,
    symbol: d.kind === "crypto" ? symbol.toLowerCase() : symbol.toUpperCase(),
    qty, cost,
    currency: d.currency || currencyFor(symbol, d.kind),
  };
  Storage.set("holdings", d.id ? list.map((h) => (h.id === d.id ? entry : h)) : [...list, entry]);
  Storage.remove("draft");
  Storage.set("tab", 1);
  const { errors } = await load();
  const mine = errors.find((e) => e.toLowerCase().startsWith(entry.symbol.toLowerCase()));
  if (mine) await UI.alert({ title: "Saved, but no price yet", message: mine });
});

Script.action("cancel", () => { Storage.remove("draft"); Storage.set("tab", 1); });

Script.action("holding", async ({ id }) => {
  const h = holdings().find((x) => x.id === id);
  if (!h) return;
  const choice = await UI.alert({ title: h.symbol, message: `${h.qty} × ${money(h.cost, h.currency)} cost basis`, buttons: ["Cancel", "Edit", "Remove"] });
  if (choice === 1) {
    Storage.set("draft", { id: h.id, kind: h.kind, symbol: h.symbol, qty: String(h.qty), cost: String(h.cost), currency: h.currency });
    Storage.set("tab", 2);
  }
  if (choice === 2) Storage.set("holdings", holdings().filter((x) => x.id !== id));
});

Script.action("refresh", async () => { await load(true); });

Script.action("clearHistory", async () => {
  const choice = await UI.alert({ title: "Clear the 30-day history?", buttons: ["Cancel", "Clear"] });
  if (choice === 1) Storage.remove("history");
});

Script.action("reset", async () => {
  const choice = await UI.alert({ title: "Remove all holdings?", message: "Holdings, history and cached prices are deleted from this device.", buttons: ["Cancel", "Remove"] });
  if (choice === 1) Storage.clear();
});

// ───────────────────────────────────────────── Mini-app panes

function changeLine(amount, ratio, label, font = "subheadline") {
  return Widget.hstack([
    Widget.symbol(amount >= 0 ? "arrow.up.right" : "arrow.down.right", { size: 12, color: toneOf(amount), fallback: amount >= 0 ? "↗" : "↘" }),
    Widget.text(`${money(amount)} (${pct(ratio)})`, { font, weight: "semibold", color: toneOf(amount) }),
    Widget.text(label, { font: "caption", color: "secondary" }),
  ], { spacing: 5 });
}

function overviewPane(v, errors) {
  if (holdings().length === 0) {
    return Widget.vstack([
      Widget.symbol("chart.line.uptrend.xyaxis", { size: 44, color: "teal", fallback: "📈" }),
      Widget.text("No holdings yet", { font: "headline" }),
      Widget.text("Add stocks, ETFs or crypto in the Add tab. Everything stays on this device.", { color: "secondary", align: "center" }),
    ], { spacing: 10, padding: 24, frame: { maxWidth: "infinity" } });
  }
  const history = historyValues();
  const allocation = v.rows.filter((r) => r.value > 0).map((r) => ({ x: r.symbol, y: Math.round(r.value * 100) / 100 }));
  return Widget.vstack([
    Widget.vstack([
      Widget.text("Total value", { font: "caption", color: "secondary" }),
      Widget.text(money(v.total), { font: 38, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.5 }),
      changeLine(v.dayChange, v.dayPct, "today"),
      changeLine(v.gain, v.gainPct, "since purchase", "footnote"),
      Widget.hstack([
        Widget.text(v.time ? "Prices" : "No prices yet", { font: "caption2", color: "secondary" }),
        v.time ? Widget.date(v.time, { style: "relative", font: "caption2", color: "secondary" }) : null,
        Widget.spacer(),
        Widget.button("Refresh", "refresh", null, { style: "bordered", color: "teal" }),
      ], { spacing: 4 }),
    ], { alignment: "leading", spacing: 4, padding: 16, background: TILE, cornerRadius: 16, frame: { maxWidth: "infinity", alignment: "leading" } }),
    errors.length ? Widget.text(errors.join("\n"), { font: "caption", color: "orange" }) : null,
    v.priced < v.rows.length ? Widget.text(`${v.rows.length - v.priced} holding${v.rows.length - v.priced === 1 ? "" : "s"} without a price are left out of the totals.`, { font: "caption", color: "secondary" }) : null,
    allocation.length ? Widget.card([
      Widget.chart(allocation, { kind: "donut", colors: v.rows.filter((r) => r.value > 0).map((r) => r.color), frame: { height: 220 } }),
    ], { title: "Allocation", symbol: "chart.pie.fill", color: "teal" }) : null,
    Widget.card([
      history.length >= 2
        ? Widget.chart(history.map((p) => ({ x: p.day.slice(5), y: p.value })), { kind: "line", smooth: true, color: v.gain >= 0 ? UP : DOWN, frame: { height: 180 } })
        : Widget.text("The chart fills in as the total is recorded once a day.", { font: "footnote", color: "secondary" }),
    ], { title: `Last ${HISTORY_DAYS} days`, subtitle: history.length ? `${history.length} day${history.length === 1 ? "" : "s"} recorded` : undefined, symbol: "calendar", color: "teal" }),
  ], { alignment: "leading", spacing: 14 });
}

function holdingsPane(v) {
  if (v.rows.length === 0) return Widget.text("Nothing here yet. Use the Add tab.", { color: "secondary", align: "center", padding: 24 });
  const sorted = [...v.rows].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  return Widget.vstack([
    Widget.list(sorted.map((r) => ({
      title: r.symbol,
      subtitle: r.value == null
        ? `${r.qty} units · ${r.missing}`
        : `${r.qty} × ${money(r.price, r.currency)} · ${pct(r.dayPct)} today`,
      detail: r.value == null ? "–" : `${money(r.value, settings().currency, true)}  ${pct(r.gainPct)}`,
      symbol: r.kind === "crypto" ? "bitcoinsign.circle.fill" : r.gain >= 0 ? "arrow.up.right.circle.fill" : "arrow.down.right.circle.fill",
      color: r.value == null ? "gray" : r.gain >= 0 ? "green" : "red",
      action: "holding",
      args: { id: r.id },
    })), { title: `${v.rows.length} holdings · ${money(v.total)}` }),
    Widget.text("Value in your display currency, then gain since purchase. Tap a row to edit or remove it.", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 10 });
}

function addPane() {
  const d = draft();
  const isCrypto = d.kind === "crypto";
  const guess = d.symbol ? currencyFor(d.symbol, d.kind) : "USD";
  const row = (label, control) => Widget.vstack([Widget.text(label, { font: "caption", color: "secondary" }), control], { alignment: "leading", spacing: 4 });
  return Widget.vstack([
    Widget.text(d.id ? "Edit holding" : "New holding", { font: "headline" }),
    Widget.picker([{ label: "Stock or ETF", value: "stock" }, { label: "Crypto", value: "crypto" }], d.kind, "kind", null, { style: "segmented" }),
    row(isCrypto ? "CoinGecko id" : "Stooq symbol", Widget.textField(isCrypto ? "bitcoin, ethereum, solana…" : "AAPL.US, VUSA.UK, SAP.DE…", d.symbol, "field", { field: "symbol" })),
    row("Quantity", Widget.textField("0", d.qty, "field", { field: "qty" }, { keyboard: "decimal" })),
    row(`Cost per unit (${d.currency || guess})`, Widget.textField("0.00", d.cost, "field", { field: "cost" }, { keyboard: "decimal" })),
    row("Quoted in", Widget.picker(CURRENCIES.map((c) => ({ label: c === guess ? `${c} (from the symbol)` : c, value: c })), d.currency || guess, "field", { field: "currency" })),
    Widget.hstack([
      Widget.button(d.id ? "Save changes" : "Add holding", "save", null, { style: "prominent", color: "teal" }),
      Widget.button("Cancel", "cancel", null, { style: "bordered" }),
    ], { spacing: 10 }),
    Widget.divider(),
    Widget.text(isCrypto
      ? "Crypto ids are the lower-case names CoinGecko uses in its URLs: bitcoin, ethereum, solana, cardano, dogecoin. Prices are quoted in USD and converted."
      : "Stooq symbols carry the market as a suffix: .US (NYSE, Nasdaq), .UK (London), .DE (Xetra), .FR, .NL, .JP, .HK, .CA, .AU, .CH, .PL. The suffix sets the quote currency; change it above if needed.",
      { font: "caption", color: "secondary" }),
  ], { alignment: "leading", spacing: 14 });
}

function settingsPane() {
  return Widget.vstack([
    Widget.picker(CURRENCIES, settings().currency, "currency", null, { label: "Display currency" }),
    Widget.text("Totals, values and the history chart use this currency. Rates come from api.frankfurter.app (European Central Bank data).", { font: "caption", color: "secondary" }),
    Widget.divider(),
    Widget.button("Refresh prices now", "refresh", null, { style: "bordered", color: "teal" }),
    Widget.button("Clear 30-day history", "clearHistory", null, { style: "bordered" }),
    Widget.button("Remove all holdings", "reset", null, { style: "bordered", color: "red" }),
    Widget.divider(),
    Widget.text("Prices are cached for 10 minutes. Stooq quotes can be delayed by 15 minutes or more depending on the exchange. Widget Parameter \"private\" hides amounts.", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 14 });
}

// ───────────────────────────────────────────── Mini-app

Script.ui(async () => {
  const tab = Storage.get("tab", 0);
  let v, errors = [];
  try { ({ v, errors } = await load()); }
  catch (error) { v = valuation(); errors = [error.message]; }
  const panes = [() => overviewPane(v, errors), () => holdingsPane(v), addPane, settingsPane];
  return {
    title: "Portfolio Pulse",
    content: Widget.vstack([
      Widget.tabs(TABS.map((title, i) => ({ title, symbol: TAB_SYMBOLS[i], content: i === tab ? panes[i]() : Widget.text("") })), { selected: tab, action: "tab" }),
    ], { padding: 16 }),
  };
});

// ───────────────────────────────────────────── Widget

function sparkline(height, color) {
  const values = historyValues().map((p) => p.value);
  if (values.length < 2) return Widget.text("history builds up daily", { font: "caption2", color: "secondary" });
  return Widget.chart(values, { kind: "area", axes: false, smooth: true, color, frame: { height } });
}

function holdingRow(r, hidden) {
  return Widget.hstack([
    { type: "stack", direction: "vertical", children: [], background: r.color, cornerRadius: 2, frame: { width: 4, height: 22 } },
    Widget.vstack([
      Widget.text(r.symbol, { font: "caption", weight: "semibold", lineLimit: 1 }),
      Widget.text(r.value == null ? r.missing : `${pct(r.dayPct)} today`, { font: "caption2", color: r.value == null ? "secondary" : toneOf(r.dayChange), lineLimit: 1 }),
    ], { alignment: "leading", spacing: 0 }),
    Widget.spacer(),
    Widget.vstack([
      Widget.text(r.value == null ? "–" : hidden ? "••••" : money(r.value, settings().currency, true), { font: "caption", weight: "semibold", design: "rounded", lineLimit: 1 }),
      Widget.text(r.value == null ? "" : pct(r.gainPct), { font: "caption2", color: toneOf(r.gain ?? 0), lineLimit: 1 }),
    ], { alignment: "trailing", spacing: 0 }),
  ], { spacing: 8 });
}

Script.widget(async ({ family, parameter }) => {
  const hidden = /private/i.test(parameter ?? "");
  let v;
  try { ({ v } = Script.env.lowPowerMode ? { v: valuation() } : await load()); }
  catch { v = valuation(); }

  const lockScreen = family === "rectangular" || family === "inline";
  if (holdings().length === 0) {
    if (family === "inline") return Widget.text("Portfolio: add holdings in Scriptwell");
    return Widget.vstack([
      Widget.symbol("chart.line.uptrend.xyaxis", { size: lockScreen ? 18 : 28, color: "teal", fallback: "📈" }),
      Widget.text("Open Portfolio Pulse to add holdings", { font: "caption", color: "secondary", align: "center", lineLimit: 3 }),
    ], { spacing: 6, url: APP_LINK });
  }

  const totalText = hidden ? "••••••" : money(v.total, settings().currency, true);
  const dayText = hidden ? pct(v.dayPct) : `${signed(v.dayChange, 0)} · ${pct(v.dayPct)}`;
  const tone = toneOf(v.dayChange);
  const arrow = v.dayChange >= 0 ? "arrow.up.right" : "arrow.down.right";

  if (family === "inline") return Widget.text(`Portfolio ${totalText} ${pct(v.dayPct)}`);
  if (family === "rectangular") {
    return Widget.vstack([
      Widget.text("PORTFOLIO", { font: "caption2", weight: "bold" }),
      Widget.text(totalText, { font: "title3", weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
      Widget.text(`${pct(v.dayPct)} today`, { font: "caption" }),
    ], { alignment: "leading", spacing: 1 });
  }

  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const root = { alignment: "leading", padding: 14, url: APP_LINK, frame: fill };
  const stamp = v.time ? Widget.date(v.time, { style: "relative", font: "caption2", color: "secondary" }) : null;
  const header = Widget.hstack([
    Widget.symbol("chart.line.uptrend.xyaxis", { size: 11, color: "teal", fallback: "📈" }),
    Widget.text("PORTFOLIO", { font: "caption2", weight: "bold", color: "secondary" }),
    Widget.spacer(),
    stamp,
  ], { spacing: 4 });
  const total = (font) => Widget.text(totalText, { font, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.5 });
  const change = (font) => Widget.hstack([
    Widget.symbol(arrow, { size: 10, color: tone, fallback: v.dayChange >= 0 ? "↗" : "↘" }),
    Widget.text(dayText, { font, weight: "semibold", color: tone, lineLimit: 1, minimumScale: 0.7 }),
  ], { spacing: 3 });
  const sorted = [...v.rows].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  let content;

  if (family === "small") {
    content = Widget.vstack([
      header,
      total(26),
      change("caption"),
      Widget.spacer(),
      sparkline(40, tone),
      Widget.text(`${pct(v.gainPct)} since purchase`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
    ], { ...root, spacing: 2 });
  } else if (family === "medium") {
    content = Widget.hstack([
      Widget.vstack([
        header,
        total(28),
        change("subheadline"),
        Widget.text(`${hidden ? "" : `${money(v.gain, settings().currency, true)} · `}${pct(v.gainPct)} since purchase`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
        Widget.spacer(),
        sparkline(44, tone),
      ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack([
        ...sorted.slice(0, 4).map((r) => holdingRow(r, hidden)),
        Widget.spacer(),
      ], { alignment: "leading", spacing: 5, frame: { width: 132, maxHeight: "infinity", alignment: "topLeading" } }),
    ], { ...root, spacing: 12 });
  } else {
    content = Widget.vstack([
      header,
      Widget.hstack([
        Widget.vstack([total(34), change("subheadline")], { alignment: "leading", spacing: 2 }),
        Widget.spacer(),
        Widget.vstack([
          Widget.text(hidden ? pct(v.gainPct) : money(v.gain, settings().currency, true), { font: "subheadline", weight: "semibold", color: toneOf(v.gain), lineLimit: 1 }),
          Widget.text(hidden ? "since purchase" : `${pct(v.gainPct)} since purchase`, { font: "caption2", color: "secondary" }),
        ], { alignment: "trailing", spacing: 1 }),
      ], { alignment: "top" }),
      Widget.vstack([sparkline(64, tone)], { padding: 8, background: TILE, cornerRadius: 12, frame: { maxWidth: "infinity" } }),
      ...sorted.slice(0, 7).map((r) => holdingRow(r, hidden)),
      sorted.length > 7 ? Widget.text(`and ${sorted.length - 7} more`, { font: "caption2", color: "secondary" }) : null,
      Widget.spacer(),
      Widget.text("stooq.com · coingecko.com · frankfurter.app", { font: "caption2", color: "secondary" }),
    ], { ...root, spacing: 6, padding: 16 });
  }

  return { content, refreshAfter: 15 * 60 };
});

// ───────────────────────────────────────────── Run

Script.run(async () => {
  if (holdings().length === 0) return "No holdings yet. Open Portfolio Pulse to add some.";
  const { v, errors } = await load();
  const lines = [
    `Portfolio ${money(v.total)}, ${signed(v.dayChange)} (${pct(v.dayPct)}) today, ${pct(v.gainPct)} since purchase.`,
    ...[...v.rows].sort((a, b) => (b.value ?? -1) - (a.value ?? -1)).slice(0, 8)
      .map((r) => (r.value == null ? `${r.symbol}: ${r.missing}` : `${r.symbol}: ${money(r.value)} (${pct(r.dayPct)} today)`)),
  ];
  if (errors.length) lines.push(`Problems: ${errors.join("; ")}`);
  return lines.join("\n");
});
