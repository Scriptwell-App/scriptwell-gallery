// @name        TV Tonight
// @description Tonight's TV schedule for your country, the shows you follow with a countdown to their next episode, and one-tap calendar reminders. Contacts api.tvmaze.com.
// @permissions network, calendar
// @widget      small, medium, large
// @icon        tv.fill
// @color       #6D28D9
// @version     1.0.0
// @author      scriptwell
// @category    entertainment

// How it works
// • Tonight's schedule and show details come from api.tvmaze.com. The only things sent there are
//   the country code you pick in Settings, today's date, show ids and the text you type in Search.
// • Follow shows from Tonight or Search. The Following tab shows each one's next episode with a
//   live countdown and a "Remind me" button that adds a calendar event with a 10-minute alarm.
// • The widget shows the next episode of a followed show (or tonight's first pick) and, in the
//   large size, a timeline of tonight's picks. Set the widget Parameter to a show's name to
//   feature that show. Tapping the widget opens the mini-app.
// • Open the mini-app once before adding the widget, so the network and calendar permissions are
//   approved and the schedule is cached. The widget only refreshes caches that are stale.

// ───────────────────────────────────────────── Constants

const API = "https://api.tvmaze.com";
const SCHEDULE_FRESH = 3 * 60 * 60 * 1000;
const FOLLOW_FRESH = 6 * 60 * 60 * 1000;
const MAX_FOLLOWS = 30;
const MAX_SCHEDULE = 200;
const EVENING_HOUR = 18;

const COUNTRIES = [
  ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["AU", "Australia"],
  ["IE", "Ireland"], ["NZ", "New Zealand"], ["DE", "Germany"], ["FR", "France"], ["ES", "Spain"],
  ["IT", "Italy"], ["NL", "Netherlands"], ["BE", "Belgium"], ["SE", "Sweden"], ["NO", "Norway"],
  ["DK", "Denmark"], ["FI", "Finland"], ["PT", "Portugal"], ["PL", "Poland"], ["BR", "Brazil"], ["JP", "Japan"],
];

const TABS = ["Tonight", "Following", "Search", "Settings"];
const PURPLE = "#A78BFA";
const PINK = "#F472B6";
const SOFT = "#FFFFFFB3";
const FAINT = "#FFFFFF66";
const SCREEN = Widget.gradient(["#2E1065", "#4C1D95", "#1E1B4B"], { direction: "topLeadingToBottomTrailing" });
const CARD_BG = { light: "#F5F3FF", dark: "#2E1065" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────────────────────────── Helpers

const settings = () => ({ country: "US", ...Storage.get("settings", {}) });
const countryName = (code) => COUNTRIES.find(([c]) => c === code)?.[1] ?? code;
const follows = () => Storage.get("follows", []);
const isFollowed = (id) => follows().some((s) => s.id === id);
const today = () => new Date().toLocaleDateString("en-CA");
const scheduleKey = () => `schedule:${settings().country}:${today()}`;
const pad2 = (n) => String(n ?? 0).padStart(2, "0");
const code = (ep) => (ep && ep.season != null && ep.number != null ? `S${pad2(ep.season)}E${pad2(ep.number)}` : "");
const episodeLabel = (ep) => [code(ep), ep?.title].filter(Boolean).join(" · ");
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(Script.env.locale, { hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso) => new Date(iso).toLocaleDateString(Script.env.locale, { weekday: "short", day: "numeric", month: "short" });
const hourLabel = (iso) => {
  const d = new Date(iso);
  d.setMinutes(0, 0, 0);
  return d.toLocaleTimeString(Script.env.locale, { hour: "2-digit", minute: "2-digit" });
};
const strip = (html) => (html ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

// An episode is "on now" between its start and its end.
function airState(ep) {
  if (!ep?.airstamp) return "none";
  const start = new Date(ep.airstamp).getTime();
  const end = start + (ep.runtime ?? 60) * 60_000;
  if (Date.now() < start) return "upcoming";
  return Date.now() < end ? "onNow" : "aired";
}

async function getJSON(path, params = {}, timeout = 8000) {
  const url = new URL(API + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { timeout });
  if (!response.ok) throw new Error(`TVmaze answered ${response.status}`);
  return response.json();
}

// ───────────────────────────────────────────── Schedule

function trimEpisode(e) {
  const show = e.show ?? {};
  return {
    id: e.id,
    showId: show.id,
    show: show.name ?? "Untitled",
    network: show.network?.name ?? show.webChannel?.name ?? "",
    season: e.season,
    number: e.number,
    title: e.name ?? "",
    airstamp: e.airstamp,
    runtime: e.runtime ?? show.runtime ?? 60,
    type: e.type ?? "regular",
    image: show.image?.medium ?? null,
    url: show.url ?? null,
    genre: show.genres?.[0] ?? "",
  };
}

async function loadSchedule(force = false) {
  const key = scheduleKey();
  const cached = Storage.get(key);
  if (!force && cached && Date.now() - cached.time < SCHEDULE_FRESH) return cached;
  try {
    const timeout = Script.env.mode === "widget" ? 5000 : 10000;
    const raw = await getJSON("/schedule", { country: settings().country, date: today() }, timeout);
    const items = raw.map(trimEpisode)
      .filter((e) => e.airstamp)
      .sort((a, b) => new Date(a.airstamp) - new Date(b.airstamp))
      .slice(0, MAX_SCHEDULE);
    for (const k of Storage.keys()) if (k.startsWith("schedule:") && k !== key) Storage.remove(k);
    const fresh = { items, time: Date.now() };
    Storage.set(key, fresh);
    Storage.remove("scheduleError");
    return fresh;
  } catch (error) {
    Storage.set("scheduleError", { message: error.message, time: Date.now() });
    return cached ?? null;
  }
}

// Episodes from early evening (or the last hour) onwards, grouped by the hour they start.
function tonightGroups(schedule) {
  if (!schedule) return [];
  const evening = new Date();
  evening.setHours(EVENING_HOUR, 0, 0, 0);
  const from = Math.min(Date.now() - 60 * 60_000, evening.getTime());
  const groups = new Map();
  for (const ep of schedule.items) {
    if (new Date(ep.airstamp).getTime() < from) continue;
    const label = hourLabel(ep.airstamp);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(ep);
  }
  return [...groups.entries()];
}

// A short, time-ordered selection: followed shows first, then primetime, then the rest.
function tonightPicks(schedule, count) {
  if (!schedule) return [];
  const now = Date.now();
  const score = (ep) => {
    const hour = new Date(ep.airstamp).getHours();
    let s = 0;
    if (isFollowed(ep.showId)) s += 100;
    if (hour >= 19 && hour <= 23) s += 10;
    if (ep.type === "regular") s += 5;
    if (ep.image) s += 1;
    return s;
  };
  return schedule.items
    .filter((ep) => new Date(ep.airstamp).getTime() + ep.runtime * 60_000 > now)
    .sort((a, b) => score(b) - score(a) || new Date(a.airstamp) - new Date(b.airstamp))
    .slice(0, count)
    .sort((a, b) => new Date(a.airstamp) - new Date(b.airstamp));
}

// ───────────────────────────────────────────── Followed shows

function trimShow(show) {
  return {
    id: show.id,
    name: show.name,
    network: show.network?.name ?? show.webChannel?.name ?? "",
    status: show.status ?? "",
    premiered: show.premiered ?? "",
    rating: show.rating?.average ?? null,
    image: show.image?.medium ?? null,
    url: show.url ?? null,
    summary: strip(show.summary).slice(0, 160),
  };
}

async function refreshFollow(show) {
  const data = await getJSON(`/shows/${show.id}`, { embed: "nextepisode" }, Script.env.mode === "widget" ? 5000 : 8000);
  const next = data._embedded?.nextepisode;
  return {
    ...show,
    ...trimShow(data),
    next: next ? {
      id: next.id, title: next.name ?? "", season: next.season, number: next.number,
      airstamp: next.airstamp, runtime: next.runtime ?? data.runtime ?? 60,
    } : null,
    checked: Date.now(),
  };
}

async function refreshFollows(force = false) {
  const list = follows();
  const stale = list.filter((s) => force || !s.checked || Date.now() - s.checked > FOLLOW_FRESH || (s.next && airState(s.next) === "aired"));
  if (stale.length === 0) return list;
  const limit = Script.env.mode === "widget" ? 6 : Script.env.mode === "background" ? 10 : stale.length;
  const updated = await Promise.all(stale.slice(0, limit).map((s) => refreshFollow(s).catch(() => s)));
  const merged = list.map((s) => updated.find((u) => u.id === s.id) ?? s);
  Storage.set("follows", merged);
  return merged;
}

const upcoming = (list = follows()) => list
  .filter((s) => s.next && airState(s.next) !== "aired")
  .sort((a, b) => new Date(a.next.airstamp) - new Date(b.next.airstamp));

async function follow(show) {
  if (isFollowed(show.id)) return;
  if (follows().length >= MAX_FOLLOWS) throw new Error(`You can follow up to ${MAX_FOLLOWS} shows`);
  let entry = { ...show, next: null, checked: null };
  try { entry = await refreshFollow(entry); } catch { /* next episode fills in later */ }
  Storage.set("follows", [...follows(), entry]);
}

function unfollow(id) {
  Storage.set("follows", follows().filter((s) => s.id !== id));
}

// ───────────────────────────────────────────── Calendar reminders

const reminders = () => Storage.get("reminders", {});

async function addReminder(show) {
  const ep = show.next;
  if (!ep) return;
  const start = new Date(ep.airstamp);
  const event = await Calendar.add({
    title: `${show.name} ${code(ep)}${ep.title ? ` – ${ep.title}` : ""}`,
    start,
    end: new Date(start.getTime() + (ep.runtime ?? 60) * 60_000),
    notes: `${show.network ? `On ${show.network}. ` : ""}Added by TV Tonight.`,
    url: show.url ?? undefined,
    alarm: 10,
  });
  Storage.set("reminders", { ...reminders(), [ep.id]: event.id });
}

async function removeReminder(episodeId) {
  const id = reminders()[episodeId];
  if (id) {
    try { await Calendar.remove(id); } catch { /* already gone */ }
  }
  const rest = { ...reminders() };
  delete rest[episodeId];
  Storage.set("reminders", rest);
}

// ───────────────────────────────────────────── Search

async function search(query) {
  const results = await getJSON("/search/shows", { q: query });
  return results.slice(0, 10).map((r) => trimShow(r.show));
}

// ───────────────────────────────────────────── Actions

Script.action("tab", ({ value }) => Storage.set("tab", value));

Script.action("country", async ({ value }) => {
  Storage.set("settings", { ...settings(), country: value });
  await loadSchedule(true);
});

Script.action("search", async ({ value }) => {
  const q = String(value ?? "").trim();
  if (!q) { Storage.remove("search"); return; }
  try {
    Storage.set("search", { q, results: await search(q), time: Date.now() });
  } catch (error) {
    Storage.set("search", { q, results: [], error: error.message, time: Date.now() });
  }
});

Script.action("toggleFollow", async ({ show }) => {
  if (isFollowed(show.id)) {
    unfollow(show.id);
    return;
  }
  try {
    await follow(show);
    await UI.haptic("success");
  } catch (error) {
    await UI.alert({ title: "Could not follow", message: error.message });
  }
});

Script.action("episode", async ({ id }) => {
  const ep = Storage.get(scheduleKey())?.items.find((e) => e.id === id);
  if (!ep) return;
  const followed = isFollowed(ep.showId);
  const buttons = ["Cancel", followed ? "Unfollow" : "Follow", "Open on TVmaze"];
  const choice = await UI.alert({
    title: ep.show,
    message: `${[ep.network, episodeLabel(ep)].filter(Boolean).join(" · ")}\n${fmtDay(ep.airstamp)} ${fmtTime(ep.airstamp)}${ep.runtime ? ` · ${ep.runtime} min` : ""}`,
    buttons,
  });
  if (choice === 1) {
    if (followed) unfollow(ep.showId);
    else await follow({ id: ep.showId, name: ep.show, network: ep.network, image: ep.image, url: ep.url });
  }
  if (choice === 2 && ep.url) await UI.openURL(ep.url);
});

Script.action("remind", async ({ id }) => {
  const show = follows().find((s) => s.id === id);
  if (!show?.next) return;
  const existing = reminders()[show.next.id];
  try {
    if (existing) {
      const choice = await UI.alert({ title: "Remove the reminder?", message: `${show.name} ${code(show.next)} is in your calendar.`, buttons: ["Keep", "Remove"] });
      if (choice === 1) await removeReminder(show.next.id);
    } else {
      await addReminder(show);
      await UI.haptic("success");
    }
  } catch (error) {
    await UI.alert({ title: "Calendar", message: error.message });
  }
});

Script.action("open", async ({ url }) => { if (url) await UI.openURL(url); });
Script.action("unfollow", ({ id }) => unfollow(id));

Script.action("refresh", async () => {
  await Promise.all([loadSchedule(true), refreshFollows(true)]);
});

Script.action("reset", async () => {
  const choice = await UI.alert({ title: "Forget everything?", message: "Followed shows, reminders and cached schedules are removed. Calendar events stay.", buttons: ["Cancel", "Forget"] });
  if (choice === 1) Storage.clear();
});

// ───────────────────────────────────────────── Mini-app panes

function tonightPane(schedule) {
  const error = Storage.get("scheduleError");
  if (!schedule) {
    return Widget.vstack([
      Widget.symbol("antenna.radiowaves.left.and.right.slash", { size: 40, color: "secondary", fallback: "📡" }),
      Widget.text(error ? `Could not load the schedule: ${error.message}` : "Loading the schedule…", { color: "secondary", align: "center" }),
      Widget.button("Try again", "refresh", null, { style: "bordered" }),
    ], { spacing: 12, padding: 24, frame: { maxWidth: "infinity" } });
  }
  const groups = tonightGroups(schedule);
  let rows = 0;
  const lists = [];
  for (const [label, eps] of groups) {
    if (rows >= 80) break;
    const shown = eps.slice(0, Math.min(12, 80 - rows));
    rows += shown.length;
    lists.push(Widget.list(shown.map((e) => ({
      title: e.show,
      subtitle: [e.network, episodeLabel(e)].filter(Boolean).join(" · ") || e.type,
      detail: fmtTime(e.airstamp),
      symbol: isFollowed(e.showId) ? "heart.fill" : "tv",
      color: isFollowed(e.showId) ? "pink" : "secondary",
      action: "episode",
      args: { id: e.id },
    })), { title: label }));
  }
  return Widget.vstack([
    Widget.hstack([
      Widget.text(`${countryName(settings().country)} · ${fmtDay(new Date().toISOString())}`, { font: "footnote", color: "secondary" }),
      Widget.spacer(),
      Widget.text("Updated", { font: "caption2", color: "secondary" }),
      Widget.date(schedule.time, { style: "relative", font: "caption2", color: "secondary" }),
    ], { spacing: 4 }),
    error ? Widget.text(`Showing the last schedule: ${error.message}`, { font: "caption", color: "orange" }) : null,
    ...lists,
    lists.length === 0 ? Widget.text("Nothing more is scheduled for today.", { color: "secondary", align: "center", padding: 20 }) : null,
    Widget.text("Tap a row to follow a show. Schedule data by TVmaze.", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 12 });
}

function followCard(show) {
  const ep = show.next;
  const state = airState(ep);
  const reminded = ep && reminders()[ep.id];
  const when = ep
    ? state === "onNow"
      ? Widget.text("On now", { font: "caption", weight: "bold", color: "pink" })
      : Widget.hstack([
          Widget.date(ep.airstamp, { style: "relative", font: "caption", weight: "semibold", color: "purple" }),
          Widget.text(`· ${fmtDay(ep.airstamp)} ${fmtTime(ep.airstamp)}`, { font: "caption", color: "secondary", lineLimit: 1 }),
        ], { spacing: 4 })
    : null;
  return Widget.card([
    Widget.hstack([
      show.image
        ? Widget.image({ src: show.image, size: 52, cornerRadius: 8 })
        : Widget.symbol("tv", { size: 32, color: "secondary", fallback: "📺" }),
      Widget.vstack([
        Widget.text(ep ? episodeLabel(ep) || "Next episode" : show.status === "Ended" ? "This show has ended" : "No next episode scheduled yet", {
          font: "subheadline", weight: ep ? "medium" : "regular", color: ep ? "primary" : "secondary", lineLimit: 2,
        }),
        when,
      ], { alignment: "leading", spacing: 3 }),
      Widget.spacer(),
    ], { spacing: 10 }),
    Widget.hstack([
      ep && state === "upcoming"
        ? Widget.button(reminded ? "Reminder set" : "Remind me", "remind", { id: show.id }, { style: reminded ? "bordered" : "prominent", color: "purple" })
        : null,
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [
        { title: "Open on TVmaze", symbol: "safari", action: "open", args: { url: show.url } },
        { title: "Unfollow", symbol: "heart.slash", action: "unfollow", args: { id: show.id }, destructive: true },
      ]),
    ]),
  ], { title: show.name, subtitle: show.network || undefined, symbol: "tv.fill", color: "purple" });
}

function followingPane(list) {
  if (list.length === 0) {
    return Widget.vstack([
      Widget.symbol("heart.text.square", { size: 44, color: "pink", fallback: "💜" }),
      Widget.text("You are not following any shows yet.", { font: "headline", align: "center" }),
      Widget.text("Tap a show in Tonight or find one in Search. Followed shows get a countdown here and in the widget.", { color: "secondary", align: "center" }),
    ], { spacing: 10, padding: 24, frame: { maxWidth: "infinity" } });
  }
  const soon = upcoming(list);
  const later = list.filter((s) => !soon.includes(s)).sort((a, b) => a.name.localeCompare(b.name));
  return Widget.vstack([
    Widget.text(`${list.length} show${list.length === 1 ? "" : "s"} · ${soon.length} with a date`, { font: "footnote", color: "secondary" }),
    ...soon.map(followCard),
    later.length ? Widget.text("Waiting for a date", { font: "caption", weight: "semibold", color: "secondary" }) : null,
    ...later.map(followCard),
  ], { alignment: "leading", spacing: 12 });
}

function searchPane() {
  const s = Storage.get("search");
  return Widget.vstack([
    Widget.textField("Show name", s?.q ?? "", "search", null, { keyboard: "search", label: "Search TVmaze" }),
    s?.error ? Widget.text(`Search failed: ${s.error}`, { font: "caption", color: "orange" }) : null,
    s && s.results.length === 0 && !s.error ? Widget.text(`Nothing found for “${s.q}”.`, { color: "secondary" }) : null,
    s?.results.length ? Widget.list(s.results.map((show) => ({
      title: show.name,
      subtitle: [show.network, show.premiered ? show.premiered.slice(0, 4) : "", show.status, show.rating ? `★ ${show.rating}` : ""].filter(Boolean).join(" · "),
      detail: isFollowed(show.id) ? "Following" : "Follow",
      symbol: isFollowed(show.id) ? "heart.fill" : "plus.circle",
      color: isFollowed(show.id) ? "pink" : "purple",
      action: "toggleFollow",
      args: { show },
    })), { title: "Results" }) : null,
    !s ? Widget.text("Type a show's name and tap Return. Tap a result to follow or unfollow it.", { font: "footnote", color: "secondary" }) : null,
  ], { alignment: "leading", spacing: 12 });
}

function settingsPane() {
  const options = COUNTRIES.map(([value, label]) => ({ label, value }));
  return Widget.vstack([
    Widget.picker(options, settings().country, "country", null, { label: "Schedule country" }),
    Widget.text("TVmaze lists the broadcast schedule per country. Times are shown in your device's time zone.", { font: "caption", color: "secondary" }),
    Widget.divider(),
    Widget.button("Refresh schedule and shows", "refresh", null, { style: "bordered" }),
    Widget.button("Forget everything", "reset", null, { style: "bordered", color: "red" }),
    Widget.divider(),
    Widget.text("Reminders are ordinary calendar events with a 10-minute alarm. Removing one here removes the event.", { font: "caption", color: "secondary" }),
    Widget.text("Data: api.tvmaze.com (schedule, show details, search).", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 14 });
}

// ───────────────────────────────────────────── Mini-app

Script.ui(async () => {
  const tab = Storage.get("tab", 0);
  const schedule = await loadSchedule();
  let list = follows();
  try { list = await refreshFollows(); } catch { /* keep the cached list */ }
  const panes = [
    () => tonightPane(schedule),
    () => followingPane(list),
    searchPane,
    settingsPane,
  ];
  const symbols = ["sparkles.tv", "heart.fill", "magnifyingglass", "gearshape"];
  return {
    title: "TV Tonight",
    content: Widget.vstack([
      Widget.tabs(TABS.map((title, i) => ({
        title,
        symbol: symbols[i],
        content: i === tab ? panes[i]() : Widget.text(""),
      })), { selected: tab, action: "tab" }),
    ], { padding: 16 }),
  };
});

// ───────────────────────────────────────────── Widget pieces

// Pick the show to feature: the parameter's show if it matches, otherwise the soonest upcoming one.
function featured(list, parameter) {
  const soon = upcoming(list);
  const wanted = (parameter ?? "").trim().toLowerCase();
  if (wanted) {
    const match = list.find((s) => s.name.toLowerCase().includes(wanted));
    if (match) return match;
  }
  return soon[0] ?? null;
}

function countdown(ep, font) {
  const state = airState(ep);
  if (state === "onNow") return Widget.text("On now", { font, weight: "bold", color: PINK, lineLimit: 1 });
  return Widget.date(ep.airstamp, { style: "relative", font, weight: "bold", color: PURPLE, lineLimit: 1, minimumScale: 0.6 });
}

function heroBlock(show, pick, size) {
  const label = Widget.text(show ? "NEXT UP" : "TONIGHT", { font: "caption2", weight: "bold", color: FAINT });
  if (!show && !pick) {
    return Widget.vstack([
      label,
      Widget.text("Nothing to show yet", { font: "headline", color: "white" }),
      Widget.text("Open TV Tonight to follow shows", { font: "caption", color: SOFT, lineLimit: 2 }),
    ], { alignment: "leading", spacing: 3 });
  }
  const name = show ? show.name : pick.show;
  const ep = show ? show.next : pick;
  const network = show ? show.network : pick.network;
  return Widget.vstack([
    Widget.hstack([
      Widget.symbol(show ? "heart.fill" : "sparkles", { size: 10, color: show ? PINK : PURPLE, fallback: "♥" }),
      label,
    ], { spacing: 4 }),
    Widget.text(name, { font: size === "small" ? "headline" : "title3", weight: "bold", color: "white", lineLimit: 2, minimumScale: 0.8 }),
    Widget.text(episodeLabel(ep) || network || " ", { font: "caption", color: SOFT, lineLimit: 1 }),
    countdown(ep, size === "small" ? "title3" : "title2"),
    Widget.text(`${fmtDay(ep.airstamp)} ${fmtTime(ep.airstamp)}${network ? ` · ${network}` : ""}`, { font: "caption2", color: SOFT, lineLimit: 1, minimumScale: 0.7 }),
  ], { alignment: "leading", spacing: 2 });
}

function pickRow(ep, compact) {
  const followed = isFollowed(ep.showId);
  return Widget.hstack([
    Widget.text(fmtTime(ep.airstamp), { font: compact ? "caption2" : "caption", weight: "semibold", design: "rounded", color: SOFT, frame: { width: compact ? 38 : 44, alignment: "leading" } }),
    Widget.symbol(followed ? "heart.fill" : "circle.fill", { size: compact ? 6 : 7, color: followed ? PINK : PURPLE, fallback: "•" }),
    Widget.vstack([
      Widget.text(ep.show, { font: compact ? "caption" : "subheadline", weight: "medium", color: "white", lineLimit: 1 }),
      compact ? null : Widget.text([ep.network, episodeLabel(ep)].filter(Boolean).join(" · ") || ep.type, { font: "caption2", color: SOFT, lineLimit: 1 }),
    ], { alignment: "leading", spacing: 0 }),
    Widget.spacer(),
  ], { spacing: 6, alignment: compact ? "center" : "top" });
}

function poster(show, pick, size) {
  const src = show?.image ?? pick?.image;
  if (!src) return Widget.symbol("tv.fill", { size: size * 0.6, color: "#FFFFFF33", fallback: "📺" });
  return Widget.image({ src, size, cornerRadius: 8 });
}

// ───────────────────────────────────────────── Widget

Script.widget(async ({ family, parameter }) => {
  let list = follows();
  let schedule = Storage.get(scheduleKey());
  if (!Script.env.lowPowerMode) {
    try {
      // One network job per refresh keeps the widget inside its time budget.
      if (!schedule || Date.now() - schedule.time > SCHEDULE_FRESH) schedule = (await loadSchedule()) ?? schedule;
      else list = await refreshFollows();
    } catch { /* cached data below */ }
  }

  const show = featured(list, parameter);
  const picks = tonightPicks(schedule, family === "large" ? 8 : 3);
  const pick = show ? null : picks[0] ?? null;
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const root = { alignment: "leading", padding: 14, background: SCREEN, url: APP_LINK, frame: fill };
  let content;

  if (family === "small") {
    content = Widget.vstack([
      heroBlock(show, pick, "small"),
      Widget.spacer(),
      Widget.text(picks.length ? `${picks.length} pick${picks.length === 1 ? "" : "s"} tonight` : countryName(settings().country), { font: "caption2", color: FAINT, lineLimit: 1 }),
    ], { ...root, spacing: 4 });
  } else if (family === "medium") {
    const rows = picks.filter((ep) => !show || ep.showId !== show.id).slice(0, 3);
    content = Widget.hstack([
      Widget.hstack([
        poster(show, pick, 54),
        heroBlock(show, pick, "medium"),
      ], { spacing: 10, alignment: "top", frame: { maxWidth: "infinity", alignment: "topLeading" } }),
      Widget.vstack([
        Widget.text("TONIGHT", { font: "caption2", weight: "bold", color: FAINT }),
        ...rows.map((ep) => pickRow(ep, true)),
        rows.length === 0 ? Widget.text("No schedule yet", { font: "caption", color: SOFT }) : null,
        Widget.spacer(),
      ], { alignment: "leading", spacing: 5, frame: { width: 128, maxHeight: "infinity", alignment: "topLeading" } }),
    ], { ...root, spacing: 12 });
  } else {
    content = Widget.vstack([
      Widget.hstack([
        poster(show, pick, 64),
        heroBlock(show, pick, "large"),
        Widget.spacer(),
      ], { spacing: 12, alignment: "top", padding: 10, background: "#FFFFFF14", cornerRadius: 14, frame: { maxWidth: "infinity", alignment: "leading" } }),
      Widget.hstack([
        Widget.text("TONIGHT", { font: "caption2", weight: "bold", color: FAINT }),
        Widget.spacer(),
        Widget.text(countryName(settings().country), { font: "caption2", color: FAINT }),
      ]),
      ...picks.map((ep) => pickRow(ep, false)),
      picks.length === 0 ? Widget.text("Open TV Tonight to load tonight's schedule.", { font: "caption", color: SOFT }) : null,
      Widget.spacer(),
      Widget.hstack([
        Widget.symbol("heart.fill", { size: 7, color: PINK, fallback: "♥" }),
        Widget.text("followed", { font: "caption2", color: FAINT }),
        Widget.spacer(),
        schedule ? Widget.date(schedule.time, { style: "relative", font: "caption2", color: FAINT }) : null,
      ], { spacing: 3 }),
    ], { ...root, spacing: 6, padding: 16 });
  }

  return { content, refreshAfter: 30 * 60 };
});

// ───────────────────────────────────────────── Run and background

Script.run(async (input) => {
  const query = (input ?? "").trim();
  if (query) {
    const results = await search(query);
    if (results.length === 0) return `No show called “${query}” on TVmaze.`;
    const show = results[0];
    if (isFollowed(show.id)) return `You already follow ${show.name}.`;
    await follow(show);
    const next = follows().find((s) => s.id === show.id)?.next;
    return next
      ? `Following ${show.name}. Next: ${episodeLabel(next)} on ${fmtDay(next.airstamp)} at ${fmtTime(next.airstamp)}.`
      : `Following ${show.name}. No next episode is scheduled yet.`;
  }
  const [schedule, list] = await Promise.all([loadSchedule(), refreshFollows()]);
  const lines = [];
  for (const s of upcoming(list).slice(0, 3)) {
    lines.push(`${s.name} ${code(s.next)}: ${airState(s.next) === "onNow" ? "on now" : `${fmtDay(s.next.airstamp)} ${fmtTime(s.next.airstamp)}`}`);
  }
  const picks = tonightPicks(schedule, 5);
  if (picks.length) lines.push(`Tonight: ${picks.map((ep) => `${fmtTime(ep.airstamp)} ${ep.show}`).join(", ")}`);
  return lines.join("\n") || "Nothing to report. Open TV Tonight to follow some shows.";
});

Script.background(async () => {
  await Promise.all([
    loadSchedule(),
    refreshFollows().catch(() => null),
  ]);
});
