// @name        Bluesky Stats
// @description Followers and posts for any Bluesky account, with the change since yesterday
// @permissions network
// @widget      small, medium
// @icon        at.circle.fill
// @color       #0085FF
// @version     1.0.0
// @author      scriptwell
// @category    social-networking

// Put a handle such as "bsky.app" in the widget's Parameter field, or set
// one in the app. Uses Bluesky's public API: no login and no key.

const DEFAULT = "bsky.app";
// "@name.bsky.social" → "name.bsky.social"; anything that is not a handle → null.
const clean = (text) => { const h = String(text ?? "").trim().replace(/^@/, "").toLowerCase(); return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : null; };
const handle = (parameter) => clean(parameter) ?? Storage.get("handle", DEFAULT);

async function stats(who) {
  const day = new Date().toLocaleDateString("en-CA");
  const saved = Storage.get(`stats:${who}`);
  try {
    const response = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(who)}`, { timeout: 8000 });
    if (response.status === 400) return { handle: who, missing: true };
    if (!response.ok) throw new Error(`Bluesky answered ${response.status}`);
    const p = await response.json();
    // The first count seen each day is what "today" is measured against.
    const base = saved?.day === day ? saved.base : (saved?.followers ?? p.followersCount ?? 0);
    const fresh = { handle: p.handle, name: p.displayName || p.handle, followers: p.followersCount ?? 0, following: p.followsCount ?? 0, posts: p.postsCount ?? 0, day, base, time: Date.now() };
    Storage.set(`stats:${who}`, fresh);
    return fresh;
  } catch (error) {
    if (saved) return { ...saved, offline: true };
    throw error;
  }
}

const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : n.toLocaleString());
const change = (s) => { const d = s.followers - s.base; return d === 0 ? "no change today" : `${d > 0 ? "+" : "−"}${compact(Math.abs(d))} today`; };

Script.widget(async ({ family, parameter }) => {
  const s = await stats(handle(parameter));
  if (s.missing) return Widget.text(`No Bluesky account called ${s.handle}`, { font: "caption", color: "secondary", align: "center" });

  const main = Widget.vstack([
    Widget.hstack([Widget.symbol("at.circle.fill", { size: 15, color: "blue", fallback: "🦋" }), Widget.text(s.name, { font: "caption", weight: "semibold", lineLimit: 1 })], { spacing: 4 }),
    Widget.text(compact(s.followers), { font: 36, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
    Widget.text("followers", { font: "caption2", color: "secondary" }),
    Widget.text(s.offline ? "offline" : change(s), { font: "caption2", color: s.offline ? "orange" : s.followers >= s.base ? "green" : "red" }),
  ], { spacing: 2 });

  return {
    content: family === "small" ? main : Widget.hstack([
      main,
      Widget.vstack([
        Widget.text(`${compact(s.posts)} posts`, { font: "subheadline" }),
        Widget.text(`${compact(s.following)} following`, { font: "subheadline" }),
        Widget.text(`@${s.handle}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
      ], { alignment: "leading", spacing: 5 }),
    ], { spacing: 24 }),
    refreshAfter: 30 * 60,
  };
});

Script.action("change", async () => {
  const answer = await UI.prompt({ title: "Bluesky handle", placeholder: "name.bsky.social", defaultValue: handle() });
  if (answer === null) return;
  if (!clean(answer)) { await UI.alert({ title: "Not a handle", message: "Write it like name.bsky.social." }); return; }
  Storage.set("handle", clean(answer));
});
Script.action("open", () => UI.openURL(`https://bsky.app/profile/${handle()}`));
Script.action("refresh", () => {});

Script.ui(async () => {
  const s = await stats(handle());
  const stat = (label, value) => Widget.vstack([Widget.text(value, { font: "title2", weight: "bold", design: "rounded" }), Widget.text(label, { font: "caption", color: "secondary" })], { spacing: 2, frame: { maxWidth: "infinity" } });
  return {
    title: "Bluesky",
    content: Widget.vstack(s.missing ? [
      Widget.text(`There is no account called ${s.handle}.`, { color: "secondary", align: "center" }),
      Widget.button("Choose an account", "change", null, { style: "prominent", color: "blue" }),
    ] : [
      Widget.text(s.name, { font: "title2", weight: "bold" }),
      Widget.text(`@${s.handle}`, { color: "secondary" }),
      Widget.hstack([stat("followers", compact(s.followers)), stat("following", compact(s.following)), stat("posts", compact(s.posts))]),
      Widget.text(s.offline ? "Offline. Showing the last numbers." : `Followers: ${change(s)}`, { font: "subheadline", color: s.offline ? "orange" : "secondary" }),
      Widget.hstack([
        Widget.button("Open profile", "open", null, { style: "bordered" }),
        Widget.button("Update", "refresh", null, { style: "bordered" }),
      ], { spacing: 10 }),
      Widget.button("Change account", "change", null, { color: "secondary" }),
    ], { spacing: 12, padding: 20 }),
  };
});

Script.run(async (input) => {
  const s = await stats(handle(input));
  return s.missing ? `There is no Bluesky account called ${s.handle}.` : `${s.name} (@${s.handle}): ${s.followers.toLocaleString()} followers, ${s.posts.toLocaleString()} posts, ${change(s)}.`;
});
