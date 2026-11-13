// @name        New Releases
// @description Follow artists and see their upcoming and recent albums, EPs and singles from musicbrainz.org, with artwork from itunes.apple.com, calendar events and a notification on release day.
// @permissions network, calendar, notifications
// @widget      small, medium, large
// @icon        music.note.list
// @color       #DB2777
// @version     1.0.0
// @author      va4w
// @category    music

// How it works
// • Search an artist in the mini-app and tap a result to follow it. Artist names you type are sent to
//   musicbrainz.org (artist search); each followed artist's MusicBrainz id is sent to fetch its release
//   groups. Artist and release titles are sent to itunes.apple.com to find artwork. Nothing else leaves
//   the device.
// • MusicBrainz asks for one request per second and a descriptive User-Agent; the script waits between
//   calls and sends "ScriptWell-NewReleases/1.0". Syncs are spread over runs: each run works through
//   the artists in turn within its time budget, and background runs continue where the last one stopped.
// • Run the script once in the app, then add the widget. Widget parameter: an artist name to show only
//   that artist, or "recent" to lead with what just came out.
// • "Add to Calendar" creates all-day events for upcoming releases. Syncs schedule a notification for
//   9:00 on each release day (within the next 60 days); background runs also catch same-day releases.

// ───────────────────────── Constants

const MB = "https://musicbrainz.org/ws/2";
const ITUNES = "https://itunes.apple.com/search";
const USER_AGENT = "ScriptWell-NewReleases/1.0 (Scriptwell gallery script)";
const MB_GAP_MS = 1100;
const ITUNES_GAP_MS = 400;
const DAY = 86_400_000;
const RECENT_DAYS = 90;
const NOTIFY_DAYS = 60;
const PAGE = 25;

const TIME_LIMITS = { app: 30_000, pwa: 30_000, shortcut: 20_000, background: 15_000, widget: 8_000 };
const TIME_MARGIN = 4_000;

const TYPE_COLORS = { Album: "pink", EP: "purple", Single: "indigo" };
const PINK = "#EC4899";
const CARD_BG = { light: "#FFFFFF", dark: "#1C1C1E" };
const WIDGET_BG = Widget.gradient(["#4A044E", "#831843", "#9D174D"], { direction: "topLeadingToBottomTrailing" });
const SOFT_WHITE = "#FFFFFFB3";
const locale = Script.env.locale;
const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────── Storage helpers

const artists = () => Storage.get("artists", []);                 // [{ id, name, disambiguation, country }]
const releases = () => Storage.get("releases", {});               // id -> { id, title, type, date, precision, artistId, artistName }
const artwork = () => Storage.get("artwork", {});                 // releaseId -> { url, time }
const DEFAULTS = { types: ["Album", "EP", "Single"], tab: "Upcoming" };
const settings = () => ({ ...DEFAULTS, ...Storage.get("settings", {}) });
const save = (changes) => Storage.set("settings", { ...settings(), ...changes });

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

// MusicBrainz dates can be "2026", "2026-05" or "2026-05-12".
function parseDate(text) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(text ?? "");
  if (!m) return null;
  const precision = m[3] ? "day" : m[2] ? "month" : "year";
  return { time: new Date(Number(m[1]), Number(m[2] ?? 1) - 1, Number(m[3] ?? 1)).getTime(), precision };
}

function timeline() {
  const { types } = settings();
  const cutoff = startOfToday() - RECENT_DAYS * DAY;
  const list = Object.values(releases()).filter((r) => types.includes(r.type) && r.date >= cutoff);
  const today = startOfToday();
  return {
    upcoming: list.filter((r) => r.date >= today).sort((a, b) => a.date - b.date),
    recent: list.filter((r) => r.date < today).sort((a, b) => b.date - a.date),
  };
}

function dateLabel(r) {
  const d = new Date(r.date);
  if (r.precision === "year") return String(d.getFullYear());
  if (r.precision === "month") return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function countdown(r) {
  const days = Math.round((r.date - startOfToday()) / DAY);
  if (r.precision !== "day") return `expected ${dateLabel(r)}`;
  if (days === 0) return "Out today";
  if (days === 1) return "Tomorrow";
  if (days > 0) return `in ${days} days`;
  if (days === -1) return "Yesterday";
  return `${-days} days ago`;
}

// ───────────────────────── Networking with a time budget and rate limits

function makeBudget() {
  const end = Date.now() + (TIME_LIMITS[Script.env.mode] ?? 20_000) - TIME_MARGIN;
  return { left: () => end - Date.now() };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastCall = { mb: 0, itunes: 0 };

async function throttle(kind, gap) {
  const elapsed = Date.now() - lastCall[kind];
  if (elapsed < gap) await wait(gap - elapsed);
  lastCall[kind] = Date.now();
}

async function mbGet(path, params, budget) {
  await throttle("mb", MB_GAP_MS);
  const url = new URL(`${MB}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("fmt", "json");
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    timeout: Math.max(2000, Math.min(8000, budget.left())),
  });
  if (response.status === 503) throw new Error("MusicBrainz is busy (rate limited). Try again in a minute.");
  if (!response.ok) throw new Error(`MusicBrainz returned ${response.status}`);
  return response.json();
}

async function searchArtists(name, budget) {
  const data = await mbGet("artist/", { query: name.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, " ").trim(), limit: "8" }, budget);
  return (data.artists ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    disambiguation: a.disambiguation ?? "",
    country: a.country ?? "",
    type: a.type ?? "",
    score: a.score ?? 0,
  }));
}

// One page of an artist's release groups, merged into the stored map. Returns the total MusicBrainz reports.
async function fetchReleasePage(artist, offset, budget) {
  const data = await mbGet("release-group", { artist: artist.id, type: "album|ep|single", limit: String(PAGE), offset: String(offset) }, budget);
  const map = releases();
  for (const g of data["release-groups"] ?? []) {
    const parsed = parseDate(g["first-release-date"]);
    const secondary = g["secondary-types"] ?? [];
    if (!parsed || secondary.some((t) => /compilation|live|remix|demo|soundtrack/i.test(t))) continue;
    map[g.id] = {
      id: g.id,
      title: g.title,
      type: g["primary-type"] ?? "Album",
      date: parsed.time,
      precision: parsed.precision,
      artistId: artist.id,
      artistName: artist.name,
    };
  }
  Storage.set("releases", map);
  return data["release-group-count"] ?? 0;
}

async function fetchArtwork(r, budget) {
  await throttle("itunes", ITUNES_GAP_MS);
  const url = new URL(ITUNES);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "album");
  url.searchParams.set("term", `${r.artistName} ${r.title}`);
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { timeout: Math.max(2000, Math.min(6000, budget.left())) });
  if (!response.ok) return null;
  const data = await response.json();
  const hit = data.results?.[0];
  return hit?.artworkUrl100 ? hit.artworkUrl100.replace("100x100", "600x600") : null;
}

// ───────────────────────── Sync

async function sync() {
  const budget = makeBudget();
  const list = artists();
  if (list.length === 0) { Storage.set("lastSync", Date.now()); return; }
  const background = Script.env.mode === "background";
  const maxPages = background ? 1 : 4;
  let cursor = Storage.get("syncCursor", 0) % list.length;
  let done = 0;
  let error = null;

  try {
    // Round-robin through the artists, newest followers first on their first sync.
    while (done < list.length && budget.left() > 3_000) {
      const artist = list[cursor];
      let offset = 0;
      for (let page = 0; page < maxPages && budget.left() > 3_000; page++) {
        const total = await fetchReleasePage(artist, offset, budget);
        offset += PAGE;
        if (offset >= total) break;
      }
      cursor = (cursor + 1) % list.length;
      Storage.set("syncCursor", cursor);
      done++;
    }

    // Artwork for what the widget will show, a few per run.
    const { upcoming, recent } = timeline();
    const want = [...upcoming, ...recent].slice(0, 12);
    const art = artwork();
    let lookups = 0;
    for (const r of want) {
      if (lookups >= (background ? 2 : 8) || budget.left() < 2_500) break;
      const cached = art[r.id];
      if (cached && (cached.url || Date.now() - cached.time < 7 * DAY)) continue;
      try { art[r.id] = { url: await fetchArtwork(r, budget), time: Date.now() }; }
      catch { art[r.id] = { url: null, time: Date.now() }; }
      lookups++;
    }
    // Keep the cache to what is still on the timeline.
    const keep = new Set(Object.keys(releases()));
    Storage.set("artwork", Object.fromEntries(Object.entries(art).filter(([id]) => keep.has(id))));
  } catch (e) {
    error = e;
  }

  try { await scheduleNotifications(); } catch { /* notifications are a bonus */ }
  Storage.set("lastSync", Date.now());
  Storage.set("lastError", error ? { message: error.message, time: Date.now() } : null);
  if (error && done === 0) throw error;
}

// ───────────────────────── Notifications

async function scheduleNotifications() {
  if (Script.env.mode === "widget") return;
  const { upcoming } = timeline();
  const notified = Storage.get("notified", {});
  const now = Date.now();
  for (const r of upcoming) {
    if (r.precision !== "day" || r.date - now > NOTIFY_DAYS * DAY) continue;
    const at = new Date(r.date);
    at.setHours(9, 0, 0, 0);
    const id = `release-${r.id}`;
    const body = `${r.title} (${r.type}) is out today.`;
    if (at.getTime() > now + 60_000) {
      await Notification.schedule({ id, title: `${r.artistName} · new release`, body, at });
    } else if (!notified[r.id]) {
      // Release day and 9:00 has passed (or iOS only woke us now): say it soon.
      await Notification.schedule({ id, title: `${r.artistName} · out now`, body, after: 5 });
    } else {
      continue;
    }
    notified[r.id] = now;
  }
  // Forget releases older than the window so the map does not grow forever.
  const cutoff = now - RECENT_DAYS * DAY;
  const all = releases();
  Storage.set("notified", Object.fromEntries(Object.entries(notified).filter(([id]) => all[id] && all[id].date >= cutoff)));
}

// ───────────────────────── Actions

Script.action("query", async ({ value }) => {
  const query = (value ?? "").trim();
  Storage.set("query", query);
  if (!query) { Storage.remove("searchResults"); return; }
  try {
    Storage.set("searchResults", await searchArtists(query, makeBudget()));
    Storage.set("lastError", null);
  } catch (e) {
    Storage.set("lastError", { message: e.message, time: Date.now() });
  }
});

Script.action("follow", async ({ value }) => {
  const result = (Storage.get("searchResults") ?? []).find((a) => a.id === value);
  if (!result || artists().some((a) => a.id === result.id)) return;
  Storage.set("artists", [result, ...artists()]);
  Storage.remove("searchResults");
  Storage.set("query", "");
  // Sync the new artist straight away, others next time.
  Storage.set("syncCursor", 0);
  try { await sync(); await UI.haptic("success"); } catch { await UI.haptic("error"); }
});

Script.action("unfollow", async ({ id }) => {
  const artist = artists().find((a) => a.id === id);
  const choice = await UI.alert({ title: `Unfollow ${artist?.name ?? "this artist"}?`, buttons: ["Cancel", "Unfollow"] });
  if (choice !== 1) return;
  Storage.set("artists", artists().filter((a) => a.id !== id));
  Storage.set("releases", Object.fromEntries(Object.entries(releases()).filter(([, r]) => r.artistId !== id)));
  Storage.set("syncCursor", 0);
});

Script.action("sync", async () => {
  try { await sync(); await UI.haptic("success"); } catch { await UI.haptic("error"); }
});

Script.action("types", ({ value }) => save({ types: value.length ? value : ["Album"] }));
Script.action("tab", ({ value }) => save({ tab: value }));

Script.action("calendar", async () => {
  const ids = Storage.get("calendarIds", {});
  const { upcoming } = timeline();
  let added = 0;
  for (const r of upcoming) {
    if (ids[r.id] || r.precision !== "day") continue; // "2027" or "2027-03" is not a date to put in a calendar
    const event = await Calendar.add({
      title: `${r.artistName}: ${r.title}`,
      start: new Date(r.date),
      allDay: true,
      notes: `${r.type} · release date from MusicBrainz. Added by New Releases in Scriptwell.`,
      url: `https://musicbrainz.org/release-group/${r.id}`,
    });
    ids[r.id] = event.id;
    added++;
  }
  Storage.set("calendarIds", ids);
  await UI.alert(added ? `Added ${added} release${added === 1 ? "" : "s"} to your calendar.` : "Every upcoming release with an exact date is already in your calendar.");
});

Script.action("uncalendar", async () => {
  const ids = Storage.get("calendarIds", {});
  const choice = await UI.alert({ title: "Remove the calendar events this script added?", buttons: ["Cancel", "Remove"] });
  if (choice !== 1) return;
  for (const eventId of Object.values(ids)) { try { await Calendar.remove(eventId); } catch { /* already gone */ } }
  Storage.remove("calendarIds");
});

Script.action("open", ({ id }) => UI.openURL(`https://musicbrainz.org/release-group/${id}`));

// ───────────────────────── Shared pieces

function cover(r, size, radius = 8) {
  const url = artwork()[r.id]?.url;
  if (url) return Widget.image({ src: url, size, cornerRadius: radius });
  return Widget.zstack([
    { type: "stack", direction: "vertical", children: [], frame: { width: size, height: size }, background: { light: "#FBCFE8", dark: "#500724" }, cornerRadius: radius },
    Widget.symbol("music.note", { size: size * 0.4, color: PINK, fallback: "♪" }),
  ]);
}

function typeBadge(r, light = false) {
  return Widget.text(r.type.toUpperCase(), {
    font: 9, weight: "bold", color: light ? "white" : TYPE_COLORS[r.type] ?? "pink",
    padding: { horizontal: 5, vertical: 2 }, background: light ? "#FFFFFF33" : { light: "#FCE7F3", dark: "#500724" }, cornerRadius: 5,
  });
}

// ───────────────────────── Mini-app

function releaseCard(r) {
  const days = Math.round((r.date - startOfToday()) / DAY);
  const inCalendar = Boolean(Storage.get("calendarIds", {})[r.id]);
  return Widget.button(Widget.hstack([
    cover(r, 64, 10),
    Widget.vstack([
      Widget.text(r.title, { font: "headline", lineLimit: 2 }),
      Widget.text(r.artistName, { font: "subheadline", color: "secondary", lineLimit: 1 }),
      Widget.hstack([
        typeBadge(r),
        Widget.text(dateLabel(r), { font: "caption", color: "secondary" }),
        inCalendar ? Widget.symbol("calendar.badge.checkmark", { size: 11, color: "green", fallback: "📅" }) : null,
      ], { spacing: 6 }),
    ], { alignment: "leading", spacing: 3 }),
    Widget.spacer(),
    Widget.text(days >= 0 && r.precision === "day" ? (days === 0 ? "today" : `${days}d`) : countdown(r), { font: "caption", weight: "semibold", color: days >= 0 ? PINK : "secondary", lineLimit: 2, align: "trailing" }),
  ], { spacing: 12, padding: 12, background: CARD_BG, cornerRadius: 14, frame: { maxWidth: "infinity", alignment: "leading" } }), "open", { id: r.id });
}

function artistRows() {
  const list = artists();
  const all = Object.values(releases());
  if (list.length === 0) return Widget.text("No artists yet. Search above and tap a result to follow it.", { font: "footnote", color: "secondary" });
  return Widget.list(list.map((a) => {
    const mine = all.filter((r) => r.artistId === a.id);
    const latest = mine.sort((x, y) => y.date - x.date)[0];
    return {
      title: a.name,
      subtitle: latest ? `${mine.length} releases · latest ${latest.title}` : [a.disambiguation, a.country].filter(Boolean).join(" · ") || "Not synced yet",
      symbol: "person.wave.2.fill",
      color: "pink",
      detail: "Unfollow",
      action: "unfollow",
      args: { id: a.id },
    };
  }), { title: `Following (${list.length})` });
}

Script.ui(() => {
  const s = settings();
  const results = Storage.get("searchResults");
  const error = Storage.get("lastError");
  const lastSync = Storage.get("lastSync");
  const { upcoming, recent } = timeline();
  const pane = (items, empty) => (items.length
    ? Widget.vstack(items.slice(0, 40).map(releaseCard), { spacing: 8 })
    : Widget.text(empty, { font: "footnote", color: "secondary", padding: 12 }));

  return {
    title: "New Releases",
    content: Widget.vstack([
      Widget.textField("Search an artist on MusicBrainz", Storage.get("query", ""), "query", null, { keyboard: "search" }),
      results ? (results.length
        ? Widget.list(results.map((a) => ({
            title: a.name,
            subtitle: [a.type, a.disambiguation, a.country].filter(Boolean).join(" · ") || "MusicBrainz artist",
            symbol: artists().some((x) => x.id === a.id) ? "checkmark.circle.fill" : "plus.circle",
            color: "pink",
            value: a.id,
          })), { title: "Tap to follow", action: "follow" })
        : Widget.text("No artist matched. Try another spelling.", { font: "footnote", color: "secondary" })) : null,
      artistRows(),
      Widget.hstack([
        Widget.button("Sync now", "sync", null, { style: "prominent", color: "pink" }),
        Widget.button(upcoming.length ? `Add ${upcoming.length} to Calendar` : "Add to Calendar", "calendar", null, { style: "bordered", color: "pink" }),
        Widget.spacer(),
        Widget.menu("ellipsis.circle", [{ title: "Remove calendar events", symbol: "calendar.badge.minus", action: "uncalendar", destructive: true }]),
      ], { spacing: 8 }),
      Widget.hstack([
        lastSync ? Widget.text("Synced", { font: "caption", color: "secondary" }) : Widget.text("Not synced yet", { font: "caption", color: "secondary" }),
        lastSync ? Widget.date(lastSync, { style: "relative", font: "caption", color: "secondary" }) : null,
        error ? Widget.text(`· ${error.message}`, { font: "caption", color: "orange", lineLimit: 2 }) : null,
      ], { spacing: 4 }),
      Widget.checklist(["Album", "EP", "Single"], s.types, "types", null, { label: "Show" }),
      Widget.tabs([
        { title: `Upcoming (${upcoming.length})`, symbol: "calendar", content: pane(upcoming, "Nothing announced yet for the artists you follow. Release dates appear on MusicBrainz once labels publish them.") },
        { title: `Recent (${recent.length})`, symbol: "clock.arrow.circlepath", content: pane(recent, `Nothing released in the last ${RECENT_DAYS} days.`) },
      ], { selected: s.tab.startsWith("Recent") ? 1 : 0 }),
      Widget.text("Data: MusicBrainz (release groups) and the iTunes Search API (artwork). Release dates are community-maintained and can change.", { font: "caption2", color: "secondary" }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});

// ───────────────────────── Widget

function pickForWidget(parameter) {
  const { upcoming, recent } = timeline();
  const p = (parameter ?? "").trim().toLowerCase();
  const filter = (list) => (p && p !== "recent" ? list.filter((r) => r.artistName.toLowerCase().includes(p)) : list);
  const up = filter(upcoming), re = filter(recent);
  return p === "recent" ? [...re, ...up] : [...up, ...re];
}

function emptyWidget(family) {
  const message = artists().length ? "Open the app and tap Sync now" : "Open New Releases and follow an artist";
  return Widget.vstack([
    Widget.symbol("music.note.list", { size: family === "small" ? 26 : 34, color: "white", fallback: "♪" }),
    Widget.text(message, { font: "caption", color: SOFT_WHITE, align: "center", lineLimit: 3 }),
  ], { spacing: 8, padding: 14, background: WIDGET_BG, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
}

function smallWidget(r) {
  const upcoming = r.date >= startOfToday();
  return Widget.vstack([
    Widget.hstack([
      cover(r, 56, 8),
      Widget.spacer(),
      Widget.vstack([
        typeBadge(r, true),
        Widget.text(upcoming ? "NEXT" : "LATEST", { font: 9, weight: "bold", color: SOFT_WHITE }),
      ], { alignment: "trailing", spacing: 4 }),
    ], { alignment: "top" }),
    Widget.spacer(),
    Widget.text(r.title, { font: "headline", color: "white", lineLimit: 2, minimumScale: 0.8 }),
    Widget.text(r.artistName, { font: "caption", color: SOFT_WHITE, lineLimit: 1 }),
    r.precision === "day"
      ? Widget.date(r.date, { style: "relative", font: "caption", weight: "semibold", color: "#F9A8D4" })
      : Widget.text(countdown(r), { font: "caption", weight: "semibold", color: "#F9A8D4", lineLimit: 1 }),
  ], { alignment: "leading", spacing: 2, padding: 13, background: WIDGET_BG, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
}

function mediumWidget(list) {
  const column = (r) => Widget.vstack([
    cover(r, 58, 8),
    Widget.text(r.title, { font: "caption", weight: "semibold", color: "white", lineLimit: 2, align: "center", minimumScale: 0.8 }),
    Widget.text(r.artistName, { font: "caption2", color: SOFT_WHITE, lineLimit: 1 }),
    Widget.text(countdown(r), { font: "caption2", weight: "semibold", color: "#F9A8D4", lineLimit: 1 }),
  ], { spacing: 2, frame: { maxWidth: "infinity", alignment: "top" } });
  return Widget.vstack([
    Widget.hstack([
      Widget.symbol("music.note.list", { size: 12, color: "#F9A8D4", fallback: "♪" }),
      Widget.text("New releases", { font: "caption", weight: "bold", color: "white" }),
      Widget.spacer(),
      Widget.text(`${timeline().upcoming.length} upcoming`, { font: "caption2", color: SOFT_WHITE }),
    ], { spacing: 4 }),
    Widget.hstack(list.slice(0, 3).map(column), { spacing: 10, alignment: "top" }),
  ], { alignment: "leading", spacing: 8, padding: 13, background: WIDGET_BG, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
}

function largeWidget(parameter) {
  const { upcoming, recent } = timeline();
  const p = (parameter ?? "").trim().toLowerCase();
  const filter = (list) => (p && p !== "recent" ? list.filter((r) => r.artistName.toLowerCase().includes(p)) : list);
  const up = filter(upcoming).slice(0, 4);
  const re = filter(recent).slice(0, 7 - up.length);
  const row = (r, future) => Widget.hstack([
    cover(r, 36, 6),
    Widget.vstack([
      Widget.text(r.title, { font: "subheadline", weight: "semibold", color: "white", lineLimit: 1 }),
      Widget.text(`${r.artistName} · ${r.type}`, { font: "caption2", color: SOFT_WHITE, lineLimit: 1 }),
    ], { alignment: "leading", spacing: 1 }),
    Widget.spacer(),
    Widget.vstack([
      Widget.text(future && r.precision === "day" && r.date - startOfToday() <= 14 * DAY ? countdown(r) : dateLabel(r), { font: "caption", weight: "semibold", color: future ? "#F9A8D4" : "white", lineLimit: 1 }),
      future ? null : Widget.text(countdown(r), { font: "caption2", color: SOFT_WHITE }),
    ], { alignment: "trailing", spacing: 1 }),
  ], { spacing: 10 });
  const heading = (text) => Widget.text(text.toUpperCase(), { font: 10, weight: "bold", color: "#F9A8D4" });
  return Widget.vstack([
    Widget.hstack([
      Widget.symbol("music.note.list", { size: 14, color: "#F9A8D4", fallback: "♪" }),
      Widget.text(p && p !== "recent" ? `New releases · ${artists().find((a) => a.name.toLowerCase().includes(p))?.name ?? parameter}` : "New releases", { font: "headline", color: "white", lineLimit: 1 }),
      Widget.spacer(),
      Widget.date(Storage.get("lastSync") ?? Date.now(), { style: "relative", font: "caption2", color: SOFT_WHITE }),
    ], { spacing: 6 }),
    up.length ? heading("Upcoming") : null,
    ...up.map((r) => row(r, true)),
    re.length ? heading(`Last ${RECENT_DAYS} days`) : null,
    ...re.map((r) => row(r, false)),
    up.length + re.length === 0 ? Widget.text("Nothing on the timeline yet.", { font: "footnote", color: SOFT_WHITE }) : null,
    Widget.spacer(),
  ], { alignment: "leading", spacing: 7, padding: 14, background: WIDGET_BG, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
}

Script.widget(({ family, parameter }) => {
  const list = pickForWidget(parameter);
  let content;
  if (list.length === 0) content = emptyWidget(family);
  else if (family === "small") content = smallWidget(list[0]);
  else if (family === "medium") content = mediumWidget(list);
  else content = largeWidget(parameter);
  return { content, refreshAfter: 60 * 60 };
});

// ───────────────────────── Run and background

Script.run(async () => {
  try { await sync(); } catch (e) { if (Object.keys(releases()).length === 0) return `Could not sync: ${e.message}`; }
  const { upcoming, recent } = timeline();
  if (artists().length === 0) return "Follow some artists in the New Releases mini-app first.";
  const next = upcoming[0] ? `Next: ${describe(upcoming[0])}.` : "Nothing announced yet.";
  const latest = recent[0] ? ` Latest: ${describe(recent[0])}.` : "";
  return `${next}${latest}`;
});

function describe(r) {
  return `${r.title} by ${r.artistName} (${r.type}), ${countdown(r)}`;
}

Script.background(async () => {
  try { await sync(); } catch { /* kept in lastError */ }
});
