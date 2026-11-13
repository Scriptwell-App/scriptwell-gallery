// @name        Scan & Translate
// @description Point the camera at a sign, menu or page, or pick a photo: the text is read and translated on the device, shown side by side with the original, read aloud, copied or shared, with a history of your last twenty scans
// @permissions camera, clipboard
// @icon        doc.text.viewfinder
// @color       #0D9488
// @version     1.0.0
// @author      scriptwell
// @category    photo-video

// How it works
// • Take a photo or pick one. Text is read with on-device Vision, grouped into paragraphs by its
//   position on the page, and translated with Apple's on-device translation. Nothing leaves the device.
// • Choose the source language (or leave it on Auto) and the target language. Changing the target on
//   a finished scan translates it again. The first time a language pair is used, iOS offers to download it.
// • Each card shows the original on the left and the translation on the right. Speak reads the
//   translation aloud in the target language; Copy and Share hand the text on.
// • The last twenty scans are kept with thumbnails in the script's Files folder; swipe through them
//   on the home screen and delete the ones you no longer need.
// • From Shortcuts, pass an image in the Files parameter and a language code as Input
//   (for example "es", or "de>en" for a fixed source) to get the translated text back.

// ───────────────────────── Languages

const LANGUAGES = [
  { label: "English", code: "en", voice: "en-US" },
  { label: "Spanish", code: "es", voice: "es-ES" },
  { label: "French", code: "fr", voice: "fr-FR" },
  { label: "German", code: "de", voice: "de-DE" },
  { label: "Italian", code: "it", voice: "it-IT" },
  { label: "Portuguese", code: "pt", voice: "pt-BR" },
  { label: "Dutch", code: "nl", voice: "nl-NL" },
  { label: "Polish", code: "pl", voice: "pl-PL" },
  { label: "Ukrainian", code: "uk", voice: "uk-UA" },
  { label: "Russian", code: "ru", voice: "ru-RU" },
  { label: "Turkish", code: "tr", voice: "tr-TR" },
  { label: "Arabic", code: "ar", voice: "ar-SA" },
  { label: "Hindi", code: "hi", voice: "hi-IN" },
  { label: "Japanese", code: "ja", voice: "ja-JP" },
  { label: "Korean", code: "ko", voice: "ko-KR" },
  { label: "Chinese (Simplified)", code: "zh-Hans", voice: "zh-CN" },
  { label: "Thai", code: "th", voice: "th-TH" },
  { label: "Vietnamese", code: "vi", voice: "vi-VN" },
];
const language = (code) => LANGUAGES.find((l) => l.code === code) ?? null;
const languageName = (code) => (code === "auto" ? "Auto" : language(code)?.label ?? code);

const deviceLanguage = () => {
  const code = String(Script.env.locale ?? "en").split("-")[0].toLowerCase();
  return language(code === "zh" ? "zh-Hans" : code) ? (code === "zh" ? "zh-Hans" : code) : "en";
};

const HISTORY_FILE = "history.json";
const MAX_HISTORY = 20;
const TEAL = "#0D9488";
const TILE = { light: "#F1F5F9", dark: "#1E293B" };
const locale = Script.env.locale;

const settings = () => ({ source: "auto", target: deviceLanguage(), ...Storage.get("settings", {}) });
const newId = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const save = (changes) => Storage.set("settings", { ...settings(), ...changes });

// ───────────────────────── Reading and grouping text

const boxTop = (box) => box?.y ?? 0;
const boxHeight = (box) => box?.height ?? box?.h ?? 0.03;
const boxLeft = (box) => box?.x ?? 0;

// Lines come back one per line of text, top to bottom. A gap clearly larger than a line's own
// height starts a new paragraph, and so does a big jump back to the left after a short line.
function groupParagraphs(lines) {
  const usable = lines
    .filter((l) => l.text?.trim() && (l.confidence ?? 1) >= 0.3)
    .sort((a, b) => boxTop(a.box) - boxTop(b.box) || boxLeft(a.box) - boxLeft(b.box));
  if (!usable.length) return [];

  const heights = usable.map((l) => boxHeight(l.box)).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)] || 0.03;

  const groups = [];
  let current = null;
  let previousBottom = null;
  for (const line of usable) {
    const gap = previousBottom == null ? 0 : boxTop(line.box) - previousBottom;
    if (!current || gap > typical * 0.8) {
      current = [];
      groups.push(current);
    }
    current.push(line.text.trim());
    previousBottom = boxTop(line.box) + boxHeight(line.box);
  }
  return groups.map((g) => g.join("\n"));
}

async function readPhoto(photo, source) {
  const options = source !== "auto" && language(source) ? { languages: [language(source).voice] } : undefined;
  const lines = await Vision.readText(photo, options);
  return groupParagraphs(lines);
}

async function translateAll(originals, { source, target }) {
  if (!originals.length) return [];
  const options = { to: target };
  if (source !== "auto") options.from = source;
  // Lines inside a paragraph are joined so the translator sees whole sentences.
  const translated = await Translate.text(originals.map((p) => p.replace(/\s*\n\s*/g, " ")), options);
  return originals.map((original, i) => ({ original, translated: translated[i] ?? "" }));
}

// ───────────────────────── History in Files

let history = null;

async function loadHistory() {
  if (history) return history;
  try {
    history = (await Files.exists(HISTORY_FILE)) ? await Files.readJSON(HISTORY_FILE) : [];
  } catch {
    history = [];
  }
  return history;
}

async function saveHistory(list) {
  history = list;
  await Files.writeJSON(HISTORY_FILE, list);
}

async function addEntry(entry) {
  const list = [entry, ...(await loadHistory())];
  const dropped = list.slice(MAX_HISTORY);
  for (const old of dropped) {
    try { await Files.remove(old.photo.path); } catch { /* already gone */ }
  }
  await saveHistory(list.slice(0, MAX_HISTORY));
}

async function removeEntry(id) {
  const list = await loadHistory();
  const entry = list.find((e) => e.id === id);
  if (entry) {
    try { await Files.remove(entry.photo.path); } catch { /* already gone */ }
  }
  await saveHistory(list.filter((e) => e.id !== id));
}

const translationText = (entry) => entry.paragraphs.map((p) => p.translated).join("\n\n");
const originalText = (entry) => entry.paragraphs.map((p) => p.original).join("\n\n");

// ───────────────────────── Scanning

let page = "home";   // "home" or "result"
let currentId = null;
let message = null;

async function scan(source) {
  const s = settings();
  const id = newId();
  const name = `scan-${id}.jpg`;
  const photo = source === "camera" ? await Camera.capture({ saveAs: name }) : await Photos.pick({ saveAs: name });
  if (!photo) return;

  try {
    const originals = await readPhoto(photo, s.source);
    if (!originals.length) {
      await Files.remove(photo.path);
      message = "No text found in that picture. Try more light, or hold the camera square to the page.";
      await UI.haptic("warning");
      return;
    }
    const paragraphs = await translateAll(originals, s);
    const entry = { id, time: Date.now(), photo, source: s.source, target: s.target, paragraphs };
    await addEntry(entry);
    currentId = entry.id;
    page = "result";
    message = null;
    await UI.haptic("success");
  } catch (error) {
    try { await Files.remove(photo.path); } catch { /* nothing to tidy */ }
    message = `Could not translate: ${error.message}`;
    await UI.haptic("error");
  }
}

async function retranslate(entry, target) {
  const originals = entry.paragraphs.map((p) => p.original);
  const paragraphs = await translateAll(originals, { source: entry.source, target });
  const list = await loadHistory();
  await saveHistory(list.map((e) => (e.id === entry.id ? { ...e, target, paragraphs } : e)));
}

// ───────────────────────── Actions

Script.action("scan", async ({ source }) => { await scan(source); });

Script.action("source", ({ value }) => save({ source: value }));

Script.action("target", async ({ value }) => {
  save({ target: value });
  if (page !== "result") return;
  const entry = (await loadHistory()).find((e) => e.id === currentId);
  if (!entry || entry.target === value) return;
  try {
    await retranslate(entry, value);
    message = null;
  } catch (error) {
    message = `Could not translate into ${languageName(value)}: ${error.message}`;
  }
});

Script.action("open", ({ id }) => { currentId = id; page = "result"; message = null; });
Script.action("home", () => { page = "home"; message = null; Speech.stop(); });

Script.action("speak", async ({ id }) => {
  const entry = (await loadHistory()).find((e) => e.id === id);
  if (!entry) return;
  const voice = language(entry.target)?.voice;
  await Speech.say(translationText(entry), voice ? { language: voice } : undefined);
});

Script.action("stop", () => Speech.stop());

Script.action("copy", async ({ id, which }) => {
  const entry = (await loadHistory()).find((e) => e.id === id);
  if (!entry) return;
  await Clipboard.writeText(which === "original" ? originalText(entry) : translationText(entry));
  message = `${which === "original" ? "Original" : "Translation"} copied.`;
  await UI.haptic("light");
});

Script.action("share", async ({ id, which }) => {
  const entry = (await loadHistory()).find((e) => e.id === id);
  if (!entry) return;
  if (which === "photo") await UI.share(entry.photo);
  else if (which === "both") await UI.share(entry.paragraphs.map((p) => `${p.original}\n→ ${p.translated}`).join("\n\n"));
  else await UI.share(translationText(entry));
});

Script.action("delete", async ({ id }) => {
  const choice = await UI.alert({ title: "Delete this scan?", message: "The photo and its translation are removed.", buttons: ["Cancel", "Delete"] });
  if (choice !== 1) return;
  await removeEntry(id);
  if (currentId === id) { currentId = null; page = "home"; }
});

Script.action("clear", async () => {
  const list = await loadHistory();
  const choice = await UI.alert({ title: `Delete all ${list.length} scans?`, message: "This cannot be undone.", buttons: ["Cancel", "Delete all"] });
  if (choice !== 1) return;
  for (const entry of list) {
    try { await Files.remove(entry.photo.path); } catch { /* already gone */ }
  }
  await saveHistory([]);
  page = "home";
});

// ───────────────────────── Screens

const languagePicker = (value, action, label) => Widget.picker(
  [...(action === "source" ? [{ label: "Auto-detect", value: "auto" }] : []), ...LANGUAGES.map((l) => ({ label: l.label, value: l.code }))],
  value, action, null, { style: "menu", label },
);

function languageRow(s) {
  return Widget.hstack([
    Widget.vstack([Widget.text("From", { font: "caption2", color: "secondary" }), languagePicker(s.source, "source")], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
    Widget.symbol("arrow.right", { size: 14, color: "secondary", fallback: "→" }),
    Widget.vstack([Widget.text("To", { font: "caption2", color: "secondary" }), languagePicker(s.target, "target")], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
  ], { spacing: 10, alignment: "bottom" });
}

function historyRow(entry) {
  const first = entry.paragraphs[0];
  const when = new Date(entry.time).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return Widget.button(Widget.hstack([
    Widget.image({ file: entry.photo, size: 56, contentMode: "fill", cornerRadius: 10 }),
    Widget.vstack([
      Widget.text(first?.translated || "No text", { font: "subheadline", weight: "medium", lineLimit: 2, align: "leading" }),
      Widget.text(first?.original?.split("\n")[0] || "", { font: "caption", color: "secondary", lineLimit: 1, align: "leading" }),
      Widget.text(`${languageName(entry.source)} → ${languageName(entry.target)} · ${entry.paragraphs.length} ¶ · ${when}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
    Widget.symbol("chevron.right", { size: 12, color: "secondary", fallback: "›" }),
  ], { spacing: 12, padding: 10, background: TILE, cornerRadius: 14 }), "open", { id: entry.id });
}

function homeScreen(s, list) {
  return Widget.vstack([
    Widget.vstack([
      Widget.hstack([
        Widget.button(Widget.vstack([
          Widget.symbol("camera.fill", { size: 26, color: "white", fallback: "📷" }),
          Widget.text("Camera", { font: "subheadline", weight: "semibold", color: "white" }),
        ], { spacing: 6, padding: 16, background: TEAL, cornerRadius: 16, frame: { maxWidth: "infinity" } }), "scan", { source: "camera" }),
        Widget.button(Widget.vstack([
          Widget.symbol("photo.on.rectangle", { size: 26, color: TEAL, fallback: "🖼" }),
          Widget.text("Photo", { font: "subheadline", weight: "semibold", color: TEAL }),
        ], { spacing: 6, padding: 16, background: TILE, cornerRadius: 16, frame: { maxWidth: "infinity" } }), "scan", { source: "photos" }),
      ], { spacing: 12 }),
      languageRow(s),
    ], { spacing: 14 }),
    message ? Widget.text(message, { font: "footnote", color: "orange" }) : null,
    list.length
      ? Widget.hstack([
          Widget.text(`Recent scans · ${list.length}`, { font: "headline" }),
          Widget.spacer(),
          Widget.menu("ellipsis.circle", [{ title: "Delete all scans", symbol: "trash", action: "clear", destructive: true }]),
        ])
      : Widget.vstack([
          Widget.symbol("doc.text.viewfinder", { size: 54, color: TEAL, fallback: "🔍" }),
          Widget.text("Scan a menu, a sign, a label or a page.", { font: "headline", align: "center" }),
          Widget.text("Reading and translation happen on this device. The first use of a language pair downloads it.", { font: "footnote", color: "secondary", align: "center" }),
        ], { spacing: 8, padding: 24 }),
    ...list.map(historyRow),
  ], { alignment: "leading", spacing: 14, padding: 16 });
}

function paragraphCard(p, index) {
  const column = (title, text, color, weight) => Widget.vstack([
    Widget.text(title, { font: "caption2", weight: "bold", color: "secondary" }),
    Widget.text(text || "—", { font: "callout", weight, color, align: "leading" }),
  ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", alignment: "topLeading" } });
  return Widget.hstack([
    column("ORIGINAL", p.original, "secondary", "regular"),
    Widget.divider(),
    column("TRANSLATION", p.translated, "primary", "medium"),
  ], { spacing: 12, alignment: "top", padding: 12, background: TILE, cornerRadius: 14 });
}

function resultScreen(s, entry) {
  if (!entry) {
    return Widget.vstack([
      Widget.text("That scan is gone.", { color: "secondary" }),
      Widget.button("Back to scans", "home", null, { style: "bordered" }),
    ], { spacing: 12, padding: 24 });
  }
  const id = entry.id;
  return Widget.vstack([
    Widget.hstack([
      Widget.button(Widget.label("Scans", "chevron.left", { color: TEAL }), "home"),
      Widget.spacer(),
      Widget.date(entry.time, { style: "date", font: "caption", color: "secondary" }),
      Widget.menu("ellipsis.circle", [
        { title: "Copy original", symbol: "doc.on.doc", action: "copy", args: { id, which: "original" } },
        { title: "Share original and translation", symbol: "square.and.arrow.up", action: "share", args: { id, which: "both" } },
        { title: "Share photo", symbol: "photo", action: "share", args: { id, which: "photo" } },
        { title: "Delete scan", symbol: "trash", action: "delete", args: { id }, destructive: true },
      ]),
    ], { spacing: 10 }),
    Widget.image({ file: entry.photo, contentMode: "fit", cornerRadius: 16, frame: { maxWidth: "infinity", height: 180 } }),
    languageRow({ source: entry.source, target: s.target }),
    s.target !== entry.target ? Widget.text(`Shown in ${languageName(entry.target)}; pick a language above to translate again.`, { font: "caption", color: "secondary" }) : null,
    message ? Widget.text(message, { font: "footnote", color: "orange" }) : null,
    Widget.hstack([
      Widget.button(Widget.label("Speak", "speaker.wave.2.fill"), "speak", { id }, { style: "prominent", color: TEAL }),
      Widget.button(Widget.label("Stop", "stop.fill"), "stop", null, { style: "bordered" }),
      Widget.button(Widget.label("Copy", "doc.on.clipboard"), "copy", { id, which: "translation" }, { style: "bordered" }),
      Widget.button(Widget.label("Share", "square.and.arrow.up"), "share", { id, which: "translation" }, { style: "bordered" }),
    ], { spacing: 8 }),
    Widget.text(`${entry.paragraphs.length} paragraph${entry.paragraphs.length === 1 ? "" : "s"} · ${languageName(entry.source)} → ${languageName(entry.target)}`, { font: "caption", color: "secondary" }),
    ...entry.paragraphs.map(paragraphCard),
  ], { alignment: "leading", spacing: 14, padding: 16 });
}

Script.ui(async () => {
  const s = settings();
  const list = await loadHistory();
  if (page === "result") {
    const entry = list.find((e) => e.id === currentId);
    return { title: entry ? "Translation" : "Scan & Translate", content: resultScreen(s, entry) };
  }
  return { title: "Scan & Translate", content: homeScreen(s, list) };
});

// ───────────────────────── Shortcuts: image in, translated text out

function parseLanguages(input) {
  const text = String(input ?? "").trim();
  const s = settings();
  if (!text) return { source: s.source, target: s.target, text: "" };
  if (text.startsWith("{")) {
    try {
      const json = JSON.parse(text);
      return { source: json.from ?? s.source, target: json.to ?? s.target, text: json.text ?? "" };
    } catch { /* fall through */ }
  }
  const pair = /^([a-z]{2}(?:-[A-Za-z]{2,4})?)\s*(?:>|to)\s*([a-z]{2}(?:-[A-Za-z]{2,4})?)$/i.exec(text);
  if (pair) return { source: pair[1], target: pair[2], text: "" };
  const single = /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/i.exec(text);
  if (single) return { source: s.source, target: text, text: "" };
  return { source: s.source, target: s.target, text };
}

Script.run(async (input, context) => {
  const { source, target, text } = parseLanguages(input);
  const image = (context?.files ?? []).find((f) => f.type === "image");

  if (!image) {
    if (!text) return "Pass an image in the Files parameter, with a language code such as \"es\" or \"de>en\" as Input. Plain text as Input is translated directly.";
    return Translate.text(text, source === "auto" ? { to: target } : { from: source, to: target });
  }

  try {
    const originals = await readPhoto(image.path, source);
    if (!originals.length) return "No text found in the image.";
    const paragraphs = await translateAll(originals, { source, target });

    // Keep a copy in the history, like a scan made in the app.
    try {
      const id = newId();
      const kept = `scan-${id}.jpg`;
      await Files.writeBytes(kept, await Files.readBytes(image.path));
      await addEntry({ id, time: Date.now(), photo: { path: kept }, source, target, paragraphs, fromShortcut: true });
    } catch { /* the translation still goes back */ }

    return paragraphs.map((p) => p.translated).join("\n\n");
  } finally {
    try { await Files.remove(image.path); } catch { /* already gone */ }
  }
});
