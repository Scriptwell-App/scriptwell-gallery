// @name        Morning Briefing
// @description Pulls the latest headlines from the RSS feeds you choose (BBC News and The Guardian by default), condenses them into a short briefing with on-device AI, reads it aloud and shows it in a widget. Contacts only the feed hosts
// @permissions network
// @widget      small, medium, large
// @icon        sunrise.fill
// @color       #F59E0B
// @version     1.0.0
// @author      va4w
// @category    magazines-newspapers

// How it works
// • Fetches the feeds listed under Settings (RSS or Atom, parsed with regular expressions), keeps the
//   latest 20 headlines with the first sentence of each description, and groups them by publication.
//   Only the feed hosts are contacted; nothing else is sent anywhere.
// • Apple Intelligence (on-device AI.summarize) condenses them into about six bullet points. When the
//   model is not available the briefing is the top headlines, word for word.
// • Tap ▶, or run it from Shortcuts, and the briefing is read aloud with the system voice; the mini-app
//   has Read aloud and Stop buttons. Pass "quiet" as the input to skip the voice.
// • For a 7 am briefing: Shortcuts › Automation › Time of Day › 7:00, Run Immediately, then add the
//   action Scriptwell › Run Script and choose Morning Briefing. Run Script returns the briefing text,
//   so you can hand it to Speak Text, Messages or a note as well.
// • The latest briefing is stored with its time; the widget shows it (medium: three bullets, large: all).

// ───────────────────────── Constants

const DEFAULT_FEEDS = [
  { id: "bbc", name: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml" },
  { id: "guardian", name: "The Guardian", url: "https://www.theguardian.com/world/rss" },
];
const DEFAULT_SETTINGS = { speak: true, rate: 1, bullets: 6 };
const HEADLINES = 20;
const SENTENCE_CHARS = 180;
const TIME_LIMITS = { app: 30_000, pwa: 30_000, shortcut: 20_000, background: 15_000, widget: 8_000 };
const FETCH_TIMEOUT = { shortcut: 7000, background: 6000, app: 10000, pwa: 10000 };
const DAWN = Widget.gradient([{ light: "#FFF7ED", dark: "#2A1B0E" }, { light: "#FFEDD5", dark: "#1C1410" }], { direction: "topToBottom" });
const AMBER = { light: "#B45309", dark: "#FBBF24" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

const started = Date.now();
const timeLeft = () => (TIME_LIMITS[Script.env.mode] ?? 20_000) - (Date.now() - started);

// ───────────────────────── Settings

const feeds = () => Storage.get("feeds") ?? DEFAULT_FEEDS;
const settings = () => ({ ...DEFAULT_SETTINGS, ...Storage.get("settings", {}) });
const saveSettings = (changes) => Storage.set("settings", { ...settings(), ...changes });
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

// ───────────────────────── Parsing RSS and Atom without a DOM

const ENTITIES = { quot: '"', apos: "'", lt: "<", gt: ">", amp: "&", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", mdash: "—", ndash: "–" };
const codePoint = (n) => (n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "");

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

function clean(raw) {
  let text = String(raw ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  text = decodeEntities(text).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

function tagText(block, names) {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i").exec(block);
    if (match) return match[1];
  }
  return "";
}

function linkOf(block, atom) {
  if (atom) {
    const tags = [...block.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    const tag = tags.find((t) => /rel=["']alternate["']/i.test(t)) ?? tags.find((t) => !/rel=/i.test(t)) ?? tags[0];
    return tag ? /\shref=["']([^"']+)["']/i.exec(tag)?.[1] ?? "" : "";
  }
  const plain = clean(tagText(block, ["link"]));
  if (plain.startsWith("http")) return plain;
  const guid = clean(tagText(block, ["guid"]));
  return guid.startsWith("http") ? guid : plain;
}

// The first sentence of a description, so a headline has one line of context.
function firstSentence(text) {
  if (!text) return "";
  const match = /^[\s\S]*?[.!?](?=["”’)]?\s|$)/.exec(text);
  const sentence = (match ? match[0] : text).trim();
  return sentence.length > SENTENCE_CHARS ? `${sentence.slice(0, SENTENCE_CHARS - 1).trimEnd()}…` : sentence;
}

function parseFeed(xml) {
  const atom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const firstItem = xml.search(atom ? /<entry[\s>]/i : /<item[\s>]/i);
  const title = clean(tagText(firstItem > 0 ? xml.slice(0, firstItem) : xml, ["title"]));
  const items = [];
  for (const [block] of xml.matchAll(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi)) {
    const itemTitle = clean(tagText(block, ["title"]));
    if (!itemTitle) continue;
    const summary = clean(tagText(block, ["description", "summary", "content:encoded", "content"]));
    items.push({
      title: itemTitle,
      sentence: summary === itemTitle ? "" : firstSentence(summary),
      link: decodeEntities(linkOf(block, atom)).trim(),
      date: Date.parse(clean(tagText(block, ["pubDate", "published", "updated", "dc:date"]))) || 0,
    });
  }
  return { title, items };
}

// ───────────────────────── Headlines

async function fetchHeadlines() {
  const timeout = FETCH_TIMEOUT[Script.env.mode] ?? 8000;
  const list = feeds();
  const results = await Promise.allSettled(list.map(async (feed) => {
    const response = await fetch(feed.url, { timeout, headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8" } });
    if (!response.ok) throw new Error(`${response.status} from ${hostOf(feed.url)}`);
    const parsed = parseFeed(await response.text());
    if (parsed.items.length === 0) throw new Error(`no articles at ${hostOf(feed.url)}`);
    return parsed.items.map((item, index) => ({ ...item, index, feed: feed.name, feedId: feed.id }));
  }));

  const errors = results.map((r, i) => (r.status === "rejected" ? `${list[i].name}: ${r.reason?.message ?? r.reason}` : null)).filter(Boolean);
  const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (all.length === 0) throw new Error(errors.join(" · ") || "No feeds configured");

  // Newest first; feeds without dates fall back to their own order, interleaved fairly.
  const latest = all.sort((a, b) => b.date - a.date || a.index - b.index).slice(0, HEADLINES);
  const groups = list
    .map((feed) => ({ name: feed.name, items: latest.filter((item) => item.feedId === feed.id).map(({ title, sentence, link }) => ({ title, sentence, link })) }))
    .filter((group) => group.items.length > 0);
  return { groups, errors };
}

// ───────────────────────── Summarising

function splitSentences(text) {
  return text
    .replace(/\r/g, "")
    .split(/\n+|(?<=[.!?]["”’)]?)\s+(?=["“(A-Z0-9])/)
    .map((line) => line.replace(/^\s*(?:[-•*–]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 12);
}

async function condense(groups, wanted) {
  const text = groups
    .map((group) => `${group.name}:\n${group.items.map((item) => `- ${item.title}${item.sentence ? `. ${item.sentence}` : ""}`).join("\n")}`)
    .join("\n\n")
    .slice(0, 11_000);
  const status = await AI.availability();
  if (!status.available) return null;
  const summary = await AI.summarize(text, { sentences: wanted });
  const bullets = splitSentences(summary).slice(0, wanted + 2);
  return bullets.length >= 2 ? bullets : null;
}

async function buildBriefing() {
  const { groups, errors } = await fetchHeadlines();
  const wanted = settings().bullets;
  let bullets = null, mode = "headlines";
  try {
    bullets = await condense(groups, wanted);
    if (bullets) mode = "ai";
  } catch (error) {
    console.warn("On-device AI did not answer, using the headlines:", error.message);
  }
  if (!bullets) {
    // Top headlines verbatim, taking turns between publications so one feed does not crowd out the rest.
    bullets = [];
    for (let i = 0; bullets.length < wanted && groups.some((g) => g.items[i]); i++) {
      for (const group of groups) if (group.items[i] && bullets.length < wanted) bullets.push(group.items[i].title);
    }
  }
  const briefing = {
    bullets, groups, mode, time: Date.now(),
    headlines: groups.reduce((sum, g) => sum + g.items.length, 0),
    sources: groups.map((g) => g.name),
    errors,
  };
  Storage.set("briefing", briefing);
  return briefing;
}

const dateLine = (time) => new Date(time).toLocaleDateString(Script.env.locale, { weekday: "long", day: "numeric", month: "long" });

function briefingText(b) {
  return [`Briefing for ${dateLine(b.time)}.`, ...b.bullets.map((line) => `• ${line}`), `Sources: ${b.sources.join(", ")}.`].join("\n");
}

function spokenText(b) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
  return `${greeting} Here is your briefing for ${dateLine(b.time)}. ${b.bullets.join(" ")} That was from ${b.sources.join(" and ")}.`;
}

// Speech is awaited only as long as the run has time to spare, so a long briefing cannot trip the limit.
async function speak(text) {
  const budget = Math.max(1000, timeLeft() - 2500);
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, budget); });
  try {
    await Promise.race([Speech.say(text, { rate: settings().rate }), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────── Run (▶, Shortcuts, Siri)

Script.run(async (input) => {
  const words = String(input ?? "").toLowerCase();
  const quiet = /\b(quiet|silent|text)\b/.test(words);
  let briefing;
  try {
    briefing = await buildBriefing();
  } catch (error) {
    briefing = Storage.get("briefing");
    if (!briefing) return `Could not load the headlines: ${error.message}`;
    briefing.stale = error.message;
  }
  if (settings().speak && !quiet) {
    try { await speak(spokenText(briefing)); } catch (error) { console.warn("Speech:", error.message); }
  }
  return briefingText(briefing) + (briefing.stale ? `\n(Shown from the last run; feeds did not load: ${briefing.stale})` : "");
});

// ───────────────────────── Widget

function bulletRow(line, { font = "footnote", lines = 2 } = {}) {
  return Widget.hstack([
    Widget.text("•", { font, weight: "bold", color: AMBER }),
    Widget.text(line, { font, lineLimit: lines }),
  ], { spacing: 6, alignment: "top" });
}

function header(b, { compact = false } = {}) {
  const old = Date.now() - b.time > 20 * 3_600_000;
  return Widget.hstack([
    Widget.symbol("sunrise.fill", { size: compact ? 13 : 15, color: "orange", fallback: "🌅" }),
    Widget.text(compact ? "BRIEFING" : "MORNING BRIEFING", { font: compact ? "caption2" : "caption", weight: "heavy", color: AMBER, lineLimit: 1 }),
    Widget.spacer(),
    Widget.text(old ? new Date(b.time).toLocaleDateString(Script.env.locale, { day: "numeric", month: "short" }) : new Date(b.time).toLocaleTimeString(Script.env.locale, { hour: "2-digit", minute: "2-digit" }), { font: "caption2", color: "secondary", lineLimit: 1 }),
  ], { spacing: 5 });
}

function sourcesLine(b) {
  return Widget.text(`${b.sources.join(", ")} · ${b.headlines} headlines · ${b.mode === "ai" ? "on-device AI" : "top headlines"}`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 });
}

const root = { alignment: "leading", spacing: 6, padding: 12, background: DAWN, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } };

Script.widget(({ family }) => {
  const b = Storage.get("briefing");
  if (!b) {
    return Widget.vstack([
      Widget.symbol("sunrise.fill", { size: 28, color: "orange", fallback: "🌅" }),
      Widget.text("Run Morning Briefing once, or set a 7 am automation.", { font: "caption", color: "secondary", align: "center", lineLimit: 3 }),
    ], { spacing: 8, padding: 12, background: DAWN, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
  }

  let content;
  if (family === "small") {
    content = Widget.vstack([
      header(b, { compact: true }),
      Widget.text(b.bullets[0] ?? "", { font: 13, weight: "medium", lineLimit: 6, minimumScale: 0.8 }),
      Widget.spacer(),
      Widget.text(`+${Math.max(0, b.bullets.length - 1)} more · ${b.sources.length} sources`, { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], root);
  } else if (family === "medium") {
    content = Widget.vstack([
      header(b),
      ...b.bullets.slice(0, 3).map((line) => bulletRow(line)),
      Widget.spacer(),
      sourcesLine(b),
    ], root);
  } else {
    content = Widget.vstack([
      header(b),
      Widget.text(dateLine(b.time), { font: "headline", design: "serif" }),
      ...b.bullets.slice(0, 8).map((line) => bulletRow(line, { font: "subheadline", lines: 3 })),
      Widget.spacer(),
      sourcesLine(b),
    ], { ...root, spacing: 8, padding: 16 });
  }
  return { content, refreshAfter: 60 * 60 };
});

// ───────────────────────── Mini-app actions

Script.action("page", ({ value }) => Storage.set("page", value));
Script.action("setting", ({ field, value }) => saveSettings({ [field]: value }));
Script.action("speakToggle", ({ isOn }) => saveSettings({ speak: isOn }));
Script.action("draft", ({ field, value }) => Storage.set("draft", { ...Storage.get("draft", {}), [field]: value }));

Script.action("build", async () => {
  try {
    await buildBriefing();
    Storage.remove("lastError");
    await UI.haptic("success");
  } catch (error) {
    Storage.set("lastError", error.message);
    await UI.haptic("error");
  }
});

Script.action("read", async () => {
  const b = Storage.get("briefing");
  if (b) await speak(spokenText(b));
});

Script.action("stop", () => Speech.stop());

Script.action("share", async () => {
  const b = Storage.get("briefing");
  if (b) await UI.share(briefingText(b));
});

Script.action("addFeed", async () => {
  const draft = Storage.get("draft", {});
  const url = String(draft.url ?? "").trim();
  if (!/^https:\/\/\S+$/i.test(url)) { await UI.alert({ title: "Feed address", message: "Paste the full https:// address of an RSS or Atom feed." }); return; }
  if (feeds().some((f) => f.url === url)) { await UI.alert("That feed is already in the list."); return; }
  try {
    const response = await fetch(url, { timeout: 10000 });
    if (!response.ok) throw new Error(`${response.status} from ${hostOf(url)}`);
    const parsed = parseFeed(await response.text());
    if (parsed.items.length === 0) throw new Error("No articles were found at that address.");
    const name = String(draft.name ?? "").trim() || parsed.title || hostOf(url);
    Storage.set("feeds", [...feeds(), { id: `f${Date.now().toString(36)}`, name, url }]);
    Storage.remove("draft");
    await UI.haptic("success");
  } catch (error) {
    await UI.alert({ title: "Could not add that feed", message: error.message });
  }
});

Script.action("removeFeed", async ({ id }) => {
  const feed = feeds().find((f) => f.id === id);
  const choice = await UI.alert({ title: `Remove ${feed?.name ?? "this feed"}?`, buttons: ["Cancel", "Remove"] });
  if (choice === 1) Storage.set("feeds", feeds().filter((f) => f.id !== id));
});

Script.action("restoreDefaults", () => Storage.remove("feeds"));

// ───────────────────────── Mini-app pages

function briefingPage(b) {
  const error = Storage.get("lastError");
  const buttons = Widget.hstack([
    Widget.button("Build now", "build", null, { style: "prominent", color: "orange" }),
    Widget.button("Read aloud", "read", null, { style: "bordered" }),
    Widget.button("Stop", "stop", null, { style: "bordered", color: "red" }),
  ], { spacing: 8 });

  if (!b) {
    return Widget.vstack([
      Widget.symbol("sunrise.fill", { size: 56, color: "orange", fallback: "🌅" }),
      Widget.text("No briefing yet", { font: "title2", weight: "semibold" }),
      Widget.text("Build one now, or let a 7 am Shortcuts automation do it for you (see Settings).", { color: "secondary", align: "center" }),
      error ? Widget.text(error, { font: "caption", color: "red", align: "center" }) : null,
      buttons,
    ], { spacing: 14, padding: 24 });
  }

  return Widget.vstack([
    Widget.vstack([
      Widget.text(dateLine(b.time), { font: "title3", weight: "bold", design: "serif" }),
      Widget.hstack([
        Widget.text("Built", { font: "caption", color: "secondary" }),
        Widget.date(b.time, { style: "relative", font: "caption", color: "secondary" }),
        Widget.text(`· ${b.mode === "ai" ? "condensed by on-device AI" : "top headlines (no on-device model)"}`, { font: "caption", color: "secondary" }),
      ], { spacing: 4 }),
      Widget.divider(),
      ...b.bullets.map((line) => bulletRow(line, { font: "body", lines: 6 })),
    ], { alignment: "leading", spacing: 10, padding: 16, background: DAWN, cornerRadius: 16 }),
    error ? Widget.text(`Last attempt failed: ${error}`, { font: "caption", color: "red" }) : null,
    b.errors?.length ? Widget.text(`Some feeds did not load: ${b.errors.join(" · ")}`, { font: "caption", color: "orange" }) : null,
    buttons,
    Widget.hstack([
      Widget.spacer(),
      Widget.button("Share text", "share", null, { style: "plain" }),
      Widget.spacer(),
    ]),
  ], { alignment: "leading", spacing: 14 });
}

function headlinesPage(b) {
  if (!b) return Widget.text("Build a briefing to see the headlines behind it.", { color: "secondary", align: "center", padding: 24 });
  return Widget.vstack(b.groups.map((group) => Widget.card([
    Widget.list(group.items.slice(0, 10).map((item) => {
      const row = { title: item.title, symbol: "safari", color: "orange" };
      if (item.sentence) row.subtitle = item.sentence;
      if (item.link) row.url = item.link;
      return row;
    }), { style: "plain" }),
  ], { title: group.name, subtitle: `${group.items.length} of the latest ${HEADLINES}`, symbol: "newspaper.fill", color: "orange" })), { alignment: "leading", spacing: 14 });
}

function settingsPage() {
  const s = settings();
  const draft = Storage.get("draft", {});
  return Widget.vstack([
    Widget.card([
      Widget.toggle("Read aloud when run", s.speak, "speakToggle", null, { color: "orange" }),
      Widget.slider(s.rate, "setting", { field: "rate" }, { min: 0.5, max: 2, step: 0.1, label: `Voice speed ${s.rate.toFixed(1)}×`, color: "orange" }),
      Widget.stepper(`Bullet points: ${s.bullets}`, s.bullets, "setting", { field: "bullets" }, { min: 4, max: 8 }),
    ], { title: "Briefing", symbol: "speaker.wave.2.fill", color: "orange" }),
    Widget.card([
      ...feeds().map((feed) => Widget.hstack([
        Widget.vstack([
          Widget.text(feed.name, { font: "subheadline", weight: "semibold", lineLimit: 1 }),
          Widget.text(hostOf(feed.url), { font: "caption2", color: "secondary", lineLimit: 1 }),
        ], { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", alignment: "leading" } }),
        Widget.button(Widget.symbol("minus.circle.fill", { size: 20, color: "red", fallback: "−" }), "removeFeed", { id: feed.id }, { style: "plain" }),
      ], { spacing: 10 })),
      Widget.divider(),
      Widget.textField("https://example.com/feed.xml", draft.url ?? "", "draft", { field: "url" }, { label: "Feed address", keyboard: "url" }),
      Widget.textField("Taken from the feed if empty", draft.name ?? "", "draft", { field: "name" }, { label: "Name" }),
      Widget.hstack([
        Widget.button("Add feed", "addFeed", null, { style: "prominent", color: "orange" }),
        Widget.button("Restore defaults", "restoreDefaults", null, { style: "bordered" }),
      ], { spacing: 8 }),
    ], { title: "Feeds", subtitle: "RSS or Atom, https only", symbol: "antenna.radiowaves.left.and.right", color: "orange" }),
    Widget.card([
      Widget.text("1. Open Shortcuts › Automation › + › Time of Day, choose 7:00 daily and Run Immediately.", { font: "footnote" }),
      Widget.text("2. Add the action Scriptwell › Run Script and pick Morning Briefing.", { font: "footnote" }),
      Widget.text("3. Done. The briefing is built, read aloud and shown in the widget. Put \"quiet\" in the Input field to skip the voice; the action still returns the text.", { font: "footnote" }),
    ], { title: "7 am automation", symbol: "alarm.fill", color: "orange" }),
    Widget.text("Headlines are fetched straight from the publishers. Summaries are made on this device.", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 14 });
}

// ───────────────────────── Mini-app

Script.ui(() => {
  const b = Storage.get("briefing");
  const page = Storage.get("page", "briefing");
  const body = page === "headlines" ? headlinesPage(b) : page === "settings" ? settingsPage() : briefingPage(b);
  return {
    title: "Morning Briefing",
    content: Widget.vstack([
      Widget.picker([
        { label: "Briefing", value: "briefing" },
        { label: "Headlines", value: "headlines" },
        { label: "Settings", value: "settings" },
      ], page, "page", null, { style: "segmented" }),
      body,
    ], { alignment: "leading", spacing: 14, padding: 16 }),
  };
});
