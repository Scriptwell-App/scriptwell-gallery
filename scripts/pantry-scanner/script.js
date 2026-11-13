// @name        Pantry Scanner
// @description Scan food barcodes to stock a pantry with expiry reminders; product names, Nutri-Score and allergens are looked up on world.openfoodfacts.org
// @permissions camera, network, notifications, reminders
// @widget      small, medium, large, rectangular
// @icon        barcode.viewfinder
// @color       #16A34A
// @version     1.0.0
// @author      scriptwell
// @category    food-drink

// How it works
// • Scan tab: point the camera at an EAN or UPC barcode. Only the code is sent to world.openfoodfacts.org,
//   which answers with the product name, brand, quantity, Nutri-Score, NOVA group and allergens.
// • Pantry items (name, quantity, fridge / pantry / freezer, expiry date) stay in the script's Storage on your device.
// • Every item gets two local notifications: two days before it expires and on the day, at the hour you choose.
//   Editing an item replaces them, deleting an item cancels them.
// • "Add to shopping list" creates a reminder in the Reminders list you pick in Settings.
// • Open the mini-app once before adding the widget so camera, network, notification and reminder access are approved.
// • Widget: the items expiring soonest, colour-coded; the large widget also counts items per location.

// ───────────────────────── Constants

const DAY = 86_400_000;
const MAX_ITEMS = 120;
const OFF_URL = "https://world.openfoodfacts.org/api/v2/product/";
const OFF_FIELDS = "product_name,brands,nutriscore_grade,nova_group,allergens_tags,ingredients_text,image_front_small_url,quantity";
const USER_AGENT = "ScriptwellPantryScanner/1.0 (Scriptwell gallery script; https://github.com/va4w/scriptwell-gallery)";

const LOCATIONS = [
  { value: "fridge", label: "Fridge", symbol: "refrigerator.fill", fallback: "🧊", color: "blue", hex: "#3B82F6" },
  { value: "pantry", label: "Pantry", symbol: "cabinet.fill", fallback: "🥫", color: "orange", hex: "#F97316" },
  { value: "freezer", label: "Freezer", symbol: "snowflake", fallback: "❄️", color: "cyan", hex: "#06B6D4" },
];
const locationOf = (value) => LOCATIONS.find((l) => l.value === value) ?? LOCATIONS[1];

const NUTRI = { a: "#038141", b: "#85BB2F", c: "#FECB02", d: "#EE8100", e: "#E63E11" };
const TILE_BG = { light: "#F1F5F9", dark: "#1E293B" };
const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────── Storage

const items = () => Storage.get("items", []);
const saveItems = (list) => Storage.set("items", list.slice(0, MAX_ITEMS));
const settings = () => ({ list: null, hour: 9, lead: 2, ...Storage.get("settings", {}) });
const saveSettings = (changes) => Storage.set("settings", { ...settings(), ...changes });
const products = () => Storage.get("products", {});

// ───────────────────────── Dates and formatting

const isoDay = (date) => new Date(date).toLocaleDateString("en-CA");
const todayISO = () => isoDay(new Date());
const dateFromISO = (iso) => new Date(`${iso}T12:00:00`);

function daysUntil(iso) {
  const target = dateFromISO(iso);
  const today = dateFromISO(todayISO());
  return Math.round((target - today) / DAY);
}

function expiryLabel(iso) {
  const d = daysUntil(iso);
  if (d < -1) return `Expired ${-d} days ago`;
  if (d === -1) return "Expired yesterday";
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d <= 14) return `In ${d} days`;
  return dateFromISO(iso).toLocaleDateString(Script.env.locale, { day: "numeric", month: "short" });
}

function expiryColor(iso) {
  const d = daysUntil(iso);
  if (d < 0) return "red";
  if (d <= 2) return "orange";
  if (d <= 7) return "yellow";
  return "green";
}

function expiryHex(iso) {
  return { red: "#EF4444", orange: "#F97316", yellow: "#EAB308", green: "#22C55E" }[expiryColor(iso)];
}

const byExpiry = (a, b) => a.expiry.localeCompare(b.expiry) || a.name.localeCompare(b.name);
const sorted = () => [...items()].sort(byExpiry);
const expiring = (days = 7) => sorted().filter((item) => daysUntil(item.expiry) <= days);

function allergenName(tag) {
  const word = String(tag).replace(/^[a-z]{2}:/, "").replace(/-/g, " ");
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// ───────────────────────── Open Food Facts

async function lookup(code) {
  const cached = products()[code];
  if (cached && Date.now() - cached.time < 30 * DAY) return cached;

  const url = new URL(`${OFF_URL}${encodeURIComponent(code)}.json`);
  url.searchParams.set("fields", OFF_FIELDS);
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, timeout: 10_000 });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Open Food Facts answered ${response.status}`);
  const data = await response.json();
  if (data.status === 0 || !data.product) return null;

  const p = data.product;
  const product = {
    code,
    name: (p.product_name ?? "").trim(),
    brand: (p.brands ?? "").split(",")[0].trim(),
    quantity: (p.quantity ?? "").trim(),
    nutriscore: /^[a-e]$/.test(p.nutriscore_grade ?? "") ? p.nutriscore_grade : null,
    nova: [1, 2, 3, 4].includes(Number(p.nova_group)) ? Number(p.nova_group) : null,
    allergens: (p.allergens_tags ?? []).map(allergenName).slice(0, 8),
    ingredients: (p.ingredients_text ?? "").trim().slice(0, 400),
    image: typeof p.image_front_small_url === "string" && p.image_front_small_url.startsWith("https://") ? p.image_front_small_url : null,
    time: Date.now(),
  };
  const all = products();
  all[code] = product;
  const keys = Object.keys(all);
  if (keys.length > 100) delete all[keys.sort((a, b) => all[a].time - all[b].time)[0]];
  Storage.set("products", all);
  return product;
}

// ───────────────────────── Notifications

function notifyAt(iso, hour) {
  const when = dateFromISO(iso);
  when.setHours(hour, 0, 0, 0);
  return when;
}

async function scheduleFor(item) {
  const { hour, lead } = settings();
  const soon = notifyAt(item.expiry, hour);
  soon.setDate(soon.getDate() - lead);
  const day = notifyAt(item.expiry, hour);
  const plans = [
    { id: `lead:${item.id}`, at: soon, title: `${item.name} expires in ${lead} day${lead === 1 ? "" : "s"}`, body: `${locationOf(item.location).label} · use it soon.` },
    { id: `day:${item.id}`, at: day, title: `${item.name} expires today`, body: `Check the ${locationOf(item.location).label.toLowerCase()}.` },
  ];
  for (const plan of plans) {
    if (plan.at > new Date()) await Notification.schedule({ id: plan.id, title: plan.title, body: plan.body, at: plan.at });
    else await Notification.cancel(plan.id);
  }
}

async function cancelFor(id) {
  await Notification.cancel(`lead:${id}`);
  await Notification.cancel(`day:${id}`);
}

// ───────────────────────── Draft (the add / edit form)

let tab = 0;
let scanNote = null;
let reminderLists = null;
let busy = false;

const draft = () => Storage.get("draft");

function newDraft(product, code) {
  const expiry = new Date(Date.now() + 7 * DAY);
  return {
    id: null,
    code: code ?? product?.code ?? null,
    name: product?.name ?? "",
    brand: product?.brand ?? "",
    size: product?.quantity ?? "",
    nutriscore: product?.nutriscore ?? null,
    nova: product?.nova ?? null,
    allergens: product?.allergens ?? [],
    image: product?.image ?? null,
    quantity: 1,
    location: Storage.get("lastLocation", "fridge"),
    expiry: isoDay(expiry),
    shop: false,
  };
}

Script.action("tab", ({ value }) => { tab = value; });

Script.action("scanned", async ({ value, format }) => {
  if (draft()) return; // a form is already open
  const code = String(value).replace(/\D/g, "");
  if (code.length < 8) { scanNote = `That ${format} code is not a product barcode.`; return; }
  busy = true;
  try {
    const product = await lookup(code);
    Storage.set("draft", newDraft(product, code));
    scanNote = product ? null : `No product found for ${code}. Fill in the name yourself.`;
    await UI.haptic(product ? "success" : "warning");
  } catch (error) {
    Storage.set("draft", newDraft(null, code));
    scanNote = `Could not reach Open Food Facts (${error.message}). Fill in the name yourself.`;
  } finally {
    busy = false;
  }
});

Script.action("manual", () => { Storage.set("draft", newDraft(null, null)); tab = 1; });
Script.action("edit", ({ id }) => {
  const item = items().find((i) => i.id === id);
  if (item) { Storage.set("draft", { ...item, shop: false }); tab = 1; }
});
Script.action("cancel", () => Storage.remove("draft"));

Script.action("field", ({ field, value }) => {
  const d = draft();
  if (!d) return;
  if (field === "expiry") value = isoDay(value);
  Storage.set("draft", { ...d, [field]: value });
});
Script.action("shopToggle", ({ isOn }) => { const d = draft(); if (d) Storage.set("draft", { ...d, shop: isOn }); });

Script.action("save", async () => {
  const d = draft();
  if (!d) return;
  if (!d.name.trim()) { await UI.alert({ title: "Give it a name", message: "Type the product name, then tap Return." }); return; }
  const item = { ...d, name: d.name.trim(), id: d.id ?? crypto.randomUUID(), added: d.added ?? Date.now() };
  delete item.shop;
  const list = items().filter((i) => i.id !== item.id);
  saveItems([item, ...list]);
  Storage.set("lastLocation", item.location);
  Storage.remove("draft");
  try { await scheduleFor(item); } catch (error) { console.warn("Notifications:", error.message); }
  if (d.shop) await addToShoppingList(item);
  await UI.haptic("success");
  tab = 0;
});

// ───────────────────────── Pantry actions

Script.action("adjust", ({ id, by }) => {
  saveItems(items().map((i) => (i.id === id ? { ...i, quantity: Math.max(0, i.quantity + by) } : i)));
});

Script.action("remove", async ({ id }) => {
  const item = items().find((i) => i.id === id);
  if (!item) return;
  const choice = await UI.alert({ title: `Remove ${item.name}?`, buttons: ["Cancel", "Remove"] });
  if (choice !== 1) return;
  saveItems(items().filter((i) => i.id !== id));
  await cancelFor(id);
});

async function addToShoppingList(item) {
  const { list } = settings();
  try {
    const reminder = { title: item.name };
    const notes = [item.brand, item.size].filter(Boolean).join(" · ");
    if (notes) reminder.notes = notes;
    if (list) reminder.list = list;
    const added = await Reminders.add(reminder);
    await UI.alert({ title: "Added to shopping list", message: `${item.name} is in ${added.list}.` });
  } catch (error) {
    await UI.alert({ title: "Could not add the reminder", message: error.message });
  }
}

Script.action("shop", async ({ id }) => {
  const item = items().find((i) => i.id === id);
  if (item) await addToShoppingList(item);
});

Script.action("setList", ({ value }) => saveSettings({ list: value || null }));
Script.action("setHour", ({ value }) => saveSettings({ hour: Math.round(value) }));
Script.action("setLead", ({ value }) => saveSettings({ lead: Math.round(value) }));
Script.action("reschedule", async () => {
  for (const item of items()) await scheduleFor(item);
  await UI.alert({ title: "Reminders updated", message: `${items().length} item${items().length === 1 ? "" : "s"} rescheduled.` });
});
Script.action("clearAll", async () => {
  const choice = await UI.alert({ title: "Empty the pantry?", message: "Every item and its reminders will be removed.", buttons: ["Cancel", "Empty"] });
  if (choice !== 1) return;
  await Notification.cancelAll();
  saveItems([]);
});

// ───────────────────────── Shared pieces

function nutriBadge(grade, size = 18) {
  return Widget.hstack(Object.entries(NUTRI).map(([letter, hex]) => {
    const active = letter === grade;
    return Widget.text(letter.toUpperCase(), {
      font: active ? size : size - 6, weight: "bold", color: "white", lineLimit: 1,
      padding: { horizontal: active ? 7 : 5, vertical: active ? 3 : 2 },
      background: hex, cornerRadius: 6, opacity: active || !grade ? 1 : 0.3,
    });
  }), { spacing: 2, alignment: "center" });
}

function chip(text, color = "secondary") {
  return Widget.text(text, {
    font: "caption2", weight: "semibold", color,
    padding: { horizontal: 7, vertical: 3 }, background: TILE_BG, cornerRadius: 8,
  });
}

function expiryPill(iso, font = "caption2") {
  return Widget.text(expiryLabel(iso), {
    font, weight: "semibold", color: expiryColor(iso), lineLimit: 1,
    padding: { horizontal: 6, vertical: 2 },
    background: { light: `${expiryHex(iso)}26`, dark: `${expiryHex(iso)}40` }, cornerRadius: 6,
  });
}

const bar = (hex, height) => ({ type: "stack", direction: "vertical", children: [], background: hex, cornerRadius: 2, frame: { width: 4, height } });

// ───────────────────────── Mini-app: Pantry tab

function itemRow(item) {
  const loc = locationOf(item.location);
  return Widget.hstack([
    bar(expiryHex(item.expiry), 36),
    Widget.button(Widget.vstack([
      Widget.text(item.name, { font: "subheadline", weight: "medium", lineLimit: 1 }),
      Widget.text([item.brand, item.size, item.quantity === 0 ? "out" : null].filter(Boolean).join(" · ") || loc.label, { font: "caption", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", alignment: "leading" } }), "edit", { id: item.id }),
    expiryPill(item.expiry),
    Widget.button("−", "adjust", { id: item.id, by: -1 }, { style: "bordered" }),
    Widget.text(item.quantity, { font: "subheadline", weight: "bold", design: "rounded", frame: { width: 20, alignment: "center" } }),
    Widget.button("+", "adjust", { id: item.id, by: 1 }, { style: "bordered" }),
    Widget.menu("ellipsis.circle", [
      { title: "Edit", symbol: "pencil", action: "edit", args: { id: item.id } },
      { title: "Add to shopping list", symbol: "cart.badge.plus", action: "shop", args: { id: item.id } },
      { title: "Remove", symbol: "trash", action: "remove", args: { id: item.id }, destructive: true },
    ]),
  ], { spacing: 8 });
}

function pantryTab() {
  const all = sorted();
  if (all.length === 0) {
    return Widget.vstack([
      Widget.symbol("basket", { size: 56, color: "green", fallback: "🧺" }),
      Widget.text("Your pantry is empty", { font: "title3", weight: "semibold" }),
      Widget.text("Scan a barcode or add an item by hand.", { color: "secondary", align: "center" }),
      Widget.button("Add by hand", "manual", null, { style: "bordered" }),
    ], { spacing: 10, padding: 24 });
  }
  const groups = LOCATIONS.map((loc) => ({ loc, list: all.filter((i) => i.location === loc.value) })).filter((g) => g.list.length);
  return Widget.vstack([
    Widget.hstack([
      Widget.text(`${all.length} item${all.length === 1 ? "" : "s"}`, { font: "footnote", color: "secondary" }),
      Widget.spacer(),
      Widget.button("Add by hand", "manual", null, { style: "bordered" }),
    ]),
    ...groups.map((g) => Widget.card(g.list.map(itemRow), {
      title: g.loc.label, subtitle: `${g.list.length} item${g.list.length === 1 ? "" : "s"}`, symbol: g.loc.symbol, color: g.loc.color,
    })),
  ], { alignment: "leading", spacing: 12 });
}

// ───────────────────────── Mini-app: Scan tab and form

function form(d) {
  const pickerLocations = LOCATIONS.map((l) => ({ label: l.label, value: l.value }));
  return Widget.vstack([
    Widget.hstack([
      d.image ? Widget.image({ src: d.image, size: 72, cornerRadius: 10 }) : Widget.symbol("shippingbox.fill", { size: 44, color: "secondary", fallback: "📦" }),
      Widget.vstack([
        Widget.text(d.name || "New item", { font: "headline", lineLimit: 2 }),
        Widget.text([d.brand, d.size].filter(Boolean).join(" · ") || (d.code ? `Barcode ${d.code}` : "Entered by hand"), { font: "caption", color: "secondary", lineLimit: 1 }),
        d.nutriscore || d.nova ? Widget.hstack([
          d.nutriscore ? nutriBadge(d.nutriscore, 14) : null,
          d.nova ? chip(`NOVA ${d.nova}`, d.nova >= 4 ? "red" : d.nova === 3 ? "orange" : "green") : null,
        ], { spacing: 8 }) : null,
      ], { alignment: "leading", spacing: 4 }),
    ], { spacing: 12, alignment: "top" }),
    d.allergens.length ? Widget.hstack(d.allergens.slice(0, 5).map((a) => chip(a, "orange")), { spacing: 4 }) : null,
    Widget.textField("Product name, then Return", d.name, "field", { field: "name" }, { label: "Name" }),
    Widget.textField("Brand (optional)", d.brand, "field", { field: "brand" }, { label: "Brand" }),
    Widget.picker(pickerLocations, d.location, "field", { field: "location" }, { style: "segmented", label: "Where" }),
    Widget.stepper("Quantity", d.quantity, "field", { field: "quantity" }, { min: 0, max: 99 }),
    Widget.datePicker(`${d.expiry}T12:00:00`, "field", { field: "expiry" }, { label: "Expires", mode: "date" }),
    Widget.text(`Reminders ${settings().lead} days before and on ${dateFromISO(d.expiry).toLocaleDateString(Script.env.locale, { weekday: "short", day: "numeric", month: "short" })}`, { font: "caption", color: "secondary" }),
    Widget.checkbox("Also add to the shopping list", d.shop, "shopToggle"),
    Widget.hstack([
      Widget.button("Cancel", "cancel", null, { style: "bordered" }),
      Widget.spacer(),
      Widget.button(d.id ? "Save changes" : "Add to pantry", "save", null, { style: "prominent", color: "green" }),
    ]),
  ], { alignment: "leading", spacing: 12, padding: 14, background: TILE_BG, cornerRadius: 16 });
}

function scanTab() {
  const d = draft();
  if (d) return form(d);
  return Widget.vstack([
    busy
      ? Widget.vstack([Widget.progress(0.5, { style: "ring", color: "green" }), Widget.text("Looking the code up…", { color: "secondary" })], { spacing: 8, padding: 40 })
      : Widget.scanner("scanned", { find: ["barcode"], frame: { height: 300 } }),
    Widget.text(scanNote ?? "Hold a barcode in front of the camera. Only the code is sent to Open Food Facts.", { font: "footnote", color: scanNote ? "orange" : "secondary", align: "center" }),
    Widget.button("No barcode? Add by hand", "manual", null, { style: "bordered" }),
  ], { spacing: 12 });
}

// ───────────────────────── Mini-app: Expiring and Settings tabs

function expiringTab() {
  const soon = expiring(7);
  if (soon.length === 0) {
    return Widget.vstack([
      Widget.symbol("checkmark.seal.fill", { size: 48, color: "green", fallback: "✅" }),
      Widget.text("Nothing expires this week", { font: "headline" }),
    ], { spacing: 10, padding: 30 });
  }
  const expired = soon.filter((i) => daysUntil(i.expiry) < 0);
  const upcoming = soon.filter((i) => daysUntil(i.expiry) >= 0);
  const block = (title, list, color) => (list.length ? Widget.card(list.map(itemRow), { title, subtitle: `${list.length}`, symbol: "clock.badge.exclamationmark", color }) : null);
  return Widget.vstack([block("Expired", expired, "red"), block("Next 7 days", upcoming, "orange")], { spacing: 12 });
}

function settingsTab() {
  const s = settings();
  const options = [{ label: "Default list", value: "" }, ...(reminderLists ?? []).map((l) => ({ label: l.title, value: l.title }))];
  return Widget.vstack([
    Widget.card([
      Widget.stepper(`Notify at ${String(s.hour).padStart(2, "0")}:00`, s.hour, "setHour", null, { min: 6, max: 22 }),
      Widget.stepper(`${s.lead} day${s.lead === 1 ? "" : "s"} before expiry`, s.lead, "setLead", null, { min: 1, max: 7 }),
      Widget.button("Apply to existing items", "reschedule", null, { style: "bordered" }),
    ], { title: "Expiry reminders", symbol: "bell.badge.fill", color: "orange" }),
    Widget.card([
      Widget.picker(options, s.list ?? "", "setList", null, { label: "Reminders list" }),
      Widget.text(reminderLists ? `${reminderLists.length} list${reminderLists.length === 1 ? "" : "s"} found` : "Lists could not be loaded. Allow Reminders access and reopen.", { font: "caption", color: "secondary" }),
    ], { title: "Shopping list", symbol: "cart.fill", color: "green" }),
    Widget.card([
      Widget.text(`${items().length} items · ${Object.keys(products()).length} products cached`, { font: "footnote", color: "secondary" }),
      Widget.button("Empty the pantry", "clearAll", null, { style: "bordered", color: "red" }),
    ], { title: "Data", symbol: "externaldrive.fill", color: "gray" }),
  ], { spacing: 12 });
}

Script.ui(async () => {
  if (tab === 3 && reminderLists === null) {
    try { reminderLists = await Reminders.lists(); } catch { reminderLists = []; }
  }
  const soon = expiring(2).length;
  return {
    title: "Pantry Scanner",
    content: Widget.vstack([
      Widget.tabs([
        { title: "Pantry", symbol: "basket.fill", content: pantryTab() },
        { title: draft() ? "Item" : "Scan", symbol: "barcode.viewfinder", content: scanTab() },
        { title: soon ? `Expiring (${soon})` : "Expiring", symbol: "clock.badge.exclamationmark", content: expiringTab() },
        { title: "Settings", symbol: "gearshape.fill", content: settingsTab() },
      ], { selected: tab, action: "tab" }),
    ], { padding: 12 }),
  };
});

// ───────────────────────── Widget

function widgetRow(item, compact) {
  return Widget.hstack([
    bar(expiryHex(item.expiry), compact ? 18 : 24),
    Widget.vstack([
      Widget.text(item.name, { font: compact ? "caption" : "subheadline", weight: "medium", lineLimit: 1 }),
      compact ? null : Widget.text(`${locationOf(item.location).label}${item.quantity > 1 ? ` · ×${item.quantity}` : ""}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 0 }),
    Widget.spacer(),
    expiryPill(item.expiry),
  ], { spacing: 6 });
}

function locationTile(loc) {
  const list = items().filter((i) => i.location === loc.value);
  const urgent = list.filter((i) => daysUntil(i.expiry) <= 2).length;
  return Widget.vstack([
    Widget.hstack([
      Widget.symbol(loc.symbol, { size: 12, color: loc.color, fallback: loc.fallback }),
      Widget.text(loc.label, { font: "caption2", weight: "semibold", color: "secondary" }),
    ], { spacing: 4 }),
    Widget.text(list.length, { font: 24, weight: "bold", design: "rounded", color: loc.color }),
    Widget.text(urgent ? `${urgent} urgent` : "all fine", { font: "caption2", color: urgent ? "orange" : "secondary" }),
  ], { alignment: "leading", spacing: 1, padding: 8, background: TILE_BG, cornerRadius: 10, frame: { maxWidth: "infinity", alignment: "leading" } });
}

Script.widget(({ family }) => {
  const all = sorted();
  const urgent = all.filter((i) => daysUntil(i.expiry) <= 2);
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const midnight = new Date();
  midnight.setHours(24, 0, 10, 0);
  let content;

  if (all.length === 0) {
    content = family === "rectangular"
      ? Widget.text("Pantry: scan your first item")
      : Widget.vstack([
          Widget.symbol("barcode.viewfinder", { size: 28, color: "green", fallback: "📷" }),
          Widget.text("Open Pantry Scanner and scan your first item", { font: "caption", color: "secondary", align: "center" }),
        ], { spacing: 6, url: appLink });
    return { content, refreshAt: midnight };
  }

  switch (family) {
    case "rectangular": {
      const [next] = all;
      content = Widget.vstack([
        Widget.hstack([
          Widget.symbol("basket.fill", { size: 11, fallback: "🧺" }),
          Widget.text(`Pantry · ${all.length}`, { font: "caption2", weight: "semibold" }),
          Widget.spacer(),
          Widget.text(urgent.length ? `${urgent.length} urgent` : "all fine", { font: "caption2" }),
        ], { spacing: 3 }),
        Widget.text(next.name, { font: "headline", lineLimit: 1 }),
        Widget.text(expiryLabel(next.expiry), { font: "caption", lineLimit: 1 }),
      ], { alignment: "leading", spacing: 1 });
      break;
    }
    case "small":
      content = Widget.vstack([
        Widget.hstack([
          Widget.symbol("basket.fill", { size: 12, color: "green", fallback: "🧺" }),
          Widget.text("Pantry", { font: "caption", weight: "semibold", color: "secondary" }),
          Widget.spacer(),
          Widget.text(all.length, { font: "caption", weight: "bold", color: "secondary" }),
        ], { spacing: 4 }),
        Widget.text(urgent.length, { font: 38, weight: "bold", design: "rounded", color: urgent.length ? "orange" : "green" }),
        Widget.text(urgent.length === 1 ? "item needs eating" : "items need eating", { font: "caption2", color: "secondary" }),
        Widget.spacer(),
        ...all.slice(0, 2).map((i) => widgetRow(i, true)),
      ], { alignment: "leading", spacing: 2, url: appLink, frame: fill });
      break;
    case "medium":
      content = Widget.vstack([
        Widget.hstack([
          Widget.symbol("basket.fill", { size: 13, color: "green", fallback: "🧺" }),
          Widget.text("Expiring soonest", { font: "headline" }),
          Widget.spacer(),
          Widget.text(`${all.length} items · ${urgent.length} urgent`, { font: "caption2", color: "secondary" }),
        ], { spacing: 5 }),
        ...all.slice(0, 4).map((i) => widgetRow(i, false)),
        Widget.spacer(),
      ], { alignment: "leading", spacing: 5, url: appLink, frame: fill });
      break;
    default:
      content = Widget.vstack([
        Widget.hstack([
          Widget.symbol("basket.fill", { size: 14, color: "green", fallback: "🧺" }),
          Widget.text("Pantry", { font: "headline" }),
          Widget.spacer(),
          Widget.text(`${all.length} items`, { font: "caption", color: "secondary" }),
        ], { spacing: 5 }),
        Widget.hstack(LOCATIONS.map(locationTile), { spacing: 8 }),
        Widget.text("EXPIRING SOONEST", { font: "caption2", weight: "bold", color: "secondary" }),
        ...all.slice(0, 6).map((i) => widgetRow(i, false)),
        Widget.spacer(),
      ], { alignment: "leading", spacing: 6, url: appLink, frame: fill });
  }
  return { content, refreshAt: midnight };
});

// ───────────────────────── Shortcuts and Siri

Script.run(() => {
  const soon = expiring(2);
  if (items().length === 0) return "The pantry is empty.";
  if (soon.length === 0) return `${items().length} items in the pantry, nothing expiring in the next two days.`;
  return `${soon.length} item${soon.length === 1 ? "" : "s"} to use up: ${soon.map((i) => `${i.name} (${expiryLabel(i.expiry).toLowerCase()})`).join(", ")}.`;
});
