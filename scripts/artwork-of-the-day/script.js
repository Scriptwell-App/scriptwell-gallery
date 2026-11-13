// @name        Artwork of the Day
// @description One public-domain artwork a day from the Art Institute of Chicago (api.artic.edu, www.artic.edu) in a theme you choose, with an elegant caption; browse, favourite and pick your own. Optional on-device AI note.
// @permissions network
// @widget      small, medium, large, extraLarge
// @icon        photo.artframe
// @color       #B45309
// @version     1.0.0
// @author      scriptwell
// @category    graphics-design

// How it works
// • Searches the Art Institute of Chicago's public API (api.artic.edu) for public-domain works in your
//   theme and caches the results for a week. Only the theme's search words are sent; nothing about you.
// • The day's work is chosen from the date, so the widget shows the same piece all day and changes at
//   midnight. The image is downloaded once a day (www.artic.edu IIIF) into Files; widgets only read it.
// • Tap a widget to open the artwork's page at artic.edu. Set the widget Parameter to a theme such as
//   "japanese prints" or "photography" to give each widget its own theme.
// • The mini-app browses the theme as a grid, marks favourites and can make any work "today's".
//   If Apple Intelligence is available, a one-line note is summarised on-device from the museum's
//   own image description; otherwise the first sentence of that description is used.
// • Run it once in the app before adding a widget, so the network permission is approved.

// ───────────────────────── Themes and constants

const THEMES = [
  { id: "impressionism", label: "Impressionism", query: "impressionism" },
  { id: "japanese-prints", label: "Japanese prints", query: "japanese woodblock print" },
  { id: "photography", label: "Photography", query: "photograph" },
  { id: "dutch", label: "Dutch Golden Age", query: "dutch 17th century painting" },
  { id: "renaissance", label: "Renaissance", query: "renaissance painting" },
  { id: "landscapes", label: "Landscapes", query: "landscape painting" },
  { id: "portraits", label: "Portraits", query: "portrait painting" },
  { id: "still-life", label: "Still life", query: "still life" },
  { id: "abstract", label: "Abstract", query: "abstract painting" },
  { id: "american", label: "American art", query: "american painting" },
  { id: "textiles", label: "Textiles", query: "textile" },
];

const API = "https://api.artic.edu/api/v1/artworks/search";
const IIIF = "https://www.artic.edu/iiif/2";
const CREDIT = "Art Institute of Chicago";
const RESULTS_FRESH_MS = 7 * 86_400_000;
const PAGE = 20;

const dayKey = () => new Date().toLocaleDateString("en-CA");
const imageUrl = (imageId, width) => `${IIIF}/${imageId}/full/${width},/0/default.jpg`;
const pageUrl = (id) => `https://www.artic.edu/artworks/${id}`;
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

function themeFor(text) {
  const wanted = String(text ?? "").trim().toLowerCase();
  if (!wanted) return THEMES.find((t) => t.id === Storage.get("theme")) ?? THEMES[0];
  const compact = wanted.replace(/[^a-z]/g, "");
  return THEMES.find((t) => t.id === wanted || t.label.toLowerCase() === wanted)
    ?? THEMES.find((t) => t.id.replace(/-/g, "").includes(compact) || t.label.toLowerCase().replace(/[^a-z]/g, "").includes(compact))
    ?? THEMES.find((t) => t.id === Storage.get("theme"))
    ?? THEMES[0];
}

// A small, stable hash so the same date and theme always give the same work.
function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h;
}

const tidy = (text, max) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// ───────────────────────── Museum API

async function loadTheme(theme, { force = false, timeout = 10_000 } = {}) {
  const key = `results:${theme.id}`;
  const cached = Storage.get(key);
  if (cached && !force && Date.now() - cached.time < RESULTS_FRESH_MS) return cached.items;

  try {
    const url = new URL(API);
    url.searchParams.set("q", theme.query);
    url.searchParams.set("fields", "id,title,artist_display,date_display,image_id,is_public_domain,medium_display,thumbnail");
    url.searchParams.set("limit", "40");
    url.searchParams.set("query[term][is_public_domain]", "true");
    const response = await fetch(url, { timeout, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`api.artic.edu answered ${response.status}`);
    const { data } = await response.json();
    const items = (data ?? [])
      .filter((a) => a.image_id && a.is_public_domain !== false)
      .map((a) => ({
        id: a.id,
        title: tidy(a.title, 120) || "Untitled",
        artist: tidy(a.artist_display, 80) || "Unknown artist",
        date: tidy(a.date_display, 40),
        medium: tidy(a.medium_display, 80),
        image_id: a.image_id,
        alt: tidy(a.thumbnail?.alt_text, 400),
      }));
    if (items.length === 0) throw new Error("No public-domain works with images for this theme");
    Storage.set(key, { items, time: Date.now() });
    pruneCaches(theme.id);
    return items;
  } catch (error) {
    if (cached) return cached.items; // offline: last week's list is fine
    throw error;
  }
}

// Keep the result lists for a handful of themes so Storage stays small.
function pruneCaches(keep) {
  const keys = Storage.keys().filter((k) => k.startsWith("results:") && k !== `results:${keep}`);
  const sorted = keys.sort((a, b) => (Storage.get(a)?.time ?? 0) - (Storage.get(b)?.time ?? 0));
  for (const k of sorted.slice(0, Math.max(0, sorted.length - 3))) Storage.remove(k);
}

function pickFor(day, theme, items) {
  const override = Storage.get(`override:${theme.id}`);
  if (override?.day === day) {
    const chosen = items.find((a) => a.id === override.id) ?? override.artwork;
    if (chosen) return chosen;
  }
  return items[hash(`${day}:${theme.id}`) % items.length];
}

async function noteFor(artwork) {
  const fallback = artwork.alt ? tidy(artwork.alt.split(/(?<=[.!?])\s/)[0], 160) : "";
  if (Script.env.mode !== "app" || !artwork.alt || artwork.alt.length < 40) return fallback;
  try {
    const status = await AI.availability();
    if (!status.available) return fallback;
    const note = await AI.summarize(artwork.alt, { sentences: 1 });
    return tidy(note, 200) || fallback;
  } catch (error) {
    console.warn("Note fell back to the museum text:", error.message);
    return fallback;
  }
}

// Makes sure today's record and image exist for a theme. Widgets call this with a tight timeout.
async function ensureToday(theme, { force = false, timeout = 10_000 } = {}) {
  const key = `today:${theme.id}`;
  const day = dayKey();
  const record = Storage.get(key);
  if (!force && record?.day === day && (await Files.exists(record.file.path))) return record;

  const items = await loadTheme(theme, { timeout });
  const artwork = pickFor(day, theme, items);
  if (!force && record?.artwork?.id === artwork.id && (await Files.exists(record.file.path))) {
    const same = { ...record, day };
    Storage.set(key, same);
    return same;
  }

  // 843 px is the museum's recommended width; fall back to a smaller rendition if that one is refused.
  let response = await fetch(imageUrl(artwork.image_id, 843), { timeout });
  if (!response.ok) response = await fetch(imageUrl(artwork.image_id, 600), { timeout });
  if (!response.ok) throw new Error(`www.artic.edu answered ${response.status} for the image`);
  const bytes = await response.bytes();
  const path = `art/${theme.id}.jpg`;
  await Files.writeBytes(path, bytes);

  const fresh = { day, themeId: theme.id, artwork, file: { path }, note: await noteFor(artwork), time: Date.now() };
  Storage.set(key, fresh);
  Storage.set("lastError", null);
  return fresh;
}

// Today's record, or the last one if the network is down.
async function todayOrLast(theme, options) {
  try {
    return { record: await ensureToday(theme, options), stale: false };
  } catch (error) {
    Storage.set("lastError", { message: error.message, time: Date.now() });
    const record = Storage.get(`today:${theme.id}`);
    return { record: record && (await Files.exists(record.file.path)) ? record : null, stale: true, error };
  }
}

// ───────────────────────── Favourites

const favourites = () => Storage.get("favourites", []);
const isFavourite = (id) => favourites().some((f) => f.id === id);

function toggleFavourite(artwork, themeId) {
  const list = favourites();
  const next = isFavourite(artwork.id)
    ? list.filter((f) => f.id !== artwork.id)
    : [{ ...artwork, themeId }, ...list].slice(0, 60);
  Storage.set("favourites", next);
}

// ───────────────────────── Widget

const SERIF = { design: "serif" };
const SCRIM = Widget.gradient(["#00000000", "#000000B3", "#000000E6"], { direction: "topToBottom" });

function caption(record, family) {
  const a = record.artwork;
  const big = family === "large" || family === "extraLarge";
  return Widget.vstack([
    Widget.text(a.title, { font: big ? "title3" : "headline", weight: "semibold", color: "white", lineLimit: 2, minimumScale: 0.8, ...SERIF }),
    Widget.text(a.artist, { font: big ? "subheadline" : "caption", color: "#FFFFFFD9", lineLimit: big ? 2 : 1 }),
    Widget.text([a.date, big ? a.medium : null].filter(Boolean).join(" · "), { font: "caption2", color: "#FFFFFFB3", lineLimit: 1 }),
    big && record.note ? Widget.text(record.note, { font: "caption", color: "#FFFFFFD9", lineLimit: family === "extraLarge" ? 4 : 3, padding: { top: 4 } }) : null,
    big ? Widget.text(CREDIT, { font: "caption2", weight: "medium", color: "#FFFFFF99", padding: { top: 4 } }) : null,
  ], { alignment: "leading", spacing: 2 });
}

function fullBleed(record, family) {
  return Widget.zstack([
    Widget.image({ file: record.file, contentMode: "fill", frame: { maxWidth: "infinity", maxHeight: "infinity" } }),
    Widget.vstack([
      Widget.spacer(),
      Widget.vstack([caption(record, family)], {
        alignment: "leading", padding: family === "small" ? { horizontal: 12, top: 28, bottom: 12 } : { horizontal: 16, top: 40, bottom: 14 },
        background: SCRIM, frame: { maxWidth: "infinity", alignment: "leading" },
      }),
    ], { frame: { maxWidth: "infinity", maxHeight: "infinity" } }),
  ], { alignment: "bottom", url: pageUrl(record.artwork.id), frame: { maxWidth: "infinity", maxHeight: "infinity" } });
}

function sideBySide(record, theme) {
  const a = record.artwork;
  return Widget.hstack([
    Widget.image({ file: record.file, contentMode: "fill", cornerRadius: 12, frame: { width: 132, maxHeight: "infinity" } }),
    Widget.vstack([
      Widget.text(theme.label.toUpperCase(), { font: "caption2", weight: "bold", color: "#B45309" }),
      Widget.text(a.title, { font: "headline", weight: "semibold", lineLimit: 3, minimumScale: 0.8, ...SERIF }),
      Widget.text(a.artist, { font: "caption", color: "secondary", lineLimit: 2 }),
      Widget.text(a.date, { font: "caption2", color: "secondary", lineLimit: 1 }),
      Widget.spacer(),
      Widget.text(CREDIT, { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 3, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
  ], { spacing: 12, padding: 12, url: pageUrl(a.id), frame: { maxWidth: "infinity", maxHeight: "infinity" } });
}

function placeholder(message) {
  return Widget.vstack([
    Widget.symbol("photo.artframe", { size: 30, color: "#B45309", fallback: "🖼" }),
    Widget.text(message, { font: "caption", color: "secondary", align: "center", lineLimit: 4 }),
  ], { spacing: 8, padding: 12, url: APP_LINK });
}

function nextMidnight() {
  const date = new Date();
  date.setHours(24, 2, 0, 0);
  return date;
}

Script.widget(async ({ family, parameter }) => {
  const theme = themeFor(parameter);
  // Two requests at most (search, then the image), each short enough to stay inside the 8 s widget budget.
  const { record, stale } = await todayOrLast(theme, { timeout: 3_500 });
  if (!record) {
    return { content: placeholder(`Open Artwork of the Day once to load "${theme.label}".`), refreshAfter: 30 * 60 };
  }
  const content = family === "medium" ? sideBySide(record, theme) : fullBleed(record, family);
  return stale ? { content, refreshAfter: 60 * 60 } : { content, refreshAt: nextMidnight() };
});

// ───────────────────────── Actions

Script.action("theme", async ({ value }) => {
  Storage.set("theme", value);
  Storage.set("selected", null);
  Storage.set("showAll", false);
});

Script.action("select", ({ id }) => Storage.set("selected", Storage.get("selected") === id ? null : id));
Script.action("showAll", () => Storage.set("showAll", true));

Script.action("useToday", async ({ id }) => {
  const theme = themeFor(null);
  const items = Storage.get(`results:${theme.id}`)?.items ?? [];
  const artwork = items.find((a) => a.id === id) ?? favourites().find((f) => f.id === id);
  if (!artwork) return;
  Storage.set(`override:${theme.id}`, { day: dayKey(), id, artwork });
  await ensureToday(theme, { force: true });
  await UI.haptic("success");
});

Script.action("surprise", async () => {
  const theme = themeFor(null);
  const items = await loadTheme(theme);
  const today = Storage.get(`today:${theme.id}`)?.artwork?.id;
  const others = items.filter((a) => a.id !== today);
  const pick = others[Math.floor(Math.random() * others.length)] ?? items[0];
  Storage.set(`override:${theme.id}`, { day: dayKey(), id: pick.id, artwork: pick });
  await ensureToday(theme, { force: true });
});

Script.action("resetToday", async () => {
  const theme = themeFor(null);
  Storage.remove(`override:${theme.id}`);
  await ensureToday(theme, { force: true });
});

Script.action("favourite", ({ id }) => {
  const theme = themeFor(null);
  const items = Storage.get(`results:${theme.id}`)?.items ?? [];
  const artwork = items.find((a) => a.id === id) ?? Storage.get(`today:${theme.id}`)?.artwork;
  if (artwork) toggleFavourite(artwork, theme.id);
});

Script.action("unfavourite", ({ id }) => Storage.set("favourites", favourites().filter((f) => f.id !== id)));
Script.action("open", async ({ id }) => { await UI.openURL(pageUrl(id)); });
Script.action("refresh", async () => { await loadTheme(themeFor(null), { force: true }); await ensureToday(themeFor(null), { force: true }); });

// ───────────────────────── Mini-app pieces

const TILE_BG = { light: "#FDF6EC", dark: "#1F1A14" };

function todayCard(record, theme, stale) {
  if (!record) {
    const error = Storage.get("lastError");
    return Widget.card([
      Widget.text(error ? `Could not load: ${error.message}` : "Loading today's artwork…", { color: "secondary" }),
      error ? Widget.button("Try again", "refresh", null, { style: "bordered" }) : null,
    ], { title: "Today", symbol: "sun.max", color: "orange" });
  }
  const a = record.artwork;
  return Widget.vstack([
    Widget.image({ file: record.file, cornerRadius: 14, frame: { maxWidth: "infinity" } }),
    Widget.text(a.title, { font: "title2", weight: "semibold", ...SERIF }),
    Widget.text(a.artist, { font: "subheadline", color: "secondary" }),
    Widget.text([a.date, a.medium].filter(Boolean).join(" · "), { font: "caption", color: "secondary" }),
    record.note ? Widget.text(record.note, { font: "footnote", padding: { top: 2 } }) : null,
    Widget.hstack([
      Widget.button(isFavourite(a.id) ? "♥ Favourite" : "♡ Favourite", "favourite", { id: a.id }, { style: isFavourite(a.id) ? "prominent" : "bordered", color: "pink" }),
      Widget.button("Surprise me", "surprise", null, { style: "bordered" }),
      Widget.button("Open", "open", { id: a.id }, { style: "bordered" }),
    ], { spacing: 8 }),
    Widget.hstack([
      Widget.text(stale ? "Showing the last downloaded work; the museum could not be reached." : `${theme.label} · ${CREDIT}`, { font: "caption2", color: stale ? "orange" : "secondary" }),
      Widget.spacer(),
      Storage.get(`override:${theme.id}`)?.day === dayKey() ? Widget.button("Back to the day's pick", "resetToday", null, { style: "plain" }) : null,
    ]),
  ], { alignment: "leading", spacing: 6, padding: 14, background: TILE_BG, cornerRadius: 18 });
}

function tile(a, selected) {
  return Widget.button(Widget.vstack([
    Widget.image({ src: imageUrl(a.image_id, 400), contentMode: "fill", cornerRadius: 10, frame: { maxWidth: "infinity", height: 150 } }),
    Widget.text(a.title, { font: "caption", weight: "semibold", lineLimit: 2, ...SERIF }),
    Widget.text(a.artist.split(/\n|,/)[0], { font: "caption2", color: "secondary", lineLimit: 1 }),
  ], {
    alignment: "leading", spacing: 3, padding: 6,
    background: selected ? { light: "#FDE68A66", dark: "#B4530955" } : TILE_BG, cornerRadius: 14,
    frame: { maxWidth: "infinity", alignment: "leading" },
  }), "select", { id: a.id });
}

function detail(a, themeId) {
  return Widget.vstack([
    Widget.text(a.title, { font: "headline", ...SERIF }),
    Widget.text(a.artist, { font: "caption", color: "secondary", lineLimit: 3 }),
    Widget.text([a.date, a.medium].filter(Boolean).join(" · "), { font: "caption2", color: "secondary" }),
    a.alt ? Widget.text(a.alt, { font: "caption2", color: "secondary", lineLimit: 4 }) : null,
    Widget.hstack([
      Widget.button("Use this one today", "useToday", { id: a.id }, { style: "prominent", color: "orange" }),
      Widget.button(isFavourite(a.id) ? "♥" : "♡", "favourite", { id: a.id }, { style: "bordered", color: "pink" }),
      Widget.button(Widget.symbol("safari", { size: 16, fallback: "↗" }), "open", { id: a.id }, { style: "bordered" }),
    ], { spacing: 8 }),
  ], { alignment: "leading", spacing: 6, padding: 14, background: { light: "#FFFFFF", dark: "#1C1C1E" }, cornerRadius: 14, frame: { maxWidth: "infinity", alignment: "leading" } });
}

function browsePane(items, themeId) {
  if (!items.length) return Widget.text("Nothing loaded for this theme yet. Check the connection and tap Refresh.", { color: "secondary" });
  const selectedId = Storage.get("selected");
  const selected = items.find((a) => a.id === selectedId);
  const shown = Storage.get("showAll", false) ? items : items.slice(0, PAGE);
  const rows = [];
  for (let i = 0; i < shown.length; i += 2) rows.push(shown.slice(i, i + 2));
  return Widget.vstack([
    selected ? detail(selected, themeId) : Widget.text("Tap a work to see details and make it today's.", { font: "footnote", color: "secondary" }),
    ...rows.map((pair) => Widget.hstack(pair.map((a) => tile(a, a.id === selectedId)), { spacing: 8, alignment: "top" })),
    shown.length < items.length ? Widget.button(`Show all ${items.length}`, "showAll", null, { style: "bordered" }) : null,
    Widget.text(`${items.length} public-domain works · ${CREDIT}`, { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 10 });
}

function favouritesPane() {
  const list = favourites();
  if (!list.length) return Widget.text("No favourites yet. Tap ♡ on any work.", { color: "secondary" });
  return Widget.vstack([
    Widget.list(list.slice(0, 30).map((f) => ({
      title: f.title, subtitle: `${f.artist.split(/\n|,/)[0]}${f.date ? ` · ${f.date}` : ""}`,
      symbol: "heart.fill", color: "pink", detail: THEMES.find((t) => t.id === f.themeId)?.label ?? "",
      action: "select", args: { id: f.id },
    })), { title: `${list.length} favourites` }),
    ...(list.find((f) => f.id === Storage.get("selected")) ? [
      Widget.hstack([
        Widget.button("Use today", "useToday", { id: Storage.get("selected") }, { style: "prominent", color: "orange" }),
        Widget.button("Open", "open", { id: Storage.get("selected") }, { style: "bordered" }),
        Widget.button("Remove", "unfavourite", { id: Storage.get("selected") }, { style: "bordered", color: "red" }),
      ], { spacing: 8 }),
    ] : []),
    Widget.text("\"Use today\" swaps today's widget for the chosen work, in the current theme.", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 10 });
}

function aboutPane() {
  const error = Storage.get("lastError");
  return Widget.vstack([
    Widget.text("Images and data come from the Art Institute of Chicago's open API and are public domain (CC0). Each day's work is chosen from the date and your theme, so every widget with the same theme agrees.", { font: "footnote" }),
    Widget.text("Add a widget, then edit it and type a theme in the Parameter field, for example \"photography\", to give that widget its own theme.", { font: "footnote", color: "secondary" }),
    Widget.button("Refresh this theme", "refresh", null, { style: "bordered" }),
    error ? Widget.text(`Last error: ${error.message}`, { font: "caption", color: "orange" }) : null,
    Widget.text(CREDIT, { font: "caption2", color: "secondary", url: "https://www.artic.edu" }),
  ], { alignment: "leading", spacing: 12 });
}

// ───────────────────────── Mini-app

Script.ui(async () => {
  const theme = themeFor(null);
  const { record, stale } = await todayOrLast(theme);
  let items = [];
  try { items = await loadTheme(theme); } catch { items = Storage.get(`results:${theme.id}`)?.items ?? []; }

  return {
    title: "Artwork of the Day",
    content: Widget.vstack([
      Widget.picker(THEMES.map((t) => ({ label: t.label, value: t.id })), theme.id, "theme", null, { style: "menu", label: "Theme" }),
      todayCard(record, theme, stale),
      Widget.tabs([
        { title: "Browse", symbol: "square.grid.2x2", content: browsePane(items, theme.id) },
        { title: "Favourites", symbol: "heart", content: favouritesPane() },
        { title: "About", symbol: "info.circle", content: aboutPane() },
      ], { selected: 0 }),
    ], { alignment: "leading", spacing: 16, padding: 16 }),
  };
});

// ───────────────────────── Run and background

Script.run(async (input) => {
  const theme = themeFor(input);
  const { record, stale, error } = await todayOrLast(theme);
  if (!record) return `Could not load ${theme.label}: ${error?.message ?? "no network"}`;
  const a = record.artwork;
  return `${a.title} — ${a.artist.split("\n")[0]}${a.date ? ` (${a.date})` : ""}. ${record.note || ""}${stale ? " (last downloaded)" : ""} ${pageUrl(a.id)}`.trim();
});

Script.background(async () => {
  try { await ensureToday(themeFor(null), { timeout: 8_000 }); } catch { /* kept in lastError by the next open */ }
});
