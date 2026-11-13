// @name        Podcast Queue
// @description Follow podcasts, see new episodes with artwork, build a listening queue with its total time, and let background runs fetch new episodes. Contacts itunes.apple.com and each show's own RSS feed.
// @permissions network
// @widget      small, medium, large
// @icon        headphones
// @color       #DB2777
// @version     1.0.0
// @author      va4w
// @category    entertainment

// How it works
// • Search sends the text you type to itunes.apple.com, which returns each show's RSS feed address
//   and artwork. Following a show stores that address; nothing else is sent to Apple.
// • Each followed show's feed is downloaded directly from its own host and parsed for the latest
//   20 episodes, which are kept as JSON in the script's Files folder. Background runs refresh the
//   feeds a few times a day and mark anything new.
// • Tap an episode to play its audio in Safari, open the show in Podcasts, queue it or mark it played.
//   The queue keeps its order and shows how long everything left adds up to.
// • The widget shows the newest unplayed episodes with artwork; set its Parameter to "queue" to show
//   the queue instead. Open the mini-app once before adding the widget.

// ───────────────────────────────────────────── Constants

const SEARCH_URL = "https://itunes.apple.com/search";
const EPISODES_PER_SHOW = 20;
const MAX_SHOWS = 25;
const MAX_QUEUE = 40;
const NEW_FOR = 48 * 60 * 60 * 1000;
const FEED_FRESH = 60 * 60 * 1000;
const TABS = ["Latest", "Queue", "Shows", "Search"];
const TAB_SYMBOLS = ["sparkles", "list.number", "square.stack", "magnifyingglass"];

const ROSE = "#DB2777";
const ROSE_SOFT = "#F9A8D4";
const WIDGET_BG = Widget.gradient([{ light: "#FFF1F2", dark: "#1F0A14" }, { light: "#FCE7F3", dark: "#2A0F1C" }], { direction: "topToBottom" });
const ROW_BG = { light: "#FFFFFFB3", dark: "#FFFFFF12" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────────────────────────── Storage helpers

const shows = () => Storage.get("shows", []);
const played = () => Storage.get("played", {});
const queue = () => Storage.get("queue", []);
const episodeFile = (showId) => `episodes/${showId}.json`;
const epKey = (showId, ep) => `${showId}:${ep.guid || ep.url}`;
const isPlayed = (key) => key in played();
const inQueue = (key) => queue().includes(key);
const isNew = (ep) => ep.firstSeen && Date.now() - ep.firstSeen < NEW_FOR;

async function readEpisodes(showId) {
  const path = episodeFile(showId);
  if (!(await Files.exists(path))) return [];
  try { return await Files.readJSON(path); } catch { return []; }
}

function formatDuration(seconds, long = false) {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (long) return h ? `${h} h ${m} min` : `${m} min`;
  return h ? `${h}h ${m}m` : `${m}m`;
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(Script.env.locale, { day: "numeric", month: "short" }) : "");

// ───────────────────────────────────────────── RSS parsing (no DOM, so regular expressions)

function decode(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tagText(block, name) {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(block);
  return match ? decode(match[1]) : "";
}

function parseDuration(text) {
  if (!text) return null;
  const parts = text.trim().split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 1) return Math.round(parts[0]);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function parseFeed(xml) {
  const items = [];
  const itemPattern = /<item\b[\s\S]*?<\/item>/gi;
  let match;
  while ((match = itemPattern.exec(xml)) && items.length < EPISODES_PER_SHOW * 2) {
    const block = match[0];
    const enclosure = /<enclosure\b[^>]*\burl=["']([^"']+)["']/i.exec(block);
    if (!enclosure) continue;
    const date = new Date(tagText(block, "pubDate"));
    items.push({
      guid: tagText(block, "guid") || null,
      title: tagText(block, "title") || "Untitled episode",
      pubDate: Number.isNaN(date.getTime()) ? null : date.toISOString(),
      duration: parseDuration(tagText(block, "itunes:duration")),
      url: decode(enclosure[1]),
    });
  }
  return items
    .sort((a, b) => new Date(b.pubDate ?? 0) - new Date(a.pubDate ?? 0))
    .slice(0, EPISODES_PER_SHOW);
}

// ───────────────────────────────────────────── Feeds

async function refreshShow(show, timeout) {
  const response = await fetch(show.feedUrl, { timeout });
  if (!response.ok) throw new Error(`Feed answered ${response.status}`);
  const episodes = parseFeed(await response.text());
  if (episodes.length === 0) throw new Error("No episodes with audio in the feed");

  const previous = await readEpisodes(show.id);
  const known = new Map(previous.map((ep) => [ep.guid || ep.url, ep]));
  const firstRun = previous.length === 0;
  const merged = episodes.map((ep) => {
    const old = known.get(ep.guid || ep.url);
    return { ...ep, firstSeen: old?.firstSeen ?? (firstRun ? 0 : Date.now()) };
  });
  await Files.writeJSON(episodeFile(show.id), merged);
  return { ...show, checked: Date.now(), lastError: null, newCount: merged.filter(isNew).length };
}

async function refreshAll(force = false) {
  const list = shows();
  const stale = list.filter((s) => force || !s.checked || Date.now() - s.checked > FEED_FRESH);
  if (stale.length === 0) return list;
  const timeout = Script.env.mode === "background" ? 6000 : 10000;
  const updated = await Promise.all(stale.map((s) => refreshShow(s, timeout).catch((error) => ({ ...s, checked: Date.now(), lastError: error.message }))));
  const merged = list.map((s) => updated.find((u) => u.id === s.id) ?? s);
  Storage.set("shows", merged);
  Storage.set("lastRefresh", Date.now());
  await rebuildSummary(merged);
  return merged;
}

// Everything the widget needs, flattened into Storage so it never has to read the feeds.
async function rebuildSummary(list = shows()) {
  const all = [];
  for (const show of list) {
    for (const ep of await readEpisodes(show.id)) {
      all.push({
        key: epKey(show.id, ep), title: ep.title, show: show.name, art: show.artwork100,
        duration: ep.duration, pubDate: ep.pubDate, url: ep.url, showUrl: show.trackViewUrl, isNew: isNew(ep),
      });
    }
  }
  all.sort((a, b) => new Date(b.pubDate ?? 0) - new Date(a.pubDate ?? 0));

  // Forget played marks and queue entries for episodes that fell out of every feed.
  const keys = new Set(all.map((ep) => ep.key));
  Storage.set("played", Object.fromEntries(Object.entries(played()).filter(([key]) => keys.has(key))));
  const q = queue().filter((key) => keys.has(key));
  Storage.set("queue", q);

  const byKey = new Map(all.map((ep) => [ep.key, ep]));
  const queued = q.map((key) => byKey.get(key));
  const unplayed = all.filter((ep) => !isPlayed(ep.key));
  Storage.set("summary", {
    unplayed: unplayed.slice(0, 12),
    unplayedCount: unplayed.length,
    queue: queued.slice(0, 12),
    queueCount: queued.length,
    queueSeconds: queued.reduce((sum, ep) => sum + (ep.duration ?? 0), 0),
    time: Date.now(),
  });
  return all;
}

// ───────────────────────────────────────────── Search and follow

async function searchPodcasts(term) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("media", "podcast");
  url.searchParams.set("term", term);
  url.searchParams.set("limit", "10");
  const response = await fetch(url, { timeout: 8000 });
  if (!response.ok) throw new Error(`Search answered ${response.status}`);
  const { results = [] } = await response.json();
  return results.filter((r) => r.feedUrl && r.collectionId).map((r) => ({
    id: r.collectionId,
    name: r.collectionName ?? "Untitled",
    artist: r.artistName ?? "",
    feedUrl: r.feedUrl,
    artwork100: r.artworkUrl100 ?? null,
    artwork600: r.artworkUrl600 ?? r.artworkUrl100 ?? null,
    trackViewUrl: r.trackViewUrl ?? null,
    genre: r.primaryGenreName ?? "",
    episodes: r.trackCount ?? null,
  }));
}

async function followShow(show) {
  if (shows().some((s) => s.id === show.id)) return;
  if (shows().length >= MAX_SHOWS) throw new Error(`You can follow up to ${MAX_SHOWS} shows`);
  if (!/^https:\/\//i.test(show.feedUrl)) throw new Error("This feed is not served over https, so it cannot be fetched");
  let entry = { ...show, added: Date.now(), checked: null, lastError: null, newCount: 0 };
  try { entry = await refreshShow(entry, 10000); } catch (error) { entry.lastError = error.message; }
  Storage.set("shows", [...shows(), entry]);
  await rebuildSummary();
}

async function unfollowShow(id) {
  Storage.set("shows", shows().filter((s) => s.id !== id));
  try { await Files.remove(episodeFile(id)); } catch { /* nothing to remove */ }
  await rebuildSummary();
}

// ───────────────────────────────────────────── Actions

Script.action("tab", ({ value }) => Storage.set("tab", value));

Script.action("search", async ({ value }) => {
  const term = String(value ?? "").trim();
  if (!term) { Storage.remove("search"); return; }
  try {
    Storage.set("search", { term, results: await searchPodcasts(term) });
  } catch (error) {
    Storage.set("search", { term, results: [], error: error.message });
  }
});

Script.action("follow", async ({ show }) => {
  try {
    await followShow(show);
    await UI.haptic("success");
  } catch (error) {
    await UI.alert({ title: "Could not follow", message: error.message });
  }
});

Script.action("unfollow", async ({ id }) => {
  const show = shows().find((s) => s.id === id);
  const choice = await UI.alert({ title: `Unfollow ${show?.name ?? "this show"}?`, message: "Its episodes leave the queue and the list.", buttons: ["Cancel", "Unfollow"] });
  if (choice === 1) await unfollowShow(id);
});

Script.action("refresh", async () => { await refreshAll(true); });
Script.action("refreshShow", async ({ id }) => {
  const show = shows().find((s) => s.id === id);
  if (!show) return;
  const result = await refreshShow(show, 10000).catch((error) => ({ ...show, checked: Date.now(), lastError: error.message }));
  Storage.set("shows", shows().map((s) => (s.id === id ? result : s)));
  await rebuildSummary();
});

Script.action("open", async ({ url }) => { if (url) await UI.openURL(url); });

Script.action("episode", async ({ key }) => {
  const ep = (await rebuildSummary()).find((e) => e.key === key);
  if (!ep) return;
  const queued = inQueue(key);
  const done = isPlayed(key);
  const buttons = ["Cancel", "Play audio", queued ? "Remove from queue" : "Add to queue", done ? "Mark unplayed" : "Mark played", "Open in Podcasts"];
  const choice = await UI.alert({ title: ep.title, message: `${ep.show} · ${fmtDate(ep.pubDate)}${ep.duration ? ` · ${formatDuration(ep.duration, true)}` : ""}`, buttons });
  if (choice === 1) await UI.openURL(ep.url);
  if (choice === 2) Storage.set("queue", queued ? queue().filter((k) => k !== key) : [...queue(), key].slice(0, MAX_QUEUE));
  if (choice === 3) {
    const marks = { ...played() };
    if (done) delete marks[key]; else marks[key] = Date.now();
    Storage.set("played", marks);
  }
  if (choice === 4) await UI.openURL(ep.showUrl ?? ep.url);
  await rebuildSummary();
});

Script.action("queueMove", async ({ key, by }) => {
  const q = queue();
  const i = q.indexOf(key);
  const j = i + by;
  if (i < 0 || j < 0 || j >= q.length) return;
  [q[i], q[j]] = [q[j], q[i]];
  Storage.set("queue", q);
  await rebuildSummary();
});

Script.action("queueDone", async ({ key }) => {
  Storage.set("played", { ...played(), [key]: Date.now() });
  Storage.set("queue", queue().filter((k) => k !== key));
  await rebuildSummary();
});

Script.action("queueTop", async ({ key }) => {
  Storage.set("queue", [key, ...queue().filter((k) => k !== key)]);
  await rebuildSummary();
});

Script.action("hidePlayed", ({ isOn }) => Storage.set("hidePlayed", isOn));

Script.action("clearPlayed", async () => {
  const choice = await UI.alert({ title: "Mark everything as played?", buttons: ["Cancel", "Mark all"] });
  if (choice !== 1) return;
  const marks = { ...played() };
  for (const ep of await rebuildSummary()) marks[ep.key] = Date.now();
  Storage.set("played", marks);
  Storage.set("queue", []);
  await rebuildSummary();
});

// ───────────────────────────────────────────── Mini-app pieces

function artwork(src, size) {
  return src
    ? Widget.image({ src, size, cornerRadius: Math.round(size / 6) })
    : Widget.symbol("waveform.circle.fill", { size: size * 0.8, color: ROSE_SOFT, fallback: "🎧" });
}

function episodeRow(ep, trailing) {
  const done = isPlayed(ep.key);
  return Widget.hstack([
    artwork(ep.art, 46),
    Widget.vstack([
      Widget.hstack([
        ep.isNew && !done ? Widget.text("NEW", { font: 9, weight: "bold", color: "white", padding: { horizontal: 5, vertical: 1 }, background: ROSE, cornerRadius: 4 }) : null,
        Widget.text(ep.title, { font: "subheadline", weight: done ? "regular" : "medium", color: done ? "secondary" : "primary", lineLimit: 2 }),
      ], { spacing: 6, alignment: "top" }),
      Widget.text([ep.show, fmtDate(ep.pubDate), formatDuration(ep.duration)].filter(Boolean).join(" · "), { font: "caption", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
    trailing,
  ], { spacing: 10, padding: 10, background: ROW_BG, cornerRadius: 12 });
}

function latestPane(all) {
  const hide = Storage.get("hidePlayed", false);
  const list = (hide ? all.filter((ep) => !isPlayed(ep.key)) : all).slice(0, 25);
  if (shows().length === 0) return emptyState("No shows yet", "Find a podcast in Search and follow it. New episodes show up here.");
  return Widget.vstack([
    Widget.hstack([
      Widget.toggle("Hide played", hide, "hidePlayed", null, { color: "pink" }),
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [
        { title: "Refresh feeds", symbol: "arrow.clockwise", action: "refresh" },
        { title: "Mark all played", symbol: "checkmark.circle", action: "clearPlayed", destructive: true },
      ]),
    ]),
    ...list.map((ep) => Widget.button(episodeRow(ep, Widget.symbol(inQueue(ep.key) ? "text.badge.checkmark" : isPlayed(ep.key) ? "checkmark" : "chevron.right", { size: 14, color: inQueue(ep.key) ? "pink" : "secondary", fallback: "›" })), "episode", { key: ep.key })),
    list.length === 0 ? Widget.text("Everything is played. Nice.", { color: "secondary", align: "center", padding: 20 }) : null,
    Widget.text("Tap an episode to play, queue or mark it.", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 8 });
}

function queuePane() {
  const summary = Storage.get("summary");
  const items = summary?.queue ?? [];
  if (items.length === 0) return emptyState("The queue is empty", "Tap an episode in Latest and choose “Add to queue”. The queue keeps its order and adds up the time left.");
  return Widget.vstack([
    Widget.card([
      Widget.hstack([
        Widget.vstack([
          Widget.text(formatDuration(summary.queueSeconds, true) || "–", { font: "title2", weight: "bold", design: "rounded", color: "pink" }),
          Widget.text(`${summary.queueCount} episode${summary.queueCount === 1 ? "" : "s"} queued`, { font: "caption", color: "secondary" }),
        ], { alignment: "leading", spacing: 2 }),
        Widget.spacer(),
        Widget.button("Play first", "open", { url: items[0].url }, { style: "prominent", color: "pink" }),
      ]),
    ], { title: "Up next", symbol: "play.circle.fill", color: "pink" }),
    ...items.map((ep, i) => episodeRow(ep, Widget.hstack([
      Widget.button(Widget.symbol("chevron.up", { size: 14, color: i === 0 ? "secondary" : "pink", fallback: "↑" }), "queueMove", { key: ep.key, by: -1 }),
      Widget.button(Widget.symbol("chevron.down", { size: 14, color: i === items.length - 1 ? "secondary" : "pink", fallback: "↓" }), "queueMove", { key: ep.key, by: 1 }),
      Widget.menu("ellipsis.circle", [
        { title: "Play audio", symbol: "play.fill", action: "open", args: { url: ep.url } },
        { title: "Move to top", symbol: "arrow.up.to.line", action: "queueTop", args: { key: ep.key } },
        { title: "Played, remove", symbol: "checkmark.circle", action: "queueDone", args: { key: ep.key } },
      ]),
    ], { spacing: 8 }))),
    summary.queueCount > items.length ? Widget.text(`And ${summary.queueCount - items.length} more.`, { font: "caption", color: "secondary" }) : null,
  ], { alignment: "leading", spacing: 8 });
}

function showsPane() {
  const list = shows();
  if (list.length === 0) return emptyState("No shows yet", "Follow podcasts from the Search tab.");
  const last = Storage.get("lastRefresh");
  return Widget.vstack([
    Widget.hstack([
      Widget.button("Refresh all feeds", "refresh", null, { style: "bordered", color: "pink" }),
      Widget.spacer(),
      last ? Widget.date(last, { style: "relative", font: "caption", color: "secondary" }) : null,
    ]),
    ...list.map((show) => Widget.hstack([
      artwork(show.artwork100, 46),
      Widget.vstack([
        Widget.text(show.name, { font: "subheadline", weight: "medium", lineLimit: 1 }),
        Widget.text(show.lastError ? `Feed problem: ${show.lastError}` : [show.artist, show.newCount ? `${show.newCount} new` : null].filter(Boolean).join(" · "), {
          font: "caption", color: show.lastError ? "orange" : "secondary", lineLimit: 2,
        }),
      ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
      Widget.menu("ellipsis.circle", [
        { title: "Open in Podcasts", symbol: "arrow.up.right.square", action: "open", args: { url: show.trackViewUrl } },
        { title: "Refresh feed", symbol: "arrow.clockwise", action: "refreshShow", args: { id: show.id } },
        { title: "Unfollow", symbol: "minus.circle", action: "unfollow", args: { id: show.id }, destructive: true },
      ]),
    ], { spacing: 10, padding: 10, background: ROW_BG, cornerRadius: 12 })),
    Widget.text("Feeds are fetched from each show's own host. Background runs refresh them a few times a day.", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 8 });
}

function searchPane() {
  const s = Storage.get("search");
  return Widget.vstack([
    Widget.textField("Podcast name", s?.term ?? "", "search", null, { keyboard: "search", label: "Search Apple Podcasts" }),
    s?.error ? Widget.text(`Search failed: ${s.error}`, { font: "caption", color: "orange" }) : null,
    s && s.results.length === 0 && !s.error ? Widget.text(`Nothing found for “${s.term}”.`, { color: "secondary" }) : null,
    ...(s?.results ?? []).map((show) => {
      const following = shows().some((x) => x.id === show.id);
      return Widget.hstack([
        artwork(show.artwork100, 46),
        Widget.vstack([
          Widget.text(show.name, { font: "subheadline", weight: "medium", lineLimit: 1 }),
          Widget.text([show.artist, show.genre, show.episodes ? `${show.episodes} episodes` : null].filter(Boolean).join(" · "), { font: "caption", color: "secondary", lineLimit: 1 }),
        ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
        following
          ? Widget.symbol("checkmark.circle.fill", { size: 22, color: "pink", fallback: "✓" })
          : Widget.button("Follow", "follow", { show }, { style: "bordered", color: "pink" }),
      ], { spacing: 10, padding: 10, background: ROW_BG, cornerRadius: 12 });
    }),
    !s ? Widget.text("Type a podcast's name and tap Return. Search results come from itunes.apple.com.", { font: "footnote", color: "secondary" }) : null,
  ], { alignment: "leading", spacing: 8 });
}

function emptyState(title, message) {
  return Widget.vstack([
    Widget.symbol("headphones", { size: 44, color: "pink", fallback: "🎧" }),
    Widget.text(title, { font: "headline", align: "center" }),
    Widget.text(message, { color: "secondary", align: "center" }),
  ], { spacing: 10, padding: 24, frame: { maxWidth: "infinity" } });
}

// ───────────────────────────────────────────── Mini-app

let openedOnce = false;

Script.ui(async () => {
  const tab = Storage.get("tab", 0);
  if (!openedOnce) {
    openedOnce = true;
    try { await refreshAll(); } catch { /* feeds keep their last state */ }
  }
  const all = tab === 0 ? await rebuildSummary() : [];
  const panes = [() => latestPane(all), queuePane, showsPane, searchPane];
  const summary = Storage.get("summary");
  return {
    title: summary ? `Podcast Queue · ${summary.unplayedCount} unplayed` : "Podcast Queue",
    content: Widget.vstack([
      Widget.tabs(TABS.map((title, i) => ({ title, symbol: TAB_SYMBOLS[i], content: i === tab ? panes[i]() : Widget.text("") })), { selected: tab, action: "tab" }),
    ], { padding: 16 }),
  };
});

// ───────────────────────────────────────────── Widget

function widgetRow(ep, size) {
  return Widget.hstack([
    artwork(ep.art, size),
    Widget.vstack([
      Widget.text(ep.title, { font: size > 40 ? "subheadline" : "caption", weight: "medium", lineLimit: size > 40 ? 2 : 1 }),
      Widget.text([ep.show, formatDuration(ep.duration)].filter(Boolean).join(" · "), { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 1 }),
    Widget.spacer(),
    ep.isNew ? Widget.symbol("circle.fill", { size: 6, color: ROSE, fallback: "•" }) : null,
  ], { spacing: 8, url: ep.showUrl ?? ep.url });
}

Script.widget(({ family, parameter }) => {
  const summary = Storage.get("summary");
  const queueMode = /queue/i.test(parameter ?? "");
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const root = { alignment: "leading", padding: 14, background: WIDGET_BG, url: APP_LINK, frame: fill };

  if (!summary || shows().length === 0) {
    return Widget.vstack([
      Widget.symbol("headphones", { size: 28, color: "pink", fallback: "🎧" }),
      Widget.text("Open Podcast Queue and follow a show", { font: "caption", color: "secondary", align: "center", lineLimit: 3 }),
    ], { spacing: 8, padding: 14, background: WIDGET_BG, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
  }

  const items = queueMode ? summary.queue : summary.unplayed;
  const heading = queueMode ? "UP NEXT" : "NEW EPISODES";
  const footer = queueMode
    ? `${summary.queueCount} queued · ${formatDuration(summary.queueSeconds) || "0m"}`
    : `${summary.unplayedCount} unplayed · queue ${formatDuration(summary.queueSeconds) || "0m"}`;
  const header = Widget.hstack([
    Widget.symbol(queueMode ? "list.number" : "sparkles", { size: 10, color: ROSE, fallback: "✦" }),
    Widget.text(heading, { font: "caption2", weight: "bold", color: ROSE }),
    Widget.spacer(),
    Widget.text(footer, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
  ], { spacing: 4 });
  let content;

  if (items.length === 0) {
    content = Widget.vstack([
      header,
      Widget.spacer(),
      Widget.text(queueMode ? "Queue is empty" : "All caught up", { font: "headline" }),
      Widget.text(queueMode ? "Add episodes from the app" : "No unplayed episodes", { font: "caption", color: "secondary" }),
      Widget.spacer(),
    ], { ...root, spacing: 2 });
  } else if (family === "small") {
    const ep = items[0];
    content = Widget.vstack([
      Widget.hstack([artwork(ep.art, 54), Widget.spacer(), ep.isNew ? Widget.text("NEW", { font: 9, weight: "bold", color: "white", padding: { horizontal: 5, vertical: 1 }, background: ROSE, cornerRadius: 4 }) : null], { alignment: "top" }),
      Widget.spacer(),
      Widget.text(ep.title, { font: "footnote", weight: "semibold", lineLimit: 3 }),
      Widget.text([ep.show, formatDuration(ep.duration)].filter(Boolean).join(" · "), { font: "caption2", color: "secondary", lineLimit: 1 }),
      Widget.text(footer, { font: "caption2", color: ROSE, lineLimit: 1, minimumScale: 0.7 }),
    ], { ...root, spacing: 2 });
  } else if (family === "medium") {
    content = Widget.vstack([
      header,
      ...items.slice(0, 3).map((ep) => widgetRow(ep, 32)),
      Widget.spacer(),
    ], { ...root, spacing: 6 });
  } else {
    content = Widget.vstack([
      header,
      ...items.slice(0, 6).map((ep) => widgetRow(ep, 44)),
      Widget.spacer(),
      Widget.hstack([
        Widget.text("Tap a row to open the show, the widget to open the app", { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
        Widget.spacer(),
        Widget.date(summary.time, { style: "relative", font: "caption2", color: "secondary" }),
      ]),
    ], { ...root, spacing: 8, padding: 16 });
  }

  return { content, refreshAfter: 30 * 60 };
});

// ───────────────────────────────────────────── Run and background

Script.run(async (input) => {
  const term = (input ?? "").trim();
  if (term) {
    const results = await searchPodcasts(term);
    if (results.length === 0) return `No podcast called “${term}” found.`;
    if (shows().some((s) => s.id === results[0].id)) return `You already follow ${results[0].name}.`;
    await followShow(results[0]);
    return `Following ${results[0].name}.`;
  }
  await refreshAll();
  const summary = Storage.get("summary");
  if (!summary || summary.unplayedCount === 0) return "No unplayed episodes.";
  const lines = summary.unplayed.slice(0, 5).map((ep) => `${ep.show}: ${ep.title}${ep.duration ? ` (${formatDuration(ep.duration)})` : ""}`);
  return `${summary.unplayedCount} unplayed, queue ${formatDuration(summary.queueSeconds) || "empty"}.\n${lines.join("\n")}`;
});

Script.background(async () => {
  try { await refreshAll(); } catch (error) { Storage.set("lastError", `${new Date().toISOString()} ${error.message}`); }
});
