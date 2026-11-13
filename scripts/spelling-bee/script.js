// @name        Spelling Bee
// @description A spelling game for children: the device says a word, the child types or spells it out loud, and letter tiles show what was right. Rounds of ten words at three levels, with stars, badges and a daily streak. Example sentences come from api.dictionaryapi.dev.
// @permissions microphone, network
// @widget      small
// @icon        textformat.abc
// @color       #F59E0B
// @version     1.0.0
// @author      scriptwell
// @category    kids

// How it works
// • Pick a level (easy, medium or hard: about thirty kid-safe words each) and start a round of ten words.
// • "Say it" reads the word aloud. "In a sentence" asks api.dictionaryapi.dev for an example sentence; only
//   the word itself is sent, and a built-in sentence is used when the request fails or nothing comes back.
// • The child types the word, or taps the microphone and spells it out loud: "a p p l e" and "apple" both count.
//   Speech is turned into text on the device.
// • After each answer, letter tiles show which letters were right. Ten words make a round with a score,
//   stars and a results screen. Stars unlock badges, and playing on consecutive days builds a streak.
// • The small widget shows the streak, the current badge and total stars. Run the mini-app once first.

// ───────────────────────── Word lists

const WORDS = {
  easy: [
    ["cat", "The cat sat in the warm sun."], ["dog", "My dog loves to chase the ball."], ["sun", "The sun comes up in the morning."],
    ["hat", "She wore a red hat to the park."], ["bed", "It is time to go to bed."], ["cup", "Pour the milk into the cup."],
    ["pig", "The pig rolled in the mud."], ["fish", "A fish swims in the pond."], ["frog", "The frog jumped onto a lily pad."],
    ["jump", "Can you jump over the puddle?"], ["milk", "I drink milk with my breakfast."], ["book", "We read a book before bed."],
    ["tree", "A bird built a nest in the tree."], ["ball", "Throw the ball to me."], ["cake", "We baked a cake for her birthday."],
    ["duck", "The duck swam across the lake."], ["rain", "The rain made the grass wet."], ["star", "I saw a bright star tonight."],
    ["moon", "The moon shines at night."], ["boat", "The boat floated down the river."], ["hand", "Wave your hand to say hello."],
    ["nest", "Three eggs sat in the nest."], ["ring", "The bell gave a loud ring."], ["sock", "I lost one blue sock."],
    ["drum", "He played the drum in the band."], ["bell", "The school bell rang at nine."], ["leaf", "A yellow leaf fell from the tree."],
    ["kite", "The kite flew high in the wind."], ["pen", "Write your name with this pen."], ["bus", "We ride the bus to school."],
  ],
  medium: [
    ["apple", "I ate a crunchy apple at lunch."], ["happy", "The puppy was happy to see us."], ["garden", "Flowers grow in the garden."],
    ["yellow", "The sunflower is bright yellow."], ["friend", "My best friend lives next door."], ["school", "We walk to school together."],
    ["water", "Plants need water to grow."], ["monkey", "The monkey swung from a branch."], ["rabbit", "A rabbit hopped across the field."],
    ["winter", "We build snowmen in winter."], ["bridge", "The train crossed the old bridge."], ["castle", "A king lived in the castle."],
    ["dragon", "The dragon in the story was friendly."], ["pencil", "Sharpen your pencil before the test."], ["rocket", "The rocket flew to the moon."],
    ["jungle", "Parrots live in the jungle."], ["planet", "Earth is our planet."], ["pirate", "The pirate found a treasure map."],
    ["button", "Press the green button to start."], ["window", "Open the window for fresh air."], ["candle", "Blow out the candle on the cake."],
    ["basket", "The basket was full of apples."], ["carrot", "The rabbit nibbled a carrot."], ["thunder", "We heard thunder during the storm."],
    ["kitchen", "Dinner is cooking in the kitchen."], ["picnic", "We had a picnic by the lake."], ["puzzle", "This puzzle has one hundred pieces."],
    ["mirror", "She smiled at the mirror."], ["feather", "A feather floated down from the sky."], ["dinner", "We eat dinner at six o'clock."],
  ],
  hard: [
    ["beautiful", "What a beautiful rainbow!"], ["necessary", "A coat is necessary in the snow."], ["calendar", "Mark the date on the calendar."],
    ["separate", "Please separate the red and blue blocks."], ["library", "We borrow books from the library."], ["island", "The boat sailed to a small island."],
    ["knowledge", "Reading gives you knowledge."], ["rhythm", "Clap along to the rhythm."], ["delicious", "This soup is delicious."],
    ["adventure", "The hike was a real adventure."], ["mountain", "Snow covered the top of the mountain."], ["umbrella", "Take an umbrella; it might rain."],
    ["chocolate", "Hot chocolate is my favourite drink."], ["because", "We stayed inside because it was raining."], ["different", "Every snowflake is different."],
    ["tomorrow", "We are going to the zoo tomorrow."], ["surprise", "The party was a big surprise."], ["elephant", "An elephant has a long trunk."],
    ["dinosaur", "The museum has a dinosaur skeleton."], ["butterfly", "A butterfly landed on the flower."], ["vegetable", "A carrot is a vegetable."],
    ["breakfast", "We had pancakes for breakfast."], ["interesting", "That was an interesting story."], ["remember", "Remember to brush your teeth."],
    ["together", "Let's build the tower together."], ["weather", "The weather is sunny today."], ["question", "Raise your hand to ask a question."],
    ["language", "Spanish is a language spoken in Spain."], ["exercise", "Running is good exercise."], ["excellent", "You did an excellent job."],
  ],
};

const LEVELS = [
  { id: "easy", label: "Easy", color: "#22C55E", emoji: "🐝", hint: "3 to 4 letters" },
  { id: "medium", label: "Medium", color: "#F59E0B", emoji: "🍯", hint: "5 to 7 letters" },
  { id: "hard", label: "Hard", color: "#EF4444", emoji: "👑", hint: "long and tricky" },
];
const ROUND_LENGTH = 10;

const BADGES = [
  { stars: 0, name: "New Bee", symbol: "ladybug.fill", emoji: "🐛" },
  { stars: 3, name: "Busy Bee", symbol: "sparkles", emoji: "✨" },
  { stars: 10, name: "Honey Maker", symbol: "drop.fill", emoji: "🍯" },
  { stars: 25, name: "Hive Hero", symbol: "shield.fill", emoji: "🛡️" },
  { stars: 50, name: "Queen Bee", symbol: "crown.fill", emoji: "👑" },
];

// Spoken letters that the recogniser writes as words.
const LETTER_WORDS = {
  ay: "a", bee: "b", be: "b", see: "c", sea: "c", dee: "d", ee: "e", eff: "f", gee: "g", aitch: "h", eye: "i", aye: "i",
  jay: "j", kay: "k", el: "l", ell: "l", em: "m", en: "n", oh: "o", owe: "o", pea: "p", queue: "q", cue: "q", are: "r", ar: "r",
  ess: "s", tea: "t", tee: "t", you: "u", ewe: "u", vee: "v", ex: "x", why: "y", zed: "z", zee: "z",
};

const CARD = { light: "#FFFFFF", dark: "#1C1C1E" };
const PAGE = { light: "#FFFBEB", dark: "#0F0E0A" };
const HONEY = "#F59E0B";

// ───────────────────────── State

const isoDay = (date = new Date()) => date.toLocaleDateString("en-CA");
const levelInfo = (id) => LEVELS.find((l) => l.id === id) ?? LEVELS[0];
const chosenLevel = () => Storage.get("level", "easy");
const progress = () => Storage.get("progress", {});
const levelProgress = (id) => progress()[id] ?? { rounds: 0, best: 0, stars: 0 };
const totalStars = () => LEVELS.reduce((sum, l) => sum + levelProgress(l.id).stars, 0);
const badgeFor = (count) => [...BADGES].reverse().find((b) => count >= b.stars);
const nextBadge = (count) => BADGES.find((b) => b.stars > count) ?? null;
const round = () => Storage.get("round");
const saveRound = (changes) => Storage.set("round", { ...round(), ...changes });
const currentWord = (r) => r.words[r.index];
const starsForScore = (score) => (score >= ROUND_LENGTH ? 3 : score >= 8 ? 2 : score >= 5 ? 1 : 0);

function streak() {
  const days = new Set(Storage.get("playDays", []));
  let count = 0;
  const cursor = new Date();
  if (!days.has(isoDay(cursor))) cursor.setDate(cursor.getDate() - 1); // today still counts as pending
  while (days.has(isoDay(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function shuffle(list) {
  const out = [...list];
  const random = new Uint32Array(out.length);
  crypto.getRandomValues(random);
  for (let i = out.length - 1; i > 0; i--) {
    const j = random[i] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickWords(level) {
  const recent = new Set(Storage.get(`recent:${level}`, []));
  const all = WORDS[level].map(([word]) => word);
  const fresh = shuffle(all.filter((w) => !recent.has(w)));
  const chosen = [...fresh, ...shuffle(all.filter((w) => recent.has(w)))].slice(0, ROUND_LENGTH);
  Storage.set(`recent:${level}`, chosen);
  return chosen;
}

// ───────────────────────── Sentences

const fallbackSentence = (word) => {
  for (const list of Object.values(WORDS)) {
    const hit = list.find(([w]) => w === word);
    if (hit) return hit[1];
  }
  return `Can you spell ${word}?`;
};

async function sentenceFor(word) {
  const cache = Storage.get("sentences", {});
  if (cache[word]) return cache[word];
  let text = null;
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { timeout: 5000 });
    if (response.ok) {
      const entries = await response.json();
      outer: for (const entry of Array.isArray(entries) ? entries : []) {
        for (const meaning of entry.meanings ?? []) {
          for (const definition of meaning.definitions ?? []) {
            const example = (definition.example ?? "").trim();
            if (example.length > 8 && example.length <= 110 && /^[A-Za-z0-9 ,.'!?;:-]+$/.test(example)) {
              text = /[.!?]$/.test(example) ? example : `${example}.`;
              break outer;
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn("Sentence lookup failed:", error.message);
  }
  text ??= fallbackSentence(word);
  const keys = Object.keys(cache);
  if (keys.length >= 120) delete cache[keys[0]];
  cache[word] = text;
  Storage.set("sentences", cache);
  return text;
}

// ───────────────────────── Checking an answer

const clean = (text) => String(text ?? "").toLowerCase().replace(/[^a-z]/g, "");

// "a p p l e", "ay pea pea el ee", "double p" and plain "apple" all become "apple".
function spellingFrom(heard) {
  const tokens = String(heard ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";
  if (tokens.length === 1) return tokens[0];
  const letters = [];
  let doubleNext = false;
  for (const token of tokens) {
    if (token === "double") { doubleNext = true; continue; }
    const letter = token.length === 1 ? token : LETTER_WORDS[token] ?? token;
    letters.push(doubleNext && letter.length === 1 ? letter + letter : letter);
    doubleNext = false;
  }
  return letters.join("");
}

async function attempt(rawTyped) {
  const r = round();
  if (!r || r.done || r.feedback) return;
  const typed = clean(rawTyped);
  if (!typed) return;
  const correct = typed === currentWord(r);
  saveRound({ typed, feedback: { typed, correct } });
  try {
    await UI.haptic(correct ? "success" : "error");
    await Sound.play(correct ? "success" : "failure", { volume: 0.7 });
  } catch { /* sound is optional */ }
}

function finishRound(r) {
  const score = r.results.filter((x) => x.correct).length;
  const earned = starsForScore(score);
  const before = levelProgress(r.level);
  Storage.set("progress", {
    ...progress(),
    [r.level]: { rounds: before.rounds + 1, best: Math.max(before.best, score), stars: before.stars + earned },
  });
  const days = new Set(Storage.get("playDays", []));
  days.add(isoDay());
  Storage.set("playDays", [...days].sort().slice(-400));
  Storage.set("round", { ...r, done: true, score, earned });
}

// ───────────────────────── Actions

Script.action("level", ({ value }) => Storage.set("level", value));

Script.action("start", async ({ level }) => {
  const id = level ?? chosenLevel();
  Storage.set("level", id);
  const words = pickWords(id);
  Storage.set("round", { level: id, words, index: 0, typed: "", feedback: null, results: [], done: false, started: Date.now() });
  try { await Speech.say(`Your first word is ${words[0]}.`, { rate: 0.9 }); } catch { /* no voice */ }
});

Script.action("say", async () => {
  const r = round();
  if (!r || r.done) return;
  try { await Speech.say(currentWord(r), { rate: 0.85 }); } catch { /* no voice */ }
});

Script.action("sentence", async () => {
  const r = round();
  if (!r || r.done) return;
  const sentence = await sentenceFor(currentWord(r));
  saveRound({ sentencePlayed: true });
  try { await Speech.say(sentence, { rate: 0.9 }); } catch { /* no voice */ }
});

Script.action("typed", ({ value }) => attempt(value));

Script.action("listen", async () => {
  const r = round();
  if (!r || r.done || r.feedback) return;
  const heard = await Speech.listen({ prompt: "Spell the word out loud, letter by letter" });
  if (heard) await attempt(spellingFrom(heard));
});

Script.action("next", async () => {
  const r = round();
  if (!r || !r.feedback) return;
  const results = [...r.results, { word: currentWord(r), typed: r.feedback.typed, correct: r.feedback.correct }];
  const index = r.index + 1;
  if (index >= r.words.length) {
    finishRound({ ...r, results, index });
    try { await Sound.play(starsForScore(results.filter((x) => x.correct).length) > 0 ? "chime" : "ding"); } catch { /* optional */ }
    return;
  }
  Storage.set("round", { ...r, results, index, typed: "", feedback: null, sentencePlayed: false });
  try { await Speech.say(`Next word: ${r.words[index]}.`, { rate: 0.9 }); } catch { /* no voice */ }
});

Script.action("home", () => Storage.remove("round"));

Script.action("resetProgress", async () => {
  const choice = await UI.alert({ title: "Start over?", message: "Stars, badges and the streak go back to zero.", buttons: ["Cancel", "Reset"] });
  if (choice !== 1) return;
  for (const key of ["progress", "playDays", "round"]) Storage.remove(key);
});

// ───────────────────────── Pieces

const bigButton = (label, symbol, action, color, fallback) =>
  Widget.button(Widget.vstack([
    Widget.symbol(symbol, { size: 28, color: "white", fallback }),
    Widget.text(label, { font: "caption", weight: "bold", color: "white" }),
  ], { spacing: 6, padding: 12, background: color, cornerRadius: 16, frame: { maxWidth: "infinity" } }), action);

function tile(letter, state, size) {
  const colors = { right: "#22C55E", wrong: "#EF4444", blank: { light: "#E7E5E4", dark: "#2C2A28" }, answer: HONEY };
  return Widget.text(letter.toUpperCase(), {
    font: size * 0.55, weight: "bold", design: "rounded",
    color: state === "blank" ? "secondary" : "white",
    background: colors[state], cornerRadius: size * 0.22,
    frame: { width: size, height: size * 1.2 },
    align: "center",
  });
}

function tileRow(letters, states, size) {
  return Widget.hstack(letters.map((letter, i) => tile(letter, states[i], size)), { spacing: 4 });
}

function tilesFor(word, typed) {
  const size = Math.max(22, Math.min(40, Math.floor(300 / Math.max(word.length, typed.length || 1)) - 4));
  if (!typed) return tileRow([...word].map(() => "•"), [...word].map(() => "blank"), size);
  const attemptLetters = [...typed];
  const states = attemptLetters.map((letter, i) => (letter === word[i] ? "right" : "wrong"));
  return tileRow(attemptLetters, states, size);
}

function progressDots(r) {
  return Widget.hstack(r.words.map((_, i) => {
    const result = r.results[i];
    const color = result ? (result.correct ? "#22C55E" : "#EF4444") : i === r.index ? HONEY : { light: "#E7E5E4", dark: "#2C2A28" };
    return { type: "stack", direction: "horizontal", children: [], background: color, cornerRadius: 5, frame: { width: i === r.index ? 14 : 10, height: 10 } };
  }), { spacing: 4 });
}

function badgeCard() {
  const total = totalStars();
  const badge = badgeFor(total);
  const next = nextBadge(total);
  const days = streak();
  return Widget.hstack([
    Widget.symbol(badge.symbol, { size: 34, color: HONEY, fallback: badge.emoji }),
    Widget.vstack([
      Widget.text(badge.name, { font: "headline" }),
      Widget.text(next ? `${next.stars - total} more ⭐ for ${next.name}` : "The top badge!", { font: "caption", color: "secondary" }),
    ], { alignment: "leading", spacing: 2 }),
    Widget.spacer(),
    Widget.vstack([
      Widget.text(`${days} 🔥`, { font: "title3", weight: "bold", design: "rounded" }),
      Widget.text(days === 1 ? "day streak" : "days streak", { font: "caption2", color: "secondary" }),
    ], { alignment: "trailing", spacing: 0 }),
  ], { spacing: 12, padding: 14, background: CARD, cornerRadius: 16 });
}

// ───────────────────────── Screens

function homeScreen() {
  const level = levelInfo(chosenLevel());
  const played = Storage.get("playDays", []).includes(isoDay());
  return Widget.vstack([
    Widget.text("🐝", { font: 64, align: "center", frame: { maxWidth: "infinity" } }),
    Widget.text("Spelling Bee", { font: "largeTitle", weight: "bold", align: "center", frame: { maxWidth: "infinity" } }),
    Widget.text(played ? "You already played today. One more round?" : "Play a round today to keep your streak.", { color: "secondary", align: "center", frame: { maxWidth: "infinity" } }),
    badgeCard(),
    Widget.picker(LEVELS.map((l) => ({ label: `${l.emoji} ${l.label}`, value: l.id })), level.id, "level", null, { style: "segmented", label: "Level" }),
    Widget.text(`${level.label}: ${level.hint}, ${WORDS[level.id].length} words to learn.`, { font: "footnote", color: "secondary" }),
    Widget.button(`Start a round of ${ROUND_LENGTH} words`, "start", { level: level.id }, { style: "prominent", color: level.color }),
    Widget.text("Progress", { font: "headline" }),
    ...LEVELS.map((l) => {
      const p = levelProgress(l.id);
      return Widget.hstack([
        Widget.text(l.emoji, { font: 24 }),
        Widget.vstack([
          Widget.text(l.label, { font: "subheadline", weight: "semibold" }),
          Widget.text(p.rounds ? `${p.rounds} round${p.rounds === 1 ? "" : "s"} · best ${p.best}/${ROUND_LENGTH}` : "Not played yet", { font: "caption", color: "secondary" }),
        ], { alignment: "leading", spacing: 1 }),
        Widget.spacer(),
        Widget.text(`${p.stars} ⭐`, { font: "headline", color: l.color }),
      ], { spacing: 10, padding: 12, background: CARD, cornerRadius: 14 });
    }),
    Widget.hstack([
      Widget.spacer(),
      Widget.button("Reset progress", "resetProgress", null, { style: "plain", color: "red" }),
    ]),
  ], { alignment: "leading", spacing: 14, padding: 16, background: PAGE });
}

function playScreen(r) {
  const level = levelInfo(r.level);
  const word = currentWord(r);
  const feedback = r.feedback;
  const showBlanks = r.level !== "hard";
  const score = r.results.filter((x) => x.correct).length;

  const answerArea = feedback
    ? Widget.vstack([
        Widget.text(feedback.correct ? "🎉 Correct!" : "Not quite", { font: "title2", weight: "bold", color: feedback.correct ? "green" : "red" }),
        Widget.text("You spelled", { font: "caption", color: "secondary" }),
        tilesFor(word, feedback.typed),
        feedback.correct ? null : Widget.text("The right spelling", { font: "caption", color: "secondary" }),
        feedback.correct ? null : tileRow([...word], [...word].map(() => "answer"), Math.max(22, Math.min(40, Math.floor(300 / word.length) - 4))),
        Widget.button(r.index + 1 >= r.words.length ? "See my results" : "Next word", "next", null, { style: "prominent", color: level.color }),
      ], { alignment: "center", spacing: 10, frame: { maxWidth: "infinity" } })
    : Widget.vstack([
        showBlanks ? tilesFor(word, "") : Widget.text("No hints on hard. Listen carefully!", { font: "caption", color: "secondary" }),
        Widget.textField("Type the word, then tap Return", r.typed ?? "", "typed", null, { label: "Your spelling", keyboard: "default" }),
        Widget.hstack([
          bigButton("Say it", "speaker.wave.2.fill", "say", "#3B82F6", "🔊"),
          bigButton("In a sentence", "text.quote", "sentence", "#8B5CF6", "💬"),
          bigButton("Spell aloud", "mic.fill", "listen", "#EC4899", "🎤"),
        ], { spacing: 10 }),
        r.sentencePlayed ? Widget.text("Sentence played. Need it again? Tap once more.", { font: "caption2", color: "secondary" }) : null,
      ], { alignment: "center", spacing: 14, frame: { maxWidth: "infinity" } });

  return Widget.vstack([
    Widget.hstack([
      Widget.button(Widget.label("Quit", "xmark.circle", { color: "secondary" }), "home", null, { style: "plain" }),
      Widget.spacer(),
      Widget.text(`${level.emoji} ${level.label}`, { font: "subheadline", weight: "semibold", color: level.color }),
      Widget.spacer(),
      Widget.text(`${score} ⭐`, { font: "subheadline", weight: "semibold" }),
    ]),
    progressDots(r),
    Widget.text(`Word ${r.index + 1} of ${r.words.length}`, { font: "caption", color: "secondary" }),
    Widget.vstack([
      Widget.text("👂", { font: 56 }),
      Widget.text("Listen, then spell the word", { font: "title3", weight: "semibold", align: "center" }),
    ], { spacing: 6, padding: 20, background: CARD, cornerRadius: 20, frame: { maxWidth: "infinity" } }),
    answerArea,
  ], { alignment: "center", spacing: 14, padding: 16, background: PAGE });
}

function resultsScreen(r) {
  const level = levelInfo(r.level);
  const stars = "⭐".repeat(r.earned) || "—";
  const message = r.earned === 3 ? "Perfect round! Amazing." : r.earned === 2 ? "Brilliant spelling!" : r.earned === 1 ? "Good work, keep going." : "Practice makes perfect. Try again!";
  return Widget.vstack([
    Widget.text(r.earned >= 2 ? "🏆" : "🐝", { font: 64, align: "center", frame: { maxWidth: "infinity" } }),
    Widget.text(`${r.score} out of ${r.words.length}`, { font: "largeTitle", weight: "bold", align: "center", frame: { maxWidth: "infinity" } }),
    Widget.text(stars, { font: 36, align: "center", frame: { maxWidth: "infinity" } }),
    Widget.text(message, { font: "headline", color: level.color, align: "center", frame: { maxWidth: "infinity" } }),
    badgeCard(),
    Widget.list(r.results.map((x) => ({
      title: x.word,
      subtitle: x.correct ? "" : `You spelled: ${x.typed}`,
      symbol: x.correct ? "checkmark.circle.fill" : "xmark.circle.fill",
      color: x.correct ? "green" : "red",
      detail: x.correct ? "⭐" : "",
    })), { title: "This round" }),
    Widget.button("Play again", "start", { level: r.level }, { style: "prominent", color: level.color }),
    Widget.button("Back to levels", "home", null, { style: "bordered" }),
  ], { alignment: "leading", spacing: 14, padding: 16, background: PAGE });
}

Script.ui(() => {
  const r = round();
  const content = !r ? homeScreen() : r.done ? resultsScreen(r) : playScreen(r);
  return { title: "Spelling Bee", content };
});

// ───────────────────────── Widget

Script.widget(() => {
  const total = totalStars();
  const badge = badgeFor(total);
  const days = streak();
  const playedToday = Storage.get("playDays", []).includes(isoDay());
  const midnight = new Date();
  midnight.setHours(24, 0, 10, 0);
  return {
    content: Widget.vstack([
      Widget.hstack([
        Widget.text("🐝", { font: 22 }),
        Widget.spacer(),
        Widget.symbol(badge.symbol, { size: 18, color: HONEY, fallback: badge.emoji }),
      ]),
      Widget.spacer(),
      Widget.text(`${days}`, { font: 40, weight: "bold", design: "rounded", color: HONEY, lineLimit: 1 }),
      Widget.text("day streak", { font: "caption", weight: "semibold", color: "secondary" }),
      Widget.text(badge.name, { font: "headline", lineLimit: 1, minimumScale: 0.7 }),
      Widget.text(playedToday ? `${total} ⭐ · played today` : `${total} ⭐ · play today!`, { font: "caption2", color: playedToday ? "secondary" : "orange", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 2, padding: 14, background: PAGE, url: `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    refreshAt: midnight,
  };
});

// ───────────────────────── Siri and Shortcuts

Script.run(() => {
  const total = totalStars();
  const days = streak();
  return `Spelling Bee: ${total} star${total === 1 ? "" : "s"}, ${badgeFor(total).name}, ${days}-day streak. ${Storage.get("playDays", []).includes(isoDay()) ? "You played today." : "You have not played today yet."}`;
});
