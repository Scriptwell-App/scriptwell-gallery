// @name        Repo Stats
// @description Stars, forks and open issues for any GitHub repository
// @permissions network
// @widget      small, medium
// @icon        chevron.left.forwardslash.chevron.right
// @color       #24292F
// @version     1.0.0
// @author      va4w
// @category    developer-tools

// Put "owner/repo" in the widget's Parameter field.
const DEFAULT_REPO = "swiftlang/swift";

async function load(name) {
  const key = `repo:${name}`;
  const cached = Storage.get(key);
  // GitHub allows 60 anonymous requests an hour, so reuse an answer for 20 minutes.
  if (cached && Date.now() - cached.time < 20 * 60 * 1000) return cached;
  try {
    const response = await fetch(`https://api.github.com/repos/${name}`, { headers: { Accept: "application/vnd.github+json" }, timeout: 6000 });
    if (response.status === 404) throw new Error(`No repository named ${name}`);
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const repo = await response.json();
    const fresh = {
      name: repo.name, owner: repo.owner.login, url: repo.html_url, language: repo.language,
      stars: repo.stargazers_count, forks: repo.forks_count, issues: repo.open_issues_count, time: Date.now(),
    };
    Storage.set(key, fresh);
    return fresh;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

const compact = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));

const stat = (symbol, emoji, value, color) => Widget.hstack([
  Widget.symbol(symbol, { size: 13, color, fallback: emoji }),
  Widget.text(compact(value), { font: "subheadline", weight: "semibold" }),
], { spacing: 4 });

Script.widget(async ({ family, parameter }) => {
  const repo = await load((parameter ?? DEFAULT_REPO).trim());
  return {
    content: Widget.vstack([
      Widget.text(repo.name, { font: "headline", lineLimit: 1, minimumScale: 0.7 }),
      Widget.text(repo.owner, { font: "caption", color: "secondary", lineLimit: 1 }),
      Widget.spacer(),
      family === "small"
        ? Widget.vstack([stat("star.fill", "⭐️", repo.stars, "yellow"), stat("arrow.triangle.branch", "⑂", repo.forks, "secondary")], { alignment: "leading", spacing: 4 })
        : Widget.hstack([
            stat("star.fill", "⭐️", repo.stars, "yellow"),
            stat("arrow.triangle.branch", "⑂", repo.forks, "secondary"),
            stat("exclamationmark.circle", "!", repo.issues, "green"),
            Widget.spacer(),
            repo.language ? Widget.text(repo.language, { font: "caption", color: "secondary" }) : null,
          ], { spacing: 14 }),
    ], { alignment: "leading", spacing: 2, url: repo.url, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    refreshAfter: 30 * 60,
  };
});

Script.run(async (input) => {
  const name = (input ?? DEFAULT_REPO).trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(name)) return 'Pass a repository as "owner/repo", for example "swiftlang/swift".';
  const repo = await load(name);
  return `${repo.owner}/${repo.name}: ${repo.stars} stars, ${repo.forks} forks, ${repo.issues} open issues`;
});
