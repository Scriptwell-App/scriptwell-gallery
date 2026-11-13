// @name        Newsstand
// @description A front-page reader for the RSS and Atom feeds you choose, with unread tracking, a read-later list and newspaper-style widgets. Contacts only the feed hosts you add (The Guardian, BBC, The New York Times and The Atlantic by default)
// @permissions network
// @widget      small, medium, large, extraLarge
// @icon        newspaper.fill
// @color       #B91C1C
// @version     1.0.0
// @author      va4w
// @category    magazines-newspapers

// How it works
// • Fetches every feed you add (RSS or Atom) as plain text and parses it with regular expressions:
//   no accounts, no keys. Only the feed hosts are contacted, and nothing is sent to them beyond the
//   request for the feed. Article pictures in the large widgets come from the same publishers.
// • Ships with four feeds: The Guardian (world), BBC News, The New York Times and The Atlantic.
//   Remove or replace them under Feeds in the mini-app; any https RSS or Atom address works.
// • Unread tracking lives in Storage, keyed by a hash of the article link; the read-later list is a
//   JSON file in the script's folder. Tapping a headline marks it read and opens it in the browser.
// • Widgets draw a front page: masthead, lead headline and three more. Small and medium rotate the
//   lead story every ten minutes with a timeline. Large and extraLarge show several publications.
//   Set the widget Parameter to a publication name (for example "BBC") to put that paper first.
// • Open the mini-app once so the first fetch happens in the app; widgets then refresh every 30 minutes.

// ───────────────────────── Constants

const DEFAULT_FEEDS = [
  { id: "guardian", name: "The Guardian", url: "https://www.theguardian.com/world/rss" },
  { id: "bbc", name: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml" },
  { id: "nyt", name: "The New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml" },
  { id: "atlantic", name: "The Atlantic", url: "https://www.theatlantic.com/feed/all/" },
];
const INKS = ["#B91C1C", "#1D4ED8", "#0F766E", "#7C3AED", "#B45309", "#BE185D", "#0E7490", "#4D7C0F"];
const DAY = 86_400_000;
const FRESH_MS = 30 * 60 * 1000;
const ITEMS_PER_FEED = 25;
const SUMMARY_CHARS = 280;
const READ_KEEP_DAYS = 30;
const READ_LATER_FILE = "read-later.json";
const MAX_TABS = 6;
const FETCH_TIMEOUT = { widget: 5000, background: 8000, shortcut: 10000, app: 12000, pwa: 12000 };
const PAPER = { light: "#FBF7EF", dark: "#1C1A17" };
const RULE = { light: "#1C1917", dark: "#E7E5E4" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────── Feeds and caches

const feeds = () => Storage.get("feeds") ?? DEFAULT_FEEDS;
const cacheOf = (id) => Storage.get(`cache:${id}`);
const inkFor = (feed) => INKS[Math.max(0, feeds().findIndex((f) => f.id === feed.id)) % INKS.length];
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

// Feeds in display order; a Parameter or input naming a publication puts it first.
function ordered(preference) {
  const list = feeds();
  const wanted = String(preference ?? "").trim().toLowerCase();
  if (!wanted) return list;
  const hit = list.find((f) => f.name.toLowerCase().includes(wanted) || f.id.includes(wanted) || hostOf(f.url).includes(wanted));
  return hit ? [hit, ...list.filter((f) => f.id !== hit.id)] : list;
}

// ───────────────────────── Parsing RSS and Atom without a DOM

const ENTITIES = { quot: '"', apos: "'", lt: "<", gt: ">", amp: "&", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", mdash: "—", ndash: "–", copy: "©" };
const codePoint = (n) => (n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "");

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

// CDATA out, entities decoded twice (descriptions often hold escaped HTML), tags stripped, spaces collapsed.
function clean(raw) {
  let text = String(raw ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  text = decodeEntities(text).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

function tagText(block, names) {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(block);
    if (match) return match[1];
  }
  return "";
}

const attrOf = (tag, name) => new RegExp(`\\s${name}=["']([^"']+)["']`, "i").exec(tag)?.[1] ?? null;

// The largest media:content or thumbnail, else an image enclosure. https only, because widgets load it.
function imageOf(block) {
  let best = null, bestWidth = -1;
  for (const [tag] of block.matchAll(/<media:(?:content|thumbnail)\b[^>]*>/gi)) {
    const url = attrOf(tag, "url");
    const medium = attrOf(tag, "medium");
    if (!url || (medium && medium !== "image")) continue;
    const width = Number(attrOf(tag, "width") ?? 0);
    if (width > bestWidth) { best = url; bestWidth = width; }
  }
  if (!best) {
    for (const [tag] of block.matchAll(/<enclosure\b[^>]*>/gi)) {
      const type = attrOf(tag, "type") ?? "";
      const url = attrOf(tag, "url");
      if (url && (type.startsWith("image/") || /\.(jpe?g|png|webp)(\?|$)/i.test(url))) { best = url; break; }
    }
  }
  best = best ? decodeEntities(best) : null;
  return best && best.startsWith("https://") ? best : null;
}

function linkOf(block, atom) {
  if (atom) {
    const tag = [...block.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const alternate = tag.find((t) => /rel=["']alternate["']/i.test(t)) ?? tag.find((t) => !/rel=/i.test(t)) ?? tag[0];
    return alternate ? attrOf(alternate, "href") ?? "" : "";
  }
  const plain = clean(tagText(block, ["link"]));
  if (plain.startsWith("http")) return plain;
  const guid = clean(tagText(block, ["guid"]));
  return guid.startsWith("http") ? guid : plain;
}

function parseFeed(xml) {
  const atom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const firstItem = xml.search(atom ? /<entry[\s>]/i : /<item[\s>]/i);
  const head = firstItem > 0 ? xml.slice(0, firstItem) : xml;
  const title = clean(tagText(head, ["title"]));
  const items = [];
  for (const [block] of xml.matchAll(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)) {
    const itemTitle = clean(tagText(block, ["title"]));
    if (!itemTitle) continue;
    const link = decodeEntities(linkOf(block, atom)).trim();
    const date = Date.parse(clean(tagText(block, ["pubDate", "published", "updated", "dc:date"]))) || 0;
    const summary = clean(tagText(block, ["description", "summary", "content:encoded", "content"])).slice(0, SUMMARY_CHARS);
    items.push({ title: itemTitle, link, date, summary: summary === itemTitle ? "" : summary, image: imageOf(block) });
  }
  return { title, items };
}

// ───────────────────────── Fetching

async function loadFeed(feed) {
  const timeout = FETCH_TIMEOUT[Script.env.mode] ?? 10000;
  const response = await fetch(feed.url, { timeout, headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8" } });
  if (!response.ok) throw new Error(`${response.status} from ${hostOf(feed.url)}`);
  const parsed = parseFeed(await response.text());
  if (parsed.items.length === 0) throw new Error(`no articles found at ${hostOf(feed.url)}`);
  const seen = new Set();
  const items = parsed.items
    .filter((item) => { const key = item.link || item.title; if (seen.has(key)) return false; seen.add(key); return true; })
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => b.date - a.date || a.index - b.index)
    .slice(0, ITEMS_PER_FEED);
  for (const item of items) delete item.index;
  Storage.set(`cache:${feed.id}`, { items, time: Date.now(), title: parsed.title });
  return parsed;
}

// Refreshes feeds whose cache is older than 30 minutes; failures keep the old cache and are noted.
async function refreshAll({ force = false } = {}) {
  const stale = feeds().filter((f) => force || !cacheOf(f.id) || Date.now() - cacheOf(f.id).time > FRESH_MS);
  if (stale.length === 0) return;
  const results = await Promise.allSettled(stale.map(loadFeed));
  const errors = results
    .map((r, i) => (r.status === "rejected" ? `${stale[i].name}: ${r.reason?.message ?? r.reason}` : null))
    .filter(Boolean);
  Storage.set("lastError", errors.length ? { message: errors.join(" · "), time: Date.now() } : null);
}

const lastUpdated = () => Math.max(0, ...feeds().map((f) => cacheOf(f.id)?.time ?? 0));

// ───────────────────────── Unread tracking and read later

function hashOf(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const keyOf = (item) => hashOf(item.link || item.title);
const readMap = () => Storage.get("read", {});
const isRead = (item) => keyOf(item) in readMap();
const unreadCount = (items) => items.filter((item) => !isRead(item)).length;

function markRead(items) {
  const map = readMap();
  const now = Date.now();
  const cutoff = now - READ_KEEP_DAYS * DAY;
  for (const item of items) map[keyOf(item)] = now;
  for (const key of Object.keys(map)) if (map[key] < cutoff) delete map[key];
  Storage.set("read", map);
}

async function readLater() {
  try {
    return (await Files.exists(READ_LATER_FILE)) ? await Files.readJSON(READ_LATER_FILE) : [];
  } catch {
    return [];
  }
}

const saveReadLater = (list) => Files.writeJSON(READ_LATER_FILE, list.slice(0, 200));

// ───────────────────────── Widget pieces

const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
const rotate = (items, k) => (k === 0 ? items : [items[k], ...items.filter((_, i) => i !== k)]);
const serif = (text, props = {}) => Widget.text(text, { design: "serif", ...props });

const rule = (color, height = 1) => ({ type: "stack", direction: "horizontal", children: [], background: color, frame: { height, maxWidth: "infinity" } });

const dot = (color, size = 6) => ({ type: "stack", direction: "horizontal", children: [], background: color, cornerRadius: size / 2, frame: { width: size, height: size } });

function masthead(feed, items, { font = 13, date = true } = {}) {
  const unread = unreadCount(items);
  return Widget.vstack([
    Widget.hstack([
      serif(feed.name.toUpperCase(), { font, weight: "black", color: inkFor(feed), lineLimit: 1, minimumScale: 0.6 }),
      Widget.spacer(),
      date ? Widget.text(new Date().toLocaleDateString(Script.env.locale, { weekday: "short", day: "numeric", month: "short" }), { font: "caption2", color: "secondary", lineLimit: 1 }) : null,
      unread ? Widget.text(String(unread), { font: "caption2", weight: "bold", color: "white", padding: { horizontal: 5, vertical: 1 }, background: inkFor(feed), cornerRadius: 7 }) : null,
    ], { spacing: 6, alignment: "bottom" }),
    rule(RULE, 2),
  ], { alignment: "leading", spacing: 3 });
}

function leadStory(item, feed, { font = 17, lines = 4, summary = false } = {}) {
  return Widget.vstack([
    serif(item.title, { font, weight: "bold", lineLimit: lines, minimumScale: 0.8, color: isRead(item) ? "secondary" : "primary" }),
    summary && item.summary ? Widget.text(item.summary, { font: "caption", color: "secondary", lineLimit: 2 }) : null,
    item.date ? Widget.date(item.date, { style: "relative", font: "caption2", color: inkFor(feed) }) : null,
  ], { alignment: "leading", spacing: 3, url: item.link || undefined, frame: { maxWidth: "infinity", alignment: "leading" } });
}

function headline(item, feed, lines = 2) {
  const read = isRead(item);
  return Widget.hstack([
    Widget.vstack([read ? dot("#9CA3AF55") : dot(inkFor(feed))], { padding: { top: 5 } }),
    Widget.text(item.title, { font: "caption", weight: read ? "regular" : "medium", color: read ? "secondary" : "primary", lineLimit: lines }),
  ], { spacing: 6, alignment: "top", url: item.link || undefined });
}

// One publication as a column: masthead, lead and up to `more` headlines.
function column(paper, k, { leadFont, leadLines, more, summary = false, picture = false }) {
  const items = rotate(paper.items, k);
  const [lead, ...rest] = items;
  const showImage = picture && lead.image && Storage.get("showImages", true);
  return Widget.vstack([
    masthead(paper.feed, paper.items, { date: false }),
    showImage
      ? Widget.hstack([
          leadStory(lead, paper.feed, { font: leadFont, lines: leadLines, summary }),
          Widget.image({ src: lead.image, size: 96, cornerRadius: 6, contentMode: "fill" }),
        ], { spacing: 10, alignment: "top" })
      : leadStory(lead, paper.feed, { font: leadFont, lines: leadLines, summary }),
    rule("#9CA3AF40"),
    ...rest.slice(0, more).map((item) => headline(item, paper.feed)),
  ], { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
}

function smallPage(paper, k) {
  const items = rotate(paper.items, k);
  return Widget.vstack([
    masthead(paper.feed, paper.items, { font: 11, date: false }),
    leadStory(items[0], paper.feed, { font: 15, lines: 5 }),
    Widget.spacer(),
    headline(items[1], paper.feed, 2),
  ], { alignment: "leading", spacing: 6, padding: 12, background: PAPER, url: APP_LINK, frame: fill });
}

function mediumPage(paper, k) {
  const items = rotate(paper.items, k);
  return Widget.vstack([
    masthead(paper.feed, paper.items),
    Widget.hstack([
      leadStory(items[0], paper.feed, { font: 16, lines: 4 }),
      Widget.vstack(items.slice(1, 4).map((item) => headline(item, paper.feed)), { alignment: "leading", spacing: 5, frame: { width: 124, maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 10, alignment: "top" }),
  ], { alignment: "leading", spacing: 6, padding: 12, background: PAPER, url: APP_LINK, frame: fill });
}

function largePage(papers) {
  const [first, second] = papers;
  return Widget.vstack([
    column(first, 0, { leadFont: 19, leadLines: 3, more: 3, summary: true, picture: true }),
    second ? Widget.spacer(6) : null,
    second ? column(second, 0, { leadFont: 15, leadLines: 2, more: 2 }) : null,
    Widget.spacer(),
    footer(),
  ], { alignment: "leading", spacing: 8, padding: 14, background: PAPER, url: APP_LINK, frame: fill });
}

function extraLargePage(papers) {
  const shown = papers.slice(0, 4);
  const left = shown.filter((_, i) => i % 2 === 0);
  const right = shown.filter((_, i) => i % 2 === 1);
  const stack = (list) => Widget.vstack(list.map((paper, i) => column(paper, 0, { leadFont: i === 0 ? 18 : 15, leadLines: 3, more: 3, summary: i === 0, picture: i === 0 })), { alignment: "leading", spacing: 12, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
  return Widget.vstack([
    Widget.hstack([
      serif("NEWSSTAND", { font: 14, weight: "black", lineLimit: 1 }),
      Widget.spacer(),
      Widget.text(new Date().toLocaleDateString(Script.env.locale, { weekday: "long", day: "numeric", month: "long" }), { font: "caption", color: "secondary" }),
    ], { alignment: "bottom" }),
    rule(RULE, 3),
    Widget.hstack([stack(left), right.length ? stack(right) : null], { spacing: 18, alignment: "top" }),
    Widget.spacer(),
    footer(),
  ], { alignment: "leading", spacing: 8, padding: 16, background: PAPER, url: APP_LINK, frame: fill });
}

function footer() {
  const error = Storage.get("lastError");
  const time = lastUpdated();
  return Widget.hstack([
    error ? Widget.symbol("exclamationmark.triangle.fill", { size: 9, color: "orange", fallback: "⚠️" }) : null,
    Widget.text(error ? "Some feeds did not load · showing cached" : "Updated", { font: "caption2", color: "secondary", lineLimit: 1 }),
    time ? Widget.date(time, { style: "relative", font: "caption2", color: "secondary" }) : null,
  ], { spacing: 4 });
}

function placeholder() {
  const error = Storage.get("lastError");
  return Widget.vstack([
    Widget.symbol("newspaper.fill", { size: 26, color: "red", fallback: "📰" }),
    serif("Newsstand", { font: "headline", weight: "bold" }),
    Widget.text(error ? error.message : "Open the mini-app once to load your papers.", { font: "caption2", color: "secondary", align: "center", lineLimit: 4 }),
  ], { spacing: 6, padding: 12, background: PAPER, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
}

// ───────────────────────── Widget

Script.widget(async ({ family, parameter }) => {
  try { await refreshAll(); } catch (error) { Storage.set("lastError", { message: error.message, time: Date.now() }); }

  const papers = ordered(parameter)
    .map((feed) => ({ feed, items: cacheOf(feed.id)?.items ?? [] }))
    .filter((paper) => paper.items.length > 0);
  if (papers.length === 0) return { content: placeholder(), refreshAfter: 15 * 60 };

  if (family === "small" || family === "medium") {
    // A timeline: the lead story changes every ten minutes without the script running again.
    const paper = papers[0];
    const steps = Math.min(6, paper.items.length);
    const timeline = Array.from({ length: steps }, (_, k) => ({
      date: new Date(Date.now() + k * 10 * 60 * 1000),
      content: family === "small" ? smallPage(paper, k) : mediumPage(paper, k),
    }));
    return { timeline, refreshAfter: 60 * 60 };
  }

  const content = family === "extraLarge" ? extraLargePage(papers) : largePage(papers);
  return { content, refreshAfter: 30 * 60 };
});

// ───────────────────────── Run and background

Script.run(async (input) => {
  await refreshAll();
  const lines = [];
  for (const feed of ordered(input)) {
    const items = cacheOf(feed.id)?.items ?? [];
    if (items.length === 0) continue;
    lines.push(`${feed.name} (${unreadCount(items)} unread)`);
    for (const item of items.slice(0, 3)) lines.push(`  • ${item.title}`);
  }
  const error = Storage.get("lastError");
  if (error) lines.push(`Could not load: ${error.message}`);
  return lines.join("\n") || "No feeds loaded yet.";
});

Script.background(async () => {
  await refreshAll();
});

// ───────────────────────── Mini-app actions

let refreshedOnce = false;

Script.action("page", ({ value }) => Storage.set("page", value));
Script.action("tab", ({ value }) => Storage.set("tab", value));
Script.action("extra", ({ value }) => Storage.set("extraFeed", value));
Script.action("images", ({ isOn }) => Storage.set("showImages", isOn));
Script.action("draft", ({ field, value }) => Storage.set("draft", { ...Storage.get("draft", {}), [field]: value }));

Script.action("refresh", async () => {
  await refreshAll({ force: true });
  await UI.haptic(Storage.get("lastError") ? "warning" : "light");
});

Script.action("open", async ({ link, title }) => {
  markRead([{ link, title }]);
  if (link) await UI.openURL(link);
});

Script.action("markAll", ({ feedId }) => markRead(cacheOf(feedId)?.items ?? []));

Script.action("save", async ({ item }) => {
  const list = await readLater();
  if (!list.some((saved) => saved.link === item.link)) await saveReadLater([{ ...item, saved: Date.now() }, ...list]);
  await UI.haptic("success");
});

Script.action("unsave", async ({ link }) => {
  await saveReadLater((await readLater()).filter((saved) => saved.link !== link));
});

Script.action("addFeed", async () => {
  const draft = Storage.get("draft", {});
  const url = String(draft.url ?? "").trim();
  if (!/^https:\/\/\S+$/i.test(url)) {
    await UI.alert({ title: "Feed address", message: "Paste the full https:// address of an RSS or Atom feed." });
    return;
  }
  if (feeds().some((f) => f.url === url)) {
    await UI.alert("That feed is already in your newsstand.");
    return;
  }
  const feed = { id: `${hostOf(url).split(".")[0]}-${hashOf(url)}`, name: String(draft.name ?? "").trim(), url };
  try {
    const parsed = await loadFeed(feed);
    feed.name = feed.name || parsed.title || hostOf(url);
    Storage.set("feeds", [...feeds(), feed]);
    Storage.remove("draft");
    await UI.haptic("success");
  } catch (error) {
    Storage.remove(`cache:${feed.id}`);
    await UI.alert({ title: "Could not add that feed", message: error.message });
  }
});

Script.action("removeFeed", async ({ id }) => {
  const feed = feeds().find((f) => f.id === id);
  const choice = await UI.alert({ title: `Remove ${feed?.name ?? "this feed"}?`, message: "Saved articles from it stay in Read later.", buttons: ["Cancel", "Remove"] });
  if (choice !== 1) return;
  Storage.set("feeds", feeds().filter((f) => f.id !== id));
  Storage.remove(`cache:${id}`);
  Storage.set("tab", 0);
});

Script.action("restoreDefaults", async () => {
  const choice = await UI.alert({ title: "Restore the default feeds?", message: "Your own feeds are removed from the list.", buttons: ["Cancel", "Restore"] });
  if (choice === 1) { Storage.remove("feeds"); Storage.set("tab", 0); }
});

// ───────────────────────── Mini-app pieces

function articleRow(item, feed, saved) {
  const read = isRead(item);
  const ink = inkFor(feed);
  const meta = [item.date ? Widget.date(item.date, { style: "relative", font: "caption2", color: ink }) : null];
  return Widget.hstack([
    Widget.button(Widget.vstack([
      serif(item.title, { font: 16, weight: read ? "regular" : "semibold", color: read ? "secondary" : "primary", lineLimit: 3, align: "leading" }),
      item.summary ? Widget.text(item.summary, { font: "caption", color: "secondary", lineLimit: 2, align: "leading" }) : null,
      Widget.hstack([...meta, saved && item.feedName ? Widget.text(item.feedName, { font: "caption2", color: "secondary" }) : null], { spacing: 6 }),
    ], { alignment: "leading", spacing: 3, frame: { maxWidth: "infinity", alignment: "leading" } }), "open", { link: item.link, title: item.title }, { style: "plain" }),
    Widget.button(
      Widget.symbol(saved ? "bookmark.fill" : "bookmark", { size: 18, color: saved ? ink : "secondary", fallback: "🔖" }),
      saved ? "unsave" : "save",
      saved ? { link: item.link } : { item: { ...item, feedId: feed.id, feedName: feed.name } },
      { style: "plain" },
    ),
  ], { spacing: 10, alignment: "top", padding: { vertical: 4 } });
}

function feedPane(feed, savedLinks) {
  const cache = cacheOf(feed.id);
  const items = cache?.items ?? [];
  if (items.length === 0) {
    const error = Storage.get("lastError");
    return Widget.vstack([
      Widget.symbol("wifi.exclamationmark", { size: 30, color: "secondary", fallback: "📡" }),
      Widget.text(error ? error.message : "Nothing loaded yet. Pull the latest with Refresh.", { font: "footnote", color: "secondary", align: "center" }),
    ], { spacing: 10, padding: 24, frame: { maxWidth: "infinity" } });
  }
  const unread = unreadCount(items);
  return Widget.vstack([
    Widget.hstack([
      Widget.text(unread ? `${unread} unread` : "All read", { font: "caption", weight: "semibold", color: unread ? inkFor(feed) : "secondary" }),
      Widget.text("·", { font: "caption", color: "secondary" }),
      Widget.date(cache.time, { style: "relative", font: "caption", color: "secondary" }),
      Widget.spacer(),
      unread ? Widget.button("Mark all read", "markAll", { feedId: feed.id }, { style: "plain" }) : null,
    ], { spacing: 4 }),
    ...items.slice(0, 15).flatMap((item, i) => [i ? Widget.divider() : null, articleRow(item, feed, savedLinks.has(item.link))]),
  ], { alignment: "leading", spacing: 6 });
}

// Only the visible pane is drawn in full; the others get a stub until the tab action redraws the screen.
const stubPane = () => Widget.text("Loading…", { font: "footnote", color: "secondary", padding: 24 });

function papersPage(savedLinks) {
  const list = feeds();
  if (list.length === 0) return Widget.text("No feeds. Add one under Feeds.", { color: "secondary", align: "center", padding: 24 });
  const tabsFeeds = list.length > MAX_TABS ? list.slice(0, MAX_TABS - 1) : list;
  const overflow = list.slice(tabsFeeds.length);
  const tabCount = tabsFeeds.length + (overflow.length ? 1 : 0);
  const selected = Math.min(Storage.get("tab", 0), tabCount - 1);
  const tabs = tabsFeeds.map((feed, index) => ({
    title: feed.name.replace(/^The /, "").split(" ")[0], symbol: "newspaper",
    content: index === selected ? feedPane(feed, savedLinks) : stubPane(),
  }));
  if (overflow.length) {
    const chosen = overflow.find((f) => f.id === Storage.get("extraFeed")) ?? overflow[0];
    tabs.push({
      title: "More", symbol: "ellipsis.circle",
      content: selected === tabs.length ? Widget.vstack([
        Widget.picker(overflow.map((f) => ({ label: f.name, value: f.id })), chosen.id, "extra", null, { label: "Publication" }),
        feedPane(chosen, savedLinks),
      ], { alignment: "leading", spacing: 12 }) : stubPane(),
    });
  }
  return Widget.tabs(tabs, { selected, action: "tab" });
}

function laterPage(saved) {
  if (saved.length === 0) {
    return Widget.vstack([
      Widget.symbol("bookmark", { size: 34, color: "secondary", fallback: "🔖" }),
      Widget.text("Nothing saved yet. Tap the bookmark next to any headline.", { font: "footnote", color: "secondary", align: "center" }),
    ], { spacing: 10, padding: 24, frame: { maxWidth: "infinity" } });
  }
  return Widget.vstack(
    saved.flatMap((item, i) => [i ? Widget.divider() : null, articleRow(item, feeds().find((f) => f.id === item.feedId) ?? { id: item.feedId, name: item.feedName ?? "" }, true)]),
    { alignment: "leading", spacing: 6 },
  );
}

function feedsPage() {
  const draft = Storage.get("draft", {});
  return Widget.vstack([
    Widget.card(feeds().map((feed) => Widget.hstack([
      dot(inkFor(feed), 10),
      Widget.vstack([
        Widget.text(feed.name, { font: "subheadline", weight: "semibold", lineLimit: 1 }),
        Widget.text(`${hostOf(feed.url)} · ${cacheOf(feed.id)?.items.length ?? 0} articles`, { font: "caption2", color: "secondary", lineLimit: 1 }),
      ], { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", alignment: "leading" } }),
      Widget.button(Widget.symbol("minus.circle.fill", { size: 20, color: "red", fallback: "−" }), "removeFeed", { id: feed.id }, { style: "plain" }),
    ], { spacing: 10 })), { title: "Your publications", symbol: "newspaper.fill", color: "red" }),
    Widget.card([
      Widget.textField("https://example.com/feed.xml", draft.url ?? "", "draft", { field: "url" }, { label: "Feed address", keyboard: "url" }),
      Widget.textField("Taken from the feed if empty", draft.name ?? "", "draft", { field: "name" }, { label: "Name" }),
      Widget.button("Add feed", "addFeed", null, { style: "prominent", color: "red" }),
    ], { title: "Add a feed", subtitle: "RSS or Atom, https only", symbol: "plus.circle.fill", color: "red" }),
    Widget.card([
      Widget.toggle("Pictures in large widgets", Storage.get("showImages", true), "images", null, { color: "red" }),
      Widget.button("Restore default feeds", "restoreDefaults", null, { style: "bordered" }),
      Widget.text("Feeds are fetched straight from the publishers. Nothing is sent anywhere else.", { font: "caption2", color: "secondary" }),
    ], { title: "Options", symbol: "gearshape.fill", color: "gray" }),
  ], { alignment: "leading", spacing: 14 });
}

// ───────────────────────── Mini-app

Script.ui(async () => {
  if (!refreshedOnce) {
    refreshedOnce = true;
    await refreshAll();
  }
  const saved = await readLater();
  const savedLinks = new Set(saved.map((item) => item.link));
  const page = Storage.get("page", "papers");
  const totalUnread = feeds().reduce((sum, f) => sum + unreadCount(cacheOf(f.id)?.items ?? []), 0);
  const error = Storage.get("lastError");

  const body = page === "later" ? laterPage(saved) : page === "feeds" ? feedsPage() : papersPage(savedLinks);

  return {
    title: totalUnread ? `Newsstand · ${totalUnread} unread` : "Newsstand",
    content: Widget.vstack([
      Widget.hstack([
        Widget.picker([
          { label: "Papers", value: "papers" },
          { label: `Read later${saved.length ? ` (${saved.length})` : ""}`, value: "later" },
          { label: "Feeds", value: "feeds" },
        ], page, "page", null, { style: "segmented" }),
        Widget.button(Widget.symbol("arrow.clockwise", { size: 17, fallback: "↻" }), "refresh", null, { style: "bordered" }),
      ], { spacing: 10 }),
      error ? Widget.hstack([
        Widget.symbol("exclamationmark.triangle.fill", { size: 12, color: "orange", fallback: "⚠️" }),
        Widget.text(error.message, { font: "caption", color: "orange", lineLimit: 3 }),
      ], { spacing: 6, alignment: "top" }) : null,
      body,
      Widget.hstack([
        Widget.spacer(),
        Widget.text("Updated", { font: "caption2", color: "secondary" }),
        lastUpdated() ? Widget.date(lastUpdated(), { style: "relative", font: "caption2", color: "secondary" }) : Widget.text("never", { font: "caption2", color: "secondary" }),
        Widget.spacer(),
      ], { spacing: 4 }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});
