// @name        Match Day
// @description Live scores, fixtures and results for the teams you follow, from ESPN's public scoreboard at site.api.espn.com, with kick-offs added to your calendar and a notification at full time
// @permissions network, calendar, notifications
// @widget      small, medium, large, rectangular, inline
// @icon        sportscourt.fill
// @color       #15803D
// @version     1.0.0
// @author      scriptwell
// @category    sports

// How it works
// • Scores come from ESPN's public scoreboard JSON at site.api.espn.com. The only things sent are the league and a date range; team crests are loaded from a.espncdn.com when a widget is drawn.
// • Open the mini-app once, pick a league and follow a team or two. That first run also approves network, calendar and notification access, which the widget and background runs need.
// • Widget: your team's live or next match with crests, score and clock. Medium adds recent and upcoming games, large adds today's slate, and the Lock Screen sizes show the score or a kick-off countdown. Set the widget Parameter to a team name to feature that team.
// • Background runs refresh the cache a few times a day and send one notification per match when a followed team's game reaches full time (deduplicated by match id).
// • "Add to Calendar" creates a two-hour event in your default calendar with an alert before kick-off.
// • Widgets refresh about every 5 minutes while a game is live and every 30 minutes otherwise; everything falls back to the cached data when offline.

// ───────────────────────── Leagues and constants

const API = "https://site.api.espn.com/apis/site/v2/sports";
const LEAGUES = [
  { id: "soccer/eng.1", name: "Premier League", short: "PL", soccer: true },
  { id: "soccer/esp.1", name: "La Liga", short: "LaLiga", soccer: true },
  { id: "soccer/ger.1", name: "Bundesliga", short: "BL", soccer: true },
  { id: "soccer/ita.1", name: "Serie A", short: "SA", soccer: true },
  { id: "soccer/fra.1", name: "Ligue 1", short: "L1", soccer: true },
  { id: "soccer/uefa.champions", name: "Champions League", short: "UCL", soccer: true },
  { id: "soccer/usa.1", name: "MLS", short: "MLS", soccer: true },
  { id: "basketball/nba", name: "NBA", short: "NBA", soccer: false },
  { id: "football/nfl", name: "NFL", short: "NFL", soccer: false },
  { id: "baseball/mlb", name: "MLB", short: "MLB", soccer: false },
  { id: "hockey/nhl", name: "NHL", short: "NHL", soccer: false },
];
const DAY = 86_400_000;
const HOUR = 3_600_000;
const PAST_DAYS = 14;
const FUTURE_DAYS = 14;
const FRESH_LIVE = 2 * 60_000;
const FRESH_IDLE = 20 * 60_000;

const GREEN = "#16A34A";
const LIVE = "#DC2626";
const PITCH = Widget.gradient([{ light: "#F0FDF4", dark: "#052E16" }, { light: "#DCFCE7", dark: "#0B3A20" }], { direction: "topToBottom" });
const TILE = { light: "#FFFFFFB3", dark: "#FFFFFF14" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

const leagueOf = (id) => LEAGUES.find((l) => l.id === id) ?? LEAGUES[0];
const currentLeague = () => Storage.get("league", LEAGUES[0].id);
const followed = () => Storage.get("teams", []);
const settings = () => ({ alarm: 30, notify: true, ...Storage.get("settings", {}) });
const dayKey = (d) => new Date(d).toLocaleDateString("en-CA");
const espnDate = (d) => dayKey(d).replace(/-/g, "");
const timeText = (d) => new Date(d).toLocaleTimeString(Script.env.locale, { hour: "2-digit", minute: "2-digit" });
const dateText = (d) => new Date(d).toLocaleDateString(Script.env.locale, { weekday: "short", day: "numeric", month: "short" });

// ───────────────────────── ESPN parsing and cache

function parseTeam(c) {
  const t = c?.team ?? {};
  const score = c?.score == null || c.score === "" ? null : Number(c.score);
  return {
    id: t.id ?? null,
    name: t.displayName ?? t.name ?? "Unknown",
    abbr: t.abbreviation ?? (t.displayName ?? "???").slice(0, 3).toUpperCase(),
    logo: typeof t.logo === "string" && t.logo.startsWith("https://") ? t.logo : null,
    score: Number.isNaN(score) ? null : score,
  };
}

function parseEvent(ev, league) {
  const comp = ev.competitions?.[0];
  if (!comp || !ev.id) return null;
  const competitors = comp.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === "home") ?? competitors[0];
  const away = competitors.find((c) => c.homeAway === "away") ?? competitors[1];
  if (!home || !away) return null;
  const status = ev.status ?? comp.status ?? {};
  const type = status.type ?? {};
  return {
    id: String(ev.id),
    league,
    date: ev.date ?? comp.date,
    state: type.state ?? "pre",              // "pre", "in" or "post"
    clock: status.displayClock ?? "",
    detail: type.shortDetail ?? type.description ?? "",
    period: status.period ?? 0,
    home: parseTeam(home),
    away: parseTeam(away),
  };
}

async function fetchEvents(league, from, to, timeout) {
  const url = new URL(`${API}/${league}/scoreboard`);
  if (from && to) url.searchParams.set("dates", `${espnDate(from)}-${espnDate(to)}`);
  const response = await fetch(url, { timeout });
  if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
  const data = await response.json();
  return (data.events ?? []).map((e) => parseEvent(e, league)).filter(Boolean);
}

const cacheKey = (league) => `events:${league}`;
const cached = (league) => Storage.get(cacheKey(league)) ?? { list: [], time: 0 };

function merge(league, fresh) {
  const now = Date.now();
  const byId = new Map(cached(league).list.map((e) => [e.id, e]));
  for (const e of fresh) byId.set(e.id, e);
  const list = [...byId.values()]
    .filter((e) => Math.abs(new Date(e.date) - now) < 30 * DAY)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  Storage.set(cacheKey(league), { list, time: now });
  return list;
}

// The chosen league plus any league a followed team plays in.
const leaguesInUse = () => [...new Set([currentLeague(), ...followed().map((t) => t.league)])];

// `wide` fetches two weeks back and ahead (app, Shortcuts, background); otherwise just today's games.
async function refresh({ wide = false, leagues = leaguesInUse(), deadline = Infinity } = {}) {
  const errors = [];
  for (const league of leagues) {
    if (Date.now() > deadline) { errors.push("Ran out of time"); break; }
    try {
      const now = new Date();
      if (wide) {
        const [past, future] = await Promise.all([
          fetchEvents(league, new Date(now - PAST_DAYS * DAY), now, 10_000),
          fetchEvents(league, now, new Date(now.getTime() + FUTURE_DAYS * DAY), 10_000),
        ]);
        merge(league, [...past, ...future]);
      } else {
        merge(league, await fetchEvents(league, null, null, 6_000));
      }
    } catch (error) {
      errors.push(`${leagueOf(league).name}: ${error.message}`);
    }
  }
  Storage.set("lastError", errors.length ? { message: errors.join(" · "), time: Date.now() } : null);
  if (Script.env.mode !== "widget") await notifyFullTime();
  return errors;
}

// ───────────────────────── Teams, fixtures and form

function isTeam(team, follow) {
  if (follow.id && team.id) return String(team.id) === String(follow.id);
  const needle = follow.name.toLowerCase();
  return team.name.toLowerCase().includes(needle) || team.abbr.toLowerCase() === needle;
}
const involves = (e, follow) => isTeam(e.home, follow) || isTeam(e.away, follow);
const teamEvents = (follow) => cached(follow.league).list.filter((e) => involves(e, follow));
const hasLive = (list) => list.some((e) => e.state === "in");

// The match to feature: live now, a result from the last few hours, otherwise the next fixture.
function featureFor(follow) {
  const list = teamEvents(follow);
  const live = list.find((e) => e.state === "in");
  if (live) return live;
  const now = Date.now();
  const next = list.find((e) => e.state === "pre" && new Date(e.date) >= now - 3 * HOUR);
  const last = [...list].reverse().find((e) => e.state === "post");
  const recent = last && now - new Date(last.date) < 8 * HOUR;
  const soon = next && new Date(next.date) - now < 3 * HOUR;
  if (recent && !soon) return last;
  return next ?? last ?? null;
}

function mineAndTheirs(e, follow) {
  const mine = isTeam(e.home, follow) ? e.home : e.away;
  return { mine, theirs: mine === e.home ? e.away : e.home, atHome: mine === e.home };
}

function resultFor(e, follow) {
  const { mine, theirs } = mineAndTheirs(e, follow);
  if (mine.score == null || theirs.score == null) return "D";
  return mine.score > theirs.score ? "W" : mine.score < theirs.score ? "L" : "D";
}

const formOf = (follow, n = 5) => teamEvents(follow).filter((e) => e.state === "post").slice(-n).map((e) => resultFor(e, follow));

// Every team seen in a league's cache, for the follow search.
function teamsIn(league) {
  const seen = new Map();
  for (const e of cached(league).list) for (const t of [e.home, e.away]) if (!seen.has(t.name)) seen.set(t.name, t);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function findFollow(name) {
  const needle = String(name ?? "").trim().toLowerCase();
  if (!needle) return null;
  const known = followed().find((t) => t.name.toLowerCase().includes(needle) || t.abbr.toLowerCase() === needle);
  if (known) return known;
  for (const league of leaguesInUse()) {
    const team = teamsIn(league).find((t) => t.name.toLowerCase().includes(needle) || t.abbr.toLowerCase() === needle);
    if (team) return { ...team, league };
  }
  return null;
}

// Which team the widget features: the Parameter, else the first followed team.
const featuredTeam = (parameter) => findFollow(parameter) ?? followed()[0] ?? null;

// ───────────────────────── Formatting

// Soccer reads home first ("ARS 2–1 CHE"); North American sports read away at home ("BOS @ LAL").
function sides(e) {
  const soccer = leagueOf(e.league).soccer;
  return soccer ? { left: e.home, right: e.away, sep: "–", vs: "v" } : { left: e.away, right: e.home, sep: "–", vs: "@" };
}

function scoreline(e) {
  const { left, right, sep, vs } = sides(e);
  if (e.state === "pre") return `${left.abbr} ${vs} ${right.abbr}`;
  return `${left.abbr} ${left.score ?? 0}${sep}${right.score ?? 0} ${right.abbr}`;
}

function statusText(e) {
  if (e.state === "in") return e.detail || e.clock || "Live";
  if (e.state === "post") return e.detail || "Full time";
  const d = new Date(e.date);
  return dayKey(d) === dayKey(new Date()) ? timeText(d) : `${dateText(d)} ${timeText(d)}`;
}

const relativeDay = (d) => {
  const diff = Math.round((new Date(dayKey(d)) - new Date(dayKey(new Date()))) / DAY);
  return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : dateText(d);
};

function todaysGames(league) {
  const today = dayKey(new Date());
  const order = { in: 0, pre: 1, post: 2 };
  return cached(league).list.filter((e) => dayKey(e.date) === today).sort((a, b) => order[a.state] - order[b.state] || new Date(a.date) - new Date(b.date));
}

// ───────────────────────── Notifications and calendar

async function notifyFullTime() {
  const seen = new Set(Storage.get("notified", []));
  const fresh = [];
  for (const follow of followed()) {
    for (const e of teamEvents(follow)) {
      if (e.state !== "post" || seen.has(e.id)) continue;
      seen.add(e.id);
      const old = Date.now() - new Date(e.date) > 12 * HOUR;
      if (!old && settings().notify && Script.env.mode !== "app") fresh.push({ e, follow });
    }
  }
  Storage.set("notified", [...seen].slice(-200));
  for (const { e, follow } of fresh) {
    const word = { W: "won", L: "lost", D: "drew" }[resultFor(e, follow)];
    try {
      await Notification.schedule({ id: `ft-${e.id}`, title: `Full time: ${scoreline(e)}`, body: `${follow.name} ${word}. ${leagueOf(follow.league).name}.` });
    } catch (error) {
      Storage.set("lastError", { message: `Notification: ${error.message}`, time: Date.now() });
    }
  }
}

const addedEvents = () => Storage.get("added", {});

Script.action("calendar", async ({ id, league }) => {
  const e = cached(league).list.find((x) => x.id === id);
  if (!e) return;
  const start = new Date(e.date);
  try {
    const event = await Calendar.add({
      title: `${e.home.name} v ${e.away.name}`,
      start,
      end: new Date(start.getTime() + 2 * HOUR),
      notes: `${leagueOf(league).name} · Added by Match Day`,
      alarm: settings().alarm,
    });
    Storage.set("added", { ...addedEvents(), [id]: event.id });
    await UI.haptic("success");
  } catch (error) {
    await UI.alert({ title: "Could not add the event", message: error.message });
  }
});

// ───────────────────────── Widget pieces

function crest(team, size) {
  if (team.logo) return Widget.image({ src: team.logo, size, cornerRadius: 4 });
  return Widget.text(team.abbr, {
    font: Math.max(8, Math.round(size * 0.3)), weight: "bold", color: "white", lineLimit: 1, minimumScale: 0.5,
    background: "#334155", cornerRadius: Math.round(size / 2), frame: { width: size, height: size },
  });
}

function statusChip(e) {
  if (e.state === "in") {
    return Widget.hstack([
      { type: "stack", direction: "horizontal", children: [], background: LIVE, cornerRadius: 3, frame: { width: 6, height: 6 } },
      Widget.text(e.detail || e.clock || "LIVE", { font: "caption2", weight: "bold", color: LIVE, lineLimit: 1 }),
    ], { spacing: 4 });
  }
  const text = e.state === "post" ? (e.detail || "FT") : relativeDay(e.date);
  return Widget.text(text, { font: "caption2", weight: "semibold", color: "secondary", lineLimit: 1 });
}

function formStrip(results, size = 12) {
  if (!results.length) return null;
  const colors = { W: GREEN, D: "#94A3B8", L: LIVE };
  return Widget.hstack(results.map((r) => Widget.text(r, {
    font: Math.round(size * 0.7), weight: "bold", color: "white",
    background: colors[r], cornerRadius: 3, frame: { width: size, height: size },
  })), { spacing: 3 });
}

// The big score or "vs" block with crests either side.
function scoreBlock(e, crestSize, font) {
  const { left, right, sep, vs } = sides(e);
  const centre = e.state === "pre"
    ? Widget.text(vs, { font: Math.round(font * 0.6), weight: "semibold", color: "secondary" })
    : Widget.text(`${left.score ?? 0}${sep}${right.score ?? 0}`, { font, weight: "heavy", design: "rounded", lineLimit: 1, minimumScale: 0.5 });
  return Widget.hstack([
    Widget.vstack([crest(left, crestSize), Widget.text(left.abbr, { font: "caption2", weight: "semibold", lineLimit: 1 })], { spacing: 2 }),
    Widget.spacer(),
    centre,
    Widget.spacer(),
    Widget.vstack([crest(right, crestSize), Widget.text(right.abbr, { font: "caption2", weight: "semibold", lineLimit: 1 })], { spacing: 2 }),
  ], { alignment: "center" });
}

function kickoffLine(e, font = "caption") {
  if (e.state === "pre") {
    return Widget.hstack([
      Widget.text("Kick-off", { font, color: "secondary" }),
      Widget.date(e.date, { style: "relative", font, weight: "semibold" }),
      Widget.text(`· ${timeText(e.date)}`, { font, color: "secondary" }),
    ], { spacing: 4 });
  }
  return Widget.text(statusText(e), { font, weight: "semibold", color: e.state === "in" ? LIVE : "secondary", lineLimit: 1 });
}

function slateRow(e, compact) {
  const { left, right, sep, vs } = sides(e);
  const score = e.state === "pre" ? vs : `${left.score ?? 0}${sep}${right.score ?? 0}`;
  return Widget.hstack([
    Widget.text(e.state === "pre" ? timeText(e.date) : (e.state === "in" ? (e.clock || "LIVE") : (e.detail || "FT")), {
      font: "caption2", weight: e.state === "in" ? "bold" : "regular", color: e.state === "in" ? LIVE : "secondary", lineLimit: 1, minimumScale: 0.7,
      frame: { width: compact ? 40 : 52, alignment: "leading" },
    }),
    crest(left, 16),
    Widget.text(left.abbr, { font: "caption", weight: "medium", lineLimit: 1 }),
    Widget.spacer(),
    Widget.text(score, { font: "caption", weight: "bold", design: "rounded", lineLimit: 1 }),
    Widget.spacer(),
    Widget.text(right.abbr, { font: "caption", weight: "medium", lineLimit: 1 }),
    crest(right, 16),
  ], { spacing: 5 });
}

function teamRow(e, follow) {
  const { theirs, atHome } = mineAndTheirs(e, follow);
  const right = e.state === "pre" ? timeText(e.date) : scoreline(e).replace(/^\S+\s|\s\S+$/g, "");
  const r = e.state === "post" ? resultFor(e, follow) : null;
  return Widget.hstack([
    Widget.text(relativeDay(e.date), { font: "caption2", color: "secondary", lineLimit: 1, frame: { width: 46, alignment: "leading" } }),
    crest(theirs, 14),
    Widget.text(`${atHome ? "v" : "@"} ${theirs.abbr}`, { font: "caption", lineLimit: 1 }),
    Widget.spacer(),
    r ? formStrip([r], 11) : null,
    Widget.text(right, { font: "caption", weight: "semibold", design: "rounded", color: e.state === "in" ? LIVE : "primary", lineLimit: 1 }),
  ], { spacing: 5 });
}

function emptyWidget(family) {
  if (family === "inline") return Widget.text("Match Day: open to follow a team");
  if (family === "rectangular") return Widget.text("Open Match Day and follow a team", { font: "caption" });
  return Widget.vstack([
    Widget.symbol("sportscourt.fill", { size: 26, color: GREEN, fallback: "🏟" }),
    Widget.text("Open Match Day to pick a league and follow a team", { font: "caption", color: "secondary", align: "center", lineLimit: 3 }),
  ], { spacing: 8, padding: 12, background: PITCH, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
}

// ───────────────────────── Widget

Script.widget(async ({ family, parameter }) => {
  const team = featuredTeam(parameter);
  const league = team?.league ?? currentLeague();
  const wanted = cached(league);
  const fresh = hasLive(wanted.list) ? FRESH_LIVE : FRESH_IDLE;
  if (Date.now() - wanted.time > fresh) await refresh({ leagues: [league] });

  const e = team ? featureFor(team) : null;
  const slate = todaysGames(league);
  const live = e?.state === "in" || hasLive(slate);
  const soon = e?.state === "pre" && new Date(e.date) - Date.now() < 2 * HOUR;
  const refreshAfter = live ? 5 * 60 : soon ? 10 * 60 : 30 * 60;
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const header = Widget.hstack([
    Widget.text(leagueOf(league).short, { font: "caption2", weight: "bold", color: GREEN }),
    Widget.spacer(),
    e ? statusChip(e) : Widget.text(`${slate.length} today`, { font: "caption2", color: "secondary" }),
  ]);

  if (!e && slate.length === 0) return { content: emptyWidget(family), refreshAfter };

  let content;
  if (family === "inline") {
    content = Widget.text(e ? (e.state === "pre" ? `${scoreline(e)} · ${relativeDay(e.date)} ${timeText(e.date)}` : `${scoreline(e)} · ${statusText(e)}`) : `${leagueOf(league).short}: ${slate.length} games today`);
  } else if (family === "rectangular") {
    content = e ? Widget.vstack([
      Widget.text(scoreline(e), { font: "headline", lineLimit: 1, minimumScale: 0.7 }),
      e.state === "pre"
        ? Widget.hstack([Widget.text("Kick-off", { font: "caption" }), Widget.date(e.date, { style: "relative", font: "caption", weight: "semibold" })], { spacing: 4 })
        : Widget.text(statusText(e), { font: "caption", weight: "semibold" }),
      Widget.text(`${leagueOf(league).name}`, { font: "caption2", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 1 }) : Widget.vstack([
      Widget.text(`${leagueOf(league).short} today`, { font: "headline" }),
      ...slate.slice(0, 2).map((g) => Widget.text(`${scoreline(g)} · ${statusText(g)}`, { font: "caption", lineLimit: 1 })),
    ], { alignment: "leading", spacing: 1 });
  } else if (family === "small") {
    content = Widget.vstack([
      header,
      Widget.spacer(),
      e ? scoreBlock(e, 34, 26) : Widget.vstack(slate.slice(0, 3).map((g) => slateRow(g, true)), { spacing: 4 }),
      Widget.spacer(),
      e ? kickoffLine(e, "caption2") : null,
      team ? formStrip(formOf(team), 10) : null,
    ], { alignment: "leading", spacing: 4, padding: 12, background: PITCH, url: APP_LINK, frame: fill });
  } else if (family === "medium") {
    const others = team ? teamEvents(team).filter((g) => g.id !== e?.id) : [];
    const upcoming = others.filter((g) => g.state !== "post").slice(0, 2);
    const recent = others.filter((g) => g.state === "post").slice(-2);
    content = Widget.hstack([
      Widget.vstack([
        header,
        Widget.spacer(),
        e ? scoreBlock(e, 36, 28) : Widget.text("No match to show", { font: "caption", color: "secondary" }),
        Widget.spacer(),
        e ? kickoffLine(e, "caption2") : null,
      ], { alignment: "leading", spacing: 4, padding: 10, background: TILE, cornerRadius: 14, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack(team ? [
        Widget.hstack([Widget.text(team.name, { font: "caption", weight: "semibold", lineLimit: 1, minimumScale: 0.7 }), Widget.spacer(), formStrip(formOf(team), 11)], { spacing: 4 }),
        ...recent.map((g) => teamRow(g, team)),
        ...upcoming.map((g) => teamRow(g, team)),
        Widget.spacer(),
      ] : [
        Widget.text("Today", { font: "caption", weight: "semibold" }),
        ...slate.slice(0, 4).map((g) => slateRow(g, true)),
        Widget.spacer(),
      ], { alignment: "leading", spacing: 5, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 10, padding: 12, background: PITCH, url: APP_LINK, frame: fill });
  } else {
    const rows = slate.filter((g) => g.id !== e?.id).slice(0, 7);
    content = Widget.vstack([
      header,
      e ? Widget.vstack([
        scoreBlock(e, 44, 34),
        Widget.hstack([kickoffLine(e, "caption"), Widget.spacer(), team ? formStrip(formOf(team), 12) : null]),
      ], { spacing: 6, padding: 12, background: TILE, cornerRadius: 14, frame: { maxWidth: "infinity", alignment: "leading" } }) : null,
      Widget.text(rows.length ? `Today in the ${leagueOf(league).name}` : `Nothing else today in the ${leagueOf(league).name}`, { font: "caption", weight: "semibold", color: "secondary" }),
      ...rows.map((g) => slateRow(g, false)),
      Widget.spacer(),
      Widget.hstack([
        Widget.spacer(),
        Widget.text("Updated", { font: "caption2", color: "secondary" }),
        Widget.date(wanted.time || Date.now(), { style: "relative", font: "caption2", color: "secondary" }),
      ], { spacing: 3 }),
    ], { alignment: "leading", spacing: 7, padding: 14, background: PITCH, url: APP_LINK, frame: fill });
  }
  return { content, refreshAfter };
});

// ───────────────────────── Run and background

Script.run(async (input) => {
  await refresh({ wide: true, deadline: Date.now() + 14_000 });
  const teams = input ? [findFollow(input)].filter(Boolean) : followed();
  if (!teams.length) return input ? `No team called “${input}” in the cached leagues.` : "Open Match Day in Scriptwell to follow a team.";
  return teams.map((team) => {
    const e = featureFor(team);
    if (!e) return `${team.name}: no fixtures in the next two weeks.`;
    if (e.state === "in") return `${team.name} are playing now: ${scoreline(e)}, ${statusText(e)}.`;
    if (e.state === "post") return `${team.name} ${{ W: "won", L: "lost", D: "drew" }[resultFor(e, team)]} ${scoreline(e)}. Form: ${formOf(team).join("") || "–"}.`;
    const hours = Math.round((new Date(e.date) - Date.now()) / HOUR);
    return `${team.name} next play ${scoreline(e)}, ${relativeDay(e.date)} at ${timeText(e.date)} (${hours < 48 ? `in ${hours} h` : `in ${Math.round(hours / 24)} days`}).`;
  }).join("\n");
});

Script.background(async () => {
  await refresh({ wide: true, deadline: Date.now() + 9_000 });
});

// ───────────────────────── Mini-app

let tab = 0;
let query = "";
let selectedId = null;
let loadedOnce = false;
let busy = false;

Script.action("tab", ({ value }) => { tab = value; });
Script.action("query", ({ value }) => { query = String(value ?? "").trim(); });
Script.action("select", ({ id }) => { selectedId = selectedId === id ? null : id; });

Script.action("league", async ({ value }) => {
  Storage.set("league", value);
  selectedId = null;
  if (!cached(value).list.length) await refresh({ wide: true, leagues: [value] });
});

Script.action("refresh", async () => {
  busy = true;
  const errors = await refresh({ wide: true });
  busy = false;
  await UI.haptic(errors.length ? "error" : "success");
});

Script.action("follow", async ({ team, league }) => {
  if (followed().some((t) => t.name === team.name && t.league === league)) return;
  Storage.set("teams", [...followed(), { id: team.id, name: team.name, abbr: team.abbr, logo: team.logo, league }].slice(0, 8));
  query = "";
  if (cached(league).list.length < 5) await refresh({ wide: true, leagues: [league] });
  await notifyFullTime(); // marks existing results as seen so old games are never announced
});

Script.action("unfollow", ({ name, league }) => {
  Storage.set("teams", followed().filter((t) => !(t.name === name && t.league === league)));
});

Script.action("setting", ({ key, value, isOn }) => Storage.set("settings", { ...settings(), [key]: value ?? isOn }));

Script.action("clear", async () => {
  const choice = await UI.alert({ title: "Clear cached games?", message: "Followed teams and settings are kept.", buttons: ["Cancel", "Clear"] });
  if (choice !== 1) return;
  for (const key of Storage.keys()) if (key.startsWith("events:")) Storage.remove(key);
});

function matchCard(e, follow) {
  const added = addedEvents()[e.id];
  const { left, right } = sides(e);
  const canFollow = (team) => !followed().some((t) => t.name === team.name);
  return Widget.card([
    scoreBlock(e, 48, 36),
    Widget.hstack([
      Widget.vstack([Widget.text(left.name, { font: "footnote", weight: "medium", lineLimit: 1 })], { alignment: "leading" }),
      Widget.spacer(),
      Widget.text(right.name, { font: "footnote", weight: "medium", lineLimit: 1 }),
    ]),
    kickoffLine(e, "subheadline"),
    Widget.hstack([
      e.state === "pre" ? Widget.button(added ? "In your calendar" : "Add to Calendar", "calendar", { id: e.id, league: e.league }, { style: added ? "bordered" : "prominent", color: GREEN }) : null,
      Widget.spacer(),
      canFollow(left) ? Widget.button(`Follow ${left.abbr}`, "follow", { team: left, league: e.league }, { style: "bordered" }) : null,
      canFollow(right) ? Widget.button(`Follow ${right.abbr}`, "follow", { team: right, league: e.league }, { style: "bordered" }) : null,
    ], { spacing: 8 }),
    follow ? Widget.hstack([Widget.text("Form", { font: "caption", color: "secondary" }), formStrip(formOf(follow), 14)], { spacing: 6 }) : null,
  ], { title: `${leagueOf(e.league).name}`, subtitle: `${relativeDay(e.date)} · ${statusText(e)}`, symbol: e.state === "in" ? "dot.radiowaves.left.and.right" : "sportscourt", color: e.state === "in" ? "red" : "green" });
}

function todayTab() {
  const league = currentLeague();
  const games = todaysGames(league);
  const upcoming = cached(league).list.filter((e) => e.state === "pre" && dayKey(e.date) > dayKey(new Date())).slice(0, 6);
  const selected = selectedId ? cached(league).list.find((e) => e.id === selectedId) : null;
  const row = (e) => Widget.button(slateRow(e, false), "select", { id: e.id }, { style: "plain" });
  return Widget.vstack([
    Widget.picker(LEAGUES.map((l) => ({ label: l.name, value: l.id })), league, "league", null, { label: "League" }),
    selected ? matchCard(selected, followed().find((t) => involves(selected, t)) ?? null) : null,
    Widget.card(games.length ? games.map(row) : [Widget.text("No games today in this league.", { color: "secondary" })], { title: "Today", subtitle: dateText(new Date()), symbol: "calendar", color: "green" }),
    upcoming.length ? Widget.card(upcoming.map(row), { title: "Coming up", symbol: "clock", color: "gray" }) : null,
  ], { alignment: "leading", spacing: 14 });
}

function teamSection(team) {
  const list = teamEvents(team);
  const next = list.find((e) => e.state === "pre");
  const last = [...list].reverse().find((e) => e.state === "post");
  const form = formOf(team);
  return Widget.card([
    next ? Widget.vstack([
      Widget.hstack([Widget.text("Next", { font: "caption", weight: "semibold", color: "secondary" }), Widget.spacer(), Widget.date(next.date, { style: "relative", font: "caption", weight: "semibold" })]),
      Widget.button(slateRow(next, false), "select", { id: next.id }, { style: "plain" }),
      Widget.text(`${relativeDay(next.date)} · ${timeText(next.date)}`, { font: "caption2", color: "secondary" }),
    ], { alignment: "leading", spacing: 4 }) : Widget.text("No fixture in the next two weeks.", { font: "footnote", color: "secondary" }),
    last ? Widget.vstack([
      Widget.text("Last result", { font: "caption", weight: "semibold", color: "secondary" }),
      Widget.hstack([teamRow(last, team)]),
    ], { alignment: "leading", spacing: 4 }) : null,
    Widget.hstack([
      Widget.text("Form", { font: "caption", weight: "semibold", color: "secondary" }),
      form.length ? formStrip(form, 16) : Widget.text("no results yet", { font: "caption2", color: "secondary" }),
      Widget.spacer(),
      next && !addedEvents()[next.id] ? Widget.button("Add to Calendar", "calendar", { id: next.id, league: team.league }, { style: "bordered", color: GREEN }) : null,
      Widget.menu("ellipsis.circle", [{ title: "Unfollow", symbol: "minus.circle", action: "unfollow", args: { name: team.name, league: team.league }, destructive: true }]),
    ], { spacing: 8 }),
  ], { title: team.name, subtitle: leagueOf(team.league).name, symbol: "star.fill", color: "yellow" });
}

function teamsTab() {
  const league = currentLeague();
  const matches = query ? teamsIn(league).filter((t) => t.name.toLowerCase().includes(query.toLowerCase()) || t.abbr.toLowerCase() === query.toLowerCase()).slice(0, 8) : [];
  const selected = selectedId ? leaguesInUse().flatMap((l) => cached(l).list).find((e) => e.id === selectedId) : null;
  return Widget.vstack([
    Widget.textField(`Search ${leagueOf(league).name} teams`, query, "query", null, { label: "Follow a team", keyboard: "search" }),
    matches.length ? Widget.list(matches.map((t) => ({ title: t.name, subtitle: t.abbr, symbol: "plus.circle.fill", color: "green", args: { team: t, league } })), { action: "follow" }) : null,
    query && !matches.length ? Widget.text(cached(league).list.length ? "No team matches. Switch league in Today if it plays elsewhere." : "Load the league first with Refresh.", { font: "footnote", color: "secondary" }) : null,
    selected ? matchCard(selected, followed().find((t) => involves(selected, t)) ?? null) : null,
    ...followed().map(teamSection),
    followed().length === 0 ? Widget.text("Follow a team to see its next fixtures, results and form here and in the widget.", { color: "secondary", align: "center", padding: 12 }) : null,
  ], { alignment: "leading", spacing: 14 });
}

function settingsTab() {
  const s = settings();
  const error = Storage.get("lastError");
  return Widget.vstack([
    Widget.card([
      Widget.toggle("Full-time notifications", s.notify, "setting", { key: "notify" }, { color: "green" }),
      Widget.stepper(`Calendar alert ${s.alarm} min before`, s.alarm, "setting", { key: "alarm" }, { min: 0, max: 120, step: 5 }),
    ], { title: "Alerts", symbol: "bell.fill", color: "orange" }),
    Widget.card([
      Widget.text("Set the widget Parameter to a team name to feature that team; otherwise the first followed team is shown.", { font: "footnote" }),
      Widget.text("Widgets refresh about every 5 minutes during a live game and every 30 minutes otherwise.", { font: "footnote", color: "secondary" }),
    ], { title: "Widget", symbol: "square.grid.2x2", color: "blue" }),
    Widget.card([
      Widget.text(`Cached games: ${leaguesInUse().map((l) => `${leagueOf(l).short} ${cached(l).list.length}`).join(" · ")}`, { font: "footnote" }),
      error ? Widget.text(`Last problem: ${error.message}`, { font: "footnote", color: "orange" }) : Widget.text("Data: ESPN public scoreboard (site.api.espn.com).", { font: "footnote", color: "secondary" }),
      Widget.button("Clear cached games", "clear", null, { style: "bordered", color: "red" }),
    ], { title: "Data", symbol: "externaldrive", color: "gray" }),
  ], { alignment: "leading", spacing: 14 });
}

Script.ui(async () => {
  if (!loadedOnce) {
    loadedOnce = true;
    const stale = leaguesInUse().some((l) => Date.now() - cached(l).time > FRESH_IDLE);
    if (stale && !Script.env.lowPowerMode) await refresh({ wide: true });
  }
  const liveCount = leaguesInUse().reduce((n, l) => n + cached(l).list.filter((e) => e.state === "in").length, 0);
  const updated = Math.max(0, ...leaguesInUse().map((l) => cached(l).time));
  return {
    title: "Match Day",
    content: Widget.vstack([
      Widget.hstack([
        Widget.button(busy ? "Refreshing…" : "Refresh", "refresh", null, { style: "prominent", color: GREEN }),
        liveCount ? Widget.text(`${liveCount} live`, { font: "caption", weight: "bold", color: LIVE }) : null,
        Widget.spacer(),
        updated ? Widget.hstack([Widget.text("Updated", { font: "caption2", color: "secondary" }), Widget.date(updated, { style: "relative", font: "caption2", color: "secondary" })], { spacing: 3 }) : null,
      ], { spacing: 10 }),
      Widget.tabs([
        { title: "Today", symbol: "calendar", content: todayTab() },
        { title: "My Teams", symbol: "star.fill", content: teamsTab() },
        { title: "Settings", symbol: "gearshape.fill", content: settingsTab() },
      ], { selected: tab, action: "tab" }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});
