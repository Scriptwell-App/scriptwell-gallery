// @name        Wikipedia Summary
// @description Look anything up and get the first paragraph from Wikipedia, in the app or by voice
// @permissions network
// @icon        text.book.closed.fill
// @color       #374151
// @version     1.0.0
// @author      scriptwell
// @category    reference

// From Shortcuts or Siri, pass a topic and the summary comes back as text.
// Change LANGUAGE to read another Wikipedia, for example "de" or "es".

const LANGUAGE = "en";
const HOST = `https://${LANGUAGE}.wikipedia.org`;

async function lookUp(topic) {
  // Find the best matching article title first, so "eiffel tower" and typos still work.
  const search = await fetch(`${HOST}/w/api.php?${new URLSearchParams({ action: "opensearch", search: topic, limit: 1, format: "json" })}`, { timeout: 8000 });
  if (!search.ok) throw new Error(`Wikipedia answered ${search.status}`);
  const title = (await search.json())[1]?.[0];
  if (!title) return null;

  const response = await fetch(`${HOST}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`, { timeout: 8000 });
  if (!response.ok) throw new Error(`Wikipedia answered ${response.status}`);
  const page = await response.json();
  return {
    title: page.title,
    description: page.description ?? "",
    extract: page.extract ?? "",
    image: page.thumbnail?.source ?? null,
    url: page.content_urls?.mobile?.page ?? `${HOST}/wiki/${encodeURIComponent(title)}`,
  };
}

let page = null;
let missing = null; // the last topic that found nothing

async function search(topic) {
  page = await lookUp(topic);
  missing = page ? null : topic;
  if (page) Storage.set("recent", [page.title, ...Storage.get("recent", []).filter((t) => t !== page.title)].slice(0, 6));
}

Script.action("ask", async () => {
  const topic = (await UI.prompt({ title: "Look up", placeholder: "Aurora" }))?.trim();
  if (topic) await search(topic);
});
Script.action("show", ({ topic }) => search(topic));
Script.action("open", () => UI.openURL(page.url));
Script.action("share", () => UI.share(`${page.title}: ${page.extract}\n${page.url}`));

Script.ui(() => {
  const recent = Storage.get("recent", []);
  return {
    title: "Wikipedia",
    content: Widget.vstack([
      Widget.button("Look something up", "ask", null, { style: "prominent", color: "gray" }),
      missing ? Widget.text(`Nothing found for "${missing}".`, { color: "orange" }) : null,
      page ? Widget.vstack([
        page.image ? Widget.image({ src: page.image, contentMode: "fit", cornerRadius: 12, frame: { height: 170 } }) : null,
        Widget.text(page.title, { font: "title2", weight: "bold", design: "serif" }),
        page.description ? Widget.text(page.description, { font: "subheadline", color: "secondary" }) : null,
        Widget.text(page.extract, { font: "body", design: "serif" }),
        Widget.hstack([
          Widget.button("Read the article", "open", null, { style: "bordered" }),
          Widget.button("Share", "share", null, { style: "bordered" }),
        ], { spacing: 10 }),
      ], { alignment: "leading", spacing: 8 }) : null,
      recent.length ? Widget.divider() : null,
      recent.length ? Widget.text("Recent", { font: "caption", color: "secondary" }) : null,
      ...recent.map((topic) => Widget.button(topic, "show", { topic }, { color: "primary" })),
    ], { alignment: "leading", spacing: 12, padding: 16 }),
  };
});

Script.run(async (input) => {
  if (!input?.trim()) return "Pass a topic to look up.";
  const found = await lookUp(input.trim());
  return found ? `${found.title}: ${found.extract}` : `Wikipedia has nothing for "${input.trim()}".`;
});
