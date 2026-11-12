// @name        Mastodon Stats
// @description Followers and posts for any Mastodon account, with the change since yesterday
// @permissions network
// @widget      small, medium
// @icon        bubble.left.and.bubble.right.fill
// @color       #6364FF
// @version     1.0.0
// @author      va4w
// @category    social-networking

// Put an address such as "Mastodon@mastodon.social" in the widget's Parameter
// field, or set one in the app. Uses the server's public API: no login.

const DEFAULT = "Mastodon@mastodon.social";
// "@name@server.tld" → { user, server }; anything else → null.
function clean(text) {
  const match = /^@?([a-z0-9_]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i.exec(String(text ?? "").trim());
  return match ? { user: match[1], server: match[2].toLowerCase() } : null;
}
const account = (parameter) => clean(parameter) ?? clean(Storage.get("account", DEFAULT));
const address = (a) => `${a.user}@${a.server}`;

async function stats(who) {
  const day = new Date().toLocaleDateString("en-CA");
  const key = `stats:${address(who).toLowerCase()}`;
  const saved = Storage.get(key);
  try {
    const response = await fetch(`https://${who.server}/api/v1/accounts/lookup?acct=${encodeURIComponent(who.user)}`, { timeout: 8000 });
    if (response.status === 404) return { address: address(who), missing: true };
    if (!response.ok) throw new Error(`${who.server} answered ${response.status}`);
    const p = await response.json();
    // The first count seen each day is what "today" is measured against.
    const base = saved?.day === day ? saved.base : (saved?.followers ?? p.followers_count ?? 0);
    const fresh = { address: address(who), name: p.display_name || p.username, followers: p.followers_count ?? 0, following: p.following_count ?? 0, posts: p.statuses_count ?? 0, url: p.url, day, base };
    Storage.set(key, fresh);
    return fresh;
  } catch (error) {
    if (saved) return { ...saved, offline: true };
    throw error;
  }
}

const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : n.toLocaleString());
const change = (s) => { const d = s.followers - s.base; return d === 0 ? "no change today" : `${d > 0 ? "+" : "−"}${compact(Math.abs(d))} today`; };

Script.widget(async ({ family, parameter }) => {
  const s = await stats(account(parameter));
  if (s.missing) return Widget.text(`No account at ${s.address}`, { font: "caption", color: "secondary", align: "center" });

  const main = Widget.vstack([
    Widget.text(s.name, { font: "caption", weight: "semibold", color: "indigo", lineLimit: 1 }),
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
        Widget.text(`@${s.address}`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
      ], { alignment: "leading", spacing: 5 }),
    ], { spacing: 24 }),
    refreshAfter: 30 * 60,
  };
});

Script.action("change", async () => {
  const answer = await UI.prompt({ title: "Mastodon address", placeholder: "name@mastodon.social", defaultValue: address(account()) });
  if (answer === null) return;
  if (!clean(answer)) { await UI.alert({ title: "Not an address", message: "Write it like name@mastodon.social." }); return; }
  Storage.set("account", address(clean(answer)));
});
Script.action("open", ({ url }) => UI.openURL(url));
Script.action("refresh", () => {});

Script.ui(async () => {
  const s = await stats(account());
  const stat = (label, value) => Widget.vstack([Widget.text(value, { font: "title2", weight: "bold", design: "rounded" }), Widget.text(label, { font: "caption", color: "secondary" })], { spacing: 2, frame: { maxWidth: "infinity" } });
  return {
    title: "Mastodon",
    content: Widget.vstack(s.missing ? [
      Widget.text(`There is no account at ${s.address}.`, { color: "secondary", align: "center" }),
      Widget.button("Choose an account", "change", null, { style: "prominent", color: "indigo" }),
    ] : [
      Widget.text(s.name, { font: "title2", weight: "bold" }),
      Widget.text(`@${s.address}`, { color: "secondary" }),
      Widget.hstack([stat("followers", compact(s.followers)), stat("following", compact(s.following)), stat("posts", compact(s.posts))]),
      Widget.text(s.offline ? "Offline. Showing the last numbers." : `Followers: ${change(s)}`, { font: "subheadline", color: s.offline ? "orange" : "secondary" }),
      Widget.hstack([
        Widget.button("Open profile", "open", { url: s.url }, { style: "bordered" }),
        Widget.button("Update", "refresh", null, { style: "bordered" }),
      ], { spacing: 10 }),
      Widget.button("Change account", "change", null, { color: "secondary" }),
    ], { spacing: 12, padding: 20 }),
  };
});

Script.run(async (input) => {
  const s = await stats(account(input));
  return s.missing ? `There is no Mastodon account at ${s.address}.` : `${s.name} (@${s.address}): ${s.followers.toLocaleString()} followers, ${s.posts.toLocaleString()} posts, ${change(s)}.`;
});
