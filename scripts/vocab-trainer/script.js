// @name        Vocab Trainer
// @description Learn English words with spaced repetition: definitions and phonetics from api.dictionaryapi.dev, on-device translation into your language, spoken pronunciation, flip-card reviews, streaks and accuracy stats
// @permissions network
// @widget      small, medium, rectangular, inline
// @icon        character.book.closed.fill
// @color       #6366F1
// @version     1.0.0
// @author      va4w
// @category    education

// How it works
// • Type a word in the mini-app. Its definitions, part of speech, phonetics and an example sentence
//   come from api.dictionaryapi.dev; only the word itself is sent there.
// • Pick your language once and the word and its first definition are translated on the device
//   with Apple's translation models. "Say" reads the word aloud with the system voice.
// • Reviews use SM-2 style spaced repetition: flip the card, then rate it Again, Hard, Good or Easy.
//   Each rating sets the next due date, from ten minutes to months away. Everything stays in Storage.
// • Stats show words learned (an interval of three weeks or more), what is due today, your streak
//   and a fourteen-day accuracy chart.
// • The widget shows the word that is due now with a short definition and the due count; the Lock
//   Screen sizes show how many words are waiting. Tapping the widget opens the trainer.
// • From Shortcuts or Siri, run the script with a word as input to add it.

// ───────────────────────── Constants

const DAY = 86_400_000;
const MATURE_DAYS = 21;
const SESSION_SIZE = 20;
const MAX_WORDS = 400;

const LANGUAGES = [
  { label: "No translation", value: "off" },
  { label: "Spanish", value: "es" }, { label: "French", value: "fr" }, { label: "German", value: "de" },
  { label: "Italian", value: "it" }, { label: "Portuguese", value: "pt" }, { label: "Dutch", value: "nl" },
  { label: "Polish", value: "pl" }, { label: "Turkish", value: "tr" }, { label: "Russian", value: "ru" },
  { label: "Ukrainian", value: "uk" }, { label: "Arabic", value: "ar" }, { label: "Hindi", value: "hi" },
  { label: "Japanese", value: "ja" }, { label: "Korean", value: "ko" }, { label: "Chinese", value: "zh" },
];

const GRADES = [
  { grade: 0, label: "Again", color: "red" },
  { grade: 3, label: "Hard", color: "orange" },
  { grade: 4, label: "Good", color: "green" },
  { grade: 5, label: "Easy", color: "blue" },
];

const INK = "#6366F1";
const CARD_BG = { light: "#EEF2FF", dark: "#1E1B4B" };
const TILE_BG = { light: "#F1F5F9", dark: "#1E293B" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────── Stored state

const words = () => Storage.get("words", []);
const saveWords = (list) => Storage.set("words", list);
const language = () => Storage.get("language", "off");
const session = () => Storage.get("session");
const log = () => Storage.get("log", {});
const dayKey = (date = new Date()) => date.toLocaleDateString("en-CA");

const dueNow = () => words().filter((w) => w.due <= Date.now()).sort((a, b) => a.due - b.due);
const dueToday = () => {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return words().filter((w) => w.due <= end.getTime()).length;
};
const learned = () => words().filter((w) => w.interval >= MATURE_DAYS).length;
const nextDue = () => words().filter((w) => w.due > Date.now()).sort((a, b) => a.due - b.due)[0] ?? null;

function streak() {
  const days = log();
  let count = 0;
  const cursor = new Date();
  if (!days[dayKey(cursor)]?.total) cursor.setDate(cursor.getDate() - 1); // today is still open
  while (days[dayKey(cursor)]?.total) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function dueText(due) {
  const diff = due - Date.now();
  if (diff <= 0) return "due now";
  if (diff < 3_600_000) return `in ${Math.max(1, Math.round(diff / 60_000))} min`;
  if (diff < DAY) return `in ${Math.round(diff / 3_600_000)} h`;
  return `in ${Math.round(diff / DAY)} d`;
}

// ───────────────────────── Spaced repetition (SM-2 style)

function schedule(card, grade) {
  let { interval = 0, ease = 2.5, reps = 0, lapses = 0 } = card;
  if (grade < 3) {
    return { ...card, interval: 0, ease: Math.max(1.3, ease - 0.2), reps: 0, lapses: lapses + 1, due: Date.now() + 10 * 60_000, last: Date.now() };
  }
  if (reps === 0) interval = grade === 5 ? 4 : 1;
  else if (reps === 1) interval = grade === 5 ? 10 : 6;
  else interval = Math.max(interval + 1, Math.round(interval * (grade === 3 ? 1.2 : grade === 5 ? ease * 1.3 : ease)));
  ease = Math.max(1.3, ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
  return { ...card, interval, ease: Math.round(ease * 100) / 100, reps: reps + 1, lapses, due: Date.now() + interval * DAY, last: Date.now() };
}

// The interval a rating would give, shown under each button.
function preview(card, grade) {
  const next = schedule(card, grade);
  return next.interval === 0 ? "10 min" : `${next.interval} d`;
}

function record(correct) {
  const days = log();
  const key = dayKey();
  const today = days[key] ?? { correct: 0, total: 0 };
  days[key] = { correct: today.correct + (correct ? 1 : 0), total: today.total + 1 };
  const cutoff = dayKey(new Date(Date.now() - 30 * DAY));
  for (const k of Object.keys(days)) if (k < cutoff) delete days[k];
  Storage.set("log", days);
}

// ───────────────────────── Dictionary and translation

async function lookup(word) {
  const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { timeout: 8000 });
  if (response.status === 404) throw new Error(`No definition found for “${word}”.`);
  if (!response.ok) throw new Error(`The dictionary returned ${response.status}.`);
  const [entry] = await response.json();
  if (!entry?.meanings?.length) throw new Error(`No definition found for “${word}”.`);
  return {
    word: entry.word ?? word,
    phonetic: entry.phonetic ?? entry.phonetics?.find((p) => p.text)?.text ?? "",
    meanings: entry.meanings.slice(0, 3).map((m) => ({
      pos: m.partOfSpeech ?? "",
      definition: m.definitions?.[0]?.definition ?? "",
      example: m.definitions?.find((d) => d.example)?.example ?? null,
      synonyms: [...(m.synonyms ?? []), ...(m.definitions?.[0]?.synonyms ?? [])].slice(0, 4),
    })).filter((m) => m.definition),
  };
}

async function translate(card, to) {
  if (to === "off") return { ...card, translation: null, definitionTranslation: null, translatedTo: "off" };
  try {
    const [translation, definitionTranslation] = await Translate.text([card.word, card.meanings[0].definition], { from: "en", to });
    return { ...card, translation, definitionTranslation, translatedTo: to };
  } catch (error) {
    console.warn(`Translation to ${to} failed:`, error.message);
    return { ...card, translatedTo: null };
  }
}

async function addWord(text) {
  const word = String(text ?? "").trim().toLowerCase().replace(/[^a-z'’ -]/g, "");
  if (!word) throw new Error("Type a word first.");
  if (words().some((w) => w.word === word)) throw new Error(`“${word}” is already in your list.`);
  if (words().length >= MAX_WORDS) throw new Error(`The list holds up to ${MAX_WORDS} words.`);
  const found = await lookup(word);
  let card = { id: crypto.randomUUID(), ...found, added: Date.now(), due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0, last: null };
  card = await translate(card, language());
  saveWords([...words(), card]);
  return card;
}

// ───────────────────────── Actions

Script.action("add", async ({ value }) => {
  try {
    const card = await addWord(value);
    await UI.haptic("success");
    if (Script.env.mode === "app") await Speech.say(card.word, { language: "en-US" });
  } catch (error) {
    await UI.alert({ title: "Could not add the word", message: error.message });
  }
});

Script.action("lang", ({ value }) => Storage.set("language", value));

Script.action("translateAll", async () => {
  const to = language();
  const stale = words().filter((w) => w.translatedTo !== to).slice(0, 25);
  const updated = [];
  for (const w of stale) updated.push(await translate(w, to));
  saveWords(words().map((w) => updated.find((u) => u.id === w.id) ?? w));
});

Script.action("say", async ({ id }) => {
  const card = words().find((w) => w.id === id);
  if (card) await Speech.say(card.word, { language: "en-US", rate: 0.9 });
});

Script.action("start", () => {
  const due = dueNow();
  const pool = due.length ? due : [...words()].sort((a, b) => a.due - b.due).slice(0, 10);
  Storage.set("session", { ids: pool.slice(0, SESSION_SIZE).map((w) => w.id), index: 0, flipped: false, correct: 0, total: 0 });
});

Script.action("flip", () => Storage.set("session", { ...session(), flipped: true }));

Script.action("grade", async ({ grade }) => {
  const s = session();
  const id = s?.ids[s.index];
  if (!id) return;
  saveWords(words().map((w) => (w.id === id ? schedule(w, grade) : w)));
  const correct = grade >= 3;
  record(correct);
  Storage.set("session", { ...s, index: s.index + 1, flipped: false, correct: s.correct + (correct ? 1 : 0), total: s.total + 1 });
  await UI.haptic(correct ? "light" : "warning");
});

Script.action("end", () => Storage.remove("session"));
Script.action("open", ({ id }) => Storage.set("ui.word", id));
Script.action("back", () => Storage.remove("ui.word"));

Script.action("reset", ({ id }) => {
  saveWords(words().map((w) => (w.id === id ? { ...w, due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0 } : w)));
});

Script.action("remove", async ({ id }) => {
  const card = words().find((w) => w.id === id);
  const choice = await UI.alert({ title: `Remove “${card?.word}”?`, buttons: ["Cancel", "Remove"] });
  if (choice !== 1) return;
  saveWords(words().filter((w) => w.id !== id));
  const s = session();
  if (s) Storage.set("session", { ...s, ids: s.ids.filter((x) => x !== id) });
  Storage.remove("ui.word");
});

// ───────────────────────── Run (Shortcuts and Siri)

Script.run(async (input) => {
  if (input?.trim()) {
    // Siri and Shortcuts get the reason as text rather than a failed run.
    let card;
    try {
      card = await addWord(input);
    } catch (error) {
      return error.message;
    }
    const m = card.meanings[0];
    return `${card.word}${card.phonetic ? ` ${card.phonetic}` : ""} (${m.pos}): ${m.definition}${card.translation ? ` — ${card.translation}` : ""}`;
  }
  const due = dueNow().length;
  return `${words().length} words, ${learned()} learned, ${due} due now, ${streak()}-day streak.`;
});

// ───────────────────────── Widget

function accuracySeries(days) {
  const entries = log();
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.now() - (days - 1 - i) * DAY);
    const entry = entries[dayKey(date)];
    return { x: date.toLocaleDateString(Script.env.locale, { day: "numeric" }), y: entry?.total ? Math.round((entry.correct / entry.total) * 100) : 0, total: entry?.total ?? 0 };
  });
}

Script.widget(({ family }) => {
  const due = dueNow();
  const card = due[0] ?? null;
  const count = due.length;
  const next = nextDue();
  const m = card?.meanings[0];
  const midnight = new Date();
  midnight.setHours(24, 0, 5, 0);
  const refreshAt = next && next.due < midnight.getTime() ? new Date(next.due + 1000) : midnight;
  let content;

  if (words().length === 0) {
    if (family === "inline") return Widget.text("Vocab Trainer: add your first word");
    return Widget.vstack([
      Widget.symbol("character.book.closed.fill", { size: 26, color: "indigo", fallback: "📖" }),
      Widget.text("Open the trainer and add a word", { font: "caption", color: "secondary", align: "center" }),
    ], { spacing: 6, url: APP_LINK });
  }

  if (family === "inline") {
    content = Widget.text(count ? `${count} due · ${card.word}` : "Vocab: all caught up");
  } else if (family === "rectangular") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.text(card ? card.word : "All caught up", { font: "headline", lineLimit: 1 }),
        Widget.spacer(),
        Widget.text(`${count} due`, { font: "caption", weight: "semibold" }),
      ]),
      Widget.text(card ? m.definition : (next ? `Next word ${dueText(next.due)}` : "Nothing scheduled"), { font: "caption", lineLimit: 2 }),
    ], { alignment: "leading", spacing: 1 });
  } else if (family === "small") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.text(card ? "DUE NOW" : "ALL DONE", { font: "caption2", weight: "bold", color: INK }),
        Widget.spacer(),
        Widget.text(String(count), { font: "caption", weight: "bold", color: "white", padding: { horizontal: 6, vertical: 1 }, background: count ? INK : "gray", cornerRadius: 7 }),
      ]),
      Widget.text(card ? card.word : "Caught up", { font: "title2", weight: "bold", design: "serif", lineLimit: 1, minimumScale: 0.5 }),
      card?.phonetic ? Widget.text(card.phonetic, { font: "caption2", color: "secondary", lineLimit: 1 }) : null,
      Widget.text(card ? m.definition : (next ? "Next word" : `${learned()} learned`), { font: "caption", lineLimit: 3 }),
      !card && next ? Widget.date(next.due, { style: "relative", font: "caption", weight: "semibold" }) : null,
      Widget.spacer(),
      Widget.hstack([
        Widget.symbol("flame.fill", { size: 10, color: "orange", fallback: "🔥" }),
        Widget.text(`${streak()} day streak`, { font: "caption2", color: "secondary" }),
      ], { spacing: 3 }),
    ], { alignment: "leading", spacing: 3, padding: 14, background: CARD_BG, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
  } else {
    const series = accuracySeries(7);
    const stat = (value, label) => Widget.vstack([
      Widget.text(String(value), { font: "title3", weight: "bold", design: "rounded", color: INK }),
      Widget.text(label, { font: "caption2", color: "secondary" }),
    ], { alignment: "leading", spacing: 0 });
    content = Widget.hstack([
      Widget.vstack([
        Widget.text(card ? "DUE NOW" : "ALL CAUGHT UP", { font: "caption2", weight: "bold", color: INK }),
        Widget.text(card ? card.word : "Nice work", { font: "title2", weight: "bold", design: "serif", lineLimit: 1, minimumScale: 0.5 }),
        Widget.text(card ? `${card.phonetic ? `${card.phonetic} · ` : ""}${m.pos}` : (next ? "Next word" : "Nothing scheduled"), { font: "caption2", color: "secondary", lineLimit: 1 }),
        Widget.text(card ? m.definition : (next ? "" : "Add more words in the trainer."), { font: "caption", lineLimit: 3 }),
        !card && next ? Widget.date(next.due, { style: "relative", font: "caption", weight: "semibold" }) : null,
        card?.translation ? Widget.text(card.translation, { font: "caption", weight: "semibold", color: INK, lineLimit: 1 }) : null,
        Widget.spacer(),
      ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack([
        Widget.hstack([stat(count, "due"), Widget.spacer(), stat(learned(), "learned")]),
        Widget.hstack([
          Widget.symbol("flame.fill", { size: 11, color: "orange", fallback: "🔥" }),
          Widget.text(`${streak()} day streak`, { font: "caption2", weight: "semibold" }),
        ], { spacing: 3 }),
        Widget.spacer(),
        Widget.text("ACCURACY · 7 DAYS", { font: 8, weight: "bold", color: "secondary" }),
        Widget.chart(series.map((p) => ({ x: p.x, y: p.y })), { kind: "bar", axes: false, color: INK, range: [0, 100], frame: { height: 34 } }),
      ], { alignment: "leading", spacing: 4, frame: { width: 104, maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 12, padding: 14, background: CARD_BG, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
  }

  return { content, refreshAt };
});

// ───────────────────────── Mini-app screens

const tile = (value, label, color = INK) => Widget.vstack([
  Widget.text(String(value), { font: "title2", weight: "bold", design: "rounded", color }),
  Widget.text(label, { font: "caption", color: "secondary" }),
], { alignment: "leading", spacing: 0, padding: 12, background: TILE_BG, cornerRadius: 12, frame: { maxWidth: "infinity", alignment: "leading" } });

function meaningRows(card) {
  return card.meanings.map((m) => Widget.vstack([
    Widget.hstack([
      Widget.text(m.pos, { font: "caption", weight: "bold", color: INK, padding: { horizontal: 6, vertical: 1 }, background: CARD_BG, cornerRadius: 6 }),
      Widget.text(m.definition, { font: "body" }),
    ], { spacing: 8, alignment: "top" }),
    m.example ? Widget.text(`“${m.example}”`, { font: "callout", design: "serif", color: "secondary" }) : null,
    m.synonyms.length ? Widget.text(`Also: ${m.synonyms.join(", ")}`, { font: "caption", color: "secondary" }) : null,
  ], { alignment: "leading", spacing: 4 }));
}

function reviewTab() {
  const s = session();
  const due = dueNow();

  if (!s) {
    const next = nextDue();
    return Widget.vstack([
      Widget.symbol(due.length ? "rectangle.stack.fill" : "checkmark.seal.fill", { size: 48, color: due.length ? "indigo" : "green", fallback: "🗂" }),
      Widget.text(due.length ? `${due.length} word${due.length === 1 ? "" : "s"} due now` : "Nothing due right now", { font: "title3", weight: "semibold" }),
      !due.length && next ? Widget.hstack([Widget.text("Next word", { color: "secondary" }), Widget.date(next.due, { style: "relative", weight: "semibold" })], { spacing: 4 }) : null,
      words().length
        ? Widget.button(due.length ? "Start review" : "Practice 10 words anyway", "start", null, { style: due.length ? "prominent" : "bordered", color: "indigo" })
        : Widget.text("Add a few words under Words to begin.", { color: "secondary" }),
    ], { spacing: 14, padding: 20, frame: { maxWidth: "infinity" } });
  }

  if (s.index >= s.ids.length) {
    const pct = s.total ? Math.round((s.correct / s.total) * 100) : 0;
    return Widget.vstack([
      Widget.symbol("party.popper.fill", { size: 48, color: "orange", fallback: "🎉" }),
      Widget.text("Session complete", { font: "title3", weight: "semibold" }),
      Widget.text(`${s.total} reviewed · ${pct}% correct · ${streak()}-day streak`, { color: "secondary" }),
      Widget.button("Done", "end", null, { style: "prominent", color: "indigo" }),
    ], { spacing: 14, padding: 20, frame: { maxWidth: "infinity" } });
  }

  const card = words().find((w) => w.id === s.ids[s.index]);
  if (!card) return Widget.button("Continue", "end", null, { style: "bordered" });
  return Widget.vstack([
    Widget.hstack([
      Widget.text(`${s.index + 1} of ${s.ids.length}`, { font: "caption", weight: "semibold", color: "secondary" }),
      Widget.spacer(),
      Widget.button("End session", "end", null, { style: "plain", color: "red" }),
    ]),
    Widget.progress((s.index) / s.ids.length, { color: "indigo" }),
    Widget.vstack([
      Widget.text(card.word, { font: 40, weight: "bold", design: "serif", align: "center", minimumScale: 0.5, lineLimit: 1 }),
      card.phonetic ? Widget.text(card.phonetic, { font: "callout", color: "secondary" }) : null,
      Widget.button(Widget.label("Say", "speaker.wave.2.fill"), "say", { id: card.id }, { style: "bordered", color: "indigo" }),
      s.flipped ? Widget.divider() : null,
      s.flipped ? Widget.vstack(meaningRows(card), { alignment: "leading", spacing: 10 }) : null,
      s.flipped && card.translation ? Widget.vstack([
        Widget.text(card.translation, { font: "title3", weight: "semibold", color: INK }),
        card.definitionTranslation ? Widget.text(card.definitionTranslation, { font: "callout", color: "secondary" }) : null,
      ], { alignment: "leading", spacing: 2 }) : null,
    ], { spacing: 12, padding: 20, background: CARD_BG, cornerRadius: 20, frame: { maxWidth: "infinity" } }),
    s.flipped
      ? Widget.hstack(GRADES.map((g) => Widget.vstack([
          Widget.button(g.label, "grade", { grade: g.grade }, { style: "prominent", color: g.color }),
          Widget.text(preview(card, g.grade), { font: "caption2", color: "secondary" }),
        ], { spacing: 3 })), { spacing: 8 })
      : Widget.button("Show answer", "flip", null, { style: "prominent", color: "indigo" }),
  ], { alignment: "leading", spacing: 14 });
}

function wordDetail(id) {
  const card = words().find((w) => w.id === id);
  return Widget.vstack([
    Widget.button(Widget.label("Words", "chevron.left"), "back", null, { style: "plain" }),
    Widget.hstack([
      Widget.text(card.word, { font: "largeTitle", weight: "bold", design: "serif", minimumScale: 0.5, lineLimit: 1 }),
      Widget.spacer(),
      Widget.button(Widget.symbol("speaker.wave.2.fill", { size: 22, color: "indigo", fallback: "🔊" }), "say", { id }, { style: "plain" }),
    ]),
    card.phonetic ? Widget.text(card.phonetic, { font: "callout", color: "secondary" }) : null,
    card.translation ? Widget.text(`${card.translation}${card.definitionTranslation ? ` — ${card.definitionTranslation}` : ""}`, { font: "callout", color: INK }) : null,
    ...meaningRows(card),
    Widget.divider(),
    Widget.hstack([
      tile(card.interval ? `${card.interval} d` : "new", "interval"),
      tile(card.reps, "reviews"),
      tile(card.lapses, "lapses", card.lapses ? "red" : INK),
    ], { spacing: 8 }),
    Widget.text(`Next review ${dueText(card.due)} · ease ${card.ease.toFixed(2)}`, { font: "caption", color: "secondary" }),
    Widget.hstack([
      Widget.button("Reset progress", "reset", { id }, { style: "bordered" }),
      Widget.button("Remove", "remove", { id }, { style: "bordered", color: "red" }),
    ], { spacing: 10 }),
  ], { alignment: "leading", spacing: 12 });
}

function wordsTab() {
  const list = [...words()].sort((a, b) => a.due - b.due);
  const stale = words().filter((w) => w.translatedTo !== language()).length;
  return Widget.vstack([
    Widget.textField("Type a word and tap Return", "", "add", null, { label: "New word" }),
    Widget.picker(LANGUAGES, language(), "lang", null, { label: "Translate into" }),
    stale && language() !== "off" ? Widget.button(`Translate ${Math.min(stale, 25)} word${stale === 1 ? "" : "s"} into ${LANGUAGES.find((l) => l.value === language())?.label}`, "translateAll", null, { style: "bordered", color: "indigo" }) : null,
    list.length
      ? Widget.list(list.slice(0, 60).map((w) => ({
          title: w.word,
          subtitle: w.meanings[0]?.definition ?? "",
          symbol: w.interval >= MATURE_DAYS ? "checkmark.seal.fill" : w.reps ? "leaf.fill" : "sparkle",
          color: w.interval >= MATURE_DAYS ? "green" : w.reps ? "teal" : "indigo",
          detail: dueText(w.due),
          action: "open", args: { id: w.id },
        })), { title: `${list.length} words, soonest first` })
      : Widget.text("No words yet.", { color: "secondary" }),
    list.length > 60 ? Widget.text(`${list.length - 60} more words are scheduled later.`, { font: "caption", color: "secondary" }) : null,
  ], { alignment: "leading", spacing: 12 });
}

function statsTab() {
  const series = accuracySeries(14);
  const reviewed = series.reduce((s, p) => s + p.total, 0);
  const young = words().filter((w) => w.reps > 0 && w.interval < MATURE_DAYS).length;
  return Widget.vstack([
    Widget.hstack([tile(words().length, "words"), tile(learned(), "learned", "green"), tile(young, "learning", "teal")], { spacing: 8 }),
    Widget.hstack([tile(dueToday(), "due today", "orange"), tile(`${streak()} 🔥`, "day streak")], { spacing: 8 }),
    Widget.card([
      reviewed
        ? Widget.chart(series.map((p) => ({ x: p.x, y: p.y })), { kind: "bar", color: "indigo", range: [0, 100], frame: { height: 180 } })
        : Widget.text("Review a few words and your accuracy shows up here.", { color: "secondary" }),
      Widget.text(`${reviewed} reviews in 14 days · percent rated Hard, Good or Easy`, { font: "caption", color: "secondary" }),
    ], { title: "Accuracy", symbol: "chart.bar.fill", color: "indigo" }),
    Widget.text("A word counts as learned once its interval reaches three weeks. Again resets a word and brings it back in ten minutes.", { font: "caption", color: "secondary" }),
  ], { alignment: "leading", spacing: 12 });
}

Script.ui(() => {
  const selected = Storage.get("ui.word");
  if (selected && words().some((w) => w.id === selected)) {
    return { title: "Word", content: Widget.vstack([wordDetail(selected)], { padding: 16 }) };
  }
  return {
    title: "Vocab Trainer",
    content: Widget.vstack([
      Widget.tabs([
        { title: "Review", symbol: "rectangle.stack.fill", content: reviewTab() },
        { title: "Words", symbol: "list.bullet", content: wordsTab() },
        { title: "Stats", symbol: "chart.bar.fill", content: statsTab() },
      ], { selected: 0 }),
    ], { padding: 16 }),
  };
});
