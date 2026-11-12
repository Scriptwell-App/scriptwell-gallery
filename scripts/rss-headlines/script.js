// @name        RSS Headlines
// @description Latest headlines from any RSS or Atom feed
// @permissions network
// @widget      medium, large, rectangular
// @icon        newspaper.fill
// @color       #F97316
// @version     1.0.0
// @author      va4w
// @category    magazines-newspapers

// Put a feed URL in the widget's Parameter field. Without one, this feed is used.
const DEFAULT_FEED = "https://feeds.bbci.co.uk/news/world/rss.xml";

const decode = (text) => text
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .trim();

const tag = (xml, name) => {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return match ? decode(match[1]) : "";
};

// Small feed parser: handles RSS <item> and Atom <entry>. There is no DOM in Scriptwell.
function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  return blocks.map((block) => {
    const atomLink = /<link[^>]*href="([^"]+)"/i.exec(block);
    return {
      title: tag(block, "title"),
      link: tag(block, "link") || (atomLink ? atomLink[1] : ""),
      date: tag(block, "pubDate") || tag(block, "updated") || tag(block, "published"),
    };
  }).filter((item) => item.title);
}

async function headlines(feedURL) {
  const key = `feed:${feedURL}`;
  try {
    const response = await fetch(feedURL, { headers: { Accept: "application/rss+xml, application/atom+xml, text/xml" } });
    if (!response.ok) throw new Error(`Feed returned ${response.status}`);
    const xml = await response.text();
    const feed = { name: tag(xml, "title") || new URL(feedURL).hostname, items: parseFeed(xml).slice(0, 12) };
    Storage.set(key, feed);
    return feed;
  } catch (error) {
    // Slow or offline: show the headlines from last time rather than an error.
    const saved = Storage.get(key);
    if (saved) return saved;
    throw error;
  }
}

Script.widget(async ({ family, parameter }) => {
  const feedURL = parameter && parameter.startsWith("https://") ? parameter : DEFAULT_FEED;
  const feed = await headlines(feedURL);
  const count = family === "large" ? 7 : family === "medium" ? 3 : 2;
  const items = feed.items.slice(0, count);

  const rows = items.map((item, index) => Widget.vstack([
    index > 0 && family !== "rectangular" ? Widget.divider() : null,
    Widget.text(item.title, {
      font: family === "rectangular" ? "caption" : "subheadline",
      weight: "medium",
      lineLimit: family === "large" ? 2 : 1,
      // Tapping a headline opens it (medium and large widgets).
      url: item.link.startsWith("https://") ? item.link : undefined,
    }),
  ], { alignment: "leading", spacing: 5 }));

  if (family === "rectangular") {
    return { content: Widget.vstack(rows, { alignment: "leading", spacing: 2 }), refreshAfter: 30 * 60 };
  }

  return {
    content: Widget.vstack([
      Widget.hstack([
        Widget.symbol("newspaper.fill", { size: 13, color: "orange", fallback: "📰" }),
        Widget.text(feed.name, { font: "caption", weight: "semibold", color: "orange", lineLimit: 1 }),
        Widget.spacer(),
        Widget.date(new Date(), { style: "time", font: "caption2", color: "secondary" }),
      ], { spacing: 5 }),
      ...rows,
      Widget.spacer(),
    ], { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    refreshAfter: 30 * 60,
  };
});

// From the app or Shortcuts: returns the headlines as text. Input is an optional feed URL.
Script.run(async (input) => {
  const feed = await headlines(input && input.startsWith("https://") ? input : DEFAULT_FEED);
  return feed.items.slice(0, 10).map((item, i) => `${i + 1}. ${item.title}`).join("\n");
});
