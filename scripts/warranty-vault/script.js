// @name        Warranty Vault
// @description Keeps your receipts, warranties and return windows in one place: photograph a receipt, on-device AI reads the store, date and total, and you get a notification a week before each deadline. Nothing leaves the device.
// @permissions camera, notifications
// @widget      small, medium, large
// @icon        shield.checkered
// @color       #0F766E
// @version     1.0.0
// @author      va4w
// @category    shopping

// How it works
// • Photograph a receipt (or pick one from Photos). Vision reads the text on the device and the on-device
//   AI model pulls out the store, date, total and items; a plain regex takes over when the model is missing.
//   You confirm or correct everything before it is saved.
// • Each purchase has a warranty length (6–60 months) and a return window (14–90 days). The script works out
//   the return deadline and the warranty end, and schedules a notification 7 days before each one.
// • The mini-app lists purchases by soonest deadline with status badges (returnable, under warranty, expired),
//   search, a detail page with the receipt picture and a share button, the total value still under warranty,
//   and an archive for things you no longer own.
// • Widget: the next deadlines; the large size adds the value under warranty and a count by status.
// • Receipts are stored in the script's own Files folder. No network, no accounts, nothing uploaded.

// ───────────────────────────────────────────── Constants

const DAY = 86_400_000;
const WARRANTY_OPTIONS = [6, 12, 24, 36, 60];
const RETURN_OPTIONS = [14, 30, 60, 90];
const NOTIFY_DAYS_BEFORE = 7;
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const TILE_BG = { light: "#F1F5F9", dark: "#1E293B" };

const STATUS = {
  returnable: { label: "Returnable", symbol: "arrow.uturn.backward.circle.fill", color: "green", hex: "#22C55E" },
  warranty: { label: "Under warranty", symbol: "shield.checkered", color: "teal", hex: "#14B8A6" },
  expired: { label: "Expired", symbol: "clock.badge.xmark", color: "gray", hex: "#94A3B8" },
};

const CURRENCY_BY_REGION = { GB: "GBP", US: "USD", CA: "CAD", AU: "AUD", NZ: "NZD", JP: "JPY", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", IN: "INR", BR: "BRL", MX: "MXN", ZA: "ZAR", KR: "KRW", CN: "CNY", SG: "SGD", HK: "HKD" };
const localeRegion = (Script.env.locale.split(/[-_]/)[1] ?? "").toUpperCase();
const DEFAULT_CURRENCY = CURRENCY_BY_REGION[localeRegion] ?? "EUR";

// ───────────────────────────────────────────── Storage

const purchases = () => Storage.get("purchases", []);
const savePurchases = (list) => Storage.set("purchases", list);
const settings = () => ({ currency: DEFAULT_CURRENCY, notify: true, hour: 9, ...Storage.get("settings", {}) });
const ui = () => Storage.get("ui", { page: "list", filter: "active", query: "" });
const setUi = (changes) => Storage.set("ui", { ...ui(), ...changes });

// ───────────────────────────────────────────── Dates and money

const isoDay = (date) => new Date(date).toLocaleDateString("en-CA");
const today = () => isoDay(new Date());

function addMonths(iso, months) {
  const d = new Date(`${iso}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return isoDay(d);
}

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDay(d);
}

const daysUntil = (iso) => Math.round((new Date(`${iso}T12:00:00`) - new Date(`${today()}T12:00:00`)) / DAY);

function money(value) {
  if (value == null || Number.isNaN(value)) return "–";
  try {
    return value.toLocaleString(Script.env.locale, { style: "currency", currency: settings().currency, maximumFractionDigits: 2 });
  } catch {
    return `${value.toFixed(2)} ${settings().currency}`;
  }
}

const longDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(Script.env.locale, { day: "numeric", month: "short", year: "numeric" });

function daysText(days) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} ago`;
  return `in ${days} days`;
}

// ───────────────────────────────────────────── Derived state

function derive(p) {
  const returnBy = addDays(p.date, p.returnDays);
  const warrantyEnd = addMonths(p.date, p.warrantyMonths);
  const returnLeft = daysUntil(returnBy);
  const warrantyLeft = daysUntil(warrantyEnd);
  const status = returnLeft >= 0 ? "returnable" : warrantyLeft >= 0 ? "warranty" : "expired";
  const next = returnLeft >= 0
    ? { kind: "return", label: "Return by", date: returnBy, days: returnLeft }
    : warrantyLeft >= 0
      ? { kind: "warranty", label: "Warranty ends", date: warrantyEnd, days: warrantyLeft }
      : { kind: "none", label: "Warranty ended", date: warrantyEnd, days: warrantyLeft };
  const total = Math.max(1, daysUntil(warrantyEnd) - daysUntil(p.date));
  const elapsed = Math.min(1, Math.max(0, -daysUntil(p.date) / total));
  return { ...p, returnBy, warrantyEnd, returnLeft, warrantyLeft, status, next, elapsed };
}

function active() {
  return purchases().filter((p) => !p.archived).map(derive).sort((a, b) => {
    const rank = (x) => (x.next.kind === "none" ? 1 : 0);
    return rank(a) - rank(b) || a.next.days - b.next.days;
  });
}

function totals(list) {
  const covered = list.filter((p) => p.status !== "expired");
  return {
    value: covered.reduce((sum, p) => sum + (p.price ?? 0), 0),
    counts: { returnable: list.filter((p) => p.status === "returnable").length, warranty: list.filter((p) => p.status === "warranty").length, expired: list.filter((p) => p.status === "expired").length },
  };
}

// ───────────────────────────────────────────── Notifications

async function schedule(p) {
  const d = derive(p);
  const s = settings();
  await Notification.cancel(`return:${p.id}`);
  await Notification.cancel(`warranty:${p.id}`);
  if (!s.notify || p.archived) return;
  const when = (iso) => {
    let at = new Date(`${addDays(iso, -NOTIFY_DAYS_BEFORE)}T00:00:00`);
    at.setHours(s.hour, 0, 0, 0);
    if (at <= new Date()) { at = new Date(); at.setDate(at.getDate() + 1); at.setHours(s.hour, 0, 0, 0); }
    return at < new Date(`${iso}T23:59:00`) ? at : null;
  };
  const returnAt = when(d.returnBy);
  if (returnAt) {
    await Notification.schedule({ id: `return:${p.id}`, title: `Return window closing: ${p.product}`, body: `You can still return it to ${p.store || "the shop"} until ${longDate(d.returnBy)}.`, at: returnAt });
  }
  const warrantyAt = when(d.warrantyEnd);
  if (warrantyAt) {
    await Notification.schedule({ id: `warranty:${p.id}`, title: `Warranty ending: ${p.product}`, body: `The ${p.warrantyMonths}-month warranty ends ${longDate(d.warrantyEnd)}. Check it over while you can still claim.`, at: warrantyAt });
  }
}

async function rescheduleAll() {
  for (const p of purchases()) await schedule(p);
}

// ───────────────────────────────────────────── Reading a receipt

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthDayFirst = /^en-US$/i.test(Script.env.locale);

// Turns the many ways a date is printed into YYYY-MM-DD, or null.
function parseDate(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const year = (y) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  const build = (y, m, d) => {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  let m;
  if ((m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t))) return build(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(t))) {
    const a = Number(m[1]), b = Number(m[2]), y = year(m[3]);
    if (a > 12) return build(y, b, a);
    if (b > 12) return build(y, a, b);
    return monthDayFirst ? build(y, a, b) : build(y, b, a);
  }
  if ((m = /(\d{1,2})\s*(?:st|nd|rd|th)?\s+([a-z]{3,})\.?\s+(\d{2,4})/.exec(t))) {
    const idx = MONTHS.indexOf(m[2].slice(0, 3));
    if (idx >= 0) return build(year(m[3]), idx + 1, Number(m[1]));
  }
  if ((m = /([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})/.exec(t))) {
    const idx = MONTHS.indexOf(m[1].slice(0, 3));
    if (idx >= 0) return build(year(m[3]), idx + 1, Number(m[2]));
  }
  return null;
}

function amountsIn(text) {
  return (text.match(/\d{1,6}[.,]\d{2}(?!\d)/g) ?? []).map((s) => Number(s.replace(",", ".")));
}

// The regex reading: used when the model is missing, and to fill any field it left empty.
function regexRead(lines) {
  const texts = lines.map((l) => l.text);
  const totalLine = texts.find((t) => /\b(total|amount due|balance|summe|totale|montant)\b/i.test(t) && amountsIn(t).length);
  const all = texts.flatMap(amountsIn);
  const total = totalLine ? Math.max(...amountsIn(totalLine)) : all.length ? Math.max(...all) : null;
  const date = texts.map(parseDate).find(Boolean) ?? null;
  const store = texts.find((t) => /[a-z]{3,}/i.test(t) && !/\d{3,}/.test(t) && t.length <= 32) ?? null;
  const items = texts
    .filter((t) => amountsIn(t).length && /[a-z]{3,}/i.test(t) && !/\b(total|subtotal|tax|vat|change|cash|card|visa|mastercard)\b/i.test(t))
    .map((t) => t.replace(/\s*\d{1,6}[.,]\d{2}.*$/, "").trim())
    .filter((t) => t.length > 1)
    .slice(0, 12);
  return { store, date, total, items };
}

async function readReceipt(photo) {
  const lines = await Vision.readText(photo);
  const sure = lines.filter((l) => l.confidence > 0.3);
  const fallback = regexRead(sure);
  let source = "regex";
  let result = fallback;
  try {
    const status = await AI.availability();
    if (status.available && sure.length) {
      const text = sure.map((l) => l.text).join("\n").slice(0, 8000);
      const ai = await AI.extract(text, {
        store: "string: the shop or company name at the top",
        date: "string: the purchase date exactly as written",
        total: "number: the final amount paid, including tax",
        items: [{ name: "string: a product line, without its price" }],
      });
      result = {
        store: ai.store?.trim() || fallback.store,
        date: parseDate(ai.date) ?? fallback.date,
        total: typeof ai.total === "number" && ai.total > 0 ? ai.total : fallback.total,
        items: ai.items?.length ? ai.items.map((i) => i.name).filter(Boolean).slice(0, 12) : fallback.items,
      };
      source = "ai";
    }
  } catch (error) {
    console.warn("On-device AI could not read the receipt:", error.message);
  }
  return { ...result, source, lineCount: lines.length };
}

// Keep the picture under the purchase's own name so it survives the 20-photo limit of images/.
async function keepReceipt(photo, id) {
  const path = `receipts/${id}.jpg`;
  const bytes = await Files.readBytes(photo.path);
  await Files.writeBytes(path, bytes);
  await Files.remove(photo.path);
  return path;
}

// ───────────────────────────────────────────── Drafts

function blankDraft() {
  return { id: crypto.randomUUID(), product: "", store: "", date: today(), price: null, warrantyMonths: 24, returnDays: 30, receipt: null, items: [], source: null };
}

async function startFromPhoto(photo) {
  if (!photo) return;
  const draft = blankDraft();
  draft.receipt = await keepReceipt(photo, draft.id);
  try {
    const read = await readReceipt(draft.receipt);
    draft.store = read.store ?? "";
    draft.date = read.date ?? today();
    draft.price = read.total;
    draft.items = read.items;
    draft.product = read.items[0] ?? "";
    draft.source = read.lineCount ? read.source : "none";
  } catch (error) {
    draft.source = "none";
    console.warn("Could not read the receipt:", error.message);
  }
  setUi({ page: "edit", draft, editing: null });
}

// ───────────────────────────────────────────── Actions

Script.action("capture", async () => startFromPhoto(await Camera.capture()));
Script.action("pick", async () => startFromPhoto(await Photos.pick()));
Script.action("manual", () => setUi({ page: "edit", draft: blankDraft(), editing: null }));

Script.action("open", ({ id }) => setUi({ page: "detail", selected: id }));
Script.action("page", ({ page }) => setUi({ page, draft: null, editing: null }));
Script.action("filter", ({ value }) => setUi({ filter: value }));
Script.action("query", ({ value }) => setUi({ query: value ?? "" }));

Script.action("draft", ({ field, value }) => {
  const draft = ui().draft ?? blankDraft();
  if (field === "price") {
    const n = Number(String(value).replace(/[^\d.,-]/g, "").replace(",", "."));
    draft.price = Number.isFinite(n) && value.trim() ? n : null;
  } else if (field === "date") {
    draft.date = isoDay(value);
  } else if (field === "warrantyMonths" || field === "returnDays") {
    draft[field] = Number(value);
  } else {
    draft[field] = String(value).trim();
  }
  setUi({ draft });
});

Script.action("draftPhoto", async ({ from }) => {
  const draft = ui().draft ?? blankDraft();
  const photo = from === "camera" ? await Camera.capture() : await Photos.pick();
  if (!photo) return;
  if (draft.receipt) { try { await Files.remove(draft.receipt); } catch { /* fine */ } }
  draft.receipt = await keepReceipt(photo, draft.id);
  setUi({ draft });
});

Script.action("save", async () => {
  const draft = ui().draft;
  if (!draft) return;
  if (!draft.product.trim()) { await UI.alert({ title: "What did you buy?", message: "Give the purchase a product name." }); return; }
  const existing = purchases().find((p) => p.id === draft.id);
  const record = { ...(existing ?? { created: Date.now(), archived: false }), ...draft, product: draft.product.trim(), store: draft.store.trim() };
  delete record.source;
  savePurchases(existing ? purchases().map((p) => (p.id === record.id ? record : p)) : [record, ...purchases()]);
  await schedule(record);
  setUi({ page: "detail", selected: record.id, draft: null });
  await UI.haptic("success");
});

Script.action("cancel", async () => {
  const draft = ui().draft;
  const isNew = draft && !purchases().some((p) => p.id === draft.id);
  if (isNew && draft.receipt) { try { await Files.remove(draft.receipt); } catch { /* fine */ } }
  setUi({ page: isNew ? "list" : "detail", draft: null });
});

Script.action("edit", ({ id }) => {
  const p = purchases().find((x) => x.id === id);
  if (p) setUi({ page: "edit", draft: { ...p, source: null }, editing: id });
});

Script.action("archive", async ({ id, archived }) => {
  savePurchases(purchases().map((p) => (p.id === id ? { ...p, archived } : p)));
  const p = purchases().find((x) => x.id === id);
  if (p) await schedule(p);
});

Script.action("share", async ({ id }) => {
  const p = purchases().find((x) => x.id === id);
  if (p?.receipt && (await Files.exists(p.receipt))) await UI.share({ file: p.receipt });
  else if (p) await UI.share(`${p.product} from ${p.store || "unknown shop"} on ${longDate(p.date)}, ${money(p.price)}. Warranty until ${longDate(derive(p).warrantyEnd)}.`);
});

Script.action("delete", async ({ id }) => {
  const p = purchases().find((x) => x.id === id);
  if (!p) return;
  const choice = await UI.alert({ title: `Delete ${p.product}?`, message: "The receipt picture and its reminders are removed too. This cannot be undone.", buttons: ["Cancel", "Delete"] });
  if (choice !== 1) return;
  await Notification.cancel(`return:${id}`);
  await Notification.cancel(`warranty:${id}`);
  if (p.receipt) { try { await Files.remove(p.receipt); } catch { /* fine */ } }
  savePurchases(purchases().filter((x) => x.id !== id));
  setUi({ page: "list", selected: null });
});

Script.action("setting", async ({ key, value, isOn }) => {
  Storage.set("settings", { ...settings(), [key]: value ?? isOn });
  if (key === "notify" || key === "hour") await rescheduleAll();
});

// ───────────────────────────────────────────── Shared pieces

function badge(status, font = "caption2") {
  const s = STATUS[status];
  return Widget.text(s.label, {
    font, weight: "bold", color: s.color, lineLimit: 1,
    padding: { horizontal: 6, vertical: 2 }, background: { light: `${s.hex}26`, dark: `${s.hex}40` }, cornerRadius: 6,
  });
}

function deadlineRow(p, compact = false) {
  const s = STATUS[p.status];
  const urgent = p.next.kind !== "none" && p.next.days <= NOTIFY_DAYS_BEFORE;
  return Widget.hstack([
    Widget.symbol(s.symbol, { size: compact ? 14 : 18, color: s.color, fallback: "🧾" }),
    Widget.vstack([
      Widget.text(p.product, { font: compact ? "footnote" : "subheadline", weight: "medium", lineLimit: 1 }),
      Widget.text(`${p.next.label} ${longDate(p.next.date)}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 0 }),
    Widget.spacer(),
    Widget.text(p.next.kind === "none" ? "expired" : daysText(p.next.days), { font: compact ? "caption" : "subheadline", weight: "semibold", design: "rounded", color: urgent ? "orange" : "primary", lineLimit: 1 }),
  ], { spacing: 8 });
}

function statTile(label, value, color) {
  return Widget.vstack([
    Widget.text(String(value), { font: "title3", weight: "bold", design: "rounded", color }),
    Widget.text(label, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
  ], { alignment: "leading", spacing: 0, padding: 8, background: TILE_BG, cornerRadius: 10, frame: { maxWidth: "infinity", alignment: "leading" } });
}

// ───────────────────────────────────────────── Widget

Script.widget(({ family }) => {
  const list = active();
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const midnight = new Date(); midnight.setHours(24, 0, 10, 0);

  if (list.length === 0) {
    return {
      content: Widget.vstack([
        Widget.symbol("shield.checkered", { size: 30, color: "teal", fallback: "🛡" }),
        Widget.text("Warranty Vault", { font: "headline" }),
        Widget.text("Add a purchase in Scriptwell", { font: "caption2", color: "secondary", align: "center" }),
      ], { spacing: 4, url: APP_LINK }),
      refreshAt: midnight,
    };
  }

  const upcoming = list.filter((p) => p.next.kind !== "none");
  const first = upcoming[0] ?? list[0];
  const { value, counts } = totals(list);
  let content;

  if (family === "small") {
    const s = STATUS[first.status];
    const urgent = first.next.kind !== "none" && first.next.days <= NOTIFY_DAYS_BEFORE;
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol(s.symbol, { size: 13, color: s.color, fallback: "🧾" }),
        Widget.text(first.next.label.toUpperCase(), { font: "caption2", weight: "bold", color: "secondary", lineLimit: 1 }),
      ], { spacing: 4 }),
      Widget.text(first.product, { font: "headline", lineLimit: 2, minimumScale: 0.8 }),
      Widget.spacer(),
      Widget.text(first.next.kind === "none" ? "Expired" : first.next.days === 0 ? "Today" : `${first.next.days} d`, { font: 34, weight: "bold", design: "rounded", color: urgent ? "orange" : s.color }),
      Widget.text(first.next.kind === "none" ? longDate(first.next.date) : `${longDate(first.next.date)} · ${upcoming.length} tracked`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
    ], { alignment: "leading", spacing: 2, url: APP_LINK, frame: fill });
  } else if (family === "medium") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("shield.checkered", { size: 14, color: "teal", fallback: "🛡" }),
        Widget.text("Next deadlines", { font: "headline" }),
        Widget.spacer(),
        Widget.text(`${money(value)} covered`, { font: "caption", color: "secondary", lineLimit: 1 }),
      ], { spacing: 6 }),
      ...(upcoming.length ? upcoming.slice(0, 3).map((p) => deadlineRow(p, true)) : [Widget.text("Nothing returnable or under warranty.", { font: "caption", color: "secondary" })]),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 5, url: APP_LINK, frame: fill });
  } else {
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("shield.checkered", { size: 16, color: "teal", fallback: "🛡" }),
        Widget.text("Warranty Vault", { font: "headline" }),
        Widget.spacer(),
        Widget.text(`${list.length} purchases`, { font: "caption", color: "secondary" }),
      ], { spacing: 6 }),
      Widget.vstack([
        Widget.text("VALUE UNDER WARRANTY", { font: "caption2", weight: "bold", color: "secondary" }),
        Widget.text(money(value), { font: 30, weight: "bold", design: "rounded", color: "teal", lineLimit: 1, minimumScale: 0.6 }),
      ], { alignment: "leading", spacing: 0, padding: 10, background: { light: "#14B8A61A", dark: "#14B8A633" }, cornerRadius: 12, frame: { maxWidth: "infinity", alignment: "leading" } }),
      Widget.hstack([
        statTile("Returnable", counts.returnable, "green"),
        statTile("Under warranty", counts.warranty, "teal"),
        statTile("Expired", counts.expired, "gray"),
      ], { spacing: 6 }),
      Widget.text("NEXT DEADLINES", { font: "caption2", weight: "bold", color: "secondary" }),
      ...(upcoming.length ? upcoming.slice(0, 5).map((p) => deadlineRow(p, false)) : [Widget.text("Nothing returnable or under warranty.", { font: "caption", color: "secondary" })]),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 7, url: APP_LINK, frame: fill });
  }

  return { content, refreshAt: midnight };
});

// ───────────────────────────────────────────── Mini-app pages

function listPage() {
  const state = ui();
  const all = purchases().map(derive);
  const live = all.filter((p) => !p.archived);
  const { value, counts } = totals(live);
  const query = (state.query ?? "").trim().toLowerCase();
  const filter = state.filter ?? "active";
  let shown = filter === "archived" ? all.filter((p) => p.archived) : live.filter((p) => filter === "active" || p.status === filter);
  if (query) shown = shown.filter((p) => `${p.product} ${p.store} ${(p.items ?? []).join(" ")}`.toLowerCase().includes(query));
  shown.sort((a, b) => (a.next.kind === "none") - (b.next.kind === "none") || a.next.days - b.next.days);

  const rows = shown.map((p) => ({
    title: p.product,
    subtitle: `${p.store || "Unknown shop"} · ${p.next.label} ${longDate(p.next.date)}`,
    symbol: STATUS[p.status].symbol,
    color: STATUS[p.status].color,
    detail: p.archived ? "archived" : p.next.kind === "none" ? money(p.price) : daysText(p.next.days),
    action: "open",
    args: { id: p.id },
  }));

  return Widget.vstack([
    Widget.vstack([
      Widget.text("VALUE UNDER WARRANTY", { font: "caption2", weight: "bold", color: "secondary" }),
      Widget.text(money(value), { font: 36, weight: "bold", design: "rounded", color: "teal" }),
      Widget.hstack([
        statTile("Returnable", counts.returnable, "green"),
        statTile("Under warranty", counts.warranty, "teal"),
        statTile("Expired", counts.expired, "gray"),
      ], { spacing: 8 }),
    ], { alignment: "leading", spacing: 6, padding: 14, background: { light: "#14B8A61A", dark: "#14B8A633" }, cornerRadius: 16 }),
    Widget.hstack([
      Widget.button("Scan receipt", "capture", null, { style: "prominent", color: "teal" }),
      Widget.button("From Photos", "pick", null, { style: "bordered" }),
      Widget.button("Manual", "manual", null, { style: "bordered" }),
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [{ title: "Settings", symbol: "gearshape", action: "page", args: { page: "settings" } }]),
    ], { spacing: 8 }),
    Widget.textField("Search product, shop or item", state.query ?? "", "query", null, { keyboard: "search" }),
    Widget.picker([
      { label: "Active", value: "active" }, { label: "Returnable", value: "returnable" }, { label: "Warranty", value: "warranty" }, { label: "Expired", value: "expired" }, { label: "Archived", value: "archived" },
    ], filter, "filter", null, { style: "segmented" }),
    rows.length
      ? Widget.list(rows, { title: `${rows.length} purchase${rows.length === 1 ? "" : "s"}` })
      : Widget.vstack([
          Widget.symbol("doc.text.viewfinder", { size: 44, color: "secondary", fallback: "🧾" }),
          Widget.text(all.length ? "Nothing matches" : "No purchases yet", { font: "headline" }),
          Widget.text(all.length ? "Try another filter or search." : "Scan a receipt and the store, date and total are read for you.", { font: "footnote", color: "secondary", align: "center" }),
        ], { spacing: 6, padding: 24, frame: { maxWidth: "infinity" } }),
  ], { alignment: "leading", spacing: 14, padding: 16 });
}

function detailPage() {
  const p = purchases().map(derive).find((x) => x.id === ui().selected);
  if (!p) return Widget.vstack([Widget.button("‹ Back", "page", { page: "list" }, { style: "plain" })], { padding: 16 });
  const s = STATUS[p.status];
  const fact = (label, value, color) => Widget.hstack([
    Widget.text(label, { color: "secondary" }), Widget.spacer(), Widget.text(value, { weight: "semibold", color: color ?? "primary", align: "trailing" }),
  ]);
  return Widget.vstack([
    Widget.hstack([
      Widget.button("‹ Back", "page", { page: "list" }, { style: "plain" }),
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [
        { title: "Edit", symbol: "pencil", action: "edit", args: { id: p.id } },
        { title: "Share receipt", symbol: "square.and.arrow.up", action: "share", args: { id: p.id } },
        { title: p.archived ? "Unarchive" : "Archive", symbol: "archivebox", action: "archive", args: { id: p.id, archived: !p.archived } },
        { title: "Delete", symbol: "trash", action: "delete", args: { id: p.id }, destructive: true },
      ]),
    ]),
    p.receipt ? Widget.image({ file: p.receipt, cornerRadius: 14, frame: { maxWidth: "infinity" } }) : null,
    Widget.hstack([badge(p.status, "caption"), p.archived ? Widget.text("Archived", { font: "caption", color: "secondary" }) : null], { spacing: 8 }),
    Widget.text(p.product, { font: "title2", weight: "bold" }),
    Widget.text(`${p.store || "Unknown shop"} · ${longDate(p.date)} · ${money(p.price)}`, { color: "secondary" }),
    Widget.card([
      fact("Return by", `${longDate(p.returnBy)} · ${daysText(p.returnLeft)}`, p.returnLeft >= 0 ? "green" : "secondary"),
      fact("Warranty ends", `${longDate(p.warrantyEnd)} · ${daysText(p.warrantyLeft)}`, p.warrantyLeft >= 0 ? "teal" : "secondary"),
      Widget.progress(p.elapsed, { color: p.warrantyLeft >= 0 ? "teal" : "gray" }),
      Widget.text(`${p.warrantyMonths}-month warranty · ${p.returnDays}-day return window`, { font: "caption", color: "secondary" }),
    ], { title: "Deadlines", symbol: "calendar.badge.clock", color: "teal" }),
    p.items?.length ? Widget.card(p.items.map((i) => Widget.text(`• ${i}`, { font: "footnote" })), { title: "On the receipt", symbol: "list.bullet.rectangle", color: "gray" }) : null,
    Widget.text(settings().notify && !p.archived && p.next.kind !== "none"
      ? `You will be notified ${NOTIFY_DAYS_BEFORE} days before each deadline, at ${String(settings().hour).padStart(2, "0")}:00.`
      : "No reminders for this purchase.", { font: "caption", color: "secondary" }),
    Widget.hstack([
      Widget.button("Share receipt", "share", { id: p.id }, { style: "prominent", color: "teal" }),
      Widget.button("Edit", "edit", { id: p.id }, { style: "bordered" }),
    ], { spacing: 8 }),
  ], { alignment: "leading", spacing: 12, padding: 16 });
}

function editPage() {
  const d = ui().draft ?? blankDraft();
  const row = (label, control) => Widget.vstack([Widget.text(label, { font: "caption", color: "secondary" }), control], { alignment: "leading", spacing: 4 });
  const preview = derive({ ...d, product: d.product || "?" });
  const hint = d.source === "ai" ? "Read by the on-device model from your receipt. Check and correct before saving."
    : d.source === "regex" ? "Read from the receipt text without the AI model. Check the fields."
      : d.source === "none" ? "Nothing readable was found on the picture. Fill the fields in yourself." : null;
  return Widget.vstack([
    Widget.text(ui().editing ? "Edit purchase" : "New purchase", { font: "title2", weight: "bold" }),
    d.receipt ? Widget.image({ file: d.receipt, size: 160, cornerRadius: 12 }) : null,
    Widget.hstack([
      Widget.button(d.receipt ? "Retake" : "Photograph receipt", "draftPhoto", { from: "camera" }, { style: "bordered" }),
      Widget.button("From Photos", "draftPhoto", { from: "photos" }, { style: "bordered" }),
    ], { spacing: 8 }),
    hint ? Widget.text(hint, { font: "caption", color: d.source === "none" ? "orange" : "secondary" }) : null,
    row("Product", Widget.textField("What did you buy?", d.product, "draft", { field: "product" })),
    row("Store", Widget.textField("Shop or website", d.store, "draft", { field: "store" })),
    row("Purchase date", Widget.datePicker(`${d.date}T12:00:00`, "draft", { field: "date" }, { mode: "date", max: new Date().toISOString() })),
    row("Price", Widget.textField("0.00", d.price == null ? "" : String(d.price), "draft", { field: "price" }, { keyboard: "decimal" })),
    row("Warranty", Widget.picker(WARRANTY_OPTIONS.map((m) => ({ label: m >= 12 ? `${m / 12} year${m > 12 ? "s" : ""}` : `${m} months`, value: m })), d.warrantyMonths, "draft", { field: "warrantyMonths" }, { style: "segmented" })),
    row("Return window", Widget.picker(RETURN_OPTIONS.map((n) => ({ label: `${n} days`, value: n })), d.returnDays, "draft", { field: "returnDays" }, { style: "segmented" })),
    d.items?.length ? Widget.text(`On the receipt: ${d.items.join(", ")}`, { font: "caption", color: "secondary", lineLimit: 3 }) : null,
    Widget.text(`Return by ${longDate(preview.returnBy)} · warranty until ${longDate(preview.warrantyEnd)}`, { font: "footnote", color: "teal" }),
    Widget.hstack([
      Widget.button("Save", "save", null, { style: "prominent", color: "teal" }),
      Widget.button("Cancel", "cancel", null, { style: "bordered" }),
    ], { spacing: 8 }),
  ], { alignment: "leading", spacing: 14, padding: 16 });
}

function settingsPage() {
  const s = settings();
  const hours = Array.from({ length: 14 }, (_, i) => i + 7).map((h) => ({ label: `${String(h).padStart(2, "0")}:00`, value: h }));
  return Widget.vstack([
    Widget.button("‹ Back", "page", { page: "list" }, { style: "plain" }),
    Widget.text("Settings", { font: "title2", weight: "bold" }),
    Widget.toggle("Deadline notifications", s.notify, "setting", { key: "notify" }, { color: "teal" }),
    s.notify ? Widget.vstack([Widget.text("Notify at", { font: "caption", color: "secondary" }), Widget.picker(hours, s.hour, "setting", { key: "hour" })], { alignment: "leading", spacing: 4 }) : null,
    Widget.vstack([
      Widget.text("Currency code", { font: "caption", color: "secondary" }),
      Widget.textField("EUR, USD, GBP…", s.currency, "setting", { key: "currency" }),
      Widget.text(`Prices are shown as ${money(1234.5)}.`, { font: "caption", color: "secondary" }),
    ], { alignment: "leading", spacing: 4 }),
    Widget.divider(),
    Widget.text(`${purchases().length} purchases · receipts stay in this script's Files folder on your device.`, { font: "caption", color: "secondary" }),
  ], { alignment: "leading", spacing: 14, padding: 16 });
}

Script.ui(() => {
  const page = ui().page ?? "list";
  const titles = { list: "Warranty Vault", detail: "Purchase", edit: "Purchase", settings: "Settings" };
  const pages = { list: listPage, detail: detailPage, edit: editPage, settings: settingsPage };
  return { title: titles[page] ?? "Warranty Vault", content: (pages[page] ?? listPage)() };
});

// ───────────────────────────────────────────── Shortcuts and Siri

Script.run(() => {
  const list = active().filter((p) => p.next.kind !== "none");
  if (list.length === 0) return "Nothing is returnable or under warranty.";
  const { value } = totals(list);
  const next = list.slice(0, 3).map((p) => `${p.product}: ${p.next.label.toLowerCase()} ${daysText(p.next.days)}`);
  return `${money(value)} under warranty across ${list.length} purchase${list.length === 1 ? "" : "s"}.\n${next.join("\n")}`;
});
