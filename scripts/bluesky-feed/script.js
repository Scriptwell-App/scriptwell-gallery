// @name        Bluesky Feed
// @description Follow Bluesky accounts, searches and custom feeds without logging in, using the public API at public.api.bsky.app: post cards with pictures and counts, a profile header with a posting sparkline, and widgets with the latest posts or follower growth.
// @permissions network
// @widget      small, medium, large, extraLarge
// @icon        cloud.fill
// @color       #1185FE
// @version     1.0.0
// @author      scriptwell
// @category    social-networking

// How it works
// • Everything comes from Bluesky's public, read-only API at public.api.bsky.app. No account, no login and no
//   token: the only things sent are the handle, search words or feed address you typed.
// • The mini-app keeps a list of sources (handles, searches and custom feeds), one tab each. Post cards show the
//   avatar, name, text, time, like/repost/reply counts and image thumbnails; tapping one opens it on bsky.app.
//   Handles also get a profile header with follower, following and post counts and a 7-day posting sparkline.
// • Widget parameter: the handle to show, for example "bsky.app" (the first handle in the app if empty).
//   Small shows the follower count and the change since yesterday (the count is stored once a day), medium
//   shows the latest post, large three posts, extra large the profile and four posts.
// • Pictures are loaded from Bluesky's image servers; turn them off in the app if you prefer text only.

// ───────────────────────────────────────────── Constants

const API = "https://public.api.bsky.app/xrpc/";
const DAY = 86_400_000;
const FRESH_APP = 5 * 60 * 1000;
const FRESH_WIDGET = 15 * 60 * 1000;
const POST_LIMIT = 15;
const HISTORY_DAYS = 14;
const BLUE = "#1185FE";
const TILE_BG = { light: "#F1F5F9", dark: "#1E293B" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────────────────────────── Storage

const sources = () => Storage.get("sources", [{ id: "handle:bsky.app", type: "handle", value: "bsky.app" }]);
const settings = () => ({ images: true, ...Storage.get("settings", {}) });
const ui = () => Storage.get("ui", { selected: 0, addType: "handle" });
const setUi = (changes) => Storage.set("ui", { ...ui(), ...changes });

const cleanHandle = (text) => String(text ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/bsky\.app\/profile\//, "").replace(/\/.*$/, "").toLowerCase();
const sourceKey = (s) => `${s.type}:${s.value}`;
const sourceLabel = (s) => (s.type === "handle" ? `@${s.value.split(".")[0]}` : s.type === "search" ? `“${s.value}”` : s.label ?? "Feed");

function rememberFollowers(handle, count) {
  const key = `followers:${handle}`;
  const history = Storage.get(key, {});
  history[new Date().toLocaleDateString("en-CA")] = count;
  const cutoff = new Date(Date.now() - HISTORY_DAYS * DAY).toLocaleDateString("en-CA");
  for (const day of Object.keys(history)) if (day < cutoff) delete history[day];
  Storage.set(key, history);
}

// Today's count against the newest earlier day we have.
function followerChange(handle) {
  const history = Storage.get(`followers:${handle}`, {});
  const days = Object.keys(history).sort();
  const todayKey = new Date().toLocaleDateString("en-CA");
  const earlier = days.filter((d) => d < todayKey);
  if (!earlier.length || history[todayKey] == null) return null;
  const base = earlier[earlier.length - 1];
  return { delta: history[todayKey] - history[base], since: base };
}

// ───────────────────────────────────────────── Bluesky API

async function api(method, params) {
  const url = new URL(API + method);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { timeout: Script.env.mode === "widget" ? 6000 : 12000, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(response.status === 400 ? "Bluesky does not know that handle or feed" : `Bluesky answered ${response.status}`);
  return response.json();
}

function compactPost(item) {
  const post = item.post ?? item;
  const rkey = String(post.uri ?? "").split("/").pop();
  const embed = post.embed ?? {};
  const images = (embed.images ?? embed.media?.images ?? []).map((i) => i.thumb).filter(Boolean).slice(0, 4);
  return {
    uri: post.uri,
    handle: post.author?.handle ?? "",
    name: post.author?.displayName || post.author?.handle || "",
    avatar: post.author?.avatar ?? null,
    text: String(post.record?.text ?? "").slice(0, 700),
    at: post.record?.createdAt ?? post.indexedAt,
    likes: post.likeCount ?? 0,
    reposts: post.repostCount ?? 0,
    replies: post.replyCount ?? 0,
    images,
    repost: Boolean(item.reason),
    url: `https://bsky.app/profile/${post.author?.handle}/post/${rkey}`,
  };
}

function compactProfile(p) {
  return {
    handle: p.handle, name: p.displayName || p.handle, avatar: p.avatar ?? null, banner: p.banner ?? null,
    description: String(p.description ?? "").slice(0, 300),
    followers: p.followersCount ?? 0, following: p.followsCount ?? 0, posts: p.postsCount ?? 0,
  };
}

async function fetchSource(source) {
  if (source.type === "handle") {
    const [profile, feed] = await Promise.all([
      api("app.bsky.actor.getProfile", { actor: source.value }),
      api("app.bsky.feed.getAuthorFeed", { actor: source.value, limit: POST_LIMIT, filter: "posts_no_replies" }),
    ]);
    const data = { time: Date.now(), profile: compactProfile(profile), posts: (feed.feed ?? []).map(compactPost) };
    rememberFollowers(source.value, data.profile.followers);
    return data;
  }
  if (source.type === "search") {
    const result = await api("app.bsky.feed.searchPosts", { q: source.value, limit: POST_LIMIT });
    return { time: Date.now(), posts: (result.posts ?? []).map(compactPost) };
  }
  const result = await api("app.bsky.feed.getFeed", { feed: source.value, limit: POST_LIMIT });
  return { time: Date.now(), posts: (result.feed ?? []).map(compactPost) };
}

// Fresh if young enough; otherwise fetch, and fall back to the cache when offline.
async function load(source, maxAge) {
  const key = `cache:${sourceKey(source)}`;
  const cached = Storage.get(key);
  if (cached && Date.now() - cached.time < maxAge) return { ...cached, stale: false };
  try {
    const data = await fetchSource(source);
    Storage.set(key, data);
    return { ...data, stale: false };
  } catch (error) {
    if (cached) return { ...cached, stale: true, error: error.message };
    throw error;
  }
}

// ───────────────────────────────────────────── Formatting

const compactNumber = (n) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
};

function timeAgo(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(iso).toLocaleDateString(Script.env.locale, { day: "numeric", month: "short" });
}

// Posts per day over the last 7 days, oldest first.
function activity(posts) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * DAY);
    return { key: d.toLocaleDateString("en-CA"), x: d.toLocaleDateString(Script.env.locale, { weekday: "narrow" }), y: 0 };
  });
  for (const post of posts) {
    if (post.repost) continue;
    const key = new Date(post.at).toLocaleDateString("en-CA");
    const day = days.find((d) => d.key === key);
    if (day) day.y += 1;
  }
  return days;
}

function avatar(src, size) {
  if (src && settings().images) return Widget.image({ src, size, cornerRadius: size / 2, contentMode: "fill" });
  return Widget.symbol("person.crop.circle.fill", { size, color: "secondary", fallback: "👤" });
}

function counts(post, font = "caption2") {
  const item = (symbol, n, fallback) => Widget.hstack([
    Widget.symbol(symbol, { size: 10, color: "secondary", fallback }),
    Widget.text(compactNumber(n), { font, color: "secondary" }),
  ], { spacing: 3 });
  return Widget.hstack([
    item("bubble.left", post.replies, "💬"),
    item("arrow.2.squarepath", post.reposts, "🔁"),
    item("heart", post.likes, "♥"),
  ], { spacing: 12 });
}

function thumbnails(post, size) {
  if (!settings().images || !post.images.length) return null;
  return Widget.hstack(post.images.slice(0, 2).map((src) => Widget.image({ src, size, cornerRadius: 8, contentMode: "fill" })), { spacing: 6 });
}

// ───────────────────────────────────────────── Widget

function widgetPost(post, { lines, thumb, font = "footnote" }) {
  return Widget.vstack([
    Widget.hstack([
      avatar(post.avatar, 18),
      Widget.text(post.name, { font: "caption", weight: "semibold", lineLimit: 1 }),
      Widget.text(`@${post.handle}`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
      Widget.spacer(),
      Widget.date(post.at, { style: "relative", font: "caption2", color: "secondary" }),
    ], { spacing: 5 }),
    Widget.text(post.text || "(picture only)", { font, lineLimit: lines, minimumScale: 0.9 }),
    Widget.hstack([
      thumb ? thumbnails(post, thumb) : null,
      Widget.spacer(),
      counts(post),
    ], { spacing: 6, alignment: "bottom" }),
  ], { alignment: "leading", spacing: 4, padding: 8, background: TILE_BG, cornerRadius: 10, url: post.url, frame: { maxWidth: "infinity", alignment: "leading" } });
}

function profileStrip(profile, change, size = "headline") {
  return Widget.hstack([
    avatar(profile.avatar, size === "headline" ? 34 : 44),
    Widget.vstack([
      Widget.text(profile.name, { font: size, weight: "bold", lineLimit: 1 }),
      Widget.text(`@${profile.handle}`, { font: "caption", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 0 }),
    Widget.spacer(),
    Widget.vstack([
      Widget.text(compactNumber(profile.followers), { font: "headline", weight: "bold", design: "rounded", color: BLUE }),
      Widget.text(change ? `${change.delta >= 0 ? "+" : ""}${change.delta} today` : "followers", { font: "caption2", color: change && change.delta > 0 ? "green" : change && change.delta < 0 ? "red" : "secondary" }),
    ], { alignment: "trailing", spacing: 0 }),
  ], { spacing: 8 });
}

function widgetProblem(message, family) {
  return Widget.vstack([
    Widget.symbol("cloud.fill", { size: family === "small" ? 26 : 34, color: BLUE, fallback: "🦋" }),
    Widget.text(message, { font: "caption", color: "secondary", align: "center", lineLimit: 4, minimumScale: 0.7 }),
  ], { spacing: 6, url: APP_LINK });
}

Script.widget(async ({ family, parameter }) => {
  const handle = cleanHandle(parameter) || sources().find((s) => s.type === "handle")?.value || "bsky.app";
  const source = { type: "handle", value: handle };
  let data;
  try {
    data = await load(source, FRESH_WIDGET);
  } catch (error) {
    return { content: widgetProblem(`@${handle}: ${error.message}`, family), refreshAfter: 15 * 60 };
  }
  const profile = data.profile;
  const own = data.posts.filter((p) => !p.repost);
  const posts = own.length ? own : data.posts;
  const change = followerChange(handle);
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const footer = Widget.hstack([
    data.stale ? Widget.symbol("wifi.slash", { size: 9, color: "orange", fallback: "⚠️" }) : null,
    Widget.text(data.stale ? "offline · last updated" : "updated", { font: "caption2", color: "secondary" }),
    Widget.date(data.time, { style: "relative", font: "caption2", color: "secondary" }),
  ], { spacing: 3 });
  let content;

  if (family === "small") {
    content = Widget.vstack([
      Widget.hstack([avatar(profile.avatar, 28), Widget.spacer(), Widget.symbol("cloud.fill", { size: 14, color: BLUE, fallback: "🦋" })]),
      Widget.text(profile.name, { font: "subheadline", weight: "semibold", lineLimit: 1 }),
      Widget.text(`@${profile.handle}`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
      Widget.spacer(),
      Widget.text(compactNumber(profile.followers), { font: 32, weight: "bold", design: "rounded", color: BLUE, lineLimit: 1, minimumScale: 0.6 }),
      Widget.text("followers", { font: "caption2", color: "secondary" }),
      change
        ? Widget.hstack([
            Widget.symbol(change.delta >= 0 ? "arrow.up.right" : "arrow.down.right", { size: 10, color: change.delta >= 0 ? "green" : "red", fallback: change.delta >= 0 ? "↗" : "↘" }),
            Widget.text(`${change.delta >= 0 ? "+" : ""}${change.delta.toLocaleString(Script.env.locale)} since yesterday`, { font: "caption2", weight: "semibold", color: change.delta >= 0 ? "green" : "red", lineLimit: 1, minimumScale: 0.7 }),
          ], { spacing: 2 })
        : Widget.text("change shows from tomorrow", { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
    ], { alignment: "leading", spacing: 1, url: `https://bsky.app/profile/${profile.handle}`, frame: fill });
  } else if (family === "medium") {
    const post = posts[0];
    content = Widget.vstack([
      post ? widgetPost(post, { lines: 3, thumb: 36 }) : Widget.text("No posts yet", { color: "secondary" }),
      Widget.spacer(),
      Widget.hstack([
        Widget.text(`@${profile.handle} · ${compactNumber(profile.followers)} followers`, { font: "caption2", color: "secondary", lineLimit: 1 }),
        Widget.spacer(),
        footer,
      ]),
    ], { alignment: "leading", spacing: 4, url: APP_LINK, frame: fill });
  } else if (family === "large") {
    content = Widget.vstack([
      profileStrip(profile, change),
      ...posts.slice(0, 3).map((post) => widgetPost(post, { lines: 3, thumb: 40 })),
      posts.length === 0 ? Widget.text("No posts yet", { color: "secondary" }) : null,
      Widget.spacer(),
      footer,
    ], { alignment: "leading", spacing: 6, url: APP_LINK, frame: fill });
  } else {
    const column = (list) => Widget.vstack(list.map((post) => widgetPost(post, { lines: 4, thumb: 48, font: "subheadline" })), { spacing: 8, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
    content = Widget.vstack([
      Widget.hstack([
        profileStrip(profile, change, "title3"),
        Widget.spacer(),
        Widget.vstack([
          Widget.text("LAST 7 DAYS", { font: "caption2", weight: "bold", color: "secondary" }),
          Widget.chart(activity(data.posts), { kind: "bar", axes: false, color: BLUE, frame: { width: 120, height: 36 } }),
        ], { alignment: "leading", spacing: 2 }),
      ], { spacing: 16, alignment: "center" }),
      Widget.hstack([column(posts.slice(0, 2)), column(posts.slice(2, 4))], { spacing: 8, alignment: "top" }),
      Widget.spacer(),
      footer,
    ], { alignment: "leading", spacing: 8, url: APP_LINK, frame: fill });
  }

  return { content, refreshAfter: 15 * 60 };
});

// ───────────────────────────────────────────── Mini-app actions

Script.action("select", ({ value }) => setUi({ selected: Number(value) }));
Script.action("addType", ({ value }) => setUi({ addType: value }));

Script.action("add", async ({ value }) => {
  const type = ui().addType ?? "handle";
  let text = String(value ?? "").trim();
  if (!text) return;
  let source;
  if (type === "handle") {
    const handle = cleanHandle(text);
    if (!handle.includes(".")) { await UI.alert({ title: "Full handle needed", message: "Bluesky handles look like name.bsky.social or a domain." }); return; }
    source = { type, value: handle };
  } else if (type === "search") {
    source = { type, value: text };
  } else {
    // Accept an at:// URI or a https://bsky.app/profile/<did or handle>/feed/<rkey> link.
    const link = /bsky\.app\/profile\/([^/]+)\/feed\/([^/?#]+)/.exec(text);
    if (link) text = `at://${link[1]}/app.bsky.feed.generator/${link[2]}`;
    if (!text.startsWith("at://")) { await UI.alert({ title: "Feed address needed", message: "Paste the feed's bsky.app link or its at:// address." }); return; }
    source = { type, value: text, label: `Feed ${text.split("/").pop()}` };
  }
  source.id = sourceKey(source);
  const list = sources();
  if (list.some((s) => s.id === source.id)) { setUi({ selected: list.findIndex((s) => s.id === source.id) }); return; }
  setUi({ selected: list.length, loading: true });
  Storage.set("sources", [...list, source]);
  try {
    await load(source, 0);
    await UI.haptic("success");
  } catch (error) {
    await UI.alert({ title: "Could not load", message: error.message });
  }
  setUi({ loading: false });
});

Script.action("remove", async () => {
  const list = sources();
  const current = list[ui().selected];
  if (!current) return;
  const choice = await UI.alert({ title: `Remove ${sourceLabel(current)}?`, buttons: ["Cancel", "Remove"] });
  if (choice !== 1) return;
  Storage.remove(`cache:${current.id}`);
  Storage.set("sources", list.filter((s) => s.id !== current.id));
  setUi({ selected: 0 });
});

Script.action("refresh", async () => {
  const current = sources()[ui().selected];
  if (!current) return;
  try { await load(current, 0); await UI.haptic("light"); } catch (error) { await UI.alert({ title: "Could not refresh", message: error.message }); }
});

Script.action("images", ({ isOn }) => Storage.set("settings", { ...settings(), images: isOn }));
Script.action("open", ({ url }) => UI.openURL(url));

// ───────────────────────────────────────────── Mini-app pieces

function postCard(post) {
  return Widget.vstack([
    Widget.hstack([
      avatar(post.avatar, 40),
      Widget.vstack([
        Widget.hstack([
          Widget.text(post.name, { font: "subheadline", weight: "semibold", lineLimit: 1 }),
          post.repost ? Widget.symbol("arrow.2.squarepath", { size: 11, color: "secondary", fallback: "🔁" }) : null,
        ], { spacing: 4 }),
        Widget.text(`@${post.handle} · ${timeAgo(post.at)}`, { font: "caption", color: "secondary", lineLimit: 1 }),
      ], { alignment: "leading", spacing: 1 }),
      Widget.spacer(),
    ], { spacing: 10 }),
    post.text ? Widget.text(post.text, { font: "body", lineLimit: 12 }) : null,
    settings().images && post.images.length
      ? Widget.hstack(post.images.slice(0, 3).map((src) => Widget.image({ src, size: post.images.length === 1 ? 240 : 100, cornerRadius: 10, contentMode: "fill" })), { spacing: 6 })
      : null,
    Widget.hstack([counts(post, "caption"), Widget.spacer(), Widget.symbol("arrow.up.right.square", { size: 12, color: "secondary", fallback: "↗" })]),
  ], { alignment: "leading", spacing: 8, padding: 12, background: TILE_BG, cornerRadius: 14, url: post.url });
}

function profileHeader(profile, posts) {
  const change = followerChange(profile.handle);
  const stat = (n, label) => Widget.vstack([
    Widget.text(n.toLocaleString(Script.env.locale), { font: "headline", weight: "bold", design: "rounded" }),
    Widget.text(label, { font: "caption2", color: "secondary" }),
  ], { spacing: 0 });
  const week = activity(posts);
  const total = week.reduce((sum, d) => sum + d.y, 0);
  return Widget.vstack([
    Widget.hstack([
      avatar(profile.avatar, 56),
      Widget.vstack([
        Widget.text(profile.name, { font: "title3", weight: "bold", lineLimit: 1 }),
        Widget.text(`@${profile.handle}`, { font: "subheadline", color: "secondary", lineLimit: 1 }),
        change ? Widget.text(`${change.delta >= 0 ? "+" : ""}${change.delta.toLocaleString(Script.env.locale)} followers since ${change.since === new Date(Date.now() - DAY).toLocaleDateString("en-CA") ? "yesterday" : change.since}`, { font: "caption", color: change.delta >= 0 ? "green" : "red" }) : null,
      ], { alignment: "leading", spacing: 1 }),
      Widget.spacer(),
    ], { spacing: 12 }),
    profile.description ? Widget.text(profile.description, { font: "footnote", color: "secondary", lineLimit: 4 }) : null,
    Widget.hstack([stat(profile.followers, "followers"), stat(profile.following, "following"), stat(profile.posts, "posts")], { spacing: 24 }),
    Widget.vstack([
      Widget.text(`${total} post${total === 1 ? "" : "s"} in the last 7 days`, { font: "caption", color: "secondary" }),
      Widget.chart(week.map(({ x, y }) => ({ x, y })), { kind: "bar", color: BLUE, axes: false, frame: { height: 56 } }),
    ], { alignment: "leading", spacing: 2 }),
  ], { alignment: "leading", spacing: 10, padding: 14, background: { light: "#1185FE14", dark: "#1185FE2E" }, cornerRadius: 16, url: `https://bsky.app/profile/${profile.handle}` });
}

function addRow() {
  const type = ui().addType ?? "handle";
  const placeholder = { handle: "name.bsky.social", search: "words to search for", feed: "bsky.app/profile/…/feed/… or at://…" }[type];
  return Widget.vstack([
    Widget.picker([{ label: "Handle", value: "handle" }, { label: "Search", value: "search" }, { label: "Custom feed", value: "feed" }], type, "addType", null, { style: "segmented" }),
    Widget.textField(placeholder, "", "add", null, { keyboard: type === "feed" ? "url" : type === "search" ? "search" : "default" }),
  ], { alignment: "leading", spacing: 8 });
}

async function sourcePane(source) {
  if (!source) return Widget.text("Add a handle, a search or a feed below.", { color: "secondary", padding: 20 });
  let data;
  try {
    data = await load(source, FRESH_APP);
  } catch (error) {
    return Widget.vstack([
      Widget.symbol("wifi.exclamationmark", { size: 36, color: "orange", fallback: "⚠️" }),
      Widget.text(`Could not load ${sourceLabel(source)}`, { font: "headline" }),
      Widget.text(error.message, { font: "footnote", color: "secondary", align: "center" }),
      Widget.button("Try again", "refresh", null, { style: "bordered" }),
    ], { spacing: 8, padding: 24, frame: { maxWidth: "infinity" } });
  }
  return Widget.vstack([
    data.profile ? profileHeader(data.profile, data.posts) : null,
    Widget.hstack([
      data.stale ? Widget.symbol("wifi.slash", { size: 11, color: "orange", fallback: "⚠️" }) : null,
      Widget.text(data.stale ? `Offline, showing posts from ${timeAgo(data.time)} ago` : `Updated ${timeAgo(data.time)} ago`, { font: "caption", color: data.stale ? "orange" : "secondary" }),
      Widget.spacer(),
      Widget.button("Refresh", "refresh", null, { style: "plain" }),
    ], { spacing: 4 }),
    ...data.posts.map(postCard),
    data.posts.length === 0 ? Widget.text("No posts here yet.", { color: "secondary", padding: 20 }) : null,
  ], { alignment: "leading", spacing: 12 });
}

Script.ui(async () => {
  const list = sources();
  const state = ui();
  const selected = Math.min(state.selected ?? 0, Math.max(0, list.length - 1));
  const current = list[selected];

  const pane = state.loading
    ? Widget.vstack([Widget.progress(0.5, { style: "ring", color: BLUE }), Widget.text("Loading…", { color: "secondary" })], { spacing: 8, padding: 24, frame: { maxWidth: "infinity" } })
    : await sourcePane(current);

  // Up to six sources fit in a segmented control; beyond that a menu picks the source and the pane sits below.
  const symbolFor = (s) => (s.type === "handle" ? "person" : s.type === "search" ? "magnifyingglass" : "list.bullet.rectangle");
  const body = list.length === 0
    ? pane
    : list.length <= 6
      ? Widget.tabs(list.map((s, i) => ({ title: sourceLabel(s), symbol: symbolFor(s), content: i === selected ? pane : Widget.text("Loading…", { color: "secondary", padding: 20 }) })), { selected, action: "select" })
      : Widget.vstack([
          Widget.picker(list.map((s, i) => ({ label: `${s.type === "search" ? "Search " : s.type === "feed" ? "Feed " : "@"}${s.value}`, value: i })), selected, "select"),
          pane,
        ], { alignment: "leading", spacing: 12 });

  return {
    title: current ? (current.type === "handle" ? `@${current.value}` : current.type === "search" ? `Search: ${current.value}` : current.label ?? "Feed") : "Bluesky Feed",
    content: Widget.vstack([
      body,
      Widget.divider(),
      Widget.text("ADD A SOURCE", { font: "caption2", weight: "bold", color: "secondary" }),
      addRow(),
      Widget.hstack([
        Widget.toggle("Show pictures", settings().images, "images", null, { color: "blue" }),
        Widget.spacer(),
        current ? Widget.button(`Remove ${sourceLabel(current)}`, "remove", null, { style: "bordered", color: "red" }) : null,
      ], { spacing: 8 }),
      Widget.text("Read-only, no login. Set a widget's Parameter to a handle such as bsky.app to show that account.", { font: "caption2", color: "secondary" }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});

// ───────────────────────────────────────────── Shortcuts and Siri

Script.run(async (input) => {
  const handle = cleanHandle(input) || sources().find((s) => s.type === "handle")?.value || "bsky.app";
  try {
    const data = await load({ type: "handle", value: handle }, FRESH_APP);
    const post = data.posts.find((p) => !p.repost) ?? data.posts[0];
    const change = followerChange(handle);
    return [
      `${data.profile.name} (@${handle}): ${data.profile.followers.toLocaleString(Script.env.locale)} followers${change ? ` (${change.delta >= 0 ? "+" : ""}${change.delta} since yesterday)` : ""}.`,
      post ? `Latest post, ${timeAgo(post.at)} ago: ${post.text || "(picture)"}` : "No posts yet.",
    ].join("\n");
  } catch (error) {
    return `Could not load @${handle}: ${error.message}`;
  }
});
