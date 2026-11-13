// @name        Trivia Duel
// @description A daily ten-question quiz from opentdb.com with a timer, streaks, per-category accuracy and a six-character duel code to compare scores with a friend
// @permissions network
// @widget      small, medium, rectangular
// @icon        brain.fill
// @color       #7C3AED
// @version     1.0.0
// @author      va4w
// @category    games

// How it works
// • Once a day the script fetches ten multiple-choice questions from opentdb.com (the Open Trivia Database) for
//   the category and difficulty you chose, and keeps them in Storage, so the day's set is the same every time you open it.
// • Play tab: answer each question against a live timer. Score, time, a streak across days, lifetime stats and a
//   per-category accuracy chart build up on the device.
// • Duel: share today's score with a six-character code that encodes the day, category and difficulty. A friend with the
//   same script enters the code to check they played the same day's setup, then compares scores.
// • Honest limitation: opentdb.com hands out random questions on every request, so two phones can receive different
//   questions for the same code. The duel compares scores on the same day, category and difficulty, not identical questions.
// • Widget: today's score and streak with a Play button that opens the mini-app. Sounds and haptics play in the mini-app only.

// ───────────────────────── Constants

const API = "https://opentdb.com/";
const QUESTIONS = 10;
const DAY = 86_400_000;
const EPOCH = Date.UTC(2020, 0, 1);
const DIFFICULTIES = [{ label: "Easy", value: "easy" }, { label: "Medium", value: "medium" }, { label: "Hard", value: "hard" }];
const FALLBACK_CATEGORIES = [
  { id: 9, name: "General Knowledge" }, { id: 17, name: "Science & Nature" }, { id: 18, name: "Computers" }, { id: 21, name: "Sports" },
  { id: 22, name: "Geography" }, { id: 23, name: "History" }, { id: 11, name: "Film" }, { id: 12, name: "Music" }, { id: 27, name: "Animals" },
];

const PURPLE = "#7C3AED";
const HERO = Widget.gradient(["#7C3AED", "#4C1D95"], { direction: "topLeadingToBottomTrailing" });
const CARD_BG = { light: "#F1F5F9", dark: "#1E293B" };
const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────── Storage

const settings = () => ({ category: 9, difficulty: "medium", ...Storage.get("settings", {}) });
const todayISO = () => new Date().toLocaleDateString("en-CA");
const setKey = (date = todayISO()) => `${date}|${settings().category}|${settings().difficulty}`;
const games = () => Storage.get("games", {});
const todayGame = () => games()[setKey()] ?? null;

function saveGame(g) {
  const all = games();
  all[g.key] = g;
  // Keep the last 60 days.
  const cutoff = new Date(Date.now() - 60 * DAY).toLocaleDateString("en-CA");
  for (const key of Object.keys(all)) if (key.slice(0, 10) < cutoff) delete all[key];
  Storage.set("games", all);
}

const categoryName = (id) => (categories().find((c) => c.id === Number(id))?.name ?? "Any category").replace(/^Entertainment: |^Science: /, "");

// ───────────────────────── Deterministic shuffle (same order every time the set is drawn)

function seedFrom(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function shuffled(list, seed) {
  let s = seed || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// ───────────────────────── Open Trivia DB

function categories() {
  return Storage.get("categories")?.list ?? FALLBACK_CATEGORIES;
}

async function loadCategories() {
  const cached = Storage.get("categories");
  if (cached && Date.now() - cached.time < 30 * DAY) return;
  try {
    const response = await fetch(`${API}api_category.php`, { timeout: 8000 });
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const data = await response.json();
    const list = (data.trivia_categories ?? []).map((c) => ({ id: Number(c.id), name: String(c.name) })).filter((c) => c.id && c.name);
    if (list.length) Storage.set("categories", { list, time: Date.now() });
  } catch (error) {
    console.warn("Categories:", error.message);
  }
}

const decode = (text) => { try { return decodeURIComponent(text); } catch { return text; } };

async function fetchSet(key) {
  const { category, difficulty } = settings();
  const url = new URL(`${API}api.php`);
  url.searchParams.set("amount", String(QUESTIONS));
  if (category) url.searchParams.set("category", String(category));
  if (difficulty) url.searchParams.set("difficulty", difficulty);
  url.searchParams.set("type", "multiple");
  url.searchParams.set("encode", "url3986");

  const response = await fetch(url, { timeout: 12_000 });
  if (response.status === 429) throw new Error("Open Trivia DB asks for a short pause. Try again in a few seconds.");
  if (!response.ok) throw new Error(`Open Trivia DB answered ${response.status}`);
  const data = await response.json();
  if (data.response_code === 1) throw new Error("Not enough questions for that category and difficulty. Pick another combination.");
  if (data.response_code !== 0) throw new Error(`Open Trivia DB returned code ${data.response_code}`);

  const questions = data.results.map((r, index) => {
    const correct = decode(r.correct_answer);
    const answers = shuffled([correct, ...r.incorrect_answers.map(decode)], seedFrom(`${key}#${index}`));
    return { text: decode(r.question), correct: answers.indexOf(correct), answers, category: decode(r.category).replace(/^Entertainment: |^Science: /, ""), difficulty: r.difficulty };
  });
  return { key, date: key.slice(0, 10), category, difficulty, questions, answers: [], times: [], current: 0, questionStart: null, finished: false, score: 0, fetched: Date.now() };
}

// ───────────────────────── Stats

const finishedGames = () => Object.values(games()).filter((g) => g.finished);

function streak() {
  const days = new Set(finishedGames().map((g) => g.date));
  let count = 0;
  const cursor = new Date();
  if (!days.has(todayISO())) cursor.setDate(cursor.getDate() - 1); // today not played yet: count up to yesterday
  while (days.has(cursor.toLocaleDateString("en-CA"))) { count++; cursor.setDate(cursor.getDate() - 1); }
  return count;
}

function categoryAccuracy() {
  const tally = {};
  for (const g of finishedGames()) {
    g.questions.forEach((q, i) => {
      const t = (tally[q.category] ??= { right: 0, total: 0 });
      t.total++;
      if (g.answers[i] === q.correct) t.right++;
    });
  }
  return Object.entries(tally).map(([name, t]) => ({ name, ...t, pct: Math.round((t.right / t.total) * 100) })).sort((a, b) => b.total - a.total).slice(0, 8);
}

function lifetime() {
  const list = finishedGames();
  const right = list.reduce((s, g) => s + g.score, 0);
  const total = list.length * QUESTIONS;
  const seconds = list.reduce((s, g) => s + g.times.reduce((a, b) => a + b, 0), 0);
  const perfect = list.filter((g) => g.score === QUESTIONS).length;
  return { games: list.length, right, total, pct: total ? Math.round((right / total) * 100) : 0, avgSeconds: total ? seconds / total : 0, perfect, best: Math.max(0, ...list.map((g) => g.score)) };
}

// ───────────────────────── Duel codes: 3 chars day, 2 chars category, 1 char difficulty

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const encode36 = (n, width) => n.toString(36).toUpperCase().padStart(width, "0").slice(-width);

function duelCode(g) {
  const days = Math.floor((Date.UTC(...g.date.split("-").map(Number).map((v, i) => (i === 1 ? v - 1 : v))) - EPOCH) / DAY);
  return `${encode36(days, 3)}${encode36(Number(g.category) || 0, 2)}${g.difficulty[0].toUpperCase()}`;
}

function parseCode(code) {
  const clean = String(code).toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (clean.length !== 6 || [...clean].some((ch) => !ALPHABET.includes(ch))) return null;
  const days = parseInt(clean.slice(0, 3), 36);
  const category = parseInt(clean.slice(3, 5), 36);
  const difficulty = { E: "easy", M: "medium", H: "hard" }[clean[5]];
  if (!difficulty) return null;
  return { date: new Date(EPOCH + days * DAY).toISOString().slice(0, 10), category, difficulty };
}

// ───────────────────────── Actions

let tab = 0;
let busy = false;
let notice = null;
let friendCode = "";
let friendScore = "";

async function feedback(right) {
  try { await UI.haptic(right ? "success" : "error"); await Sound.play(right ? "pop" : "failure", { volume: 0.5 }); } catch { /* no sound here */ }
}

Script.action("tab", ({ value }) => { tab = value; });
Script.action("setting", ({ field, value }) => Storage.set("settings", { ...settings(), [field]: value }));

Script.action("start", async () => {
  busy = true;
  notice = null;
  try {
    const key = setKey();
    const g = games()[key] ?? (await fetchSet(key));
    if (!g.finished && g.questionStart === null) g.questionStart = Date.now();
    saveGame(g);
  } catch (error) {
    notice = error.message;
  } finally {
    busy = false;
  }
});

Script.action("answer", async ({ index }) => {
  const g = todayGame();
  if (!g || g.finished || g.answers.length > g.current) return;
  g.answers[g.current] = index;
  g.times[g.current] = Math.min(300, Math.round((Date.now() - (g.questionStart ?? Date.now())) / 1000));
  const right = index === g.questions[g.current].correct;
  if (right) g.score++;
  saveGame(g);
  await feedback(right);
});

Script.action("next", () => {
  const g = todayGame();
  if (!g || g.finished) return;
  if (g.current + 1 >= g.questions.length) {
    g.finished = true;
    g.finishedAt = Date.now();
  } else {
    g.current++;
    g.questionStart = Date.now();
  }
  saveGame(g);
});

Script.action("share", async () => {
  const g = todayGame();
  if (!g?.finished) return;
  const seconds = g.times.reduce((a, b) => a + b, 0);
  await UI.share(`Trivia Duel ${g.date}: I scored ${g.score}/${QUESTIONS} in ${seconds}s on ${categoryName(g.category)} (${g.difficulty}). Duel code ${duelCode(g)}: play the same setup in Scriptwell and beat me.`);
});

Script.action("friendCode", ({ value }) => { friendCode = value.trim(); });
Script.action("friendScore", ({ value }) => { friendScore = value.trim(); });
Script.action("resetStats", async () => {
  const choice = await UI.alert({ title: "Delete all games and stats?", message: "Today's set will be fetched again.", buttons: ["Cancel", "Delete"] });
  if (choice === 1) Storage.remove("games");
});

// ───────────────────────── Mini-app pieces

const pill = (text, color = "secondary") => Widget.text(text, { font: "caption2", weight: "semibold", color, padding: { horizontal: 7, vertical: 3 }, background: CARD_BG, cornerRadius: 8 });
const formatSeconds = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function settingsCard() {
  const s = settings();
  return Widget.card([
    Widget.picker([{ label: "Any category", value: 0 }, ...categories().map((c) => ({ label: c.name, value: c.id }))], s.category, "setting", { field: "category" }, { label: "Category" }),
    Widget.picker(DIFFICULTIES, s.difficulty, "setting", { field: "difficulty" }, { style: "segmented", label: "Difficulty" }),
    Widget.text("Changing these starts a different set for today; your streak counts any finished set.", { font: "caption2", color: "secondary" }),
  ], { title: "Today's setup", symbol: "slider.horizontal.3", color: "purple" });
}

function startScreen() {
  const run = streak();
  return Widget.vstack([
    Widget.vstack([
      Widget.symbol("brain.fill", { size: 56, color: "white", fallback: "🧠" }),
      Widget.text(new Date().toLocaleDateString(Script.env.locale, { weekday: "long", day: "numeric", month: "long" }), { font: "caption", color: "#FFFFFFCC" }),
      Widget.text(`${QUESTIONS} questions · ${categoryName(settings().category)} · ${settings().difficulty}`, { font: "footnote", weight: "semibold", color: "white", align: "center" }),
      run ? Widget.text(`🔥 ${run}-day streak`, { font: "caption", color: "white" }) : null,
      busy ? Widget.progress(0.6, { style: "ring", color: "white" }) : Widget.button("Play today's set", "start", null, { style: "prominent", color: "white" }),
    ], { spacing: 8, padding: 24, background: HERO, cornerRadius: 20, frame: { maxWidth: "infinity" } }),
    notice ? Widget.text(notice, { font: "footnote", color: "orange", align: "center" }) : null,
    settingsCard(),
  ], { spacing: 14 });
}

function questionScreen(g) {
  const q = g.questions[g.current];
  const answered = g.answers.length > g.current;
  const chosen = g.answers[g.current];
  return Widget.vstack([
    Widget.hstack([
      Widget.text(`${g.current + 1} / ${QUESTIONS}`, { font: "headline", design: "rounded", color: "purple" }),
      Widget.spacer(),
      Widget.symbol("clock", { size: 12, color: "secondary", fallback: "⏱" }),
      answered ? Widget.text(`${g.times[g.current]}s`, { font: "subheadline", design: "monospaced" }) : Widget.date(g.questionStart ?? Date.now(), { style: "timer", font: "subheadline", design: "monospaced" }),
      Widget.spacer(),
      Widget.text(`${g.score} right`, { font: "subheadline", weight: "semibold", color: "green" }),
    ], { spacing: 6 }),
    Widget.progress(g.current / QUESTIONS, { color: "purple" }),
    Widget.hstack([pill(q.category, "purple"), pill(q.difficulty)], { spacing: 6 }),
    Widget.text(q.text, { font: "title3", weight: "semibold", padding: 14, background: CARD_BG, cornerRadius: 14, frame: { maxWidth: "infinity", alignment: "leading" } }),
    ...q.answers.map((answer, index) => {
      let style = "bordered", color = "purple";
      if (answered && index === q.correct) { style = "prominent"; color = "green"; }
      else if (answered && index === chosen) { style = "prominent"; color = "red"; }
      else if (answered) { color = "gray"; }
      return Widget.button(Widget.text(answer, { font: "body", lineLimit: 3, frame: { maxWidth: "infinity", alignment: "leading" }, padding: { horizontal: 4, vertical: 6 } }), "answer", { index }, { style, color });
    }),
    answered
      ? Widget.vstack([
          Widget.text(chosen === q.correct ? "Correct!" : `Not quite. It was ${q.answers[q.correct]}.`, { font: "subheadline", weight: "semibold", color: chosen === q.correct ? "green" : "red", align: "center" }),
          Widget.button(g.current + 1 >= QUESTIONS ? "See results" : "Next question", "next", null, { style: "prominent", color: "purple" }),
        ], { spacing: 8 })
      : Widget.text("Tap an answer. The timer per question is recorded.", { font: "caption", color: "secondary", align: "center" }),
  ], { alignment: "leading", spacing: 12 });
}

function resultScreen(g) {
  const seconds = g.times.reduce((a, b) => a + b, 0);
  const run = streak();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  return Widget.vstack([
    Widget.vstack([
      Widget.progress(g.score / QUESTIONS, { style: "ring", color: "white", label: `${g.score}/${QUESTIONS}` }),
      Widget.text(g.score === QUESTIONS ? "Perfect round!" : g.score >= 7 ? "Sharp." : g.score >= 4 ? "Not bad." : "Tomorrow is another day.", { font: "title3", weight: "bold", color: "white" }),
      Widget.text(`${formatSeconds(seconds)} total · ${(seconds / QUESTIONS).toFixed(1)}s per question`, { font: "footnote", color: "#FFFFFFCC" }),
      Widget.text(`🔥 ${run}-day streak`, { font: "caption", color: "white" }),
      Widget.hstack([Widget.text("Next set", { font: "caption2", color: "#FFFFFFCC" }), Widget.date(midnight, { style: "relative", font: "caption2", color: "white" })], { spacing: 4 }),
    ], { spacing: 8, padding: 22, background: HERO, cornerRadius: 20, frame: { maxWidth: "infinity" } }),
    Widget.card([
      Widget.text(duelCode(g), { font: 34, weight: "black", design: "monospaced", color: "purple", align: "center", frame: { maxWidth: "infinity" } }),
      Widget.text(`${g.date} · ${categoryName(g.category)} · ${g.difficulty}`, { font: "caption", color: "secondary", align: "center", frame: { maxWidth: "infinity" } }),
      Widget.button("Share score and code", "share", null, { style: "prominent", color: "purple" }),
    ], { title: "Duel code", symbol: "person.2.fill", color: "purple" }),
    Widget.card(g.questions.map((q, i) => Widget.hstack([
      Widget.symbol(g.answers[i] === q.correct ? "checkmark.circle.fill" : "xmark.circle.fill", { size: 16, color: g.answers[i] === q.correct ? "green" : "red", fallback: g.answers[i] === q.correct ? "✅" : "❌" }),
      Widget.text(q.text, { font: "caption", lineLimit: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
      Widget.text(`${g.times[i]}s`, { font: "caption2", design: "monospaced", color: "secondary" }),
    ], { spacing: 8 })), { title: "Review", symbol: "list.bullet.clipboard", color: "purple" }),
    settingsCard(),
  ], { spacing: 14 });
}

function playTab() {
  const g = todayGame();
  if (!g) return startScreen();
  if (g.finished) return resultScreen(g);
  if (g.questionStart === null) return startScreen();
  return questionScreen(g);
}

function statsTab() {
  const life = lifetime();
  const acc = categoryAccuracy();
  const recent = finishedGames().sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  const tile = (label, value, color = "purple") => Widget.vstack([
    Widget.text(value, { font: "title2", weight: "bold", design: "rounded", color }),
    Widget.text(label, { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 1, padding: 10, background: CARD_BG, cornerRadius: 12, frame: { maxWidth: "infinity", alignment: "leading" } });
  if (life.games === 0) {
    return Widget.vstack([
      Widget.symbol("chart.bar.xaxis", { size: 44, color: "purple", fallback: "📊" }),
      Widget.text("No finished games yet", { font: "headline" }),
      Widget.text("Stats and the accuracy chart appear after your first set.", { color: "secondary", align: "center" }),
    ], { spacing: 8, padding: 30 });
  }
  return Widget.vstack([
    Widget.hstack([tile("streak", `🔥 ${streak()}`), tile("accuracy", `${life.pct}%`, "green"), tile("games", life.games, "blue")], { spacing: 8 }),
    Widget.hstack([tile("best score", `${life.best}/${QUESTIONS}`), tile("perfect rounds", life.perfect, "orange"), tile("avg answer", `${life.avgSeconds.toFixed(1)}s`, "teal")], { spacing: 8 }),
    Widget.card([
      Widget.chart(acc.map((a) => ({ x: a.name.length > 12 ? `${a.name.slice(0, 11)}…` : a.name, y: a.pct })), { color: "purple", range: [0, 100], frame: { height: 200 } }),
      ...acc.map((a) => Widget.hstack([
        Widget.text(a.name, { font: "caption", lineLimit: 1, frame: { maxWidth: "infinity", alignment: "leading" } }),
        Widget.text(`${a.right}/${a.total}`, { font: "caption2", color: "secondary" }),
        Widget.text(`${a.pct}%`, { font: "caption", weight: "semibold", color: a.pct >= 70 ? "green" : a.pct >= 40 ? "orange" : "red", frame: { width: 40, alignment: "trailing" } }),
      ], { spacing: 8 })),
    ], { title: "Accuracy by category", subtitle: "percent correct", symbol: "chart.bar.fill", color: "purple" }),
    Widget.card([
      Widget.chart(recent.map((g) => ({ x: g.date.slice(5), y: g.score })), { kind: "line", smooth: true, color: "green", range: [0, QUESTIONS], frame: { height: 160 } }),
    ], { title: "Last games", subtitle: `${recent.length} shown`, symbol: "chart.xyaxis.line", color: "green" }),
    Widget.button("Delete games and stats", "resetStats", null, { style: "plain", color: "red" }),
  ], { spacing: 12 });
}

function duelTab() {
  const g = todayGame();
  const mine = g?.finished ? g : null;
  const parsed = friendCode ? parseCode(friendCode) : null;
  const matches = mine && parsed && parsed.date === mine.date && parsed.category === Number(mine.category) && parsed.difficulty === mine.difficulty;
  const theirs = Number(friendScore);
  let verdict = null;
  if (matches && friendScore !== "" && !Number.isNaN(theirs)) {
    verdict = theirs === mine.score ? "A draw." : theirs < mine.score ? `You win ${mine.score}–${theirs}.` : `They win ${theirs}–${mine.score}.`;
  }
  return Widget.vstack([
    Widget.card([
      mine
        ? Widget.vstack([
            Widget.text(duelCode(mine), { font: 34, weight: "black", design: "monospaced", color: "purple" }),
            Widget.text(`${mine.score}/${QUESTIONS} · ${categoryName(mine.category)} · ${mine.difficulty}`, { font: "footnote", color: "secondary" }),
            Widget.button("Share score and code", "share", null, { style: "prominent", color: "purple" }),
          ], { alignment: "leading", spacing: 8 })
        : Widget.text("Finish today's set to get your duel code.", { color: "secondary" }),
    ], { title: "Your code", symbol: "qrcode", color: "purple" }),
    Widget.card([
      Widget.textField("e.g. 1XG09M, then Return", friendCode, "friendCode", null, { label: "Friend's code" }),
      parsed
        ? Widget.text(`${parsed.date} · ${categoryName(parsed.category)} · ${parsed.difficulty}${mine ? (matches ? " · same setup as yours ✓" : " · different from your setup") : ""}`, { font: "caption", color: matches ? "green" : "secondary" })
        : (friendCode ? Widget.text("That is not a valid code.", { font: "caption", color: "red" }) : null),
      Widget.textField("Their score, 0–10", friendScore, "friendScore", null, { label: "Friend's score", keyboard: "number" }),
      verdict ? Widget.text(verdict, { font: "title3", weight: "bold", color: "purple" }) : null,
    ], { title: "Compare", symbol: "person.2.fill", color: "purple" }),
    Widget.text("A code is the day, category and difficulty. Open Trivia DB serves random questions per request, so a friend may get different questions in the same setup; the duel is on score, not identical questions.", { font: "caption2", color: "secondary" }),
  ], { spacing: 12 });
}

Script.ui(async () => {
  if (tab === 0) await loadCategories();
  const g = todayGame();
  return {
    title: "Trivia Duel",
    content: Widget.vstack([
      Widget.tabs([
        { title: g && !g.finished && g.questionStart !== null ? `Q${g.current + 1}` : "Play", symbol: "play.fill", content: playTab() },
        { title: "Stats", symbol: "chart.bar.fill", content: statsTab() },
        { title: "Duel", symbol: "person.2.fill", content: duelTab() },
      ], { selected: tab, action: "tab" }),
    ], { padding: 12 }),
  };
});

// ───────────────────────── Widget

Script.widget(({ family }) => {
  const g = todayGame();
  const done = g?.finished ? g : null;
  const run = streak();
  const midnight = new Date();
  midnight.setHours(24, 0, 10, 0);
  const playPill = (font = "caption") => Widget.text(done ? "Review" : g ? "Continue" : "Play", {
    font, weight: "bold", color: "white", padding: { horizontal: 12, vertical: 5 }, background: PURPLE, cornerRadius: 10,
  });
  let content;

  switch (family) {
    case "rectangular":
      content = Widget.vstack([
        Widget.hstack([
          Widget.symbol("brain.fill", { size: 11, fallback: "🧠" }),
          Widget.text("Trivia Duel", { font: "caption2", weight: "semibold" }),
          Widget.spacer(),
          Widget.text(run ? `🔥 ${run}` : "", { font: "caption2" }),
        ], { spacing: 3 }),
        Widget.text(done ? `${done.score}/${QUESTIONS} today` : g ? `Question ${g.current + 1} waiting` : "Today's set is ready", { font: "headline", lineLimit: 1 }),
        Widget.text(done ? categoryName(done.category) : `${categoryName(settings().category)} · ${settings().difficulty}`, { font: "caption", lineLimit: 1 }),
      ], { alignment: "leading", spacing: 1 });
      break;
    case "small":
      content = Widget.vstack([
        Widget.hstack([
          Widget.symbol("brain.fill", { size: 12, color: "purple", fallback: "🧠" }),
          Widget.text("Today", { font: "caption", weight: "semibold", color: "secondary" }),
          Widget.spacer(),
          run ? Widget.text(`🔥${run}`, { font: "caption", weight: "semibold" }) : null,
        ], { spacing: 4 }),
        Widget.text(done ? `${done.score}/${QUESTIONS}` : "—", { font: 40, weight: "bold", design: "rounded", color: "purple" }),
        Widget.text(done ? `in ${formatSeconds(done.times.reduce((a, b) => a + b, 0))}` : categoryName(settings().category), { font: "caption2", color: "secondary", lineLimit: 1 }),
        Widget.spacer(),
        playPill(),
      ], { alignment: "leading", spacing: 2, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
      break;
    default: {
      const life = lifetime();
      content = Widget.hstack([
        Widget.vstack([
          Widget.progress(done ? done.score / QUESTIONS : 0, { style: "ring", color: "purple", label: done ? `${done.score}/${QUESTIONS}` : "—" }),
          Widget.text(done ? "today's score" : "not played yet", { font: "caption2", color: "secondary" }),
        ], { spacing: 4, frame: { width: 96 } }),
        Widget.vstack([
          Widget.hstack([
            Widget.symbol("brain.fill", { size: 13, color: "purple", fallback: "🧠" }),
            Widget.text("Trivia Duel", { font: "headline" }),
            Widget.spacer(),
            Widget.text(run ? `🔥 ${run} day${run === 1 ? "" : "s"}` : "start a streak", { font: "caption", weight: "semibold", color: run ? "orange" : "secondary" }),
          ], { spacing: 4 }),
          Widget.text(`${categoryName(settings().category)} · ${settings().difficulty}`, { font: "caption", color: "secondary", lineLimit: 1 }),
          Widget.text(life.games ? `${life.pct}% lifetime · ${life.games} games · best ${life.best}/${QUESTIONS}` : "Ten questions a day from Open Trivia DB", { font: "caption2", color: "secondary", lineLimit: 2 }),
          Widget.spacer(),
          Widget.hstack([
            playPill("subheadline"),
            done ? Widget.text(duelCode(done), { font: "caption", weight: "bold", design: "monospaced", color: "purple" }) : null,
          ], { spacing: 10 }),
        ], { alignment: "leading", spacing: 3, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      ], { spacing: 12, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
    }
  }
  return { content, refreshAt: midnight };
});

// ───────────────────────── Shortcuts and Siri

Script.run(() => {
  const g = todayGame();
  const run = streak();
  if (g?.finished) return `Today: ${g.score} out of ${QUESTIONS} on ${categoryName(g.category)}. Streak ${run}. Duel code ${duelCode(g)}.`;
  return `You have not finished today's Trivia Duel yet. Streak so far: ${run}.`;
});
