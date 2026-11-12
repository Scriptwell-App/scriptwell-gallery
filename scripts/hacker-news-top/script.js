// @name        Hacker News Top
// @description The top stories on Hacker News, on your Home Screen and in a reader list
// @permissions network
// @widget      medium, large
// @icon        newspaper.fill
// @color       #FF6600
// @version     1.0.0
// @author      va4w
// @category    magazines-newspapers

// Stories come from the official Hacker News API (free, no key). The last
// list is kept, so the widget still shows something when you are offline.

const API = "https://hacker-news.firebaseio.com/v0";

async function json(path) {
  const response = await fetch(`${API}/${path}.json`, { timeout: 6000 });
  if (!response.ok) throw new Error(`Hacker News answered ${response.status}`);
  return response.json();
}

async function top(count) {
  try {
    const ids = (await json("topstories")).slice(0, count);
    const items = await Promise.all(ids.map((id) => json(`item/${id}`)));
    const list = items.filter((item) => item?.title).map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
      site: item.url ? new URL(item.url).hostname.replace(/^www\./, "") : "news.ycombinator.com",
      score: item.score ?? 0,
      comments: item.descendants ?? 0,
    }));
    Storage.set("stories", { list, time: Date.now() });
    return { list, time: Date.now(), offline: false };
  } catch (error) {
    const saved = Storage.get("stories");
    if (!saved) throw error;
    return { ...saved, list: saved.list.slice(0, count), offline: true };
  }
}

Script.widget(async ({ family }) => {
  const { list, time, offline } = await top(family === "large" ? 7 : 3);
  return {
    content: Widget.vstack([
      Widget.hstack([
        Widget.text("Y", { font: "caption", weight: "bold", color: "white", padding: { horizontal: 5, vertical: 1 }, background: "#FF6600", cornerRadius: 3 }),
        Widget.text("Hacker News", { font: "caption", weight: "semibold", color: "secondary" }),
        Widget.spacer(),
        offline ? Widget.text("offline", { font: "caption2", color: "orange" }) : Widget.date(time, { style: "time", font: "caption2", color: "secondary" }),
      ], { spacing: 6 }),
      ...list.map((story) => Widget.vstack([
        Widget.text(story.title, { font: "footnote", weight: "medium", lineLimit: family === "large" ? 2 : 1 }),
        Widget.text(`${story.score} points · ${story.comments} comments · ${story.site}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
      ], { alignment: "leading", spacing: 1, url: story.url })),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 7, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    refreshAfter: 30 * 60,
  };
});

Script.action("open", ({ url }) => UI.openURL(url));
Script.action("refresh", () => {});

Script.ui(async () => {
  const { list, offline } = await top(15);
  return {
    title: "Hacker News",
    content: Widget.vstack([
      offline ? Widget.text("Offline. Showing the last list.", { font: "footnote", color: "orange" }) : null,
      ...list.map((story, i) => Widget.hstack([
        Widget.text(String(i + 1), { font: "headline", design: "rounded", color: "orange", frame: { width: 26 } }),
        Widget.vstack([
          Widget.button(Widget.text(story.title, { font: "subheadline", weight: "medium", color: "primary", align: "leading" }), "open", { url: story.url }),
          Widget.button(
            Widget.text(`${story.score} points · ${story.comments} comments · ${story.site}`, { font: "caption", color: "secondary", lineLimit: 1 }),
            "open",
            { url: `https://news.ycombinator.com/item?id=${story.id}` },
          ),
        ], { alignment: "leading", spacing: 3 }),
        Widget.spacer(),
      ], { spacing: 8, alignment: "top" })),
      Widget.button("Refresh", "refresh", null, { style: "bordered", color: "orange" }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});

Script.run(async () => (await top(5)).list.map((story, i) => `${i + 1}. ${story.title} (${story.score} points)`).join("\n"));
