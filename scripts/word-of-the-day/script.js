// @name        Word of the Day
// @description One interesting English word a day with its definition, phonetics and an example from api.dictionaryapi.dev, read aloud on request; search any word, keep favourites, and ask Siri to define a word
// @permissions network
// @widget      small, medium, large, rectangular, inline
// @icon        text.book.closed.fill
// @color       #C2410C
// @version     1.0.0
// @author      va4w
// @category    reference

// How it works
// • A built-in list of 120 words is walked deterministically, so everyone sees the same word on the same day and it changes at midnight.
// • Definition, part of speech, phonetic spelling, an example sentence and synonyms come from api.dictionaryapi.dev (the Free Dictionary API). Only the word being looked up is sent.
// • The day's word is cached in Storage, so the widget fetches at most once a day and shows the last word when offline.
// • The mini-app pronounces words with the system voice, searches any word, and keeps a history and favourites.
// • From Shortcuts or Siri, run the script with text such as "define serendipity" and it returns the definition.

// ───────────────────────── Words

const WORDS = [
  "serendipity", "ephemeral", "petrichor", "luminous", "mellifluous", "ineffable", "halcyon", "ethereal", "wanderlust", "quintessential",
  "eloquence", "resilience", "labyrinth", "nebulous", "pristine", "sanguine", "ebullient", "laconic", "perspicacious", "quixotic",
  "zephyr", "epiphany", "euphoria", "felicity", "gossamer", "idyllic", "incandescent", "lassitude", "lucid", "melancholy",
  "nostalgia", "panacea", "paradigm", "plethora", "reverie", "sonorous", "soliloquy", "sublime", "surreptitious", "tenacious",
  "tranquil", "ubiquitous", "verdant", "vicarious", "vivacious", "whimsical", "zenith", "aplomb", "benevolent", "cacophony",
  "candor", "capricious", "clandestine", "cognizant", "conundrum", "copious", "dauntless", "diaphanous", "didactic", "effervescent",
  "elucidate", "enigma", "equanimity", "esoteric", "evanescent", "exuberant", "fastidious", "garrulous", "gregarious", "harbinger",
  "iconoclast", "impeccable", "indelible", "insouciant", "intrepid", "juxtapose", "kaleidoscope", "languid", "loquacious", "magnanimous",
  "meticulous", "nonchalant", "obfuscate", "opulent", "ostentatious", "pellucid", "penumbra", "pernicious", "placid", "precocious",
  "prosaic", "quiescent", "recalcitrant", "resplendent", "sagacious", "scintillating", "serene", "somnolent", "stoic", "taciturn",
  "tantalize", "truculent", "umbrage", "vacillate", "venerable", "verisimilitude", "vestige", "voracious", "wistful", "zealous",
  "alacrity", "ameliorate", "anachronism", "bucolic", "cajole", "ennui", "epitome", "fortuitous", "hubris", "mercurial",
];

const HOST = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const locale = Script.env.locale;
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const dayKey = () => new Date().toLocaleDateString("en-CA");
const dayNumber = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60_000) / 86_400_000);
const indexForDay = (n) => (n * 37 + 11) % WORDS.length; // 37 is coprime with 120, so every word has its day

const PAPER = { light: "#FBF7F0", dark: "#1C1917" };
const INK = { light: "#1C1917", dark: "#F5F0E8" };
const ACCENT = { light: "#C2410C", dark: "#FB923C" };
const RULE = { light: "#E7DFD3", dark: "#3B332C" };
const CARD_BG = { light: "#FFFFFF", dark: "#292524" };

// ───────────────────────── Dictionary

function parseEntry(entries, key) {
  const list = Array.isArray(entries) ? entries : [];
  const first = list[0];
  if (!first) return { word: key, missing: true, time: Date.now() };
  const meanings = list.flatMap((e) => e.meanings ?? []);
  const main = meanings[0];
  const definitions = meanings.flatMap((m) => m.definitions ?? []);
  const synonyms = [...new Set(meanings.flatMap((m) => [...(m.synonyms ?? []), ...(m.definitions ?? []).flatMap((d) => d.synonyms ?? [])]))]
    .filter((s) => s.toLowerCase() !== key).slice(0, 8);
  return {
    word: first.word ?? key,
    phonetic: first.phonetic ?? list.flatMap((e) => e.phonetics ?? []).find((p) => p.text)?.text ?? null,
    partOfSpeech: main?.partOfSpeech ?? null,
    definition: main?.definitions?.[0]?.definition ?? null,
    example: definitions.find((d) => d.example)?.example ?? null,
    synonyms,
    others: meanings.slice(1, 4).map((m) => ({ partOfSpeech: m.partOfSpeech, definition: m.definitions?.[0]?.definition })).filter((o) => o.definition),
    source: first.sourceUrls?.[0] ?? null,
    time: Date.now(),
  };
}

async function lookup(word, timeout = 6000) {
  const key = word.trim().toLowerCase();
  const cache = Storage.get("cache", {});
  if (cache[key]) return cache[key];

  const response = await fetch(HOST + encodeURIComponent(key), { timeout });
  let entry;
  if (response.status === 404) entry = { word: key, missing: true, time: Date.now() };
  else if (!response.ok) throw new Error(`The dictionary returned ${response.status}`);
  else entry = parseEntry(await response.json(), key);

  const keys = Object.keys(cache);
  while (keys.length >= 40) delete cache[keys.shift()];
  cache[key] = entry;
  Storage.set("cache", cache);
  return entry;
}

async function todaysWord() {
  const saved = Storage.get("today");
  if (saved?.day === dayKey()) return saved;
  let index = indexForDay(dayNumber());
  try {
    let entry = await lookup(WORDS[index]);
    for (let tries = 0; entry.missing && tries < 2; tries++) {
      index = (index + 1) % WORDS.length; // skip a word the dictionary does not know
      entry = await lookup(WORDS[index]);
    }
    const data = { day: dayKey(), entry, time: Date.now() };
    Storage.set("today", data);
    return data;
  } catch (error) {
    if (saved) return { ...saved, stale: true, error: error.message };
    throw error;
  }
}

// ───────────────────────── History and favourites

const history = () => Storage.get("history", []);
const favourites = () => Storage.get("favourites", []);
const isFavourite = (word) => favourites().includes(word);

function remember(word) {
  Storage.set("history", [word, ...history().filter((w) => w !== word)].slice(0, 50));
}

function extractWord(input) {
  let text = (input ?? "").trim().toLowerCase();
  if (!text) return null;
  text = text
    .replace(/^(please\s+)?(define|definition of|meaning of|what does|what is|what's|whats|look up|lookup|spell)\s+/i, "")
    .replace(/^(the\s+)?(word\s+)?/i, "")
    .replace(/\s+(mean|means|meaning|definition)\??\.?$/i, "")
    .replace(/[?.!,"'“”‘’]+$/g, "")
    .trim();
  return text || null;
}

function describe(entry) {
  if (entry.missing) return `No definition found for “${entry.word}”.`;
  const parts = [`${entry.word}${entry.partOfSpeech ? ` (${entry.partOfSpeech})` : ""}${entry.phonetic ? ` ${entry.phonetic}` : ""}: ${entry.definition ?? "no definition"}`];
  if (entry.example) parts.push(`Example: ${entry.example}`);
  if (entry.synonyms.length) parts.push(`Synonyms: ${entry.synonyms.slice(0, 5).join(", ")}`);
  return parts.join(" ");
}

// ───────────────────────── Widget pieces

const serif = (text, props = {}) => Widget.text(text, { design: "serif", color: INK, ...props });
const capitalise = (w) => w.charAt(0).toUpperCase() + w.slice(1);

function wordBlock(entry, size) {
  return Widget.vstack([
    serif(capitalise(entry.word), { font: size, weight: "bold", lineLimit: 2, minimumScale: 0.45 }),
    Widget.hstack([
      entry.phonetic ? Widget.text(entry.phonetic, { font: "caption", color: "secondary", lineLimit: 1, minimumScale: 0.7 }) : null,
      entry.partOfSpeech ? serif(entry.partOfSpeech, { font: "caption", color: ACCENT, weight: "medium" }) : null,
    ], { spacing: 8 }),
  ], { alignment: "leading", spacing: 2 });
}

function rule() {
  return { type: "stack", direction: "horizontal", children: [], background: RULE, frame: { maxWidth: "infinity", height: 1 } };
}

function eyebrow(text = "WORD OF THE DAY") {
  return Widget.text(text, { font: "caption2", weight: "bold", color: ACCENT });
}

function synonymChips(entry, max) {
  if (!entry.synonyms.length) return null;
  return Widget.hstack(entry.synonyms.slice(0, max).map((s) => serif(s, {
    font: "caption2", lineLimit: 1, padding: { horizontal: 7, vertical: 3 },
    background: { light: "#F3E8DD", dark: "#3B2F26" }, cornerRadius: 8,
  })), { spacing: 5 });
}

function footer(data) {
  return Widget.hstack([
    Widget.text("dictionaryapi.dev", { font: "caption2", color: "secondary" }),
    Widget.spacer(),
    data.stale ? Widget.hstack([Widget.text("offline · cached", { font: "caption2", color: "secondary" }), Widget.date(data.time, { style: "relative", font: "caption2", color: "secondary" })], { spacing: 3 }) : null,
  ]);
}

function placeholder(family, message) {
  if (family === "inline") return Widget.text("Word of the Day");
  return Widget.vstack([
    Widget.symbol("character.book.closed.fill", { size: 24, color: ACCENT, fallback: "📖" }),
    Widget.text(message, { font: "caption", color: "secondary", align: "center", lineLimit: 3 }),
  ], { spacing: 6, padding: 12, background: PAPER, frame: { maxWidth: "infinity", maxHeight: "infinity" }, url: APP_LINK });
}

// ───────────────────────── Widget

Script.widget(async ({ family }) => {
  let data;
  try {
    data = await todaysWord();
  } catch (error) {
    return placeholder(family, `Could not reach the dictionary. ${error.message}`);
  }
  const entry = data.entry;
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const page = { alignment: "leading", padding: 14, background: PAPER, frame: fill, url: APP_LINK };
  let content;

  if (family === "inline") {
    content = Widget.text(capitalise(entry.word));
  } else if (family === "rectangular") {
    content = Widget.vstack([
      Widget.text(capitalise(entry.word), { font: "headline", design: "serif", lineLimit: 1, minimumScale: 0.6 }),
      Widget.text([entry.partOfSpeech, entry.phonetic].filter(Boolean).join(" · "), { font: "caption2", lineLimit: 1 }),
      Widget.text(entry.definition ?? "", { font: "caption2", lineLimit: 2 }),
    ], { alignment: "leading", spacing: 1 });
  } else if (family === "small") {
    content = Widget.vstack([
      eyebrow(),
      wordBlock(entry, 24),
      rule(),
      serif(entry.definition ?? "", { font: "caption", lineLimit: 4, minimumScale: 0.8 }),
      Widget.spacer(),
    ], { ...page, spacing: 6 });
  } else if (family === "medium") {
    content = Widget.hstack([
      Widget.vstack([
        eyebrow(),
        wordBlock(entry, 26),
        Widget.spacer(),
        Widget.text("dictionaryapi.dev", { font: "caption2", color: "secondary" }),
      ], { alignment: "leading", spacing: 4, frame: { width: 140, maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack([
        serif(entry.definition ?? "", { font: "footnote", lineLimit: 4, minimumScale: 0.8 }),
        entry.example ? serif(`“${entry.example}”`, { font: "caption2", color: "secondary", lineLimit: 3 }) : null,
        Widget.spacer(),
        synonymChips(entry, 3),
      ], { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { ...page, spacing: 12, alignment: "top" });
  } else {
    content = Widget.vstack([
      Widget.hstack([
        eyebrow(),
        Widget.spacer(),
        Widget.text(new Date().toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }), { font: "caption2", color: "secondary" }),
      ]),
      wordBlock(entry, 40),
      rule(),
      serif(entry.definition ?? "", { font: "body", lineLimit: 5, minimumScale: 0.8 }),
      entry.example ? serif(`“${entry.example}”`, { font: "subheadline", color: "secondary", lineLimit: 3 }) : null,
      ...entry.others.slice(0, 2).map((o) => Widget.hstack([
        serif(o.partOfSpeech, { font: "caption", color: ACCENT, weight: "medium", frame: { width: 70, alignment: "leading" } }),
        serif(o.definition, { font: "caption", lineLimit: 2 }),
      ], { spacing: 6, alignment: "top" })),
      synonymChips(entry, 5),
      Widget.spacer(),
      footer(data),
    ], { ...page, spacing: 8, padding: 16 });
  }

  const midnight = new Date();
  midnight.setHours(24, 0, 10, 0);
  return { content, refreshAt: data.stale ? new Date(Date.now() + 30 * 60_000) : midnight };
});

// ───────────────────────── Mini-app actions

const ui = () => Storage.get("ui", { tab: 0, current: null, query: "", error: null });
const setUI = (changes) => Storage.set("ui", { ...ui(), ...changes });

async function showWord(word) {
  try {
    const entry = await lookup(word);
    if (!entry.missing) remember(entry.word);
    setUI({ tab: 1, current: entry.missing ? ui().current : entry.word, error: entry.missing ? `No definition found for “${word}”.` : null, query: "" });
  } catch (error) {
    setUI({ tab: 1, error: error.message });
  }
}

Script.action("tab", ({ value }) => setUI({ tab: value, error: null }));

Script.action("search", ({ value }) => { const word = extractWord(value); return word ? showWord(word) : null; });
Script.action("show", ({ word }) => showWord(word));
Script.action("say", ({ text }) => Speech.say(text, { language: "en-US", rate: 0.9 }));
Script.action("favourite", ({ word }) => {
  Storage.set("favourites", isFavourite(word) ? favourites().filter((w) => w !== word) : [word, ...favourites()].slice(0, 200));
});
Script.action("share", ({ word }) => {
  const entry = Storage.get("cache", {})[word] ?? Storage.get("today")?.entry;
  return UI.share(entry ? describe(entry) : word);
});
Script.action("source", ({ url }) => UI.openURL(url));
Script.action("clearHistory", async () => {
  const choice = await UI.alert({ title: "Clear the search history?", buttons: ["Cancel", "Clear"] });
  if (choice === 1) Storage.set("history", []);
});
Script.action("another", () => {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  return showWord(word);
});

// ───────────────────────── Mini-app pieces

function entryCard(entry, { label }) {
  const fav = isFavourite(entry.word);
  return Widget.vstack([
    eyebrow(label),
    Widget.hstack([
      wordBlock(entry, 36),
      Widget.spacer(),
      Widget.button(Widget.symbol(fav ? "heart.fill" : "heart", { size: 22, color: fav ? "red" : "secondary", fallback: fav ? "♥" : "♡" }), "favourite", { word: entry.word }, { style: "plain" }),
    ], { alignment: "top" }),
    rule(),
    serif(entry.definition ?? "No definition.", { font: "body" }),
    entry.example ? serif(`“${entry.example}”`, { font: "subheadline", color: "secondary" }) : null,
    ...entry.others.map((o) => Widget.hstack([
      serif(o.partOfSpeech, { font: "caption", color: ACCENT, weight: "medium", frame: { width: 80, alignment: "leading" } }),
      serif(o.definition, { font: "caption" }),
    ], { spacing: 6, alignment: "top" })),
    entry.synonyms.length ? Widget.vstack([
      Widget.text("SYNONYMS", { font: "caption2", weight: "bold", color: "secondary" }),
      Widget.hstack(entry.synonyms.slice(0, 4).map((s) => Widget.button(s, "show", { word: s }, { style: "bordered" })), { spacing: 6 }),
      entry.synonyms.length > 4 ? Widget.hstack(entry.synonyms.slice(4, 8).map((s) => Widget.button(s, "show", { word: s }, { style: "bordered" })), { spacing: 6 }) : null,
    ], { alignment: "leading", spacing: 6 }) : null,
    Widget.hstack([
      Widget.button("Pronounce", "say", { text: entry.word }, { style: "prominent", color: "#C2410C" }),
      entry.example ? Widget.button("Read example", "say", { text: entry.example }, { style: "bordered" }) : null,
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [
        { title: "Share", symbol: "square.and.arrow.up", action: "share", args: { word: entry.word } },
        ...(entry.source ? [{ title: "Open source page", symbol: "safari", action: "source", args: { url: entry.source } }] : []),
      ]),
    ], { spacing: 8 }),
  ], { alignment: "leading", spacing: 12, padding: 18, background: PAPER, cornerRadius: 18 });
}

function wordList(words, { empty, detail }) {
  if (!words.length) return Widget.text(empty, { color: "secondary", padding: 12 });
  const cache = Storage.get("cache", {});
  return Widget.list(words.slice(0, 50).map((w) => ({
    title: capitalise(w),
    subtitle: cache[w]?.definition ?? undefined,
    symbol: isFavourite(w) ? "heart.fill" : "text.book.closed",
    color: isFavourite(w) ? "red" : "secondary",
    detail,
    action: "show",
    args: { word: w },
  })));
}

// ───────────────────────── Mini-app

Script.ui(async () => {
  let today = null;
  let todayError = null;
  try { today = await todaysWord(); } catch (error) { todayError = error.message; }

  const state = ui();
  const tab = state.tab ?? 0;
  const current = state.current ? Storage.get("cache", {})[state.current] : null;

  // Only the open tab is built; the others stay empty until chosen.
  const todayTab = () => Widget.vstack([
    today ? entryCard(today.entry, { label: `WORD OF THE DAY · ${new Date().toLocaleDateString(locale, { day: "numeric", month: "long" })}` }) : null,
    todayError ? Widget.text(`Could not load today's word: ${todayError}`, { font: "footnote", color: "orange" }) : null,
    today?.stale ? Widget.text("Offline: showing the last word that loaded.", { font: "caption", color: "secondary" }) : null,
    Widget.button("Show me another word", "another", null, { style: "bordered" }),
    Widget.text("Definitions from api.dictionaryapi.dev", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 12 });

  const searchTab = () => Widget.vstack([
    Widget.textField("Type a word and tap Return", state.query ?? "", "search", null, { keyboard: "search", label: "Look up" }),
    state.error ? Widget.text(state.error, { font: "footnote", color: "orange" }) : null,
    current && !current.missing ? entryCard(current, { label: "DEFINITION" }) : null,
    !current ? Widget.vstack([
      Widget.symbol("magnifyingglass", { size: 36, color: "secondary", fallback: "🔍" }),
      Widget.text("Any English word, or a phrase such as “ice cream”.", { font: "footnote", color: "secondary", align: "center" }),
    ], { spacing: 8, padding: 24, frame: { maxWidth: "infinity" } }) : null,
    Widget.text("RECENT", { font: "caption2", weight: "bold", color: "secondary" }),
    Widget.hstack(history().slice(0, 4).map((w) => Widget.button(w, "show", { word: w }, { style: "bordered" })), { spacing: 6 }),
  ], { alignment: "leading", spacing: 12 });

  const historyTab = () => Widget.vstack([
    wordList(history(), { empty: "Words you look up appear here." }),
    history().length ? Widget.button("Clear history", "clearHistory", null, { style: "bordered", color: "red" }) : null,
  ], { alignment: "leading", spacing: 12 });

  const favouritesTab = () => Widget.vstack([
    wordList(favourites(), { empty: "Tap the heart on a word to keep it here.", detail: "♥" }),
    favourites().length ? Widget.text(`${favourites().length} favourite${favourites().length === 1 ? "" : "s"}. Tap one to read it again.`, { font: "caption", color: "secondary" }) : null,
  ], { alignment: "leading", spacing: 12 });

  return {
    title: "Word of the Day",
    content: Widget.vstack([
      Widget.tabs([
        { title: "Today", symbol: "sun.max", content: tab === 0 ? todayTab() : Widget.text("") },
        { title: "Search", symbol: "magnifyingglass", content: tab === 1 ? searchTab() : Widget.text("") },
        { title: "History", symbol: "clock", content: tab === 2 ? historyTab() : Widget.text("") },
        { title: "Favourites", symbol: "heart", content: tab === 3 ? favouritesTab() : Widget.text("") },
      ], { selected: tab, action: "tab" }),
    ], { padding: 16, background: CARD_BG, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "top" } }),
  };
});

// ───────────────────────── Shortcuts and Siri

Script.run(async (input) => {
  const word = extractWord(input);
  try {
    if (!word) {
      const data = await todaysWord();
      return `Today's word: ${describe(data.entry)}`;
    }
    const entry = await lookup(word);
    if (!entry.missing) remember(entry.word);
    return describe(entry);
  } catch (error) {
    return `Could not reach the dictionary: ${error.message}`;
  }
});
