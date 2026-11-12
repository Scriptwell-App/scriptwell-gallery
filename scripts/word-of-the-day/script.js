// @name        Word of the Day
// @description A new word every day, with its meaning
// @permissions network
// @widget      small, medium
// @icon        character.book.closed.fill
// @color       #4338CA
// @version     1.0.0
// @author      scriptwell
// @category    education

// The word comes from the list below; the definition from https://dictionaryapi.dev (free, no key).
const WORDS = [
  "serendipity", "ephemeral", "petrichor", "sonder", "luminous", "eloquent", "resilient", "ubiquitous", "mellifluous", "candor",
  "quixotic", "labyrinth", "nostalgia", "epiphany", "solitude", "tenacity", "wanderlust", "zenith", "halcyon", "ineffable",
  "paradox", "catalyst", "empathy", "nuance", "pragmatic", "whimsical", "vivid", "serene", "astute", "benevolent",
  "cogent", "diligent", "ebullient", "frugal", "gregarious", "humble", "idyllic", "jovial", "keen", "lucid",
  "meticulous", "nimble", "opulent", "pensive", "quaint", "radiant", "sagacious", "tranquil", "uncanny", "verdant",
  "wistful", "zealous", "ardent", "brevity", "clarity", "deft", "earnest", "fathom", "glean", "harbinger",
];

async function word() {
  const now = new Date();
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86_400_000);
  const term = WORDS[dayOfYear % WORDS.length];

  const saved = Storage.get("word");
  if (saved?.term === term && saved.definition) return saved;

  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${term}`, { timeout: 6000 });
    if (!response.ok) throw new Error(`Dictionary returned ${response.status}`);
    const [entry] = await response.json();
    const meaning = entry.meanings[0];
    const fresh = { term, phonetic: entry.phonetic ?? "", kind: meaning.partOfSpeech, definition: meaning.definitions[0].definition };
    Storage.set("word", fresh);
    return fresh;
  } catch (error) {
    return { term, phonetic: "", kind: "", definition: "" }; // offline: still show the word
  }
}

Script.widget(async ({ family }) => {
  const w = await word();
  const midnight = new Date();
  midnight.setHours(24, 0, 10, 0);

  return {
    content: Widget.vstack([
      Widget.text(w.term, { font: family === "small" ? "title3" : "title2", weight: "bold", design: "serif", color: "indigo", minimumScale: 0.6, lineLimit: 1 }),
      w.kind ? Widget.text([w.kind, w.phonetic].filter(Boolean).join("  "), { font: "caption", color: "secondary", lineLimit: 1 }) : null,
      Widget.text(w.definition || "Open Scriptwell while online to load the meaning.", { font: "footnote", lineLimit: family === "small" ? 4 : 3 }),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    // Retry sooner if the definition could not be loaded.
    refreshAt: w.definition ? midnight : new Date(Date.now() + 30 * 60 * 1000),
  };
});

Script.run(async () => {
  const w = await word();
  return w.definition ? `${w.term} (${w.kind}): ${w.definition}` : w.term;
});
