// @name        Shelf Scanner
// @description Scan a book's barcode or search by title, track your reading pace and projected finish date, and turn library due dates into reminders; looks books up at openlibrary.org
// @permissions camera, network, reminders
// @widget      small, medium, large, rectangular
// @icon        books.vertical.fill
// @color       #B45309
// @version     1.0.0
// @author      va4w
// @category    books

// How it works
// • Open the mini-app and point the camera at the barcode on the back of a book, or type a title or author into the search field.
// • Books are looked up at openlibrary.org: the ISBN or your search words are the only things sent. Covers are loaded from covers.openlibrary.org.
// • Your shelf stays in Storage on the device: status, current page and a dated reading log. The pace (pages a day) and the projected finish date are worked out from that log.
// • A library due date adds a reminder in the Reminders app and shows a countdown; clearing the date removes the reminder again.
// • Widgets show the book you are reading with progress, pace and finish date; the large widget adds a chart of pages read per day.
// • Run the script once in the app before adding a widget, so the permissions are approved.

// ───────────────────────── Constants and helpers

const DAY = 86_400_000;
const PACE_DAYS = 14;
const ACCENT = "#B45309";
const ACCENT_SOFT = { light: "#B4530922", dark: "#F59E0B33" };
const PAPER = { light: "#FDF6EC", dark: "#1F1A14" };
const TILE = { light: "#F5E9D7", dark: "#2B241B" };
const INK = { light: "#3B2A1A", dark: "#F3E9DA" };
const MUTED = { light: "#8A7460", dark: "#B8A48E" };
const STATUSES = [
  { value: "reading", label: "Reading", symbol: "book.fill", color: "orange" },
  { value: "toread", label: "To read", symbol: "bookmark.fill", color: "blue" },
  { value: "finished", label: "Finished", symbol: "checkmark.seal.fill", color: "green" },
];
const locale = Script.env.locale;
const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

const dayKey = (d = new Date()) => new Date(d).toLocaleDateString("en-CA");
const parseDay = (key) => new Date(`${key}T12:00:00`);
const fmtInt = (n) => Math.round(n).toLocaleString(locale);
const fmtDate = (d, options = { day: "numeric", month: "short" }) => new Date(d).toLocaleDateString(locale, options);
const plural = (n, word) => `${fmtInt(n)} ${word}${n === 1 ? "" : "s"}`;
const statusOf = (book) => STATUSES.find((s) => s.value === book.status) ?? STATUSES[1];
const authorsOf = (book) => (book.authors?.length ? book.authors.join(", ") : "Unknown author");

// A symbol followed by text, with the text's font and colour.
function tag(text, symbol, { font = "caption", color = "secondary" } = {}) {
  const size = font === "caption2" ? 10 : font === "caption" || font === "footnote" ? 12 : 14;
  return Widget.hstack([Widget.symbol(symbol, { size, color, fallback: "•" }), Widget.text(text, { font, color, lineLimit: 1, minimumScale: 0.7 })], { spacing: 4 });
}

// ───────────────────────── Shelf in Storage

const books = () => Storage.get("books", []);
const saveBooks = (list) => Storage.set("books", list);
const findBook = (id) => books().find((b) => b.id === id) ?? null;
const updateBook = (id, changes) => saveBooks(books().map((b) => (b.id === id ? { ...b, ...changes } : b)));
const notice = (text, kind = "info") => Storage.set("notice", { text, kind, time: Date.now() });

function currentBook() {
  const list = books();
  const id = Storage.get("current");
  return list.find((b) => b.id === id && b.status === "reading") ?? list.find((b) => b.status === "reading") ?? null;
}

// Pages read on each of the last PACE_DAYS days, from the log of { day, page } entries.
function dailyPages(book) {
  const log = [...(book.log ?? [])].sort((a, b) => a.day.localeCompare(b.day));
  const read = {};
  let previous = 0;
  for (const entry of log) {
    read[entry.day] = (read[entry.day] ?? 0) + Math.max(0, entry.page - previous);
    previous = Math.max(previous, entry.page);
  }
  return Array.from({ length: PACE_DAYS }, (_, i) => {
    const day = dayKey(Date.now() - (PACE_DAYS - 1 - i) * DAY);
    return { day, pages: read[day] ?? 0 };
  });
}

// Average pages a day from the first day with progress in the window, so rest days count against the pace.
function pagesPerDay(book) {
  const series = dailyPages(book);
  const first = series.findIndex((d) => d.pages > 0);
  if (first < 0) return 0;
  const total = series.reduce((sum, d) => sum + d.pages, 0);
  return total / (series.length - first);
}

function projection(book) {
  const pace = pagesPerDay(book);
  const left = Math.max(0, (book.pages ?? 0) - (book.page ?? 0));
  if (!book.pages || pace <= 0 || left === 0) return { pace, left, days: null, date: null };
  const days = Math.ceil(left / pace);
  return { pace, left, days, date: new Date(Date.now() + days * DAY) };
}

function setPage(id, value) {
  const book = findBook(id);
  if (!book) return;
  const page = Math.max(0, Math.min(book.pages || 99_999, Math.round(Number(value) || 0)));
  const today = dayKey();
  const log = [...(book.log ?? []).filter((e) => e.day !== today), { day: today, page }].slice(-120);
  const changes = { page, log };
  if (book.pages && page >= book.pages) {
    changes.status = "finished";
    changes.finished = today;
  } else if (book.status !== "reading" && page > 0) {
    changes.status = "reading";
    if (!book.started) changes.started = today;
  }
  updateBook(id, changes);
}

// ───────────────────────── Open Library

const cleanIsbn = (text) => String(text ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
const isIsbn = (text) => /^(97[89]\d{10}|\d{9}[\dX])$/.test(text);

async function getJSON(url) {
  const response = await fetch(url, { timeout: 12_000 });
  if (!response.ok) throw new Error(`openlibrary.org answered ${response.status}`);
  return response.json();
}

async function lookupIsbn(isbn) {
  const url = new URL("https://openlibrary.org/api/books");
  url.searchParams.set("bibkeys", `ISBN:${isbn}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("jscmd", "data");
  const item = (await getJSON(url))[`ISBN:${isbn}`];
  if (!item) return null;
  return {
    id: isbn,
    isbn,
    title: item.title ?? "Untitled",
    authors: (item.authors ?? []).map((a) => a.name).filter(Boolean).slice(0, 3),
    pages: item.number_of_pages ?? null,
    cover: item.cover ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg` : null,
    year: item.publish_date ?? null,
  };
}

async function searchBooks(query) {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "10");
  url.searchParams.set("fields", "key,title,author_name,isbn,number_of_pages_median,cover_i,first_publish_year");
  const data = await getJSON(url);
  return (data.docs ?? []).map((doc) => {
    const isbn = (doc.isbn ?? []).find((i) => i.length === 13) ?? doc.isbn?.[0] ?? null;
    return {
      id: isbn ?? doc.key,
      isbn,
      title: doc.title ?? "Untitled",
      authors: (doc.author_name ?? []).slice(0, 3),
      pages: doc.number_of_pages_median ?? null,
      cover: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
      year: doc.first_publish_year ?? null,
    };
  });
}

function addBook(info, status) {
  if (findBook(info.id)) {
    notice(`“${info.title}” is already on your shelf.`);
  } else {
    const today = dayKey();
    const book = { ...info, status, page: 0, log: [], added: today, started: status === "reading" ? today : null, finished: null, due: null, reminderId: null };
    saveBooks([book, ...books()]);
    if (status === "reading" && !currentBook()) Storage.set("current", book.id);
    notice(`Added “${info.title}”.`, "success");
  }
  Storage.set("selected", info.id);
  Storage.set("page", "book");
}

async function addByIsbn(raw) {
  const isbn = cleanIsbn(raw);
  if (!isIsbn(isbn)) {
    notice(`“${raw}” does not look like an ISBN. Try the barcode above the price, or search by title.`, "warn");
    return;
  }
  if (findBook(isbn)) return addBook({ id: isbn, title: findBook(isbn).title }, "toread");
  Storage.set("busy", `Looking up ${isbn}…`);
  try {
    const info = await lookupIsbn(isbn);
    if (!info) notice(`Open Library has no record for ISBN ${isbn}. Try searching by title.`, "warn");
    else addBook(info, "toread");
  } catch (error) {
    notice(`Could not reach openlibrary.org: ${error.message}`, "warn");
  } finally {
    Storage.remove("busy");
  }
}

// ───────────────────────── Library due dates and reminders

async function setDue(id, iso) {
  const book = findBook(id);
  if (!book) return;
  if (book.reminderId) {
    try { await Reminders.remove(book.reminderId); } catch { /* already gone */ }
  }
  if (!iso) {
    updateBook(id, { due: null, reminderId: null });
    return;
  }
  const due = new Date(iso);
  due.setHours(9, 0, 0, 0);
  let reminderId = null;
  try {
    const reminder = await Reminders.add({
      title: `Return “${book.title}” to the library`,
      notes: `Due ${fmtDate(due, { day: "numeric", month: "long" })}. Added by Shelf Scanner.`,
      due,
    });
    reminderId = reminder.id;
  } catch (error) {
    notice(`Due date saved, but no reminder was added: ${error.message}`, "warn");
  }
  updateBook(id, { due: due.toISOString(), reminderId });
}

// ───────────────────────── Actions

Script.action("nav", ({ page }) => { Storage.set("page", page); Storage.remove("notice"); });
Script.action("open", ({ id }) => { Storage.set("selected", id); Storage.set("page", "book"); Storage.remove("notice"); });
Script.action("filter", ({ value }) => Storage.set("filter", value));
Script.action("scanned", ({ value }) => addByIsbn(value));

Script.action("typeIsbn", async () => {
  const text = await UI.prompt({ title: "ISBN", message: "The 10 or 13 digits printed above the barcode.", placeholder: "9780140328721" });
  if (text) await addByIsbn(text);
});

Script.action("query", async ({ value }) => {
  const query = String(value ?? "").trim();
  Storage.set("query", query);
  if (!query) { Storage.remove("results"); return; }
  if (isIsbn(cleanIsbn(query))) return addByIsbn(query);
  Storage.set("busy", `Searching for “${query}”…`);
  try {
    Storage.set("results", await searchBooks(query));
    Storage.remove("notice");
  } catch (error) {
    notice(`Could not reach openlibrary.org: ${error.message}`, "warn");
  } finally {
    Storage.remove("busy");
  }
});

Script.action("pick", ({ index, status }) => {
  const info = Storage.get("results", [])[index];
  if (info) addBook(info, status);
});

Script.action("status", ({ id, value }) => {
  const book = findBook(id);
  if (!book) return;
  const today = dayKey();
  const changes = { status: value };
  if (value === "reading" && !book.started) changes.started = today;
  if (value === "finished") { changes.finished = today; if (book.pages) changes.page = book.pages; }
  if (value === "toread") { changes.page = 0; changes.finished = null; }
  updateBook(id, changes);
  if (value === "reading" && !currentBook()) Storage.set("current", id);
});

Script.action("page", ({ id, value }) => setPage(id, value));
Script.action("bump", ({ id, by }) => { const b = findBook(id); if (b) setPage(id, (b.page ?? 0) + by); });
Script.action("current", ({ id }) => { Storage.set("current", id); updateBook(id, { status: "reading" }); });
Script.action("due", ({ id, value }) => setDue(id, value));
Script.action("dueToggle", ({ id, isOn }) => setDue(id, isOn ? new Date(Date.now() + 21 * DAY).toISOString() : null));

Script.action("pages", async ({ id }) => {
  const book = findBook(id);
  const text = await UI.prompt({ title: "How many pages?", defaultValue: book?.pages ? String(book.pages) : "", placeholder: "320" });
  const pages = Number(text);
  if (text && Number.isFinite(pages) && pages > 0) updateBook(id, { pages: Math.round(pages) });
});

Script.action("remove", async ({ id }) => {
  const book = findBook(id);
  if (!book) return;
  const choice = await UI.alert({ title: `Remove “${book.title}”?`, message: "Its reading log goes too. This cannot be undone.", buttons: ["Cancel", "Remove"] });
  if (choice !== 1) return;
  if (book.reminderId) { try { await Reminders.remove(book.reminderId); } catch { /* already gone */ } }
  saveBooks(books().filter((b) => b.id !== id));
  if (Storage.get("current") === id) Storage.remove("current");
  Storage.set("page", "shelf");
});

// ───────────────────────── Shared pieces

function cover(book, size, radius = 6) {
  if (book.cover) return Widget.image({ src: book.cover, size, cornerRadius: radius, contentMode: "fit" });
  return Widget.vstack([
    Widget.symbol("book.closed.fill", { size: Math.round(size * 0.45), color: ACCENT, fallback: "📕" }),
  ], { frame: { width: size, height: Math.round(size * 1.45) }, background: ACCENT_SOFT, cornerRadius: radius });
}

function progressBar(book, color = ACCENT) {
  const fraction = book.pages ? Math.min(1, (book.page ?? 0) / book.pages) : 0;
  return Widget.progress(fraction, { color });
}

function paceLine(book) {
  const { pace, days, date } = projection(book);
  if (pace <= 0) return "No pages logged yet";
  const finish = date ? ` · done ${days <= 1 ? "tomorrow" : `~${fmtDate(date)}`}` : "";
  return `${pace.toFixed(pace < 10 ? 1 : 0)} pages/day${finish}`;
}

function pagesChart(book, height, axes) {
  const series = dailyPages(book);
  if (!series.some((d) => d.pages > 0)) return Widget.text("Log your page to see pages read per day.", { font: "caption2", color: MUTED });
  const data = series.map((d) => ({ x: parseDay(d.day).toLocaleDateString(locale, { day: "2-digit" }), y: d.pages }));
  return Widget.chart(data, { kind: "bar", color: ACCENT, axes, frame: { height } });
}

function dueBadge(book, font = "caption2") {
  if (!book.due) return null;
  const days = Math.ceil((new Date(book.due) - Date.now()) / DAY);
  const color = days < 0 ? "red" : days <= 3 ? "orange" : "secondary";
  const text = days < 0 ? `overdue ${plural(-days, "day")}` : days === 0 ? "due today" : `due in ${plural(days, "day")}`;
  return tag(text, "building.columns.fill", { font, color });
}

// ───────────────────────── Widget

function emptyWidget(family) {
  const toRead = books().filter((b) => b.status === "toread").length;
  const hint = toRead ? `${plural(toRead, "book")} waiting. Open Shelf Scanner and start one.` : "Open Shelf Scanner and scan a barcode.";
  if (family === "rectangular") return Widget.vstack([
    Widget.text("Shelf Scanner", { font: "headline" }),
    Widget.text(hint, { font: "caption2", lineLimit: 2 }),
  ], { alignment: "leading", spacing: 2, url: appLink });
  return Widget.vstack([
    Widget.symbol("books.vertical.fill", { size: 28, color: ACCENT, fallback: "📚" }),
    Widget.text("Nothing on the go", { font: "headline", color: INK }),
    Widget.text(hint, { font: "caption2", color: MUTED, align: "center", lineLimit: 3 }),
  ], { spacing: 6, padding: 14, background: PAPER, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
}

Script.widget(({ family }) => {
  const book = currentBook();
  if (!book) return { content: emptyWidget(family), refreshAfter: 60 * 60 };

  const { pace, left, days, date } = projection(book);
  const percent = book.pages ? Math.round(((book.page ?? 0) / book.pages) * 100) : null;
  const pageText = book.pages ? `p. ${fmtInt(book.page ?? 0)} of ${fmtInt(book.pages)}` : `p. ${fmtInt(book.page ?? 0)}`;
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  let content;

  if (family === "rectangular") {
    content = Widget.vstack([
      Widget.text(book.title, { font: "headline", lineLimit: 1 }),
      progressBar(book, "primary"),
      Widget.hstack([
        Widget.text(pageText, { font: "caption2" }),
        Widget.spacer(),
        Widget.text(days ? `${plural(days, "day")} left` : pace > 0 ? `${pace.toFixed(0)}/day` : "log a page", { font: "caption2" }),
      ]),
    ], { alignment: "leading", spacing: 3, url: appLink });
  } else if (family === "small") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("book.fill", { size: 11, color: ACCENT, fallback: "📖" }),
        Widget.text("READING", { font: "caption2", weight: "bold", color: MUTED }),
        Widget.spacer(),
        percent === null ? null : Widget.text(`${percent}%`, { font: "caption2", weight: "bold", color: ACCENT }),
      ], { spacing: 4 }),
      Widget.text(book.title, { font: "headline", color: INK, lineLimit: 2, minimumScale: 0.8 }),
      Widget.text(authorsOf(book), { font: "caption2", color: MUTED, lineLimit: 1 }),
      Widget.spacer(),
      progressBar(book),
      Widget.text(pageText, { font: "caption2", weight: "medium", color: INK }),
      Widget.text(paceLine(book), { font: "caption2", color: MUTED, lineLimit: 1, minimumScale: 0.7 }),
    ], { alignment: "leading", spacing: 3, padding: 14, background: PAPER, url: appLink, frame: fill });
  } else if (family === "medium") {
    content = Widget.hstack([
      cover(book, 78, 8),
      Widget.vstack([
        Widget.text(book.title, { font: "headline", color: INK, lineLimit: 2 }),
        Widget.text(authorsOf(book), { font: "caption", color: MUTED, lineLimit: 1 }),
        Widget.spacer(),
        progressBar(book),
        Widget.hstack([
          Widget.text(pageText, { font: "caption", weight: "medium", color: INK }),
          Widget.spacer(),
          percent === null ? null : Widget.text(`${percent}%`, { font: "caption", weight: "bold", color: ACCENT }),
        ]),
        Widget.hstack([
          tag(pace > 0 ? `${pace.toFixed(pace < 10 ? 1 : 0)} pages/day` : "no pace yet", "speedometer", { font: "caption2", color: MUTED }),
          Widget.spacer(),
          date ? tag(`~${fmtDate(date)}`, "flag.checkered", { font: "caption2", color: MUTED }) : dueBadge(book),
        ]),
      ], { alignment: "leading", spacing: 3, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 12, padding: 14, background: PAPER, url: appLink, frame: fill });
  } else {
    const queue = books().filter((b) => b.status === "toread").slice(0, 3);
    const stat = (label, value, symbol) => Widget.vstack([
      tag(label, symbol, { font: "caption2", color: MUTED }),
      Widget.text(value, { font: "subheadline", weight: "bold", color: INK, lineLimit: 1, minimumScale: 0.7 }),
    ], { alignment: "leading", spacing: 2, padding: 8, background: TILE, cornerRadius: 10, frame: { maxWidth: "infinity", alignment: "leading" } });

    content = Widget.vstack([
      Widget.hstack([
        cover(book, 64, 8),
        Widget.vstack([
          Widget.text(book.title, { font: "headline", color: INK, lineLimit: 2 }),
          Widget.text(authorsOf(book), { font: "caption", color: MUTED, lineLimit: 1 }),
          Widget.spacer(4),
          progressBar(book),
          Widget.text(`${pageText}${percent === null ? "" : ` · ${percent}%`}`, { font: "caption", weight: "medium", color: INK }),
        ], { alignment: "leading", spacing: 3, frame: { maxWidth: "infinity", alignment: "leading" } }),
      ], { spacing: 12, alignment: "top" }),
      Widget.hstack([
        stat("Pace", pace > 0 ? `${pace.toFixed(pace < 10 ? 1 : 0)} /day` : "–", "speedometer"),
        stat("Left", book.pages ? plural(left, "page") : "–", "book.pages"),
        stat("Finish", date ? fmtDate(date) : "–", "flag.checkered"),
      ], { spacing: 8 }),
      Widget.text("PAGES READ · LAST 14 DAYS", { font: "caption2", weight: "bold", color: MUTED }),
      pagesChart(book, 86, false),
      book.due ? dueBadge(book, "caption") : null,
      queue.length ? Widget.text(`Up next: ${queue.map((b) => b.title).join(" · ")}`, { font: "caption2", color: MUTED, lineLimit: 1 }) : null,
      Widget.spacer(),
    ], { alignment: "leading", spacing: 8, padding: 16, background: PAPER, url: appLink, frame: fill });
  }

  return { content, refreshAfter: 60 * 60 };
});

// ───────────────────────── Script.run (Siri and Shortcuts)

Script.run(() => {
  const book = currentBook();
  if (!book) return "You are not reading anything right now. Open Shelf Scanner to start a book.";
  const { pace, days, date } = projection(book);
  const where = book.pages ? `page ${book.page ?? 0} of ${book.pages}` : `page ${book.page ?? 0}`;
  const finish = date ? ` At ${pace.toFixed(1)} pages a day you will finish in about ${plural(days, "day")}, around ${fmtDate(date, { weekday: "long", day: "numeric", month: "long" })}.` : "";
  return `You are on ${where} of ${book.title} by ${authorsOf(book)}.${finish}`;
});

// ───────────────────────── Mini-app pages

const NOTICE_COLORS = { info: "blue", success: "green", warn: "orange" };
function noticeView() {
  const n = Storage.get("notice");
  const busy = Storage.get("busy");
  if (busy) return tag(busy, "hourglass", { color: "secondary", font: "footnote" });
  if (!n) return null;
  return Widget.text(n.text, { font: "footnote", color: NOTICE_COLORS[n.kind] ?? "secondary", padding: 10, background: TILE, cornerRadius: 10, frame: { maxWidth: "infinity", alignment: "leading" } });
}

function heroCard(book) {
  const { pace, days, date } = projection(book);
  const percent = book.pages ? Math.round(((book.page ?? 0) / book.pages) * 100) : null;
  return Widget.button(Widget.hstack([
    cover(book, 70, 8),
    Widget.vstack([
      Widget.text("READING NOW", { font: "caption2", weight: "bold", color: ACCENT }),
      Widget.text(book.title, { font: "headline", lineLimit: 2 }),
      Widget.text(authorsOf(book), { font: "caption", color: "secondary", lineLimit: 1 }),
      progressBar(book),
      Widget.text(`${book.pages ? `p. ${fmtInt(book.page ?? 0)} of ${fmtInt(book.pages)} · ${percent}%` : `p. ${fmtInt(book.page ?? 0)}`}${pace > 0 ? ` · ${pace.toFixed(1)}/day` : ""}${date ? ` · ~${fmtDate(date)}` : ""}`, { font: "caption", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
    ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", alignment: "leading" } }),
    Widget.symbol("chevron.right", { size: 14, color: "secondary", fallback: "›" }),
  ], { spacing: 12, padding: 12, background: TILE, cornerRadius: 14 }), "open", { id: book.id });
}

function shelfPage() {
  const list = books();
  const filter = Storage.get("filter", "all");
  const current = currentBook();
  const shown = list.filter((b) => filter === "all" || b.status === filter);
  const rows = shown.map((b) => {
    const s = statusOf(b);
    const detail = b.status === "reading" && b.pages ? `${Math.round(((b.page ?? 0) / b.pages) * 100)}%` : b.status === "finished" && b.finished ? fmtDate(b.finished) : b.pages ? `${fmtInt(b.pages)} p.` : "";
    return { title: b.title, subtitle: `${authorsOf(b)}${b.due ? " · library" : ""}`, symbol: s.symbol, color: s.color, detail, action: "open", args: { id: b.id } };
  });
  const finished = list.filter((b) => b.status === "finished").length;

  return {
    title: "Shelf",
    content: Widget.vstack([
      noticeView(),
      current ? heroCard(current) : Widget.vstack([
        Widget.symbol("books.vertical.fill", { size: 44, color: ACCENT, fallback: "📚" }),
        Widget.text(list.length ? "Pick a book to start reading" : "Your shelf is empty", { font: "title3", weight: "semibold" }),
        Widget.text(list.length ? "Tap a book below and set its status to Reading." : "Scan a barcode or search for a title to add your first book.", { font: "footnote", color: "secondary", align: "center" }),
      ], { spacing: 8, padding: 16, frame: { maxWidth: "infinity" } }),
      Widget.button(tag("Add a book", "barcode.viewfinder", { color: "white", font: "headline" }), "nav", { page: "add" }, { style: "prominent", color: ACCENT }),
      list.length ? Widget.picker([{ label: `All ${list.length}`, value: "all" }, ...STATUSES.map((s) => ({ label: s.label, value: s.value }))], filter, "filter", null, { style: "segmented" }) : null,
      rows.length ? Widget.list(rows) : list.length ? Widget.text("Nothing with this status.", { color: "secondary", align: "center", padding: 12 }) : null,
      list.length ? Widget.text(`${plural(list.length, "book")} · ${finished} finished · ${fmtInt(list.reduce((sum, b) => sum + (b.status === "finished" ? b.pages ?? 0 : b.page ?? 0), 0))} pages read`, { font: "caption", color: "secondary", align: "center" }) : null,
    ], { spacing: 14, padding: 16 }),
  };
}

function resultRow(info, index) {
  const onShelf = Boolean(findBook(info.id));
  const meta = [info.authors.join(", ") || "Unknown author", info.year ? String(info.year) : null, info.pages ? `${fmtInt(info.pages)} p.` : null].filter(Boolean).join(" · ");
  return Widget.hstack([
    cover(info, 40, 4),
    Widget.vstack([
      Widget.text(info.title, { font: "subheadline", weight: "medium", lineLimit: 2 }),
      Widget.text(meta, { font: "caption", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
    onShelf
      ? Widget.button(Widget.symbol("checkmark.circle.fill", { size: 24, color: "green", fallback: "✓" }), "open", { id: info.id })
      : Widget.menu("plus.circle.fill", [
        { title: "Start reading", symbol: "book.fill", action: "pick", args: { index, status: "reading" } },
        { title: "Add to To read", symbol: "bookmark.fill", action: "pick", args: { index, status: "toread" } },
        { title: "Already finished", symbol: "checkmark.seal.fill", action: "pick", args: { index, status: "finished" } },
      ]),
  ], { spacing: 10, padding: { vertical: 6 } });
}

function addPage() {
  const results = Storage.get("results", []);
  const query = Storage.get("query", "");
  return {
    title: "Add a book",
    content: Widget.vstack([
      Widget.button(tag("Back to shelf", "chevron.left", { font: "body", color: ACCENT }), "nav", { page: "shelf" }, { style: "plain" }),
      Widget.scanner("scanned", { find: ["barcode"], frame: { height: 220 } }),
      Widget.text("Point the camera at the barcode on the back cover.", { font: "footnote", color: "secondary", align: "center" }),
      noticeView(),
      Widget.textField("Title, author or ISBN", query, "query", null, { label: "Search Open Library", keyboard: "search" }),
      Widget.button(tag("Type an ISBN instead", "keyboard", { font: "body", color: ACCENT }), "typeIsbn", null, { style: "bordered" }),
      results.length ? Widget.divider() : null,
      results.length ? Widget.text(`${results.length} results for “${query}”`, { font: "caption", weight: "semibold", color: "secondary" }) : null,
      ...results.map(resultRow),
      query && !results.length && !Storage.get("busy") ? Widget.text("No results. Try fewer words.", { color: "secondary", align: "center" }) : null,
    ], { alignment: "leading", spacing: 12, padding: 16 }),
  };
}

function bookPage(book) {
  const { pace, left, days, date } = projection(book);
  const s = statusOf(book);
  const isCurrent = currentBook()?.id === book.id;
  const dueDefault = book.due ?? new Date(Date.now() + 21 * DAY).toISOString();
  const stat = (label, value) => Widget.vstack([
    Widget.text(label, { font: "caption2", color: "secondary" }),
    Widget.text(value, { font: "headline", lineLimit: 1, minimumScale: 0.6 }),
  ], { alignment: "leading", spacing: 2, padding: 10, background: TILE, cornerRadius: 10, frame: { maxWidth: "infinity", alignment: "leading" } });

  return {
    title: book.title,
    content: Widget.vstack([
      Widget.hstack([
        Widget.button(tag("Shelf", "chevron.left", { font: "body", color: ACCENT }), "nav", { page: "shelf" }, { style: "plain" }),
        Widget.spacer(),
        Widget.menu("ellipsis.circle", [
          { title: "Set page count", symbol: "number", action: "pages", args: { id: book.id } },
          { title: "Remove from shelf", symbol: "trash", action: "remove", args: { id: book.id }, destructive: true },
        ]),
      ]),
      noticeView(),
      Widget.hstack([
        cover(book, 96, 10),
        Widget.vstack([
          Widget.text(book.title, { font: "title3", weight: "bold", lineLimit: 3 }),
          Widget.text(authorsOf(book), { font: "subheadline", color: "secondary", lineLimit: 2 }),
          Widget.text([book.year ? String(book.year) : null, book.pages ? `${fmtInt(book.pages)} pages` : "page count unknown", book.isbn ? `ISBN ${book.isbn}` : null].filter(Boolean).join(" · "), { font: "caption", color: "secondary", lineLimit: 2 }),
        ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", alignment: "leading" } }),
      ], { spacing: 14, alignment: "top" }),
      Widget.picker(STATUSES.map((x) => ({ label: x.label, value: x.value })), book.status, "status", { id: book.id }, { style: "segmented" }),
      book.status === "reading" && !isCurrent ? Widget.button(tag("Show this one in the widget", "star", { font: "body", color: ACCENT }), "current", { id: book.id }, { style: "bordered" }) : null,
      book.status !== "toread" ? Widget.card([
        progressBar(book, s.color),
        Widget.hstack([
          Widget.text(book.pages ? `Page ${fmtInt(book.page ?? 0)} of ${fmtInt(book.pages)}` : `Page ${fmtInt(book.page ?? 0)}`, { font: "headline" }),
          Widget.spacer(),
          book.pages ? Widget.text(`${Math.round(((book.page ?? 0) / book.pages) * 100)}%`, { font: "headline", color: ACCENT }) : Widget.button("Set page count", "pages", { id: book.id }, { style: "plain" }),
        ]),
        Widget.slider(book.page ?? 0, "page", { id: book.id }, { min: 0, max: book.pages || 1000, step: 1, color: ACCENT }),
        Widget.hstack([
          Widget.button("−10", "bump", { id: book.id, by: -10 }, { style: "bordered" }),
          Widget.button("−1", "bump", { id: book.id, by: -1 }, { style: "bordered" }),
          Widget.spacer(),
          Widget.button("+1", "bump", { id: book.id, by: 1 }, { style: "bordered" }),
          Widget.button("+10", "bump", { id: book.id, by: 10 }, { style: "bordered" }),
          Widget.button("+25", "bump", { id: book.id, by: 25 }, { style: "prominent", color: ACCENT }),
        ], { spacing: 8 }),
      ], { title: "Where you are", symbol: "bookmark.fill", color: ACCENT }) : null,
      book.status === "reading" ? Widget.card([
        Widget.hstack([
          stat("Pace", pace > 0 ? `${pace.toFixed(1)} p/day` : "–"),
          stat("Pages left", book.pages ? fmtInt(left) : "–"),
          stat("Finish", date ? fmtDate(date) : "–"),
        ], { spacing: 8 }),
        Widget.text(date ? `At this pace you finish in ${plural(days, "day")}, around ${fmtDate(date, { weekday: "long", day: "numeric", month: "long" })}.` : pace > 0 ? "Set the page count to get a finish date." : "Log the page you are on each time you read; the pace averages the last 14 days.", { font: "footnote", color: "secondary" }),
        pagesChart(book, 160, true),
      ], { title: "Pages per day", subtitle: `started ${book.started ? fmtDate(book.started) : "–"}`, symbol: "chart.bar.fill", color: "orange" }) : null,
      book.status === "finished" ? Widget.card([
        Widget.text(`Finished ${book.finished ? fmtDate(book.finished, { day: "numeric", month: "long", year: "numeric" }) : ""}${book.started ? ` after ${plural(Math.max(1, Math.round((parseDay(book.finished ?? dayKey()) - parseDay(book.started)) / DAY)), "day")}` : ""}.`, { font: "footnote" }),
        pagesChart(book, 120, true),
      ], { title: "Done", symbol: "checkmark.seal.fill", color: "green" }) : null,
      Widget.card([
        Widget.toggle("Borrowed from a library", Boolean(book.due), "dueToggle", { id: book.id }, { color: ACCENT }),
        book.due ? Widget.datePicker(dueDefault, "due", { id: book.id }, { label: "Return by", mode: "date" }) : null,
        book.due ? Widget.hstack([
          dueBadge(book, "subheadline"),
          Widget.spacer(),
          Widget.date(book.due, { style: "relative", font: "caption", color: "secondary" }),
        ]) : Widget.text("Turn this on to set a return date. A reminder is added for 9:00 that morning.", { font: "footnote", color: "secondary" }),
        book.due && book.reminderId ? tag("Reminder set", "bell.fill", { font: "caption", color: "green" }) : null,
      ], { title: "Library due date", symbol: "building.columns.fill", color: "blue" }),
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
}

Script.ui(() => {
  const page = Storage.get("page", "shelf");
  if (page === "add") return addPage();
  if (page === "book") {
    const book = findBook(Storage.get("selected"));
    if (book) return bookPage(book);
  }
  return shelfPage();
});
