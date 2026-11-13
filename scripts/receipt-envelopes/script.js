// @name        Receipt Envelopes
// @description Envelope budgeting with receipt scanning: photograph a receipt, on-device AI reads the merchant, total and date, you confirm, and the expense lands in its envelope. Nothing leaves your device.
// @permissions camera
// @widget      small, medium, large
// @icon        envelope.open.fill
// @color       #B45309
// @version     1.0.0
// @author      va4w
// @category    finance

// How it works
// • Envelopes are categories with a monthly limit and a colour. Edit them in the Envelopes tab.
// • Add an expense by hand, or scan a receipt with the camera or a photo. Text is read with Vision
//   and the merchant, total, date and envelope are picked out by the on-device model (with a plain
//   pattern-matching fallback when the model is not available). You confirm in a form before saving.
// • Expenses are kept as JSON files in the script's folder, one per month. Export any month as CSV.
// • From Shortcuts or Siri, run the script with text such as "12.50 coffee" to file an expense; the
//   envelope is guessed from the words (coffee → Eating out) or named explicitly ("12.50 coffee fun").
// • The widget shows envelopes as progress bars that turn red when over the limit; the large size adds
//   the month's spending curve against budget pace. Set the Parameter to an envelope name to feature it.

// ───────────────────────────────────────────── Constants

const DEFAULT_ENVELOPES = [
  { id: "groceries", name: "Groceries", limit: 400, color: "#16A34A", symbol: "cart.fill", words: ["grocer", "supermarket", "market", "aldi", "lidl", "tesco", "costco", "walmart", "whole foods", "trader"] },
  { id: "eating", name: "Eating out", limit: 150, color: "#EA580C", symbol: "fork.knife", words: ["coffee", "cafe", "café", "lunch", "dinner", "restaurant", "pizza", "burger", "sushi", "bar", "pub", "takeaway", "bakery"] },
  { id: "transport", name: "Transport", limit: 120, color: "#2563EB", symbol: "tram.fill", words: ["uber", "lyft", "taxi", "bus", "train", "metro", "fuel", "petrol", "gas", "parking", "ticket", "shell", "bp"] },
  { id: "fun", name: "Fun", limit: 100, color: "#DB2777", symbol: "party.popper.fill", words: ["cinema", "movie", "game", "concert", "book", "museum", "netflix", "spotify", "steam"] },
  { id: "household", name: "Household", limit: 150, color: "#7C3AED", symbol: "house.fill", words: ["rent", "electric", "water", "internet", "phone", "ikea", "pharmacy", "cleaning", "repair"] },
  { id: "other", name: "Other", limit: 100, color: "#64748B", symbol: "tray.fill", words: [] },
];
const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "JPY", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN", "INR", "BRL", "NZD"];
const TABS = ["Month", "Expenses", "Envelopes", "Settings"];
const TAB_SYMBOLS = ["chart.bar.fill", "list.bullet", "envelope.fill", "gearshape"];
const OVER = "#DC2626";
const TILE = { light: "#FFFBEB", dark: "#2A1A05" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────────────────────────── Storage and Files helpers

const settings = () => ({ currency: "USD", ...Storage.get("settings", {}) });
const envelopes = () => Storage.get("envelopes", DEFAULT_ENVELOPES.map(({ words, ...e }) => e));
const envelopeById = (id) => envelopes().find((e) => e.id === id) ?? envelopes().at(-1);
const totalLimit = () => envelopes().reduce((s, e) => s + (e.limit || 0), 0);
const monthKey = (date = new Date()) => date.toLocaleDateString("en-CA").slice(0, 7);
const monthFile = (month) => `expenses/${month}.json`;
const summaryKey = (month) => `summary:${month}`;
const daysInMonth = (month) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
const monthName = (month) => new Date(`${month}-01T12:00:00`).toLocaleDateString(Script.env.locale, { month: "long", year: "numeric" });
const todayIso = () => new Date().toLocaleDateString("en-CA");

function money(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return "–";
  try {
    return value.toLocaleString(Script.env.locale, { style: "currency", currency: settings().currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch {
    return `${value.toFixed(digits)} ${settings().currency}`;
  }
}

async function readMonth(month) {
  const path = monthFile(month);
  if (!(await Files.exists(path))) return [];
  try { return await Files.readJSON(path); } catch { return []; }
}

async function writeMonth(month, list) {
  list.sort((a, b) => b.date.localeCompare(a.date) || b.added - a.added);
  await Files.writeJSON(monthFile(month), list);
  const months = new Set(Storage.get("months", []));
  months.add(month);
  Storage.set("months", [...months].sort().reverse().slice(0, 36));
  rebuildSummary(month, list);
}

// The widget reads this instead of the files: totals per envelope and the day-by-day curve.
function rebuildSummary(month, list) {
  const days = daysInMonth(month);
  const perEnvelope = {};
  const perDay = new Array(days).fill(0);
  for (const x of list) {
    perEnvelope[x.envelope] = (perEnvelope[x.envelope] ?? 0) + x.amount;
    const day = Number(x.date.slice(8, 10));
    if (day >= 1 && day <= days) perDay[day - 1] += x.amount;
  }
  const cumulative = [];
  perDay.reduce((sum, v, i) => (cumulative[i] = sum + v), 0);
  const last = list[0] ?? null;
  Storage.set(summaryKey(month), {
    month, perEnvelope, cumulative, count: list.length,
    total: list.reduce((s, x) => s + x.amount, 0),
    last: last ? { merchant: last.merchant, amount: last.amount, envelope: last.envelope } : null,
    time: Date.now(),
  });
}

const summary = (month = monthKey()) => Storage.get(summaryKey(month)) ?? { month, perEnvelope: {}, cumulative: [], count: 0, total: 0, last: null };

async function addExpense(expense) {
  const month = expense.date.slice(0, 7);
  const list = await readMonth(month);
  list.push({ id: crypto.randomUUID(), added: Date.now(), ...expense });
  await writeMonth(month, list);
}

// ───────────────────────────────────────────── Parsing receipts and text

function parseAmount(text) {
  const match = /(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{1,2})?/.exec(String(text ?? ""));
  if (!match) return null;
  const raw = match[0];
  const lastSep = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
  const decimals = lastSep >= 0 ? raw.length - lastSep - 1 : 0;
  const clean = decimals > 0 && decimals <= 2
    ? `${raw.slice(0, lastSep).replace(/[.,]/g, "")}.${raw.slice(lastSep + 1)}`
    : raw.replace(/[.,]/g, "");
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function parseDate(text) {
  const s = String(text ?? "");
  let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return normaliseDate(m[1], m[2], m[3]);
  m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    // Day-first unless the first number cannot be a day, or the locale is US-style.
    const usOrder = /-US$/i.test(Script.env.locale);
    const [a, b] = [Number(m[1]), Number(m[2])];
    const dayFirst = a > 12 ? true : b > 12 ? false : !usOrder;
    return dayFirst ? normaliseDate(year, m[2], m[1]) : normaliseDate(year, m[1], m[2]);
  }
  return null;
}

function normaliseDate(year, month, day) {
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(d.getTime()) || d > new Date(Date.now() + 86_400_000) || d.getFullYear() < 2000) return null;
  return d.toLocaleDateString("en-CA");
}

// Without the model: the largest amount near "total" wins, else the largest amount anywhere.
function heuristics(lines) {
  const texts = lines.map((l) => l.text);
  const amountsIn = (t) => (t.match(/\d+[.,]\d{2}\b/g) ?? []).map(parseAmount).filter((n) => n != null);
  const totalLines = texts.filter((t) => /total|amount due|balance due|to pay|sum|betrag|totaal|montant/i.test(t) && !/sub\s*-?total|tax|vat|mwst|change|cash/i.test(t));
  const candidates = (totalLines.length ? totalLines : texts).flatMap(amountsIn);
  const total = candidates.length ? Math.max(...candidates) : null;
  const date = texts.map(parseDate).find(Boolean) ?? null;
  const merchant = lines.find((l) => l.confidence > 0.5 && /[A-Za-z]{3,}/.test(l.text) && !/receipt|invoice|tel|www|total|\d{2}[:/.]\d{2}/i.test(l.text))?.text ?? null;
  return { merchant, total, date, category: null };
}

function envelopeFromWords(text) {
  const lower = ` ${String(text ?? "").toLowerCase()} `;
  const list = envelopes();
  const named = list.find((e) => lower.includes(` ${e.name.toLowerCase()} `) || lower.includes(` ${e.id} `));
  if (named) return named.id;
  for (const def of DEFAULT_ENVELOPES) {
    if (list.some((e) => e.id === def.id) && def.words.some((w) => lower.includes(w))) return def.id;
  }
  return list.at(-1).id;
}

async function extractReceipt(lines) {
  const text = lines.map((l) => l.text).join("\n").slice(0, 6000);
  const fallback = heuristics(lines);
  let result = fallback;
  let via = "patterns";
  try {
    const status = await AI.availability();
    if (status.available && text.trim()) {
      const names = envelopes().map((e) => e.name);
      const found = await AI.extract(text, {
        merchant: "string: the shop or restaurant name, usually at the top",
        total: "number: the final amount paid, including tax",
        date: "string: the purchase date exactly as written",
        category: names.join(" | "),
      });
      const envelope = envelopes().find((e) => e.name === found.category)?.id;
      result = {
        merchant: found.merchant ?? fallback.merchant,
        total: found.total ?? fallback.total,
        date: parseDate(found.date) ?? fallback.date,
        category: envelope ?? null,
      };
      via = "on-device AI";
    }
  } catch (error) {
    console.warn("AI extraction failed, using patterns:", error.message);
  }
  return {
    amount: result.total != null ? String(result.total.toFixed(2)) : "",
    merchant: (result.merchant ?? "").trim().slice(0, 40),
    date: result.date ?? todayIso(),
    envelope: result.category ?? envelopeFromWords(`${result.merchant ?? ""} ${text.slice(0, 200)}`),
    note: "",
    source: "scan",
    via,
    linesRead: lines.length,
  };
}

// ───────────────────────────────────────────── Actions: adding expenses

Script.action("tab", ({ value }) => Storage.set("tab", value));

Script.action("scan", async ({ source }) => {
  const photo = source === "camera" ? await Camera.capture() : await Photos.pick();
  if (!photo) return;
  try {
    const lines = await Vision.readText(photo);
    if (lines.length === 0) {
      await UI.alert({ title: "No text found", message: "Try again with the receipt flat and well lit." });
      return;
    }
    Storage.set("draft", await extractReceipt(lines));
  } finally {
    try { await Files.remove(photo.path); } catch { /* already gone */ }
  }
});

Script.action("manual", () => {
  Storage.set("draft", { amount: "", merchant: "", date: todayIso(), envelope: envelopes()[0].id, note: "", source: "manual", via: null });
});

Script.action("draft", ({ field, value }) => {
  const d = Storage.get("draft");
  if (!d) return;
  Storage.set("draft", { ...d, [field]: field === "date" ? String(value).slice(0, 10) : value });
});

Script.action("discard", () => Storage.remove("draft"));

Script.action("confirm", async () => {
  const d = Storage.get("draft");
  if (!d) return;
  const amount = parseAmount(d.amount);
  if (amount == null || amount <= 0) return UI.alert({ title: "Amount missing", message: "Type the total before saving." });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : todayIso();
  await addExpense({ date, amount: Math.round(amount * 100) / 100, merchant: (d.merchant || "").trim() || envelopeById(d.envelope).name, envelope: d.envelope, note: (d.note || "").trim(), source: d.source });
  Storage.remove("draft");
  Storage.set("viewMonth", date.slice(0, 7));
  await UI.haptic("success");
});

// ───────────────────────────────────────────── Actions: expenses, envelopes, settings

Script.action("viewMonth", ({ value }) => Storage.set("viewMonth", value));

Script.action("expense", async ({ id, month }) => {
  const list = await readMonth(month);
  const x = list.find((e) => e.id === id);
  if (!x) return;
  const choice = await UI.alert({ title: `${x.merchant} · ${money(x.amount)}`, message: `${envelopeById(x.envelope).name} · ${x.date}${x.note ? `\n${x.note}` : ""}`, buttons: ["Cancel", "Move to another envelope", "Delete"] });
  if (choice === 1) {
    const names = envelopes().map((e) => e.name);
    const pick = await UI.alert({ title: "Which envelope?", buttons: [...names.slice(0, 8), "Cancel"] });
    if (pick >= 0 && pick < Math.min(names.length, 8)) {
      x.envelope = envelopes()[pick].id;
      await writeMonth(month, list);
    }
  }
  if (choice === 2) await writeMonth(month, list.filter((e) => e.id !== id));
});

Script.action("envelope", ({ id, field, value }) => {
  Storage.set("envelopes", envelopes().map((e) => {
    if (e.id !== id) return e;
    if (field === "limit") { const n = parseAmount(value); return n == null ? e : { ...e, limit: n }; }
    if (field === "name") return value.trim() ? { ...e, name: value.trim().slice(0, 24) } : e;
    return { ...e, [field]: value };
  }));
});

Script.action("addEnvelope", async () => {
  const name = await UI.prompt({ title: "New envelope", placeholder: "Pets" });
  if (!name?.trim()) return;
  const id = `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
  Storage.set("envelopes", [...envelopes(), { id, name: name.trim().slice(0, 24), limit: 100, color: "#0891B2", symbol: "tray.fill" }]);
});

Script.action("removeEnvelope", async ({ id }) => {
  if (envelopes().length <= 1) return UI.alert("Keep at least one envelope.");
  const e = envelopeById(id);
  const choice = await UI.alert({ title: `Remove ${e.name}?`, message: "Past expenses keep their record and show under the last envelope.", buttons: ["Cancel", "Remove"] });
  if (choice === 1) Storage.set("envelopes", envelopes().filter((x) => x.id !== id));
});

Script.action("currency", ({ value }) => Storage.set("settings", { ...settings(), currency: value }));

Script.action("export", async ({ month }) => {
  const list = await readMonth(month);
  if (list.length === 0) return UI.alert(`No expenses in ${monthName(month)}.`);
  const escape = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const rows = list.map((x) => [x.date, escape(x.merchant), escape(envelopeById(x.envelope).name), x.amount.toFixed(2), escape(x.note), x.source].join(","));
  const path = `exports/expenses-${month}.csv`;
  await Files.write(path, ["date,merchant,envelope,amount,note,source", ...rows].join("\n"));
  const choice = await UI.alert({ title: `${list.length} expenses, ${money(list.reduce((s, x) => s + x.amount, 0))}`, message: "Save the CSV to Files or share it.", buttons: ["Cancel", "Save to Files", "Share"] });
  if (choice === 1) await Files.export(path, { name: `expenses-${month}.csv` });
  if (choice === 2) await UI.share({ file: path });
});

Script.action("reset", async () => {
  const choice = await UI.alert({ title: "Delete everything?", message: "All expenses, envelopes and settings are removed from this device.", buttons: ["Cancel", "Delete"] });
  if (choice !== 1) return;
  for (const month of Storage.get("months", [])) { try { await Files.remove(monthFile(month)); } catch { /* gone */ } }
  Storage.clear();
});

// ───────────────────────────────────────────── Mini-app pieces

function envelopeBar(e, spent, compact = false) {
  const ratio = e.limit > 0 ? spent / e.limit : 0;
  const over = spent > e.limit;
  return Widget.vstack([
    Widget.hstack([
      compact ? null : Widget.symbol(e.symbol ?? "tray.fill", { size: 11, color: over ? OVER : e.color, fallback: "▪" }),
      Widget.text(e.name, { font: compact ? "caption2" : "caption", weight: "semibold", lineLimit: 1, minimumScale: 0.7 }),
      Widget.spacer(),
      Widget.text(compact ? money(spent, 0) : `${money(spent, 0)} of ${money(e.limit, 0)}`, { font: compact ? "caption2" : "caption", color: over ? OVER : "secondary", weight: over ? "bold" : "regular", lineLimit: 1, minimumScale: 0.7 }),
    ], { spacing: 4 }),
    Widget.progress(Math.min(1, ratio), { color: over ? OVER : e.color }),
  ], { alignment: "leading", spacing: compact ? 1 : 3 });
}

function paceChart(s, height) {
  const days = daysInMonth(s.month);
  const current = s.month === monthKey();
  const until = current ? new Date().getDate() : days;
  const limit = totalLimit();
  const points = [];
  for (let d = 1; d <= until; d++) points.push({ x: d, y: Math.round((s.cumulative[d - 1] ?? 0) * 100) / 100, series: "Spent" });
  for (let d = 1; d <= days; d++) points.push({ x: d, y: Math.round((limit * d) / days), series: "Budget pace" });
  return Widget.chart(points, { kind: "line", colors: ["#B45309", "#94A3B8"], range: [0, Math.max(limit, s.total) * 1.05 || 1], frame: { height } });
}

function draftForm(d) {
  const e = envelopeById(d.envelope);
  const row = (label, control) => Widget.vstack([Widget.text(label, { font: "caption", color: "secondary" }), control], { alignment: "leading", spacing: 4 });
  return Widget.vstack([
    Widget.text(d.source === "scan" ? "Check the receipt" : "New expense", { font: "title3", weight: "bold" }),
    d.via ? Widget.text(`Read ${d.linesRead} lines · fields picked out by ${d.via}. Fix anything that looks wrong.`, { font: "caption", color: "secondary" }) : null,
    row(`Amount (${settings().currency})`, Widget.textField("0.00", d.amount, "draft", { field: "amount" }, { keyboard: "decimal" })),
    row("Merchant", Widget.textField("Where", d.merchant, "draft", { field: "merchant" })),
    row("Envelope", Widget.picker(envelopes().map((x) => ({ label: `${x.name} · ${money(summary().perEnvelope[x.id] ?? 0, 0)} of ${money(x.limit, 0)}`, value: x.id })), d.envelope, "draft", { field: "envelope" })),
    row("Date", Widget.datePicker(`${d.date}T12:00:00`, "draft", { field: "date" }, { mode: "date" })),
    row("Note", Widget.textField("Optional", d.note, "draft", { field: "note" })),
    Widget.hstack([
      Widget.button("Save expense", "confirm", null, { style: "prominent", color: e.color }),
      Widget.button("Discard", "discard", null, { style: "bordered", color: "red" }),
    ], { spacing: 10 }),
  ], { alignment: "leading", spacing: 14, padding: 16 });
}

function monthPane() {
  const s = summary();
  const list = envelopes();
  const limit = totalLimit();
  const days = daysInMonth(s.month);
  const day = new Date().getDate();
  const pace = (limit * day) / days;
  const ahead = s.total - pace;
  const ratio = limit ? s.total / limit : 0;
  return Widget.vstack([
    Widget.hstack([
      Widget.progress(Math.min(1, ratio), { style: "ring", color: s.total > limit ? OVER : "#B45309", label: `${Math.round(ratio * 100)}%` }),
      Widget.vstack([
        Widget.text(monthName(s.month), { font: "caption", color: "secondary" }),
        Widget.text(money(s.total), { font: 30, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
        Widget.text(`of ${money(limit, 0)} · ${money(Math.max(0, limit - s.total), 0)} left`, { font: "footnote", color: "secondary" }),
        Widget.text(ahead > 0 ? `${money(ahead, 0)} ahead of budget pace` : `${money(-ahead, 0)} under budget pace`, { font: "caption", weight: "semibold", color: ahead > 0 ? OVER : "#16A34A" }),
      ], { alignment: "leading", spacing: 2 }),
      Widget.spacer(),
    ], { spacing: 16, padding: 16, background: TILE, cornerRadius: 16, frame: { maxWidth: "infinity", alignment: "leading" } }),
    Widget.hstack([
      Widget.button("Scan receipt", "scan", { source: "camera" }, { style: "prominent", color: "#B45309" }),
      Widget.button("From photo", "scan", { source: "photos" }, { style: "bordered" }),
      Widget.button("By hand", "manual", null, { style: "bordered" }),
    ], { spacing: 8 }),
    Widget.card(list.map((e) => envelopeBar(e, s.perEnvelope[e.id] ?? 0)), { title: "Envelopes", symbol: "envelope.fill", color: "#B45309" }),
    Widget.card([
      Widget.chart(list.map((e) => ({ x: e.name, y: Math.round((s.perEnvelope[e.id] ?? 0) * 100) / 100, series: e.name })), { kind: "bar", colors: list.map((e) => e.color), frame: { height: 180 } }),
    ], { title: "Spend per envelope", symbol: "chart.bar.fill", color: "#B45309" }),
    Widget.card([
      paceChart(s, 180),
      Widget.text("Grey line: where spending would be if the whole budget were spread evenly over the month.", { font: "caption2", color: "secondary" }),
    ], { title: "Cumulative vs. budget pace", symbol: "chart.xyaxis.line", color: "#B45309" }),
  ], { alignment: "leading", spacing: 14 });
}

async function expensesPane() {
  const months = Storage.get("months", []);
  const month = Storage.get("viewMonth", monthKey());
  const list = await readMonth(month);
  const options = [...new Set([monthKey(), ...months])].sort().reverse().map((m) => ({ label: monthName(m), value: m }));
  return Widget.vstack([
    Widget.hstack([
      Widget.picker(options, month, "viewMonth"),
      Widget.spacer(),
      Widget.button("Export CSV", "export", { month }, { style: "bordered", color: "#B45309" }),
    ]),
    list.length === 0
      ? Widget.text(`No expenses in ${monthName(month)} yet.`, { color: "secondary", align: "center", padding: 24 })
      : Widget.list(list.slice(0, 90).map((x) => {
          const e = envelopeById(x.envelope);
          return { title: x.merchant, subtitle: [e.name, x.date, x.note].filter(Boolean).join(" · "), detail: money(x.amount), symbol: e.symbol ?? "tray.fill", color: e.color, action: "expense", args: { id: x.id, month } };
        }), { title: `${list.length} expenses · ${money(list.reduce((s, x) => s + x.amount, 0))}` }),
    list.length > 90 ? Widget.text(`Showing the latest 90. Export the CSV for everything.`, { font: "caption2", color: "secondary" }) : null,
    Widget.text("Tap an expense to move or delete it.", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 12 });
}

function envelopesPane() {
  const s = summary();
  return Widget.vstack([
    ...envelopes().map((e) => Widget.card([
      Widget.hstack([
        Widget.textField("Name", e.name, "envelope", { id: e.id, field: "name" }),
        Widget.textField("Limit", String(e.limit), "envelope", { id: e.id, field: "limit" }, { keyboard: "decimal", frame: { width: 110 } }),
      ], { spacing: 8 }),
      Widget.hstack([
        Widget.colorPicker(e.color, "envelope", { id: e.id, field: "color" }, { label: "Colour" }),
        Widget.spacer(),
        Widget.text(`${money(s.perEnvelope[e.id] ?? 0, 0)} this month`, { font: "caption", color: "secondary" }),
        Widget.menu("ellipsis.circle", [{ title: "Remove envelope", symbol: "trash", action: "removeEnvelope", args: { id: e.id }, destructive: true }]),
      ], { spacing: 8 }),
    ], { symbol: e.symbol ?? "tray.fill", color: e.color, title: e.name, subtitle: `${money(e.limit, 0)} per month` })),
    Widget.button("Add an envelope", "addEnvelope", null, { style: "bordered", color: "#B45309" }),
    Widget.text(`Monthly budget: ${money(totalLimit(), 0)} across ${envelopes().length} envelopes. Limits are per calendar month.`, { font: "caption", color: "secondary" }),
  ], { alignment: "leading", spacing: 12 });
}

async function settingsPane() {
  let ai = "checking…";
  try { const status = await AI.availability(); ai = status.available ? "available: receipts are read by the on-device model" : `not available (${status.reason}); receipts use pattern matching`; }
  catch { ai = "not available; receipts use pattern matching"; }
  return Widget.vstack([
    Widget.picker(CURRENCIES, settings().currency, "currency", null, { label: "Currency" }),
    Widget.text("Used for display only; amounts are stored as plain numbers.", { font: "caption", color: "secondary" }),
    Widget.divider(),
    Widget.text(`On-device AI ${ai}.`, { font: "footnote" }),
    Widget.text("Photos are read on the device with Vision and deleted right after. Nothing is uploaded anywhere.", { font: "caption", color: "secondary" }),
    Widget.divider(),
    Widget.text("Shortcuts and Siri: run this script with text like \"12.50 coffee\" or \"80 groceries weekly shop\" to file an expense without opening the app.", { font: "caption", color: "secondary" }),
    Widget.button("Delete everything", "reset", null, { style: "bordered", color: "red" }),
  ], { alignment: "leading", spacing: 14 });
}

// ───────────────────────────────────────────── Mini-app

Script.ui(async () => {
  const d = Storage.get("draft");
  if (d) return { title: "Receipt Envelopes", content: draftForm(d) };
  const tab = Storage.get("tab", 0);
  const panes = [monthPane, expensesPane, envelopesPane, settingsPane];
  const content = await panes[tab]();
  return {
    title: "Receipt Envelopes",
    content: Widget.vstack([
      Widget.tabs(TABS.map((title, i) => ({ title, symbol: TAB_SYMBOLS[i], content: i === tab ? content : Widget.text("") })), { selected: tab, action: "tab" }),
    ], { padding: 16 }),
  };
});

// ───────────────────────────────────────────── Widget

Script.widget(({ family, parameter }) => {
  const s = summary();
  const list = envelopes();
  const limit = totalLimit();
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const root = { alignment: "leading", padding: 14, url: APP_LINK, frame: fill };
  const wanted = (parameter ?? "").trim().toLowerCase();
  const featured = wanted ? list.find((e) => e.name.toLowerCase().includes(wanted)) : null;
  const spentOf = (e) => s.perEnvelope[e.id] ?? 0;
  const header = Widget.hstack([
    Widget.symbol("envelope.open.fill", { size: 11, color: "#B45309", fallback: "✉️" }),
    Widget.text(monthName(s.month).toUpperCase(), { font: "caption2", weight: "bold", color: "secondary", lineLimit: 1 }),
    Widget.spacer(),
    Widget.text(`${money(s.total, 0)} / ${money(limit, 0)}`, { font: "caption2", weight: "semibold", color: s.total > limit ? OVER : "secondary", lineLimit: 1, minimumScale: 0.7 }),
  ], { spacing: 4 });
  let content;

  if (featured && family !== "large") {
    const spent = spentOf(featured);
    const over = spent > featured.limit;
    const ratio = featured.limit ? spent / featured.limit : 0;
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol(featured.symbol ?? "tray.fill", { size: 14, color: over ? OVER : featured.color, fallback: "▪" }),
        Widget.text(featured.name.toUpperCase(), { font: "caption2", weight: "bold", color: "secondary", lineLimit: 1 }),
        Widget.spacer(),
        family === "medium" ? Widget.text(monthName(s.month), { font: "caption2", color: "secondary" }) : null,
      ], { spacing: 4 }),
      Widget.spacer(),
      Widget.hstack([
        Widget.progress(Math.min(1, ratio), { style: "ring", color: over ? OVER : featured.color, label: `${Math.round(ratio * 100)}%` }),
        Widget.vstack([
          Widget.text(money(spent, 0), { font: family === "small" ? 24 : 32, weight: "bold", design: "rounded", color: over ? OVER : "primary", lineLimit: 1, minimumScale: 0.5 }),
          Widget.text(over ? `${money(spent - featured.limit, 0)} over` : `${money(featured.limit - spent, 0)} left of ${money(featured.limit, 0)}`, { font: "caption", color: over ? OVER : "secondary", lineLimit: 1, minimumScale: 0.7 }),
        ], { alignment: "leading", spacing: 1 }),
      ], { spacing: 10 }),
      Widget.spacer(),
      Widget.progress(Math.min(1, ratio), { color: over ? OVER : featured.color }),
    ], { ...root, spacing: 4 });
  } else if (family === "small") {
    const top = [...list].sort((a, b) => (spentOf(b) / (b.limit || 1)) - (spentOf(a) / (a.limit || 1))).slice(0, 3);
    content = Widget.vstack([
      header,
      Widget.spacer(),
      ...top.map((e) => envelopeBar(e, spentOf(e), true)),
    ], { ...root, spacing: 6 });
  } else if (family === "medium") {
    const ratio = limit ? s.total / limit : 0;
    content = Widget.hstack([
      Widget.vstack([
        Widget.progress(Math.min(1, ratio), { style: "ring", color: s.total > limit ? OVER : "#B45309", label: `${Math.round(ratio * 100)}%` }),
        Widget.text(money(s.total, 0), { font: "headline", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
        Widget.text(`of ${money(limit, 0)}`, { font: "caption2", color: "secondary" }),
      ], { spacing: 2, frame: { width: 84 } }),
      Widget.vstack([
        Widget.text(monthName(s.month).toUpperCase(), { font: "caption2", weight: "bold", color: "secondary", lineLimit: 1 }),
        ...list.slice(0, 5).map((e) => envelopeBar(e, spentOf(e), true)),
        Widget.spacer(),
      ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { ...root, spacing: 12 });
  } else {
    content = Widget.vstack([
      header,
      ...list.slice(0, 8).map((e) => envelopeBar(e, spentOf(e))),
      Widget.vstack([paceChart(s, 100)], { padding: 6, background: TILE, cornerRadius: 12, frame: { maxWidth: "infinity" } }),
      Widget.spacer(),
      Widget.text(s.last ? `${s.count} expenses · last: ${s.last.merchant} ${money(s.last.amount)}` : "No expenses this month yet. Tap to add one.", { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
    ], { ...root, spacing: 7, padding: 16 });
  }

  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 5, 0);
  return { content, refreshAt: tomorrow };
});

// ───────────────────────────────────────────── Run (Shortcuts and Siri)

Script.run(async (input) => {
  const text = (input ?? "").trim();
  if (!text) {
    const s = summary();
    const parts = envelopes().map((e) => `${e.name} ${money(s.perEnvelope[e.id] ?? 0, 0)} of ${money(e.limit, 0)}`);
    return `${monthName(s.month)}: ${money(s.total)} of ${money(totalLimit(), 0)}. ${parts.join(", ")}.`;
  }
  const amount = parseAmount(text);
  if (amount == null || amount <= 0) return "Start with the amount, for example: 12.50 coffee";
  const words = text.replace(/(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{1,2})?/, "").replace(/^[\s:,.-]+/, "").trim();
  const envelopeId = envelopeFromWords(words);
  const e = envelopeById(envelopeId);
  const merchant = words.replace(new RegExp(`\\b${e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), "").trim() || e.name;
  await addExpense({ date: todayIso(), amount: Math.round(amount * 100) / 100, merchant: merchant.slice(0, 40), envelope: e.id, note: "", source: "shortcut" });
  const spent = summary().perEnvelope[e.id] ?? 0;
  return `Filed ${money(amount)} for ${merchant} in ${e.name}. ${e.name}: ${money(spent, 0)} of ${money(e.limit, 0)} this month${spent > e.limit ? " (over)" : ""}.`;
});
