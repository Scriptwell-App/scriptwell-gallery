// @name        On This Day
// @description Something that happened on today's date in history, from Wikipedia
// @permissions network
// @widget      medium, large
// @icon        clock.arrow.circlepath
// @color       #7C2D12
// @version     1.0.0
// @author      va4w
// @category    news

// Events come from Wikipedia's "On this day" feed (free, no key) and are
// fetched once a day. The widget shows a different event every hour.

async function events() {
  const now = new Date();
  const day = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  const saved = Storage.get("events");
  if (saved?.day === day) return saved.list;
  try {
    const response = await fetch(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/${day}`, { timeout: 8000 });
    if (!response.ok) throw new Error(`Wikipedia answered ${response.status}`);
    const list = (await response.json()).events
      .filter((event) => event.text && event.year)
      .map((event) => ({ year: event.year, text: event.text, url: event.pages?.[0]?.content_urls?.mobile?.page ?? null }))
      .slice(0, 40);
    Storage.set("events", { day, list });
    return list;
  } catch (error) {
    if (saved) return saved.list; // yesterday's list is better than an empty widget
    throw error;
  }
}

const era = (year) => (year < 0 ? `${-year} BC` : String(year));
const title = () => new Date().toLocaleDateString(undefined, { day: "numeric", month: "long" });

Script.widget(async ({ family }) => {
  const list = await events();
  const count = family === "large" ? 3 : 1;
  const start = (new Date().getHours() * count) % Math.max(1, list.length);
  const shown = [...list, ...list].slice(start, start + count);
  const nextHour = new Date();
  nextHour.setHours(nextHour.getHours() + 1, 0, 5, 0);

  return {
    content: Widget.vstack([
      Widget.hstack([
        Widget.symbol("clock.arrow.circlepath", { size: 13, color: "brown", fallback: "🕰" }),
        Widget.text(`On ${title()}`, { font: "caption", weight: "semibold", color: "secondary" }),
        Widget.spacer(),
      ], { spacing: 5 }),
      ...shown.map((event) => Widget.vstack([
        Widget.text(era(event.year), { font: family === "large" ? "headline" : "title3", weight: "bold", design: "serif", color: "brown" }),
        Widget.text(event.text, { font: "footnote", design: "serif", lineLimit: family === "large" ? 4 : 4 }),
      ], { alignment: "leading", spacing: 2, url: event.url ?? undefined })),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 8, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    refreshAt: nextHour,
  };
});

Script.action("open", ({ url }) => UI.openURL(url));

Script.ui(async () => {
  const list = [...(await events())].sort((a, b) => b.year - a.year).slice(0, 20);
  return {
    title: title(),
    content: Widget.vstack(list.map((event) => Widget.hstack([
      Widget.text(era(event.year), { font: "headline", design: "serif", color: "brown", frame: { width: 62, alignment: "leading" } }),
      event.url
        ? Widget.button(Widget.text(event.text, { font: "subheadline", design: "serif", color: "primary", align: "leading" }), "open", { url: event.url })
        : Widget.text(event.text, { font: "subheadline", design: "serif" }),
      Widget.spacer(),
    ], { spacing: 8, alignment: "top" })), { alignment: "leading", spacing: 14, padding: 16 }),
  };
});

Script.run(async () => {
  const list = await events();
  const event = list[Math.floor(Math.random() * list.length)];
  return event ? `On ${title()} in ${era(event.year)}: ${event.text}` : "Nothing found for today.";
});
