// @name        HN Top Story
// @description Shows the top story on Hacker News
// @icon        newspaper.fill
// @color       #FF6600
// @permissions network
// @widget      medium
// @version     1.0.0
// @author      scriptwell
// @category    utilities

const API = "https://hacker-news.firebaseio.com/v0";
const MAX_AGE = 15 * 60 * 1000; // refetch at most every 15 minutes

async function getJSON(url) {
  const response = await fetch(url, { timeout: 3500 });
  if (!response.ok) throw new Error(`Hacker News returned ${response.status}`);
  return response.json();
}

async function topStory(force = false) {
  const cached = Storage.get("story");
  if (!force && cached && Date.now() - cached.fetched < MAX_AGE) return cached;

  try {
    const ids = await getJSON(`${API}/topstories.json`);
    if (!Array.isArray(ids) || ids.length === 0) throw new Error("No stories found");
    const item = await getJSON(`${API}/item/${ids[0]}.json`);
    if (!item || !item.title) throw new Error("Story could not be read");

    const discussion = `https://news.ycombinator.com/item?id=${item.id}`;
    let host = "news.ycombinator.com";
    if (item.url) {
      try { host = new URL(item.url).hostname.replace(/^www\./, ""); } catch {}
    }

    const story = {
      id: item.id,
      title: item.title,
      url: item.url ?? discussion,
      discussion,
      host,
      score: item.score ?? 0,
      comments: item.descendants ?? 0,
      by: item.by ?? "unknown",
      time: (item.time ?? Date.now() / 1000) * 1000,
      fetched: Date.now(),
    };
    Storage.set("story", story);
    return story;
  } catch (error) {
    console.warn("Could not load:", error.message);
    if (cached) return { ...cached, stale: true }; // offline: show the last good story
    throw error;
  }
}

function header(story) {
  return Widget.hstack([
    Widget.text("Y", {
      font: 12, weight: "bold", color: "white",
      background: "#FF6600", cornerRadius: 3,
      frame: { width: 18, height: 18 },
    }),
    Widget.text("Top on Hacker News", { font: "caption", weight: "semibold", color: "#FF6600" }),
    Widget.spacer(),
    story?.stale ? Widget.symbol("wifi.slash", { size: 11, color: "secondary", fallback: "⚠️" }) : null,
  ], { spacing: 6 });
}

Script.widget(async () => {
  let story;
  try {
    story = await topStory();
  } catch (error) {
    return {
      // Error state: header, warning icon and the reason loading failed.
      content: Widget.vstack([
        header(null),
        Widget.spacer(),
        Widget.symbol("exclamationmark.triangle", { size: 22, color: "orange", fallback: "⚠️" }),
        Widget.text("Could not load Hacker News", { font: "subheadline", weight: "medium" }),
        Widget.text(error.message, { font: "caption2", color: "secondary", lineLimit: 2 }),
        Widget.spacer(),
      ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      refreshAfter: 15 * 60,
    };
  }

  return {
    content: Widget.vstack([
      header(story),
      Widget.text(story.title, { font: "headline", lineLimit: 3, minimumScale: 0.8 }),
      Widget.text(story.host, { font: "caption", color: "secondary", lineLimit: 1 }),
      Widget.spacer(),
      Widget.hstack([
        Widget.label(`${story.score}`, "arrow.up", { color: "#FF6600" }),
        Widget.label(`${story.comments}`, "bubble.left", { color: "secondary" }),
        Widget.text(`by ${story.by}`, { font: "caption", color: "secondary", lineLimit: 1 }),
        Widget.spacer(),
        Widget.date(story.time, { style: "relative", font: "caption2", color: "secondary", align: "trailing" }),
      ], { spacing: 10 }),
    ], {
      alignment: "leading",
      spacing: 4,
      url: story.url,
      frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" },
    }),
    refreshAfter: 30 * 60,
  };
});

Script.run(async () => {
  try {
    const story = await topStory(true);
    return `${story.title} (${story.score} points, ${story.comments} comments)\n${story.url}`;
  } catch (error) {
    return `Could not load Hacker News: ${error.message}`;
  }
});
