// @name        Daily Passage
// @description One passage a day from a public-domain book of your choice, read aloud on request, with bookmarks and a book-like widget; searches gutendex.com and downloads the text from gutenberg.org
// @permissions network
// @widget      small, medium, large
// @icon        book.pages.fill
// @color       #9A3412
// @version     1.0.0
// @author      va4w
// @category    books

// How it works
// • In the mini-app, search Project Gutenberg (the query goes to gutendex.com) and pick a book. Its plain-text edition is downloaded once from gutenberg.org into the script's Files folder; only the first megabyte is kept.
// • The text between the Gutenberg "*** START OF" and "*** END OF" markers is split into passages of about 120 words at paragraph boundaries.
// • Each day shows one new passage, chosen from the date, so the widget and the mini-app agree. "Another one" moves on today; "In order" or "Shuffle" sets how days advance.
// • Read aloud with the system voice, keep bookmarks, and browse back and forth; the mini-app reopens where you left off.
// • Widgets draw today's passage on warm paper in light mode and dark ink in dark mode. Pick a book in the app before adding a widget.

// ───────────────────────── Constants and helpers

const TARGET_WORDS = 120;
const MAX_CHARS = 1_000_000;
const MAX_PASSAGES = 4000;
const PASSAGES_FILE = "passages.json";
const locale = Script.env.locale;
const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

const PAPER = { light: "#F7EEDF", dark: "#1A1512" };
const PAPER_DEEP = { light: "#EFE2CC", dark: "#241D18" };
const INK = { light: "#2B2118", dark: "#EAE0D0" };
const INK_SOFT = { light: "#7A6450", dark: "#A89580" };
const RUST = { light: "#9A3412", dark: "#E07A3F" };
const RULE = { light: "#9A341255", dark: "#E07A3F66" };

const dayKey = (d = new Date()) => new Date(d).toLocaleDateString("en-CA");
const parseDay = (key) => new Date(`${key}T12:00:00`);
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86_400_000);
const wordCount = (text) => (text.match(/\S+/g) ?? []).length;
const fmtInt = (n) => Math.round(n).toLocaleString(locale);
const notice = (text, kind = "info") => Storage.set("notice", { text, kind, time: Date.now() });

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function midnight() {
  const next = new Date();
  next.setHours(24, 0, 10, 0);
  return next;
}

// ───────────────────────── Splitting a Gutenberg text into passages

function extractBody(raw) {
  let body = raw.replace(/\r\n?/g, "\n");
  const start = body.search(/\*\*\* ?START OF[^\n]*/i);
  if (start >= 0) body = body.slice(body.indexOf("\n", start) + 1);
  const end = body.search(/\*\*\* ?END OF[^\n]*/i);
  if (end >= 0) body = body.slice(0, end);
  return body;
}

const isHeading = (p) => wordCount(p) <= 8 && /^[A-Z0-9 .,:;'’\-—_*]+$/.test(p);

// A paragraph much longer than a passage is cut at sentence ends into pieces of roughly the target length.
function splitLong(paragraph) {
  const sentences = paragraph.match(/[^.!?]+[.!?]+["”’']*\s*|[^.!?]+$/g) ?? [paragraph];
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (wordCount(current) >= TARGET_WORDS * 0.6 && wordCount(current) + wordCount(sentence) > TARGET_WORDS * 1.2) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function buildPassages(raw) {
  const paragraphs = extractBody(raw)
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/_/g, "").replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0 && !isHeading(p));

  const passages = [];
  let current = [];
  let words = 0;
  for (const paragraph of paragraphs) {
    const pieces = wordCount(paragraph) > TARGET_WORDS * 1.5 ? splitLong(paragraph) : [paragraph];
    for (const piece of pieces) {
      const n = wordCount(piece);
      // Close the passage early rather than let a long paragraph push it far past the target.
      if (words >= TARGET_WORDS * 0.5 && words + n > TARGET_WORDS * 1.4) {
        passages.push(current.join("\n\n"));
        current = [];
        words = 0;
      }
      current.push(piece);
      words += n;
      if (words >= TARGET_WORDS) {
        passages.push(current.join("\n\n"));
        current = [];
        words = 0;
      }
    }
    if (passages.length >= MAX_PASSAGES) break;
  }
  if (words >= 40) passages.push(current.join("\n\n"));
  return passages;
}

// ───────────────────────── Project Gutenberg

async function searchGutenberg(query) {
  const url = new URL("https://gutendex.com/books");
  url.searchParams.set("search", query);
  const response = await fetch(url, { timeout: 15_000 });
  if (!response.ok) throw new Error(`gutendex.com answered ${response.status}`);
  const data = await response.json();
  return (data.results ?? []).slice(0, 10).map((item) => ({
    id: item.id,
    title: item.title ?? "Untitled",
    author: (item.authors ?? []).map((a) => a.name.split(", ").reverse().join(" ")).join(", ") || "Unknown",
    downloads: item.download_count ?? 0,
    text: textUrl(item.formats ?? {}),
  }));
}

// The plain-text edition, preferring UTF-8. Gutenberg links are https, but upgrade any that are not.
function textUrl(formats) {
  const keys = Object.keys(formats);
  const preferred = ["text/plain; charset=utf-8", "text/plain; charset=us-ascii", "text/plain; charset=iso-8859-1", "text/plain"];
  const key = preferred.find((k) => formats[k] && !formats[k].endsWith(".zip")) ?? keys.find((k) => k.startsWith("text/plain") && !formats[k].endsWith(".zip"));
  if (!key) return null;
  return formats[key].replace(/^http:\/\//, "https://");
}

async function downloadBook(result) {
  if (!result.text) throw new Error("This edition has no plain-text file");
  const response = await fetch(result.text, { timeout: 25_000 });
  if (!response.ok) throw new Error(`gutenberg.org answered ${response.status}`);
  const raw = (await response.text()).slice(0, MAX_CHARS);
  const passages = buildPassages(raw);
  if (passages.length < 5) throw new Error("Could not split this text into passages. Try another edition.");
  await Files.writeJSON(PASSAGES_FILE, passages);
  const book = { id: result.id, title: result.title, author: result.author, count: passages.length, words: wordCount(raw), downloaded: Date.now() };
  Storage.set("book", book);
  Storage.set("anchor", { day: dayKey(), index: 0 });
  Storage.set("salt", 0);
  Storage.set("view", 0);
  Storage.remove("today");
  Storage.set("bookmarks", Storage.get("bookmarks", []).filter((b) => b.bookId === book.id));
  cache = passages;
  return book;
}

// ───────────────────────── Which passage is today's

let cache = null;

async function passages() {
  if (cache) return cache;
  cache = await Files.readJSON(PASSAGES_FILE);
  return cache;
}

function todayIndex(book, day = dayKey()) {
  if (Storage.get("order", "sequence") === "shuffle") return hash(`${book.id}:${day}:${Storage.get("salt", 0)}`) % book.count;
  const anchor = Storage.get("anchor") ?? { day, index: 0 };
  return (((anchor.index + daysBetween(anchor.day, day)) % book.count) + book.count) % book.count;
}

// Today's passage, cached in Storage so widgets do not read the file on every refresh.
async function todayPassage() {
  const book = Storage.get("book");
  if (!book) return null;
  const day = dayKey();
  const index = todayIndex(book, day);
  const saved = Storage.get("today");
  if (saved && saved.bookId === book.id && saved.day === day && saved.index === index) return saved;
  const text = (await passages())[index] ?? "";
  const fresh = { bookId: book.id, day, index, text };
  Storage.set("today", fresh);
  return fresh;
}

// ───────────────────────── Actions

Script.action("query", async ({ value }) => {
  const query = String(value ?? "").trim();
  Storage.set("query", query);
  if (!query) { Storage.remove("results"); return; }
  Storage.set("busy", `Searching Project Gutenberg for “${query}”…`);
  try {
    Storage.set("results", await searchGutenberg(query));
    Storage.remove("notice");
  } catch (error) {
    notice(`Search failed: ${error.message}`, "warn");
  } finally {
    Storage.remove("busy");
  }
});

Script.action("choose", async ({ index }) => {
  const result = Storage.get("results", [])[index];
  if (!result) return;
  Storage.set("busy", `Downloading “${result.title}”…`);
  try {
    const book = await downloadBook(result);
    notice(`“${book.title}” is ready: ${fmtInt(book.count)} passages.`, "success");
    await UI.haptic("success");
  } catch (error) {
    notice(`Could not download: ${error.message}`, "warn");
  } finally {
    Storage.remove("busy");
  }
});

Script.action("view", ({ by, index }) => {
  const book = Storage.get("book");
  if (!book) return;
  const current = index ?? Storage.get("view") ?? todayIndex(book);
  const next = (((current + (by ?? 0)) % book.count) + book.count) % book.count;
  Storage.set("view", next);
  Speech.stop();
});

Script.action("today", () => { Storage.remove("view"); Speech.stop(); });

Script.action("another", () => {
  const book = Storage.get("book");
  if (!book) return;
  if (Storage.get("order", "sequence") === "shuffle") Storage.set("salt", Storage.get("salt", 0) + 1);
  else Storage.set("anchor", { day: dayKey(), index: (todayIndex(book) + 1) % book.count });
  Storage.remove("today");
  Storage.remove("view");
});

Script.action("anchorHere", () => {
  const book = Storage.get("book");
  const view = Storage.get("view");
  if (!book || view == null) return;
  Storage.set("order", "sequence");
  Storage.set("anchor", { day: dayKey(), index: view });
  Storage.remove("today");
  Storage.remove("view");
  notice("From today the daily passages continue from here.", "success");
});

Script.action("order", ({ value }) => { Storage.set("order", value); Storage.remove("today"); });
Script.action("rate", ({ value }) => Storage.set("rate", value));

Script.action("say", async ({ text }) => {
  // Not awaited: a passage takes longer to read than an action may run. Speech carries on after the action returns.
  Speech.say(text, { rate: Storage.get("rate", 1) }).catch(() => {});
});

Script.action("hush", () => Speech.stop());

Script.action("bookmark", async ({ index, text }) => {
  const book = Storage.get("book");
  const list = Storage.get("bookmarks", []);
  const existing = list.find((b) => b.bookId === book.id && b.index === index);
  if (existing) Storage.set("bookmarks", list.filter((b) => b !== existing));
  else Storage.set("bookmarks", [{ bookId: book.id, index, day: dayKey(), preview: text.split(/\s+/).slice(0, 14).join(" ") }, ...list].slice(0, 100));
  await UI.haptic("light");
});

Script.action("goto", ({ index }) => { Storage.set("view", index); Storage.set("tab", 0); });

Script.action("clearBookmarks", async () => {
  const choice = await UI.alert({ title: "Remove all bookmarks?", buttons: ["Cancel", "Remove"] });
  if (choice === 1) Storage.set("bookmarks", []);
});

Script.action("forget", async () => {
  const choice = await UI.alert({ title: "Remove this book?", message: "The downloaded text, bookmarks and position are deleted. You can download it again any time.", buttons: ["Cancel", "Remove"] });
  if (choice !== 1) return;
  try { await Files.remove(PASSAGES_FILE); } catch { /* already gone */ }
  for (const key of ["book", "anchor", "salt", "view", "today", "bookmarks"]) Storage.remove(key);
  cache = null;
});

// ───────────────────────── Widget

const serif = (text, props = {}) => Widget.text(text, { design: "serif", color: INK, ...props });

function ornament(size = 10) {
  return Widget.hstack([
    Widget.divider(),
    Widget.text("❦", { font: size, color: RUST }),
    Widget.divider(),
  ], { spacing: 8 });
}

function placeholder(family) {
  return Widget.vstack([
    Widget.symbol("book.pages.fill", { size: family === "small" ? 26 : 34, color: RUST, fallback: "📖" }),
    serif("Daily Passage", { font: family === "small" ? "headline" : "title3", weight: "semibold" }),
    Widget.text("Open the mini-app and choose a book from Project Gutenberg.", { font: "caption2", color: INK_SOFT, align: "center", lineLimit: 3 }),
  ], { spacing: 6, padding: 14, background: PAPER, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
}

Script.widget(async ({ family }) => {
  const book = Storage.get("book");
  if (!book) return { content: placeholder(family), refreshAfter: 6 * 60 * 60 };

  let today = Storage.get("today");
  let stale = false;
  try {
    today = await todayPassage();
  } catch {
    stale = Boolean(today);
  }
  if (!today) return { content: placeholder(family), refreshAfter: 60 * 60 };

  const dateText = parseDay(today.day).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  const position = `${fmtInt(today.index + 1)} of ${fmtInt(book.count)}`;
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  let content;

  if (family === "small") {
    content = Widget.vstack([
      Widget.text(book.title.toUpperCase(), { font: 9, weight: "bold", color: RUST, lineLimit: 1, minimumScale: 0.7 }),
      serif(today.text, { font: 12, lineLimit: 7, minimumScale: 0.85 }),
      Widget.spacer(),
      Widget.text(book.author, { font: "caption2", color: INK_SOFT, lineLimit: 1 }),
    ], { alignment: "leading", spacing: 5, padding: 14, background: PAPER, url: appLink, frame: fill });
  } else if (family === "medium") {
    content = Widget.hstack([
      Widget.vstack([
        serif(book.title, { font: "caption", weight: "semibold", lineLimit: 3 }),
        Widget.text(book.author, { font: "caption2", color: INK_SOFT, lineLimit: 2 }),
        Widget.spacer(),
        Widget.text(position, { font: "caption2", color: INK_SOFT }),
        Widget.progress((today.index + 1) / book.count, { color: RUST }),
      ], { alignment: "leading", spacing: 3, frame: { width: 84, maxHeight: "infinity", alignment: "topLeading" } }),
      { type: "stack", direction: "vertical", children: [], background: RULE, frame: { width: 1, maxHeight: "infinity" } },
      serif(today.text, { font: 13, lineLimit: 7, minimumScale: 0.8, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 12, padding: 14, background: PAPER, url: appLink, frame: fill });
  } else {
    content = Widget.vstack([
      Widget.hstack([
        Widget.text(dateText.toUpperCase(), { font: 10, weight: "bold", color: RUST, lineLimit: 1 }),
        Widget.spacer(),
        Widget.text(stale ? "yesterday's passage" : position, { font: 10, color: INK_SOFT }),
      ]),
      serif(book.title, { font: "title3", weight: "semibold", lineLimit: 2 }),
      Widget.text(book.author, { font: "footnote", color: INK_SOFT, lineLimit: 1 }),
      ornament(11),
      serif(today.text, { font: 14, lineLimit: 18, minimumScale: 0.8 }),
      Widget.spacer(),
      Widget.hstack([
        Widget.symbol("speaker.wave.2.fill", { size: 10, color: INK_SOFT, fallback: "🔈" }),
        Widget.text("Tap to read, listen or bookmark", { font: "caption2", color: INK_SOFT }),
        Widget.spacer(),
        Widget.text(`${fmtInt(wordCount(today.text))} words`, { font: "caption2", color: INK_SOFT }),
      ], { spacing: 4 }),
    ], { alignment: "leading", spacing: 6, padding: 18, background: PAPER, url: appLink, frame: fill });
  }

  return { content, refreshAt: midnight() };
});

// ───────────────────────── Script.run (Siri and Shortcuts)

Script.run(async () => {
  const book = Storage.get("book");
  if (!book) return "No book chosen yet. Open Daily Passage and pick one from Project Gutenberg.";
  const today = await todayPassage();
  return `From ${book.title} by ${book.author}:\n\n${today.text}`;
});

// ───────────────────────── Mini-app

const NOTICE_COLORS = { info: "blue", success: "green", warn: "orange" };

function noticeView() {
  const busy = Storage.get("busy");
  if (busy) return Widget.hstack([Widget.symbol("hourglass", { size: 14, color: "secondary", fallback: "⏳" }), Widget.text(busy, { font: "footnote", color: "secondary" })], { spacing: 6 });
  const n = Storage.get("notice");
  if (!n) return null;
  return Widget.text(n.text, { font: "footnote", color: NOTICE_COLORS[n.kind] ?? "secondary", padding: 10, background: PAPER_DEEP, cornerRadius: 10, frame: { maxWidth: "infinity", alignment: "leading" } });
}

function readTab(book, index, text, isToday) {
  const bookmarked = Storage.get("bookmarks", []).some((b) => b.bookId === book.id && b.index === index);
  const rate = Storage.get("rate", 1);
  const paragraphs = text.split("\n\n");
  const minutes = Math.max(1, Math.round(wordCount(text) / 150 / rate));

  return Widget.vstack([
    noticeView(),
    Widget.vstack([
      Widget.hstack([
        Widget.text(isToday ? `TODAY · ${parseDay(dayKey()).toLocaleDateString(locale, { day: "numeric", month: "long" }).toUpperCase()}` : `PASSAGE ${fmtInt(index + 1)}`, { font: 10, weight: "bold", color: RUST }),
        Widget.spacer(),
        Widget.text(`${fmtInt(index + 1)} / ${fmtInt(book.count)}`, { font: 10, color: INK_SOFT }),
      ]),
      serif(book.title, { font: "title2", weight: "semibold" }),
      Widget.text(book.author, { font: "subheadline", color: INK_SOFT }),
      ornament(12),
      ...paragraphs.slice(0, 12).map((p) => serif(p, { font: 17 })),
      Widget.spacer(6),
      Widget.text(`${fmtInt(wordCount(text))} words · about ${minutes} min aloud`, { font: "caption", color: INK_SOFT }),
    ], { alignment: "leading", spacing: 8, padding: 20, background: PAPER, cornerRadius: 18 }),

    Widget.hstack([
      Widget.button(Widget.symbol("chevron.left", { size: 18, color: RUST, fallback: "‹" }), "view", { by: -1, index }, { style: "bordered" }),
      Widget.button(isToday ? "Today's passage" : "Back to today", "today", null, { style: isToday ? "bordered" : "prominent", color: RUST }),
      Widget.button(Widget.symbol("chevron.right", { size: 18, color: RUST, fallback: "›" }), "view", { by: 1, index }, { style: "bordered" }),
    ], { spacing: 10 }),

    Widget.hstack([
      Widget.button(Widget.hstack([Widget.symbol("speaker.wave.2.fill", { size: 14, color: "white", fallback: "🔈" }), Widget.text("Read aloud", { color: "white", weight: "semibold" })], { spacing: 6 }), "say", { text }, { style: "prominent", color: RUST }),
      Widget.button(Widget.symbol("stop.fill", { size: 14, color: RUST, fallback: "■" }), "hush", null, { style: "bordered" }),
      Widget.spacer(),
      Widget.button(Widget.symbol(bookmarked ? "bookmark.fill" : "bookmark", { size: 18, color: RUST, fallback: "🔖" }), "bookmark", { index, text }, { style: "bordered" }),
    ], { spacing: 10 }),

    Widget.slider(rate, "rate", null, { min: 0.6, max: 1.6, step: 0.1, label: `Voice speed ${rate.toFixed(1)}×`, color: RUST }),

    Widget.divider(),
    Widget.text(isToday ? "Not in the mood for this one?" : "Make the daily passages continue from here?", { font: "footnote", color: "secondary" }),
    isToday
      ? Widget.button(Widget.hstack([Widget.symbol("arrow.triangle.2.circlepath", { size: 14, color: RUST, fallback: "↻" }), Widget.text("Another one for today", { color: RUST })], { spacing: 6 }), "another", null, { style: "bordered" })
      : Widget.button(Widget.hstack([Widget.symbol("pin.fill", { size: 14, color: RUST, fallback: "📌" }), Widget.text("Continue from this passage", { color: RUST })], { spacing: 6 }), "anchorHere", null, { style: "bordered" }),
  ], { alignment: "leading", spacing: 14 });
}

function libraryTab(book) {
  const results = Storage.get("results", []);
  const query = Storage.get("query", "");
  const order = Storage.get("order", "sequence");
  return Widget.vstack([
    noticeView(),
    book ? Widget.card([
      serif(book.title, { font: "headline" }),
      Widget.text(book.author, { font: "subheadline", color: "secondary" }),
      Widget.text(`${fmtInt(book.count)} passages · about ${fmtInt(book.words)} words · downloaded ${new Date(book.downloaded).toLocaleDateString(locale)}`, { font: "caption", color: "secondary" }),
      Widget.picker([{ label: "In order", value: "sequence" }, { label: "Shuffle", value: "shuffle" }], order, "order", null, { style: "segmented", label: "Daily passages" }),
      Widget.text(order === "shuffle" ? "A different passage each day, picked from the date." : "One passage after the other, a new one each day.", { font: "caption2", color: "secondary" }),
      Widget.button(Widget.text("Remove this book", { color: "red" }), "forget", null, { style: "plain" }),
    ], { title: "Current book", symbol: "book.closed.fill", color: "orange" }) : Widget.card([
      Widget.text("Search Project Gutenberg's 70,000 free books by title or author, then tap one to download it.", { font: "footnote", color: "secondary" }),
    ], { title: "No book yet", symbol: "books.vertical", color: "orange" }),
    Widget.textField("Title or author, e.g. Jane Austen", query, "query", null, { label: "Search Project Gutenberg", keyboard: "search" }),
    results.length ? Widget.list(results.map((r, index) => ({
      title: r.title,
      subtitle: `${r.author} · ${fmtInt(r.downloads)} downloads${r.text ? "" : " · no text edition"}`,
      symbol: r.id === book?.id ? "checkmark.circle.fill" : r.text ? "arrow.down.circle" : "xmark.circle",
      color: r.id === book?.id ? "green" : r.text ? "orange" : "gray",
      action: "choose",
      args: { index },
    })), { title: `Results for “${query}”` }) : query && !Storage.get("busy") ? Widget.text("Nothing found. Try the author's surname alone.", { color: "secondary", align: "center" }) : null,
    Widget.text("Texts are public domain in the United States; check your own country's rules. Book data: gutendex.com; texts: gutenberg.org.", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 14 });
}

function bookmarksTab(book) {
  const list = Storage.get("bookmarks", []).filter((b) => !book || b.bookId === book.id);
  if (!list.length) {
    return Widget.vstack([
      Widget.symbol("bookmark", { size: 40, color: RUST, fallback: "🔖" }),
      Widget.text("No bookmarks yet", { font: "headline" }),
      Widget.text("Tap the bookmark on a passage you want to come back to.", { font: "footnote", color: "secondary", align: "center" }),
    ], { spacing: 8, padding: 24, frame: { maxWidth: "infinity" } });
  }
  return Widget.vstack([
    Widget.list(list.map((b) => ({
      title: `${b.preview}…`,
      subtitle: `Passage ${fmtInt(b.index + 1)} · saved ${parseDay(b.day).toLocaleDateString(locale, { day: "numeric", month: "short" })}`,
      symbol: "bookmark.fill",
      color: "orange",
      action: "goto",
      args: { index: b.index },
    }))),
    Widget.button(Widget.text("Remove all bookmarks", { color: "red" }), "clearBookmarks", null, { style: "plain" }),
  ], { alignment: "leading", spacing: 12 });
}

Script.ui(async () => {
  const book = Storage.get("book");
  let index = null;
  let text = "";
  let isToday = true;
  if (book) {
    try {
      const today = await todayPassage();
      const view = Storage.get("view");
      isToday = view == null || view === today.index;
      index = isToday ? today.index : view;
      text = isToday ? today.text : ((await passages())[view] ?? "");
    } catch (error) {
      notice(`Could not read the book: ${error.message}`, "warn");
    }
  }

  const tabs = [
    { title: "Read", symbol: "book.pages", content: book && index != null ? readTab(book, index, text, isToday) : libraryTab(book) },
    { title: "Library", symbol: "books.vertical", content: libraryTab(book) },
    { title: "Bookmarks", symbol: "bookmark", content: bookmarksTab(book) },
  ];

  return {
    title: "Daily Passage",
    content: Widget.vstack([
      Widget.tabs(tabs, { selected: Storage.get("tab", book ? 0 : 1), action: "tab" }),
    ], { padding: 16 }),
  };
});

Script.action("tab", ({ value }) => Storage.set("tab", value));
