// @name        Shared List
// @description A family shopping list sorted by aisle that you tick off right in the widget, add to by typing or scanning a barcode (looked up at world.openfoodfacts.org), and mirror to a shared Reminders list so everyone sees it.
// @permissions camera, network, reminders
// @widget      small, medium, large, rectangular
// @icon        cart.fill
// @color       #16A34A
// @version     1.0.0
// @author      va4w
// @category    shopping

// How it works
// • Items live in the script's Storage, grouped by aisle (produce, dairy, bakery, household, …) with a
//   quantity and a note. Tick them off in the widget or the mini-app; "Clear ticked" removes what you bought.
// • Add items by typing ("2 oat milk (the blue one)") or by scanning a barcode. Only the barcode digits are
//   sent to world.openfoodfacts.org, which answers with the product name, brand and pack size.
// • Open items are mirrored to a Reminders list (default "Shopping"). Share that list in the Reminders app and
//   the family sees it on their own devices; ticks and additions made there flow back the next time you open.
// • "Usual items" are learned from how often you add something, so the things you always buy are one tap away.
// • Storage.shared publishes "sharedList:openCount" (a number), "sharedList:items" (an array of
//   { name, qty, note, aisle }) and "sharedList:updated" (ISO date) so your other scripts can show the list.
// • Run the script once in the app to approve camera, network and reminders before adding the widget.

// ───────────────────────────────────────────── Constants

const SHARED_PREFIX = "sharedList:";
const DEFAULT_LIST = "Shopping";
const SYNC_INTERVAL = 60_000;
const MAX_USUAL = 8;
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

const AISLES = [
  { id: "produce", label: "Produce", symbol: "leaf.fill", fallback: "🥬", hex: "#22C55E",
    words: ["apple", "banana", "tomato", "lettuce", "onion", "potato", "carrot", "salad", "fruit", "veg", "spinach", "pepper", "lemon", "lime", "avocado", "garlic", "berries", "grapes", "cucumber", "broccoli", "mushroom", "orange", "herbs", "ginger"] },
  { id: "dairy", label: "Dairy & eggs", symbol: "drop.fill", fallback: "🥛", hex: "#3B82F6",
    words: ["milk", "cheese", "yogurt", "yoghurt", "butter", "cream", "egg", "eggs", "kefir"] },
  { id: "bakery", label: "Bakery", symbol: "birthday.cake.fill", fallback: "🥐", hex: "#F59E0B",
    words: ["bread", "bagel", "bun", "rolls", "croissant", "cake", "baguette", "tortilla", "wrap", "muffin", "pastry"] },
  { id: "meat", label: "Meat & fish", symbol: "fork.knife", fallback: "🍗", hex: "#EF4444",
    words: ["chicken", "beef", "pork", "lamb", "fish", "salmon", "tuna", "sausage", "bacon", "ham", "mince", "steak", "prawns", "shrimp", "tofu", "turkey"] },
  { id: "frozen", label: "Frozen", symbol: "snowflake", fallback: "🧊", hex: "#06B6D4",
    words: ["frozen", "ice", "peas", "pizza", "fish fingers", "sorbet"] },
  { id: "pantry", label: "Pantry", symbol: "basket.fill", fallback: "🥫", hex: "#A16207",
    words: ["rice", "pasta", "flour", "sugar", "salt", "oil", "cereal", "oats", "beans", "lentils", "tin", "can", "sauce", "spice", "honey", "jam", "coffee", "tea", "noodles", "stock", "vinegar", "chocolate", "crisps", "biscuits", "nuts"] },
  { id: "drinks", label: "Drinks", symbol: "takeoutbag.and.cup.and.straw.fill", fallback: "🧃", hex: "#8B5CF6",
    words: ["water", "juice", "soda", "cola", "beer", "wine", "sparkling", "lemonade", "squash"] },
  { id: "household", label: "Household", symbol: "house.fill", fallback: "🧽", hex: "#64748B",
    words: ["paper", "towel", "toilet", "detergent", "soap", "sponge", "bin bags", "foil", "cling", "batteries", "bulb", "cleaner", "bleach", "dishwasher"] },
  { id: "personal", label: "Personal care", symbol: "comb.fill", fallback: "🧴", hex: "#EC4899",
    words: ["shampoo", "toothpaste", "deodorant", "razor", "conditioner", "lotion", "tissues", "floss", "sunscreen", "nappies"] },
  { id: "other", label: "Other", symbol: "bag.fill", fallback: "🛍", hex: "#94A3B8", words: [] },
];
const aisle = (id) => AISLES.find((a) => a.id === id) ?? AISLES[AISLES.length - 1];
const TILE_BG = { light: "#F1F5F9", dark: "#1E293B" };

// ───────────────────────────────────────────── Storage

const items = () => Storage.get("items", []);
const settings = () => ({ listName: DEFAULT_LIST, mirror: true, usual: true, ...Storage.get("settings", {}) });
const ui = () => Storage.get("ui", { page: "home", scanning: false });
const setUi = (changes) => Storage.set("ui", { ...ui(), ...changes });
const usage = () => Storage.get("usage", {});

// Everything that changes the list goes through here, so the shared store is always current.
function saveItems(list) {
  Storage.set("items", list);
  const open = list.filter((i) => !i.done).map(({ name, qty, note, aisle: a }) => ({ name, qty, note, aisle: a }));
  Storage.shared.set(`${SHARED_PREFIX}openCount`, open.length);
  Storage.shared.set(`${SHARED_PREFIX}items`, open);
  Storage.shared.set(`${SHARED_PREFIX}updated`, new Date().toISOString());
}

function learn(item) {
  const key = item.name.toLowerCase();
  const all = usage();
  const entry = all[key] ?? { name: item.name, aisle: item.aisle, count: 0 };
  all[key] = { ...entry, name: item.name, aisle: item.aisle, count: entry.count + 1, last: Date.now() };
  Storage.set("usage", all);
}

function usualItems() {
  const open = new Set(items().filter((i) => !i.done).map((i) => i.name.toLowerCase()));
  return Object.values(usage())
    .filter((u) => u.count >= 2 && !open.has(u.name.toLowerCase()))
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, MAX_USUAL);
}

// ───────────────────────────────────────────── Parsing

function guessAisle(name) {
  const text = name.toLowerCase();
  for (const a of AISLES) {
    if (a.words.some((w) => new RegExp(`(^|\\W)${w}(s|es)?(\\W|$)`).test(text))) return a.id;
  }
  return "other";
}

// "2 oat milk (the blue one)", "eggs x12", "3x bananas" → { name, qty, note }
function parseEntry(text) {
  let s = text.trim().replace(/\s+/g, " ");
  let note = null;
  const paren = /^(.*?)\s*\((.+)\)\s*$/.exec(s);
  if (paren) { s = paren[1]; note = paren[2].trim(); }
  let qty = 1;
  const leading = /^(\d+)\s*[x×]?\s+(.+)$/.exec(s);
  const trailing = /^(.+?)\s*[x×]\s*(\d+)$/.exec(s);
  if (leading) { qty = Number(leading[1]); s = leading[2]; }
  else if (trailing) { qty = Number(trailing[2]); s = trailing[1]; }
  const name = s.trim().replace(/^./, (c) => c.toUpperCase());
  return name ? { name, qty: Math.max(1, qty), note } : null;
}

const itemTitle = (item) => `${item.qty > 1 ? `${item.qty}× ` : ""}${item.name}`;

function addItem(entry, extra = {}) {
  if (!entry) return null;
  const list = items();
  const existing = list.find((i) => !i.done && i.name.toLowerCase() === entry.name.toLowerCase());
  if (existing) {
    existing.qty = Math.max(existing.qty, entry.qty);
    if (entry.note) existing.note = entry.note;
    saveItems(list);
    return existing;
  }
  const item = {
    id: crypto.randomUUID(), name: entry.name, qty: entry.qty, note: entry.note,
    aisle: usage()[entry.name.toLowerCase()]?.aisle ?? guessAisle(entry.name),
    done: false, added: Date.now(), reminderId: null, ...extra,
  };
  saveItems([...list, item]);
  learn(item);
  return item;
}

// ───────────────────────────────────────────── Reminders mirror

function setSync(changes) {
  Storage.set("sync", { ...Storage.get("sync", {}), ...changes });
}

async function targetList() {
  const lists = await Reminders.lists();
  const wanted = settings().listName.toLowerCase();
  const found = lists.find((l) => l.title.toLowerCase() === wanted) ?? null;
  setSync({ listNames: lists.map((l) => l.title) });
  return found;
}

// Two-way reconcile: Reminders ticked or added by the family come in; our open items go out.
async function reconcile(force = false) {
  if (!settings().mirror) return;
  const last = Storage.get("sync", {});
  if (!force && last.time && Date.now() - last.time < SYNC_INTERVAL) return;
  try {
    const target = await targetList();
    if (!target) {
      setSync({ time: Date.now(), error: `No Reminders list called "${settings().listName}". Create it in Reminders (and share it), or choose another list in Settings.` });
      return;
    }
    const open = await Reminders.list({ list: target.title });
    const done = await Reminders.list({ list: target.title, completed: true });
    const byId = new Map([...open.map((r) => [r.id, { ...r, completed: false }]), ...done.map((r) => [r.id, { ...r, completed: true }])]);
    const mapped = new Set();
    let list = items();
    let imported = 0;

    // 1. What happened in Reminders to the items we know about.
    list = list.filter((item) => {
      if (!item.reminderId) return true;
      const r = byId.get(item.reminderId);
      if (!r) {
        if (!item.done) return false; // deleted in Reminders while still open: someone removed it
        item.reminderId = null;
        return true;
      }
      mapped.add(r.id);
      if (r.completed && !item.done) { item.done = true; item.doneAt = Date.now(); }
      return true;
    });

    // 2. Our open items that are not in Reminders yet, and ticks that did not get through.
    for (const item of list) {
      if (item.done) {
        const r = item.reminderId ? byId.get(item.reminderId) : null;
        if (r && !r.completed) await Reminders.complete(item.reminderId);
        continue;
      }
      if (!item.reminderId) {
        const r = await Reminders.add({ title: itemTitle(item), notes: item.note, list: target.title });
        item.reminderId = r.id;
        mapped.add(r.id);
      }
    }

    // 3. Open reminders nobody mapped: added by a family member.
    for (const r of open) {
      if (mapped.has(r.id)) continue;
      const entry = parseEntry(r.title);
      if (!entry) continue;
      list.push({
        id: crypto.randomUUID(), name: entry.name, qty: entry.qty, note: entry.note ?? r.notes ?? null,
        aisle: usage()[entry.name.toLowerCase()]?.aisle ?? guessAisle(entry.name),
        done: false, added: Date.now(), reminderId: r.id,
      });
      imported += 1;
    }

    saveItems(list);
    setSync({ time: Date.now(), error: null, imported, list: target.title });
  } catch (error) {
    setSync({ time: Date.now(), error: error.message ?? String(error) });
  }
}

async function pushTick(item) {
  if (!settings().mirror || !item.reminderId) return;
  try {
    if (item.done) await Reminders.complete(item.reminderId);
    else await Reminders.update(item.reminderId, { completed: false });
  } catch (error) {
    setSync({ error: error.message });
  }
}

async function pushAdd(item) {
  if (!settings().mirror || item.reminderId) return;
  try {
    const target = await targetList();
    if (!target) return;
    const r = await Reminders.add({ title: itemTitle(item), notes: item.note, list: target.title });
    saveItems(items().map((i) => (i.id === item.id ? { ...i, reminderId: r.id } : i)));
  } catch (error) {
    setSync({ error: error.message });
  }
}

async function pushRemove(removed) {
  if (!settings().mirror) return;
  for (const item of removed) {
    if (!item.reminderId) continue;
    try { await Reminders.remove(item.reminderId); } catch { /* already gone */ }
  }
}

// ───────────────────────────────────────────── Barcodes

async function lookupBarcode(code) {
  const url = new URL(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
  url.searchParams.set("fields", "product_name,brands,quantity");
  const response = await fetch(url, { timeout: 8000 });
  if (!response.ok) throw new Error(`Open Food Facts answered ${response.status}`);
  const data = await response.json();
  const product = data.product;
  if (data.status !== 1 || !product?.product_name) return null;
  return {
    name: product.product_name.trim(),
    brand: product.brands ? product.brands.split(",")[0].trim() : null,
    size: product.quantity ? String(product.quantity).trim() : null,
  };
}

// ───────────────────────────────────────────── Actions shared by widget and mini-app

Script.action("tick", async ({ id, isOn }) => {
  const list = items().map((i) => (i.id === id ? { ...i, done: isOn, doneAt: isOn ? Date.now() : null } : i));
  saveItems(list);
  const item = list.find((i) => i.id === id);
  if (item) await pushTick(item);
});

Script.action("clear", async () => {
  const removed = items().filter((i) => i.done);
  if (removed.length === 0) return;
  saveItems(items().filter((i) => !i.done));
  await pushRemove(removed);
});

// ───────────────────────────────────────────── Mini-app actions

Script.action("add", async ({ value }) => {
  if (!value?.trim()) return;
  for (const part of value.split(/,|;/)) {
    const item = addItem(parseEntry(part));
    if (item) await pushAdd(item);
  }
  await UI.haptic("light");
});

Script.action("quick", async ({ name }) => {
  const u = usage()[name.toLowerCase()];
  const item = addItem({ name, qty: 1, note: null }, u ? { aisle: u.aisle } : {});
  if (item) await pushAdd(item);
  await UI.haptic("light");
});

Script.action("scan", () => setUi({ scanning: !ui().scanning, message: null }));

Script.action("scanned", async ({ value, type }) => {
  if (type === "text") return;
  const code = String(value).trim();
  const state = ui();
  if (state.lastCode === code && Date.now() - (state.lastCodeTime ?? 0) < 8000) return;
  setUi({ lastCode: code, lastCodeTime: Date.now(), message: `Looking up ${code}…` });
  try {
    const product = await lookupBarcode(code);
    if (!product) {
      setUi({ message: `${code} is not in Open Food Facts yet. Type the name instead.` });
      await UI.haptic("warning");
      return;
    }
    const note = [product.brand, product.size].filter(Boolean).join(" · ") || null;
    const item = addItem({ name: product.name, qty: 1, note });
    if (item) await pushAdd(item);
    setUi({ message: `Added ${product.name}` });
    await UI.haptic("success");
  } catch (error) {
    setUi({ message: `Could not look up ${code}: ${error.message}` });
    await UI.haptic("error");
  }
});

Script.action("sync", async () => {
  await reconcile(true);
  const s = Storage.get("sync", {});
  await UI.haptic(s.error ? "error" : "success");
});

Script.action("edit", ({ id }) => setUi({ page: "edit", editing: id }));
Script.action("page", ({ page }) => setUi({ page, editing: null, scanning: false, message: null }));

Script.action("field", async ({ id, field, value }) => {
  const list = items();
  const item = list.find((i) => i.id === id);
  if (!item) return;
  if (field === "name") { if (!value.trim()) return; item.name = value.trim(); }
  if (field === "qty") item.qty = Math.max(1, Math.round(Number(value) || 1));
  if (field === "note") item.note = value.trim() || null;
  if (field === "aisle") item.aisle = value;
  saveItems(list);
  if (field === "aisle") {
    const all = usage();
    if (all[item.name.toLowerCase()]) { all[item.name.toLowerCase()].aisle = value; Storage.set("usage", all); }
  }
  if (item.reminderId && settings().mirror && field !== "aisle") {
    try { await Reminders.update(item.reminderId, { title: itemTitle(item), notes: item.note }); } catch (error) { setSync({ error: error.message }); }
  }
});

Script.action("remove", async ({ id }) => {
  const item = items().find((i) => i.id === id);
  if (!item) return;
  saveItems(items().filter((i) => i.id !== id));
  await pushRemove([item]);
  setUi({ page: "home", editing: null });
});

Script.action("setting", ({ key, value, isOn }) => {
  Storage.set("settings", { ...settings(), [key]: value ?? isOn });
  if (key === "listName") Storage.set("sync", { listNames: Storage.get("sync", {}).listNames });
});

Script.action("forgetUsual", async () => {
  const choice = await UI.alert({ title: "Forget usual items?", message: "The quick-add row starts learning again from what you add next.", buttons: ["Cancel", "Forget"] });
  if (choice === 1) Storage.remove("usage");
});

Script.action("removeAll", async () => {
  const choice = await UI.alert({ title: "Remove every item?", message: "Open and ticked items are removed here and from the Reminders list.", buttons: ["Cancel", "Remove all"] });
  if (choice !== 1) return;
  const all = items();
  saveItems([]);
  await pushRemove(all);
});

// ───────────────────────────────────────────── Shared view pieces

function grouped(list) {
  return AISLES.map((a) => ({ aisle: a, rows: list.filter((i) => i.aisle === a.id) })).filter((g) => g.rows.length);
}

const dot = (hex, size = 8) => ({ type: "stack", direction: "horizontal", children: [], background: hex, cornerRadius: size / 2, frame: { width: size, height: size } });

function syncLine(font = "caption2") {
  const s = Storage.get("sync", {});
  if (!settings().mirror) return Widget.text("Reminders mirror off", { font, color: "secondary" });
  if (s.error) return Widget.text("Reminders sync needs attention", { font, color: "orange", lineLimit: 1 });
  if (!s.time) return Widget.text("Not synced yet", { font, color: "secondary" });
  return Widget.hstack([
    Widget.symbol("checklist", { size: 9, color: "secondary", fallback: "✓" }),
    Widget.text(`${s.list ?? settings().listName} ·`, { font, color: "secondary", lineLimit: 1 }),
    Widget.date(s.time, { style: "relative", font, color: "secondary" }),
  ], { spacing: 3 });
}

// ───────────────────────────────────────────── Widget

function widgetRow(item) {
  const a = aisle(item.aisle);
  return Widget.hstack([
    Widget.checkbox(itemTitle(item), item.done, "tick", { id: item.id }, { color: a.hex }),
    Widget.spacer(),
    item.note ? Widget.text(item.note, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }) : null,
  ], { spacing: 4 });
}

function widgetGroups(list, maxRows) {
  const nodes = [];
  let used = 0;
  for (const g of grouped(list)) {
    if (used >= maxRows) break;
    nodes.push(Widget.hstack([
      dot(g.aisle.hex, 7),
      Widget.text(g.aisle.label.toUpperCase(), { font: "caption2", weight: "bold", color: "secondary", lineLimit: 1 }),
    ], { spacing: 5 }));
    for (const item of g.rows) {
      if (used >= maxRows) break;
      nodes.push(widgetRow(item));
      used += 1;
    }
  }
  return nodes;
}

function allDone(family) {
  const ticked = items().filter((i) => i.done).length;
  return Widget.vstack([
    Widget.symbol("cart.badge.plus", { size: family === "small" ? 30 : 40, color: "green", fallback: "🛒" }),
    Widget.text(ticked ? "All ticked" : "Nothing to buy", { font: "headline" }),
    Widget.text(ticked ? "Clear the list from the app" : "Add items in Scriptwell or Reminders", { font: "caption2", color: "secondary", align: "center", lineLimit: 2 }),
    ticked && family !== "small" ? Widget.button("Clear ticked", "clear", null, { style: "bordered", color: "green" }) : null,
  ], { spacing: 4, url: APP_LINK });
}

Script.widget(({ family }) => {
  const list = items();
  const open = list.filter((i) => !i.done).sort((a, b) => AISLES.findIndex((x) => x.id === a.aisle) - AISLES.findIndex((x) => x.id === b.aisle) || a.added - b.added);
  const ticked = list.length - open.length;
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  let content;

  if (family === "rectangular") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("cart.fill", { size: 12, fallback: "🛒" }),
        Widget.text(open.length ? `${open.length} to buy` : "List is empty", { font: "headline", lineLimit: 1 }),
      ], { spacing: 4 }),
      ...open.slice(0, 2).map((i) => Widget.text(`• ${itemTitle(i)}`, { font: "caption", lineLimit: 1 })),
    ], { alignment: "leading", spacing: 1 });
  } else if (open.length === 0) {
    content = allDone(family);
  } else if (family === "small") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.text(String(open.length), { font: 34, weight: "bold", design: "rounded", color: "green" }),
        Widget.vstack([
          Widget.text(open.length === 1 ? "item" : "items", { font: "caption", weight: "semibold" }),
          Widget.text("to buy", { font: "caption2", color: "secondary" }),
        ], { alignment: "leading", spacing: 0 }),
      ], { spacing: 6, alignment: "center" }),
      ...open.slice(0, 3).map((i) => Widget.hstack([
        dot(aisle(i.aisle).hex, 6),
        Widget.text(itemTitle(i), { font: "caption", lineLimit: 1 }),
      ], { spacing: 5 })),
      open.length > 3 ? Widget.text(`+${open.length - 3} more`, { font: "caption2", color: "secondary" }) : null,
      Widget.spacer(),
      syncLine(),
    ], { alignment: "leading", spacing: 3, url: APP_LINK, frame: fill });
  } else if (family === "medium") {
    content = Widget.hstack([
      Widget.vstack([
        Widget.text("SHARED LIST", { font: "caption2", weight: "bold", color: "secondary" }),
        Widget.text(String(open.length), { font: 40, weight: "bold", design: "rounded", color: "green" }),
        Widget.text(open.length === 1 ? "item to buy" : "items to buy", { font: "caption", color: "secondary" }),
        Widget.spacer(),
        ticked ? Widget.button(`Clear ${ticked}`, "clear", null, { style: "bordered", color: "green" }) : syncLine(),
      ], { alignment: "leading", spacing: 1, frame: { width: 96, maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack([
        ...widgetGroups(open, 4),
        open.length > 4 ? Widget.text(`+${open.length - 4} more in the app`, { font: "caption2", color: "secondary" }) : null,
        Widget.spacer(),
      ], { alignment: "leading", spacing: 3, frame: fill }),
    ], { spacing: 10, url: APP_LINK, frame: fill });
  } else {
    const shown = 9;
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("cart.fill", { size: 16, color: "green", fallback: "🛒" }),
        Widget.text("Shared List", { font: "headline" }),
        Widget.spacer(),
        Widget.text(`${open.length} to buy${ticked ? ` · ${ticked} ticked` : ""}`, { font: "caption", color: "secondary" }),
      ], { spacing: 6 }),
      ...widgetGroups(open, shown),
      open.length > shown ? Widget.text(`+${open.length - shown} more in the app`, { font: "caption2", color: "secondary" }) : null,
      Widget.spacer(),
      Widget.hstack([
        syncLine("caption"),
        Widget.spacer(),
        ticked ? Widget.button(`Clear ${ticked} ticked`, "clear", null, { style: "bordered", color: "green" }) : null,
      ]),
    ], { alignment: "leading", spacing: 5, url: APP_LINK, frame: fill });
  }

  return { content, refreshAfter: 30 * 60 };
});

// ───────────────────────────────────────────── Mini-app pages

function homePage() {
  const list = items();
  const open = list.filter((i) => !i.done);
  const ticked = list.length - open.length;
  const s = Storage.get("sync", {});
  const state = ui();
  const usual = settings().usual ? usualItems() : [];

  const header = Widget.vstack([
    Widget.hstack([
      Widget.text(String(open.length), { font: 44, weight: "bold", design: "rounded", color: "green" }),
      Widget.vstack([
        Widget.text(open.length === 1 ? "item to buy" : "items to buy", { font: "headline" }),
        Widget.text(ticked ? `${ticked} ticked off` : "nothing ticked yet", { font: "caption", color: "secondary" }),
      ], { alignment: "leading", spacing: 1 }),
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [
        { title: "Sync with Reminders", symbol: "arrow.triangle.2.circlepath", action: "sync" },
        { title: "Settings", symbol: "gearshape", action: "page", args: { page: "settings" } },
        { title: "Remove everything", symbol: "trash", action: "removeAll", destructive: true },
      ]),
    ], { spacing: 12, alignment: "center" }),
    s.error
      ? Widget.text(s.error, { font: "caption", color: "orange", lineLimit: 3 })
      : syncLine("caption"),
  ], { alignment: "leading", spacing: 6, padding: 14, background: TILE_BG, cornerRadius: 14 });

  const adder = Widget.vstack([
    Widget.textField("Add an item, e.g. 2 oat milk (the blue one)", "", "add", null, { label: "Add" }),
    Widget.hstack([
      Widget.button(state.scanning ? "Stop scanning" : "Scan a barcode", "scan", null, { style: state.scanning ? "bordered" : "prominent", color: "green" }),
      Widget.spacer(),
      Widget.button("Sync", "sync", null, { style: "bordered" }),
    ]),
    state.scanning ? Widget.scanner("scanned", { frame: { height: 220 } }) : null,
    state.message ? Widget.text(state.message, { font: "footnote", color: "secondary" }) : null,
  ], { alignment: "leading", spacing: 10 });

  const chips = (row) => Widget.hstack(row.map((u) => Widget.button(Widget.hstack([
    dot(aisle(u.aisle).hex, 7),
    Widget.text(u.name, { font: "footnote", lineLimit: 1 }),
  ], { spacing: 5, padding: { horizontal: 10, vertical: 6 }, background: TILE_BG, cornerRadius: 10 }), "quick", { name: u.name })), { spacing: 6 });
  const usualBlock = usual.length ? Widget.vstack([
    Widget.text("USUAL ITEMS", { font: "caption2", weight: "bold", color: "secondary" }),
    chips(usual.slice(0, 4)),
    usual.length > 4 ? chips(usual.slice(4, 8)) : null,
  ], { alignment: "leading", spacing: 6 }) : null;

  const sections = grouped(list).map((g) => Widget.vstack([
    Widget.hstack([
      Widget.symbol(g.aisle.symbol, { size: 13, color: g.aisle.hex, fallback: g.aisle.fallback }),
      Widget.text(g.aisle.label, { font: "subheadline", weight: "semibold" }),
      Widget.spacer(),
      Widget.text(`${g.rows.filter((i) => !i.done).length}/${g.rows.length}`, { font: "caption", color: "secondary" }),
    ], { spacing: 6 }),
    ...g.rows.map((item) => Widget.hstack([
      Widget.vstack([
        Widget.checkbox(itemTitle(item), item.done, "tick", { id: item.id }, { color: g.aisle.hex }),
        item.note ? Widget.text(item.note, { font: "caption", color: "secondary", lineLimit: 1, padding: { leading: 28 } }) : null,
      ], { alignment: "leading", spacing: 0 }),
      Widget.spacer(),
      Widget.button(Widget.symbol("pencil.circle", { size: 20, color: "secondary", fallback: "✎" }), "edit", { id: item.id }),
    ], { spacing: 6 })),
  ], { alignment: "leading", spacing: 4, padding: 12, background: TILE_BG, cornerRadius: 14 }));

  const empty = list.length === 0 ? Widget.vstack([
    Widget.symbol("cart", { size: 44, color: "secondary", fallback: "🛒" }),
    Widget.text("Your list is empty", { font: "headline" }),
    Widget.text("Type something above, scan a barcode, or add it in the shared Reminders list.", { font: "footnote", color: "secondary", align: "center" }),
  ], { spacing: 6, padding: 20, frame: { maxWidth: "infinity" } }) : null;

  return Widget.vstack([
    header,
    adder,
    usualBlock,
    ...sections,
    empty,
    ticked ? Widget.button(`Clear ${ticked} ticked item${ticked === 1 ? "" : "s"}`, "clear", null, { style: "bordered", color: "red" }) : null,
  ], { alignment: "leading", spacing: 14, padding: 16 });
}

function editPage() {
  const item = items().find((i) => i.id === ui().editing);
  if (!item) return Widget.vstack([Widget.button("Back", "page", { page: "home" }, { style: "bordered" })], { padding: 16 });
  const row = (label, control) => Widget.vstack([Widget.text(label, { font: "caption", color: "secondary" }), control], { alignment: "leading", spacing: 4 });
  return Widget.vstack([
    Widget.button("‹ Back", "page", { page: "home" }, { style: "plain" }),
    Widget.text(itemTitle(item), { font: "title2", weight: "bold" }),
    row("Name", Widget.textField("Item", item.name, "field", { id: item.id, field: "name" })),
    Widget.stepper("Quantity", item.qty, "field", { id: item.id, field: "qty" }, { min: 1, max: 99 }),
    row("Note", Widget.textField("Brand, size, which shelf…", item.note ?? "", "field", { id: item.id, field: "note" })),
    row("Aisle", Widget.picker(AISLES.map((a) => ({ label: a.label, value: a.id })), item.aisle, "field", { id: item.id, field: "aisle" })),
    Widget.checkbox("Ticked off", item.done, "tick", { id: item.id }),
    Widget.divider(),
    Widget.text(item.reminderId ? "Mirrored to Reminders" : "Not in Reminders yet", { font: "caption", color: "secondary" }),
    Widget.button("Remove item", "remove", { id: item.id }, { style: "bordered", color: "red" }),
  ], { alignment: "leading", spacing: 14, padding: 16 });
}

function settingsPage() {
  const s = settings();
  const names = Storage.get("sync", {}).listNames ?? [];
  const options = [...new Set([s.listName, DEFAULT_LIST, ...names])].map((n) => ({ label: n, value: n }));
  return Widget.vstack([
    Widget.button("‹ Back", "page", { page: "home" }, { style: "plain" }),
    Widget.text("Settings", { font: "title2", weight: "bold" }),
    Widget.toggle("Mirror to Reminders", s.mirror, "setting", { key: "mirror" }, { color: "green" }),
    s.mirror ? Widget.vstack([
      Widget.text("Reminders list", { font: "caption", color: "secondary" }),
      Widget.picker(options, s.listName, "setting", { key: "listName" }),
      Widget.text("Create the list in the Reminders app and share it with your family. Lists appear here after the first sync.", { font: "caption", color: "secondary" }),
    ], { alignment: "leading", spacing: 4 }) : null,
    Widget.toggle("Show usual items", s.usual, "setting", { key: "usual" }, { color: "green" }),
    Widget.button("Forget usual items", "forgetUsual", null, { style: "bordered" }),
    Widget.divider(),
    Widget.text("For other scripts", { font: "headline" }),
    Widget.text(`Storage.shared.get("${SHARED_PREFIX}openCount") → ${Storage.shared.get(`${SHARED_PREFIX}openCount`, 0)}\nStorage.shared.get("${SHARED_PREFIX}items") → array of { name, qty, note, aisle }\nStorage.shared.get("${SHARED_PREFIX}updated") → ISO date`, { font: "caption2", design: "monospaced", color: "secondary" }),
  ], { alignment: "leading", spacing: 14, padding: 16 });
}

Script.ui(async () => {
  const page = ui().page;
  if (page === "home") await reconcile();
  const open = items().filter((i) => !i.done).length;
  return {
    title: page === "edit" ? "Edit item" : page === "settings" ? "Settings" : open ? `Shared List (${open})` : "Shared List",
    content: page === "edit" ? editPage() : page === "settings" ? settingsPage() : homePage(),
  };
});

// ───────────────────────────────────────────── Shortcuts and Siri

// "Add milk and eggs to the shared list" from a Shortcut; no input reads the list back.
Script.run(async (input) => {
  await reconcile();
  if (input?.trim()) {
    const added = [];
    for (const part of input.split(/,|;|\band\b/)) {
      const item = addItem(parseEntry(part));
      if (item) { await pushAdd(item); added.push(itemTitle(item)); }
    }
    return added.length ? `Added ${added.join(", ")}.` : "Nothing to add.";
  }
  const open = items().filter((i) => !i.done);
  if (open.length === 0) return "The shopping list is empty.";
  return grouped(open).map((g) => `${g.aisle.label}: ${g.rows.map(itemTitle).join(", ")}`).join("\n");
});
