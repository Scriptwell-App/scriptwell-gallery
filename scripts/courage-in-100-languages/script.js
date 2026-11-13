// @name        Courage in 100 Languages
// @description Learn the word "courage" in 100 languages, with non-Latin scripts shown large and clear
// @icon        character.book.closed.fill
// @color       #4338CA
// @widget      small, medium, large, rectangular, inline

// ─────────────────────────────────────────── Data
// [language, word, romanization, writing system, speech voice, meaning of each character]
// Entries without a writing system use the Latin alphabet.
const RAW = [
  ["Afrikaans", "moed"],
  ["Albanian", "guxim"],
  ["Amharic", "ድፍረት", "dəfrät", "Ge'ez (Ethiopic)"],
  ["Arabic", "شجاعة", "shajāʿa", "Arabic script", "ar-SA"],
  ["Armenian", "քաջություն", "k'ajut'yun", "Armenian alphabet"],
  ["Azerbaijani", "cəsarət"],
  ["Basque", "ausardia"],
  ["Belarusian", "мужнасць", "muzhnasts'", "Cyrillic alphabet"],
  ["Bengali", "সাহস", "sāhas", "Bengali script"],
  ["Bosnian", "hrabrost"],
  ["Bulgarian", "смелост", "smelost", "Cyrillic alphabet", "bg-BG"],
  ["Burmese", "သတ္တိ", "thatti", "Myanmar script"],
  ["Catalan", "coratge", null, null, "ca-ES"],
  ["Cebuano", "kaisog"],
  ["Chinese (Mandarin)", "勇气", "yǒngqì", "Simplified Chinese characters", "zh-CN", ["brave", "spirit"]],
  ["Cantonese", "勇氣", "yúhng hei", "Traditional Chinese characters", "zh-HK", ["brave", "spirit"]],
  ["Croatian", "hrabrost", null, null, "hr-HR"],
  ["Czech", "odvaha", null, null, "cs-CZ"],
  ["Danish", "mod", null, null, "da-DK"],
  ["Dutch", "moed", null, null, "nl-NL"],
  ["Esperanto", "kuraĝo"],
  ["Estonian", "julgus"],
  ["Filipino", "tapang"],
  ["Finnish", "rohkeus", null, null, "fi-FI"],
  ["French", "courage", null, null, "fr-FR"],
  ["Galician", "coraxe"],
  ["Georgian", "გამბედაობა", "gambedaoba", "Georgian Mkhedruli"],
  ["German", "Mut", null, null, "de-DE"],
  ["Greek", "θάρρος", "thárros", "Greek alphabet", "el-GR"],
  ["Gujarati", "હિંમત", "himmat", "Gujarati script"],
  ["Haitian Creole", "kouraj"],
  ["Hausa", "ƙarfin hali"],
  ["Hawaiian", "koa"],
  ["Hebrew", "אומץ", "ometz", "Hebrew alphabet", "he-IL"],
  ["Hindi", "साहस", "sāhas", "Devanagari", "hi-IN"],
  ["Hungarian", "bátorság", null, null, "hu-HU"],
  ["Icelandic", "hugrekki"],
  ["Igbo", "obi ike"],
  ["Indonesian", "keberanian", null, null, "id-ID"],
  ["Irish", "misneach"],
  ["Italian", "coraggio", null, null, "it-IT"],
  ["Japanese", "勇気", "yūki", "Kanji", "ja-JP", ["brave", "spirit"]],
  ["Kannada", "ಧೈರ್ಯ", "dhairya", "Kannada script"],
  ["Kazakh", "батылдық", "batyldyq", "Cyrillic alphabet"],
  ["Khmer", "ភាពក្លាហាន", "phéap klahan", "Khmer script"],
  ["Korean", "용기", "yonggi", "Hangul", "ko-KR", ["brave (勇)", "spirit (氣)"]],
  ["Kurdish (Kurmanji)", "wêrekî"],
  ["Lao", "ຄວາມກ້າຫານ", "khuam ka han", "Lao script"],
  ["Latin", "fortitudo"],
  ["Latvian", "drosme"],
  ["Lithuanian", "drąsa"],
  ["Luxembourgish", "Mutt"],
  ["Macedonian", "храброст", "hrabrost", "Cyrillic alphabet"],
  ["Malagasy", "herim-po"],
  ["Malay", "keberanian", null, null, "ms-MY"],
  ["Malayalam", "ധൈര്യം", "dhairyam", "Malayalam script"],
  ["Maltese", "kuraġġ"],
  ["Māori", "māia"],
  ["Marathi", "धैर्य", "dhairya", "Devanagari"],
  ["Mongolian", "зориг", "zorig", "Cyrillic alphabet"],
  ["Nepali", "साहस", "sāhas", "Devanagari"],
  ["Norwegian", "mot", null, null, "nb-NO"],
  ["Odia", "ସାହସ", "sāhasa", "Odia script"],
  ["Pashto", "زړورتیا", "zṛawartyā", "Arabic script"],
  ["Persian", "شجاعت", "shojā'at", "Arabic script"],
  ["Polish", "odwaga", null, null, "pl-PL"],
  ["Portuguese", "coragem", null, null, "pt-PT"],
  ["Punjabi", "ਹਿੰਮਤ", "himmat", "Gurmukhi"],
  ["Romanian", "curaj", null, null, "ro-RO"],
  ["Russian", "мужество", "muzhestvo", "Cyrillic alphabet", "ru-RU"],
  ["Samoan", "lototele"],
  ["Scottish Gaelic", "misneach"],
  ["Serbian", "храброст", "hrabrost", "Cyrillic alphabet"],
  ["Shona", "ushingi"],
  ["Sindhi", "همت", "himat", "Arabic script"],
  ["Sinhala", "ධෛර්යය", "dhairyaya", "Sinhala script"],
  ["Slovak", "odvaha", null, null, "sk-SK"],
  ["Slovenian", "pogum"],
  ["Somali", "geesinimo"],
  ["Spanish", "valentía", null, null, "es-ES"],
  ["Swahili", "ujasiri"],
  ["Swedish", "mod", null, null, "sv-SE"],
  ["Tajik", "далерӣ", "dalerī", "Cyrillic alphabet"],
  ["Tamil", "தைரியம்", "thairiyam", "Tamil script"],
  ["Tatar", "батырлык", "batyrlyk", "Cyrillic alphabet"],
  ["Telugu", "ధైర్యం", "dhairyam", "Telugu script"],
  ["Thai", "ความกล้าหาญ", "khwam kla han", "Thai script", "th-TH"],
  ["Tibetan", "སྙིང་སྟོབས།", "nying tob", "Tibetan script"],
  ["Turkish", "cesaret", null, null, "tr-TR"],
  ["Turkmen", "batyrlyk"],
  ["Ukrainian", "мужність", "muzhnist'", "Cyrillic alphabet", "uk-UA"],
  ["Urdu", "ہمت", "himmat", "Arabic script"],
  ["Uyghur", "جاسارەت", "jasaret", "Arabic script"],
  ["Uzbek", "jasorat"],
  ["Vietnamese", "lòng dũng cảm", null, null, "vi-VN"],
  ["Welsh", "dewrder"],
  ["Xhosa", "inkalipho"],
  ["Yiddish", "מוט", "mut", "Hebrew alphabet"],
  ["Yoruba", "ìgboyà"],
  ["Zulu", "isibindi"],
];

const LANGS = RAW.map(([language, word, roman, script, voice, parts]) => ({
  language,
  word,
  roman: roman ?? null,
  script: script ?? "Latin alphabet",
  voice: voice ?? null,
  parts: parts ?? null,
}));
const N = LANGS.length;

// ─────────────────────────────────────────── Look
const PANEL = { light: "#F8FAFC", dark: "#0F172A" };
const TILE = { light: "#FFFFFF", dark: "#1E293B" };

function accentFor(entry) {
  const s = entry.script;
  if (s === "Latin alphabet") return { light: "#334155", dark: "#CBD5E1" };
  if (s.includes("Arabic")) return { light: "#0F766E", dark: "#5EEAD4" };
  if (s.includes("Cyrillic")) return { light: "#1D4ED8", dark: "#93C5FD" };
  if (s.includes("Devanagari")) return { light: "#C2410C", dark: "#FDBA74" };
  if (s.includes("Chinese") || s === "Kanji") return { light: "#B91C1C", dark: "#FCA5A5" };
  if (s === "Hangul") return { light: "#7C3AED", dark: "#C4B5FD" };
  if (s.includes("Hebrew")) return { light: "#1E40AF", dark: "#A5B4FC" };
  if (s.includes("Greek")) return { light: "#0369A1", dark: "#7DD3FC" };
  return { light: "#4338CA", dark: "#A5B4FC" };
}

const tint = (accent) => ({ light: `${accent.light}1F`, dark: `${accent.dark}33` });
const isLatin = (entry) => entry.script === "Latin alphabet";
const isRTL = (entry) => entry.script.includes("Arabic") || entry.script.includes("Hebrew");

// ─────────────────────────────────────────── State
const wrap = (i) => ((i % N) + N) % N;
const index = () => wrap(Number(Storage.get("index", 0)) || 0);
const setIndex = (i) => Storage.set("index", wrap(i));
const learned = () => Storage.get("learned", []);

let page = "learn";
let filter = "all";
let message = null;

// ─────────────────────────────────────────── Actions
Script.action("go", ({ by }) => { message = null; setIndex(index() + by); });

Script.action("random", () => {
  message = null;
  let next = index();
  while (next === index() && N > 1) next = Math.floor(Math.random() * N);
  setIndex(next);
});

Script.action("jump", ({ value }) => {
  message = null;
  setIndex(Number(value));
  page = "learn";
});

Script.action("page", ({ value }) => { page = value; });
Script.action("filter", ({ value }) => { filter = value; });

Script.action("learned", ({ language, isOn }) => {
  const list = learned().filter((name) => name !== language);
  Storage.set("learned", isOn ? [...list, language] : list);
});

Script.action("listen", async () => {
  const entry = LANGS[index()];
  if (!entry.voice) return;
  try {
    await Speech.say(entry.word, { language: entry.voice, rate: 0.8 });
    message = null;
  } catch (error) {
    message = `Could not play the pronunciation: ${error.message}`;
  }
});

Script.action("resetProgress", async () => {
  const choice = await UI.alert({ title: "Reset progress?", message: "This clears every word marked as learned.", buttons: ["Cancel", "Reset"] });
  if (choice === 1) Storage.set("learned", []);
});

// ─────────────────────────────────────────── Building blocks
function wordText(entry, size) {
  const latin = isLatin(entry);
  return Widget.text(entry.word, {
    font: size,
    weight: latin ? "semibold" : "regular",
    design: latin ? "serif" : "default",
    color: "primary",
    lineLimit: 1,
    minimumScale: 0.25,
    align: "center",
  });
}

function scriptBadge(entry, font = "footnote") {
  const accent = accentFor(entry);
  const label = isRTL(entry) ? `${entry.script} · read right to left` : entry.script;
  return Widget.text(label, {
    font, weight: "medium", color: accent,
    padding: { horizontal: 10, vertical: 4 },
    background: tint(accent), cornerRadius: 8,
  });
}

// Character tiles for scripts where each character carries its own meaning.
function characterTiles(entry, size = 52) {
  if (!entry.parts) return null;
  const chars = Array.from(entry.word);
  const accent = accentFor(entry);
  return Widget.hstack(chars.map((ch, i) => Widget.vstack([
    Widget.text(ch, { font: size, weight: "light", color: accent }),
    Widget.text(entry.parts[i] ?? "", { font: "caption", color: "secondary", lineLimit: 1, minimumScale: 0.6 }),
  ], { spacing: 4, padding: 12, background: TILE, cornerRadius: 14, frame: { width: size * 2 } })), { spacing: 10 });
}

// A small round-ish arrow button for compact widgets.
function arrowButton(symbol, fallback, by, color) {
  return Widget.button(
    Widget.symbol(symbol, { size: 13, color, fallback, frame: { width: 16, height: 16 } }),
    "go",
    { by },
    { style: "bordered", color },
  );
}

// ─────────────────────────────────────────── Mini-app
function learnView() {
  const i = index();
  const entry = LANGS[i];
  const accent = accentFor(entry);
  const latin = isLatin(entry);
  const done = learned();

  return Widget.vstack([
    Widget.hstack([
      Widget.text(`${i + 1} / ${N}`, { font: "caption", design: "monospaced", color: "secondary" }),
      Widget.spacer(),
      Widget.text(`${done.length} learned`, { font: "caption", color: "secondary" }),
    ]),
    Widget.progress(done.length / N, { color: accent }),

    Widget.vstack([
      Widget.text(entry.language.toUpperCase(), { font: "caption", weight: "semibold", color: accent }),
      wordText(entry, latin ? 56 : 80),
      entry.roman ? Widget.text(entry.roman, { font: "title3", design: "serif", color: "secondary" }) : null,
      scriptBadge(entry),
    ], { spacing: 12, padding: { vertical: 30, horizontal: 16 }, background: PANEL, cornerRadius: 20, frame: { maxWidth: "infinity" } }),

    characterTiles(entry),

    Widget.hstack([
      Widget.button("Previous", "go", { by: -1 }, { style: "bordered" }),
      Widget.button("Random", "random", null, { style: "bordered" }),
      Widget.button("Next", "go", { by: 1 }, { style: "prominent", color: accent }),
    ], { spacing: 10 }),

    entry.voice ? Widget.button("Listen", "listen", null, { style: "bordered", color: accent }) : null,
    Widget.checkbox("I have learned this one", done.includes(entry.language), "learned", { language: entry.language }),
    message ? Widget.text(message, { font: "caption", color: "red" }) : null,
  ], { spacing: 16 });
}

function browseView() {
  const done = learned();
  const rows = LANGS
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => filter === "all" || (filter === "latin" ? isLatin(entry) : !isLatin(entry)))
    .map(({ entry, i }) => ({
      title: entry.language,
      subtitle: entry.roman ? `${entry.roman} · ${entry.script}` : entry.script,
      detail: entry.word,
      symbol: done.includes(entry.language) ? "checkmark.circle.fill" : "circle",
      color: done.includes(entry.language) ? "green" : "secondary",
      value: i,
    }));

  return Widget.vstack([
    Widget.picker([
      { label: "All", value: "all" },
      { label: "Other scripts", value: "other" },
      { label: "Latin", value: "latin" },
    ], filter, "filter", null, { style: "segmented" }),
    Widget.list(rows, { action: "jump" }),
    Widget.button("Reset progress", "resetProgress", null, { style: "plain", color: "red" }),
  ], { spacing: 12 });
}

Script.ui(() => ({
  title: "Courage",
  content: Widget.vstack([
    Widget.picker([{ label: "Learn", value: "learn" }, { label: "Browse", value: "browse" }], page, "page", null, { style: "segmented" }),
    page === "learn" ? learnView() : browseView(),
  ], { spacing: 16, padding: 20 }),
}));

// ─────────────────────────────────────────── Widget
Script.widget(({ family }) => {
  const i = index();
  const entry = LANGS[i];
  const accent = accentFor(entry);
  const latin = isLatin(entry);

  if (family === "inline") return Widget.text(`Courage · ${entry.language}: ${entry.word}`);

  if (family === "rectangular") {
    return Widget.vstack([
      Widget.text(entry.language, { font: "caption", weight: "semibold" }),
      Widget.text(entry.word, { font: "headline", lineLimit: 1, minimumScale: 0.5 }),
      entry.roman ? Widget.text(entry.roman, { font: "caption", color: "secondary", lineLimit: 1 }) : null,
    ], { alignment: "leading", spacing: 1 });
  }

  if (family === "small") {
    return Widget.vstack([
      Widget.text(entry.language.toUpperCase(), { font: "caption2", weight: "semibold", color: accent, lineLimit: 1, minimumScale: 0.7 }),
      Widget.spacer(),
      wordText(entry, latin ? 30 : 40),
      entry.roman ? Widget.text(entry.roman, { font: "caption", design: "serif", color: "secondary", lineLimit: 1 }) : null,
      Widget.spacer(),
      Widget.button("Next", "go", { by: 1 }, { style: "bordered", color: accent }),
    ], { alignment: "leading", spacing: 4, background: PANEL, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
  }

  if (family === "medium") {
    // Word on the left gets most of the room; a narrow column on the right
    // holds the counter at the top and two compact arrow buttons at the bottom.
    return Widget.hstack([
      Widget.vstack([
        Widget.text(entry.language.toUpperCase(), { font: "caption", weight: "semibold", color: accent, lineLimit: 1 }),
        wordText(entry, latin ? 34 : 46),
        entry.roman ? Widget.text(entry.roman, { font: "subheadline", design: "serif", color: "secondary", lineLimit: 1 }) : null,
        Widget.text(entry.script, { font: "caption2", color: accent, lineLimit: 1, minimumScale: 0.7 }),
      ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" } }),
      Widget.vstack([
        Widget.text(`${i + 1} / ${N}`, { font: "caption2", design: "monospaced", color: "secondary" }),
        Widget.spacer(),
        Widget.hstack([
          arrowButton("chevron.left", "‹", -1, "secondary"),
          arrowButton("chevron.right", "›", 1, accent),
        ], { spacing: 6 }),
      ], { alignment: "trailing", spacing: 4, frame: { maxHeight: "infinity", alignment: "trailing" } }),
    ], { spacing: 10, background: PANEL, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
  }

  const controls = Widget.hstack([
    Widget.button("Previous", "go", { by: -1 }, { style: "bordered" }),
    Widget.button("Next", "go", { by: 1 }, { style: "bordered", color: accent }),
  ], { spacing: 8 });

  // large and extraLarge
  return Widget.vstack([
    Widget.hstack([
      Widget.text("COURAGE", { font: "caption", weight: "bold", color: "secondary" }),
      Widget.spacer(),
      Widget.text(`${i + 1} / ${N}`, { font: "caption", design: "monospaced", color: "secondary" }),
    ]),
    Widget.spacer(),
    Widget.text(entry.language.toUpperCase(), { font: "subheadline", weight: "semibold", color: accent }),
    wordText(entry, latin ? 48 : 68),
    entry.roman ? Widget.text(entry.roman, { font: "title3", design: "serif", color: "secondary" }) : null,
    scriptBadge(entry, "caption"),
    characterTiles(entry, 30),
    Widget.spacer(),
    Widget.progress(learned().length / N, { color: accent }),
    controls,
  ], { spacing: 8, background: PANEL, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
});

// ─────────────────────────────────────────── Shortcuts and Siri
// Input: a language name ("Japanese"). Without input: the current word.
Script.run((input) => {
  const query = (input ?? "").trim().toLowerCase();
  const entry = query
    ? LANGS.find((e) => e.language.toLowerCase() === query) ?? LANGS.find((e) => e.language.toLowerCase().includes(query))
    : LANGS[index()];
  if (!entry) return `No entry for "${input}". Try a language such as Japanese, Arabic or Welsh.`;
  return entry.roman
    ? `Courage in ${entry.language}: ${entry.word} (${entry.roman}), written in ${entry.script}.`
    : `Courage in ${entry.language}: ${entry.word}.`;
});
