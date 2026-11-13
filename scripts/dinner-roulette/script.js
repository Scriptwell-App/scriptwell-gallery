// @name        Dinner Roulette
// @description Spin for tonight's dinner from www.themealdb.com, scale the ingredients, send them to Reminders, keep favourites and plan the week; an optional on-device AI line says why you'll like it
// @permissions network, reminders
// @widget      small, medium, large
// @icon        fork.knife.circle.fill
// @color       #DC2626
// @version     1.0.0
// @author      va4w
// @category    food-drink

// How it works
// • Tap Spin to draw a random recipe from www.themealdb.com (free public API). Filters narrow the draw by
//   category, cuisine and one ingredient; only those filter words are sent to the server.
// • The recipe view shows the photo, ingredients with measures, instructions and a YouTube button. The servings
//   stepper scales every measure that starts with a number (recipes are treated as serving 4).
// • "Add to Reminders" writes the scaled ingredient list to the Reminders list you choose.
// • Favourites and a Monday-to-Sunday plan live in the script's Storage. Fill the plan from favourites or spins.
// • If Apple Intelligence is available, one on-device line explains why you'll like the dish; otherwise the category and cuisine are shown.
// • Widget: tonight's planned meal with its photo; medium and large also show the week. Open the mini-app once before adding it.

// ───────────────────────── Constants

const API = "https://www.themealdb.com/api/json/v1/1/";
const DAY = 86_400_000;
const BASE_SERVINGS = 4;
const MAX_FAVOURITES = 40;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const FALLBACK_CATEGORIES = ["Beef", "Breakfast", "Chicken", "Dessert", "Goat", "Lamb", "Miscellaneous", "Pasta", "Pork", "Seafood", "Side", "Starter", "Vegan", "Vegetarian"];
const FALLBACK_AREAS = ["American", "British", "Canadian", "Chinese", "Croatian", "Dutch", "Egyptian", "Filipino", "French", "Greek", "Indian", "Irish", "Italian", "Jamaican", "Japanese", "Kenyan", "Malaysian", "Mexican", "Moroccan", "Polish", "Portuguese", "Russian", "Spanish", "Thai", "Tunisian", "Turkish", "Ukrainian", "Vietnamese"];

const TILE_BG = { light: "#FEF2F2", dark: "#2A1515" };
const CARD_BG = { light: "#F1F5F9", dark: "#1E293B" };
const HERO = Widget.gradient(["#DC2626", "#9F1239"], { direction: "topLeadingToBottomTrailing" });
const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────── Storage

const filters = () => ({ category: "", area: "", ingredient: "", ...Storage.get("filters", {}) });
const current = () => Storage.get("current");
const favourites = () => Storage.get("favourites", []);
const plan = () => Storage.get("plan", {});
const servings = () => Storage.get("servings", BASE_SERVINGS);
const blurbs = () => Storage.get("blurbs", {});
const isFavourite = (id) => favourites().some((f) => f.id === id);

const isoDay = (date) => new Date(date).toLocaleDateString("en-CA");

// Monday to Sunday of the current week, as ISO dates.
function weekDates() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return WEEKDAYS.map((_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return isoDay(d); });
}

function setPlan(date, meal) {
  const next = { ...plan() };
  if (meal) next[date] = meal; else delete next[date];
  const cutoff = isoDay(new Date(Date.now() - 7 * DAY));
  for (const key of Object.keys(next)) if (key < cutoff) delete next[key];
  Storage.set("plan", next);
}

const summaryOf = (meal) => ({ id: meal.id, name: meal.name, thumb: meal.thumb, category: meal.category, area: meal.area });

// ───────────────────────── TheMealDB

async function getJSON(path, params = {}) {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { timeout: 12_000 });
  if (!response.ok) throw new Error(`TheMealDB answered ${response.status}`);
  return response.json();
}

function parseMeal(m) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = (m[`strIngredient${i}`] ?? "").trim();
    if (!name) continue;
    ingredients.push({ name, measure: (m[`strMeasure${i}`] ?? "").trim() });
  }
  return {
    id: m.idMeal,
    name: m.strMeal,
    category: m.strCategory ?? "",
    area: m.strArea ?? "",
    thumb: m.strMealThumb ?? null,
    tags: (m.strTags ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 4),
    youtube: m.strYoutube?.startsWith("https://") ? m.strYoutube : null,
    source: m.strSource?.startsWith("https://") ? m.strSource : null,
    instructions: (m.strInstructions ?? "").replace(/\r/g, "").trim(),
    ingredients,
  };
}

async function lookup(id) {
  const data = await getJSON("lookup.php", { i: id });
  if (!data.meals?.length) throw new Error("Recipe not found");
  return parseMeal(data.meals[0]);
}

async function lists() {
  const cached = Storage.get("lists");
  if (cached && Date.now() - cached.time < 7 * DAY) return cached;
  try {
    const [c, a] = await Promise.all([getJSON("list.php", { c: "list" }), getJSON("list.php", { a: "list" })]);
    const fresh = {
      categories: (c.meals ?? []).map((x) => x.strCategory).filter(Boolean).sort(),
      areas: (a.meals ?? []).map((x) => x.strArea).filter(Boolean).filter((x) => x !== "Unknown").sort(),
      time: Date.now(),
    };
    if (fresh.categories.length && fresh.areas.length) { Storage.set("lists", fresh); return fresh; }
  } catch (error) {
    console.warn("Lists:", error.message);
  }
  return cached ?? { categories: FALLBACK_CATEGORIES, areas: FALLBACK_AREAS, time: 0 };
}

// Draw one meal that matches every active filter; with no filters, a truly random one.
async function draw() {
  const f = filters();
  const queries = [];
  if (f.category) queries.push({ c: f.category });
  if (f.area) queries.push({ a: f.area });
  if (f.ingredient.trim()) queries.push({ i: f.ingredient.trim().toLowerCase().replace(/\s+/g, "_") });

  if (queries.length === 0) {
    const data = await getJSON("random.php");
    return parseMeal(data.meals[0]);
  }

  let pool = null;
  for (const query of queries) {
    const data = await getJSON("filter.php", query);
    const ids = new Set((data.meals ?? []).map((m) => m.idMeal));
    pool = pool ? new Set([...pool].filter((id) => ids.has(id))) : ids;
    if (pool.size === 0) break;
  }
  if (!pool || pool.size === 0) throw new Error("No recipe matches those filters. Loosen one and spin again.");
  const choices = [...pool].filter((id) => id !== current()?.id);
  const picked = (choices.length ? choices : [...pool])[Math.floor(Math.random() * (choices.length || pool.size))];
  return lookup(picked);
}

// ───────────────────────── Scaling measures

const FRACTIONS = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };

function leadingNumber(measure) {
  const m = /^\s*(\d+)?\s*(?:(\d+)\s*\/\s*(\d+)|([¼½¾⅓⅔⅛])|[.,](\d+))?/.exec(measure);
  if (!m || (m[1] === undefined && m[2] === undefined && m[4] === undefined)) return null;
  let value = Number(m[1] ?? 0);
  if (m[2] !== undefined) value += Number(m[2]) / Number(m[3]);
  else if (m[4]) value += FRACTIONS[m[4]];
  else if (m[5] !== undefined) value += Number(`0.${m[5]}`);
  return { value, rest: measure.slice(m[0].length).trim() };
}

function pretty(n) {
  const whole = Math.floor(n);
  const frac = n - whole;
  const named = Object.entries(FRACTIONS).find(([, v]) => Math.abs(v - frac) < 0.04);
  if (frac < 0.04) return String(whole);
  if (named) return `${whole || ""}${named[0]}`;
  return n.toLocaleString(Script.env.locale, { maximumFractionDigits: 1 });
}

function scaled(measure, people) {
  const parsed = leadingNumber(measure);
  if (!parsed || people === BASE_SERVINGS) return measure;
  return `${pretty((parsed.value * people) / BASE_SERVINGS)} ${parsed.rest}`.trim();
}

// ───────────────────────── On-device blurb

async function blurbFor(meal) {
  const fallback = [meal.area, meal.category].filter(Boolean).join(" · ") || "Tonight's pick";
  const known = blurbs()[meal.id];
  if (known) return known;
  try {
    const status = await AI.availability();
    if (!status.available) return fallback;
    const text = await AI.generate(`${meal.name}: a ${meal.area} ${meal.category} dish with ${meal.ingredients.slice(0, 6).map((i) => i.name).join(", ")}.`, {
      instructions: "Write one warm sentence of at most 18 words telling a home cook why they will like this dish. Reply with the sentence only.",
      temperature: 0.8,
    });
    const line = text.trim().split("\n")[0].slice(0, 160);
    if (!line) return fallback;
    const all = blurbs();
    all[meal.id] = line;
    Storage.set("blurbs", Object.fromEntries(Object.entries(all).slice(-60)));
    return line;
  } catch (error) {
    console.warn("AI:", error.message);
    return fallback;
  }
}

// ───────────────────────── Actions

let tab = 0;
let busy = false;
let notice = null;
let menu = null;
let reminderLists = null;

Script.action("tab", ({ value }) => { tab = value; });
Script.action("filter", ({ field, value }) => Storage.set("filters", { ...filters(), [field]: value }));
Script.action("clearFilters", () => Storage.remove("filters"));
Script.action("servings", ({ value }) => Storage.set("servings", value));

async function spin(assignDate) {
  busy = true;
  notice = null;
  try {
    const meal = await draw();
    Storage.set("current", meal);
    Storage.set("lastSpin", Date.now());
    if (assignDate) setPlan(assignDate, summaryOf(meal));
    await UI.haptic("success");
    tab = 1;
    const line = await blurbFor(meal);
    Storage.set("current", { ...meal, blurb: line });
  } catch (error) {
    notice = error.message;
    await UI.haptic("error");
  } finally {
    busy = false;
  }
}

Script.action("spin", () => spin(null));
Script.action("spinFor", ({ date }) => spin(date));

Script.action("show", async ({ id }) => {
  busy = true;
  try {
    const meal = await lookup(id);
    Storage.set("current", { ...meal, blurb: await blurbFor(meal) });
    tab = 1;
  } catch (error) {
    notice = error.message;
  } finally {
    busy = false;
  }
});

Script.action("favourite", () => {
  const meal = current();
  if (!meal) return;
  const list = favourites().filter((f) => f.id !== meal.id);
  Storage.set("favourites", isFavourite(meal.id) ? list : [summaryOf(meal), ...list].slice(0, MAX_FAVOURITES));
});
Script.action("unfavourite", ({ id }) => Storage.set("favourites", favourites().filter((f) => f.id !== id)));

Script.action("planDay", ({ date, id }) => {
  const meal = id === current()?.id ? current() : favourites().find((f) => f.id === id);
  if (meal) setPlan(date, summaryOf(meal));
  tab = 3;
});
Script.action("planPick", async ({ id, name }) => {
  const dates = weekDates();
  const labels = dates.map((d) => new Date(`${d}T12:00:00`).toLocaleDateString(Script.env.locale, { weekday: "long" }));
  const choice = await UI.alert({ title: `Plan ${name} for…`, buttons: [...labels, "Cancel"] });
  if (choice >= 0 && choice < 7) {
    const meal = id === current()?.id ? current() : favourites().find((f) => f.id === id);
    if (meal) setPlan(dates[choice], summaryOf(meal));
    tab = 3;
  }
});
Script.action("unplan", ({ date }) => setPlan(date, null));
Script.action("open", ({ url }) => UI.openURL(url));
Script.action("setList", ({ value }) => Storage.set("shopList", value || null));

Script.action("reminders", async () => {
  const meal = current();
  if (!meal) return;
  const people = servings();
  const list = Storage.get("shopList");
  const choice = await UI.alert({ title: "Add ingredients to Reminders?", message: `${meal.ingredients.length} items for ${people} servings${list ? ` go to “${list}”` : ""}.`, buttons: ["Cancel", "Add"] });
  if (choice !== 1) return;
  let added = 0;
  try {
    for (const item of meal.ingredients) {
      const reminder = { title: `${scaled(item.measure, people)} ${item.name}`.trim(), notes: `For ${meal.name}` };
      if (list) reminder.list = list;
      await Reminders.add(reminder);
      added++;
    }
    await UI.haptic("success");
    notice = `${added} ingredients added to Reminders.`;
  } catch (error) {
    notice = `Added ${added} before Reminders failed: ${error.message}`;
  }
});

// ───────────────────────── Mini-app pieces

const pill = (text, color = "secondary") => Widget.text(text, {
  font: "caption2", weight: "semibold", color, padding: { horizontal: 7, vertical: 3 }, background: CARD_BG, cornerRadius: 8,
});

function mealThumb(meal, size, radius = 12) {
  if (meal?.thumb) return Widget.image({ src: `${meal.thumb}/preview`, size, cornerRadius: radius, contentMode: "fill" });
  return Widget.symbol("fork.knife", { size: Math.round(size / 2), color: "secondary", fallback: "🍽", frame: { width: size, height: size } });
}

function spinTab(catalog) {
  const f = filters();
  const last = Storage.get("lastSpin");
  const active = [f.category, f.area, f.ingredient.trim()].filter(Boolean);
  return Widget.vstack([
    Widget.vstack([
      Widget.symbol("fork.knife.circle.fill", { size: 64, color: "white", fallback: "🍽" }),
      Widget.text(busy ? "Spinning…" : "What's for dinner?", { font: "title2", weight: "bold", color: "white" }),
      Widget.text(active.length ? `Within ${active.join(" · ")}` : "Anything from 300+ recipes", { font: "footnote", color: "#FFFFFFCC" }),
      busy ? Widget.progress(0.6, { style: "ring", color: "white" }) : Widget.button("Spin", "spin", null, { style: "prominent", color: "white" }),
    ], { spacing: 10, padding: 24, background: HERO, cornerRadius: 20, frame: { maxWidth: "infinity" } }),
    notice ? Widget.text(notice, { font: "footnote", color: "orange", align: "center" }) : null,
    Widget.card([
      Widget.picker([{ label: "Any category", value: "" }, ...catalog.categories.map((c) => ({ label: c, value: c }))], f.category, "filter", { field: "category" }, { label: "Category" }),
      Widget.picker([{ label: "Any cuisine", value: "" }, ...catalog.areas.map((a) => ({ label: a, value: a }))], f.area, "filter", { field: "area" }, { label: "Cuisine" }),
      Widget.textField("e.g. chicken, then Return", f.ingredient, "filter", { field: "ingredient" }, { label: "Ingredient" }),
      active.length ? Widget.button("Clear filters", "clearFilters", null, { style: "plain", color: "red" }) : null,
    ], { title: "Filters", symbol: "line.3.horizontal.decrease.circle.fill", color: "red" }),
    last ? Widget.hstack([Widget.text("Last spin", { font: "caption", color: "secondary" }), Widget.date(last, { style: "relative", font: "caption", color: "secondary" })], { spacing: 4 }) : null,
  ], { spacing: 14 });
}

function recipeTab() {
  const meal = current();
  if (!meal) {
    return Widget.vstack([
      Widget.symbol("sparkles", { size: 44, color: "red", fallback: "✨" }),
      Widget.text("No recipe yet", { font: "headline" }),
      Widget.text("Spin the wheel or open a favourite.", { color: "secondary" }),
    ], { spacing: 8, padding: 30 });
  }
  const people = servings();
  const fav = isFavourite(meal.id);
  const paragraphs = meal.instructions.split(/\n+/).filter((p) => p.trim()).slice(0, 25);
  return Widget.vstack([
    meal.thumb ? Widget.image({ src: meal.thumb, cornerRadius: 18, contentMode: "fill", frame: { maxWidth: "infinity", height: 220 } }) : null,
    Widget.text(meal.name, { font: "title2", weight: "bold", lineLimit: 2 }),
    Widget.hstack([meal.area ? pill(meal.area, "red") : null, meal.category ? pill(meal.category, "orange") : null, ...meal.tags.slice(0, 2).map((t) => pill(t))], { spacing: 6 }),
    Widget.text(meal.blurb ?? [meal.area, meal.category].filter(Boolean).join(" · "), { font: "callout", design: "serif", color: "secondary" }),
    notice ? Widget.text(notice, { font: "footnote", color: "orange" }) : null,
    Widget.hstack([
      Widget.button(fav ? "♥ Favourite" : "♡ Favourite", "favourite", null, { style: fav ? "prominent" : "bordered", color: "red" }),
      Widget.button("Plan…", "planPick", { id: meal.id, name: meal.name }, { style: "bordered" }),
      Widget.menu("ellipsis.circle", [
        { title: "Add ingredients to Reminders", symbol: "checklist", action: "reminders" },
        meal.youtube ? { title: "Watch on YouTube", symbol: "play.rectangle.fill", action: "open", args: { url: meal.youtube } } : null,
        meal.source ? { title: "Open the source", symbol: "safari", action: "open", args: { url: meal.source } } : null,
      ].filter(Boolean)),
    ], { spacing: 8 }),
    Widget.card([
      Widget.stepper(`Servings · ${people}`, people, "servings", null, { min: 1, max: 16 }),
      ...meal.ingredients.map((item) => Widget.hstack([
        Widget.text(item.name, { font: "subheadline" }),
        Widget.spacer(),
        Widget.text(scaled(item.measure, people), { font: "subheadline", weight: "semibold", design: "rounded", color: "red", align: "trailing" }),
      ])),
      Widget.button("Add to Reminders", "reminders", null, { style: "bordered", color: "red" }),
    ], { title: "Ingredients", subtitle: `${meal.ingredients.length} items`, symbol: "basket.fill", color: "red" }),
    Widget.card(paragraphs.map((p, i) => Widget.hstack([
      Widget.text(String(i + 1), { font: "caption", weight: "bold", color: "white", padding: { horizontal: 6, vertical: 2 }, background: "red", cornerRadius: 8 }),
      Widget.text(p.trim(), { font: "body" }),
    ], { spacing: 8, alignment: "top" })), { title: "Method", symbol: "list.number", color: "red" }),
    meal.youtube ? Widget.button("▶︎ Watch on YouTube", "open", { url: meal.youtube }, { style: "bordered" }) : null,
  ], { alignment: "leading", spacing: 12 });
}

function favouritesTab() {
  const list = favourites();
  if (list.length === 0) {
    return Widget.vstack([
      Widget.symbol("heart", { size: 44, color: "red", fallback: "♡" }),
      Widget.text("No favourites yet", { font: "headline" }),
      Widget.text("Tap ♡ on a recipe you want to keep.", { color: "secondary" }),
    ], { spacing: 8, padding: 30 });
  }
  return Widget.vstack(list.map((f) => Widget.hstack([
    Widget.button(Widget.hstack([
      mealThumb(f, 48, 10),
      Widget.vstack([
        Widget.text(f.name, { font: "subheadline", weight: "medium", lineLimit: 1 }),
        Widget.text([f.area, f.category].filter(Boolean).join(" · "), { font: "caption", color: "secondary" }),
      ], { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", alignment: "leading" } }),
    ], { spacing: 10 }), "show", { id: f.id }),
    Widget.menu("ellipsis.circle", [
      { title: "Plan for a day…", symbol: "calendar.badge.plus", action: "planPick", args: { id: f.id, name: f.name } },
      { title: "Cook tonight", symbol: "moon.stars.fill", action: "planDay", args: { date: isoDay(new Date()), id: f.id } },
      { title: "Remove", symbol: "heart.slash", action: "unfavourite", args: { id: f.id }, destructive: true },
    ]),
  ], { spacing: 8, padding: 8, background: CARD_BG, cornerRadius: 12 })), { spacing: 8 });
}

function planTab() {
  const today = isoDay(new Date());
  const p = plan();
  const meal = current();
  const favs = favourites();
  return Widget.vstack([
    Widget.text("Tap a day's menu to fill it from the current recipe, a favourite or a fresh spin.", { font: "footnote", color: "secondary" }),
    ...weekDates().map((date, i) => {
      const entry = p[date];
      const isToday = date === today;
      const label = new Date(`${date}T12:00:00`).toLocaleDateString(Script.env.locale, { weekday: "short", day: "numeric" });
      return Widget.hstack([
        Widget.text(label, { font: "caption", weight: isToday ? "bold" : "semibold", color: isToday ? "red" : "secondary", frame: { width: 58, alignment: "leading" } }),
        entry
          ? Widget.button(Widget.hstack([
              mealThumb(entry, 40, 8),
              Widget.text(entry.name, { font: "subheadline", weight: "medium", lineLimit: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
            ], { spacing: 8 }), "show", { id: entry.id })
          : Widget.text("Nothing planned", { font: "subheadline", color: "secondary", frame: { maxWidth: "infinity", alignment: "leading" } }),
        Widget.menu("ellipsis.circle", [
          meal ? { title: `Use ${meal.name}`, symbol: "fork.knife", action: "planDay", args: { date, id: meal.id } } : null,
          { title: "Spin for this day", symbol: "dice.fill", action: "spinFor", args: { date } },
          ...favs.slice(0, 5).map((f) => ({ title: `♥ ${f.name}`, symbol: "heart.fill", action: "planDay", args: { date, id: f.id } })),
          entry ? { title: "Clear", symbol: "xmark.circle", action: "unplan", args: { date }, destructive: true } : null,
        ].filter(Boolean)),
      ], { spacing: 8, padding: 8, background: isToday ? TILE_BG : CARD_BG, cornerRadius: 12 });
    }),
    Widget.card([
      Widget.picker([{ label: "Default list", value: "" }, ...(reminderLists ?? []).map((l) => ({ label: l.title, value: l.title }))], Storage.get("shopList") ?? "", "setList", null, { label: "Shopping list" }),
      Widget.text(reminderLists === null ? "Lists load when Reminders access is allowed." : `${reminderLists.length} list${reminderLists.length === 1 ? "" : "s"} available`, { font: "caption", color: "secondary" }),
    ], { title: "Reminders", symbol: "checklist", color: "red" }),
  ], { alignment: "leading", spacing: 8 });
}

Script.ui(async () => {
  const catalog = tab === 0 ? await lists() : { categories: FALLBACK_CATEGORIES, areas: FALLBACK_AREAS };
  if (tab === 3 && reminderLists === null) {
    try { reminderLists = await Reminders.lists(); } catch { reminderLists = []; }
  }
  return {
    title: "Dinner Roulette",
    content: Widget.vstack([
      Widget.tabs([
        { title: "Spin", symbol: "dice.fill", content: spinTab(catalog) },
        { title: "Recipe", symbol: "book.fill", content: recipeTab() },
        { title: "Favourites", symbol: "heart.fill", content: favouritesTab() },
        { title: "Plan", symbol: "calendar", content: planTab() },
      ], { selected: tab, action: "tab" }),
    ], { padding: 12 }),
  };
});

// ───────────────────────── Widget

function weekList(compact) {
  const today = isoDay(new Date());
  const p = plan();
  return Widget.vstack(weekDates().map((date, i) => {
    const entry = p[date];
    const isToday = date === today;
    return Widget.hstack([
      Widget.text(WEEKDAYS[i], { font: "caption2", weight: "bold", color: isToday ? "red" : "secondary", frame: { width: 26, alignment: "leading" } }),
      compact ? null : mealThumb(entry, 18, 4),
      Widget.text(entry?.name ?? "—", { font: compact ? "caption2" : "caption", weight: isToday ? "semibold" : "regular", color: entry ? "primary" : "secondary", lineLimit: 1 }),
    ], { spacing: 5 });
  }), { alignment: "leading", spacing: compact ? 1 : 4 });
}

function tonightBlock(meal, family) {
  const title = Widget.text("TONIGHT", { font: "caption2", weight: "bold", color: "#FFFFFFCC" });
  if (!meal) {
    return Widget.vstack([
      title,
      Widget.spacer(),
      Widget.symbol("dice.fill", { size: family === "small" ? 30 : 36, color: "white", fallback: "🎲" }),
      Widget.text("Nothing planned", { font: "headline", color: "white" }),
      Widget.text("Tap to spin", { font: "caption2", color: "#FFFFFFCC" }),
    ], { alignment: "leading", spacing: 2, padding: 12, background: HERO, cornerRadius: family === "small" ? 0 : 14, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
  }
  return Widget.zstack([
    meal.thumb ? Widget.image({ src: `${meal.thumb}/preview`, contentMode: "fill", frame: { maxWidth: "infinity", maxHeight: "infinity" } }) : null,
    Widget.vstack([
      title,
      Widget.spacer(),
      Widget.text(meal.name, { font: family === "large" ? "title3" : "headline", weight: "bold", color: "white", lineLimit: 2, minimumScale: 0.7 }),
      Widget.text([meal.area, meal.category].filter(Boolean).join(" · "), { font: "caption2", color: "#FFFFFFCC", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 1, padding: 10, background: Widget.gradient(["#00000000", "#000000B3"], { direction: "topToBottom" }), frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "bottomLeading" } }),
  ], { cornerRadius: family === "small" ? 0 : 14, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
}

Script.widget(({ family }) => {
  const tonight = plan()[isoDay(new Date())] ?? null;
  const midnight = new Date();
  midnight.setHours(24, 0, 10, 0);
  let content;

  switch (family) {
    case "small":
      content = Widget.vstack([tonightBlock(tonight, family)], { url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
      break;
    case "medium":
      content = Widget.hstack([
        Widget.vstack([tonightBlock(tonight, family)], { frame: { width: 150, maxHeight: "infinity" } }),
        Widget.vstack([
          Widget.text("This week", { font: "caption", weight: "semibold", color: "secondary" }),
          weekList(true),
        ], { alignment: "leading", spacing: 3, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      ], { spacing: 10, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
      break;
    default:
      content = Widget.vstack([
        Widget.vstack([tonightBlock(tonight, family)], { frame: { maxWidth: "infinity", height: 160 } }),
        Widget.hstack([
          Widget.symbol("calendar", { size: 12, color: "red", fallback: "📅" }),
          Widget.text("This week", { font: "headline" }),
          Widget.spacer(),
          Widget.text(`${favourites().length} favourites`, { font: "caption2", color: "secondary" }),
        ], { spacing: 4 }),
        weekList(false),
        Widget.spacer(),
      ], { alignment: "leading", spacing: 8, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
  }
  return { content, refreshAt: midnight };
});

// ───────────────────────── Shortcuts and Siri

Script.run(async (input) => {
  if (input?.trim()) Storage.set("filters", { ...filters(), ingredient: input.trim() });
  const tonight = plan()[isoDay(new Date())];
  if (tonight && !input) return `Tonight: ${tonight.name} (${[tonight.area, tonight.category].filter(Boolean).join(", ")}).`;
  try {
    const meal = await draw();
    Storage.set("current", meal);
    return `How about ${meal.name}? ${[meal.area, meal.category].filter(Boolean).join(" · ")}. Ingredients: ${meal.ingredients.map((i) => i.name).join(", ")}.`;
  } catch (error) {
    return `Could not spin: ${error.message}`;
  }
});
