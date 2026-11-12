// @name        Picture of the Day
// @description Wikimedia Commons' featured picture, new every day, as a widget
// @permissions network
// @widget      medium, large
// @icon        photo.fill
// @color       #0369A1
// @version     1.0.0
// @author      scriptwell
// @category    photo-video

// The picture and its caption come from Wikipedia's featured feed (free, no
// key). Pictures are free-licensed; tap through for the author and licence.

async function picture() {
  const now = new Date();
  const day = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${String(now.getUTCDate()).padStart(2, "0")}`;
  const saved = Storage.get("picture");
  if (saved?.day === day) return saved;
  try {
    const response = await fetch(`https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${day}`, { timeout: 8000 });
    if (!response.ok) throw new Error(`Wikipedia answered ${response.status}`);
    const { image } = await response.json();
    if (!image?.thumbnail?.source) throw new Error("There is no featured picture today");
    const fresh = {
      day,
      src: image.thumbnail.source,
      title: image.title.replace(/^File:/, "").replace(/\.\w+$/, "").replace(/_/g, " "),
      caption: image.description?.text ?? "",
      page: image.file_page ?? "https://commons.wikimedia.org/wiki/Commons:Picture_of_the_day",
    };
    Storage.set("picture", fresh);
    return fresh;
  } catch (error) {
    if (saved) return saved; // keep yesterday's picture while offline
    throw error;
  }
}

Script.widget(async ({ family }) => {
  const p = await picture();
  return {
    content: Widget.zstack([
      Widget.image({ src: p.src, contentMode: "fill", frame: { maxWidth: "infinity", maxHeight: "infinity" } }),
      Widget.vstack([
        Widget.spacer(),
        Widget.text(p.caption || p.title, {
          font: "caption2", weight: "medium", color: "white", lineLimit: family === "large" ? 3 : 2,
          padding: { horizontal: 12, vertical: 8 }, background: "#00000099", frame: { maxWidth: "infinity", alignment: "leading" },
        }),
      ], { spacing: 0 }),
    ], { url: p.page }),
    refreshAfter: 3 * 60 * 60,
  };
});

Script.action("open", ({ url }) => UI.openURL(url));
Script.action("share", ({ url }) => UI.share(url));

Script.ui(async () => {
  const p = await picture();
  return {
    title: "Picture of the Day",
    content: Widget.vstack([
      Widget.image({ src: p.src, contentMode: "fit", cornerRadius: 14, frame: { maxWidth: "infinity" } }),
      Widget.text(p.title, { font: "headline", align: "center" }),
      p.caption ? Widget.text(p.caption, { font: "subheadline", color: "secondary", align: "center" }) : null,
      Widget.hstack([
        Widget.button("Author and licence", "open", { url: p.page }, { style: "bordered" }),
        Widget.button("Share", "share", { url: p.page }, { style: "bordered" }),
      ], { spacing: 10 }),
    ], { spacing: 12, padding: 16 }),
  };
});

Script.run(async () => {
  const p = await picture();
  return `${p.title}${p.caption ? `: ${p.caption}` : ""}\n${p.page}`;
});
