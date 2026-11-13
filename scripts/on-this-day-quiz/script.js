// @name        On This Day Quiz
// @description A daily five-question quiz on events that happened on today's date: guess the year, read the story on Wikipedia, keep a streak. Events come from en.wikipedia.org; questions are shortened with on-device AI when available
// @permissions network
// @widget      small, medium, large
// @icon        calendar.badge.clock
// @color       #B45309
// @version     1.0.0
// @author      scriptwell
// @category    education

// How it works
// • Once a day the script loads the "on this day" events for today's date from en.wikipedia.org
//   (the REST feed, with a descriptive User-Agent). The list is cached in Storage for the day.
// • Five events are picked and turned into "In which year did this happen?" questions, each with
//   three distractor years close to the real one. The picking is seeded by the date, so everyone
//   gets the same quiz on the same day.
// • When Apple Intelligence is available, the event text is rephrased on-device into a shorter
//   sentence; otherwise the original text is used. Nothing is sent anywhere but Wikipedia.
// • Answers play a sound and a haptic, show the real year with the story and a link to the
//   Wikipedia page. Your first attempt each day counts towards the score history and streak.
// • The widget shows a featured event (one that is not in the quiz) and today's score; the large
//   size lists three events with their years. Tapping the widget opens the quiz.

// ───────────────────────── Constants

const USER_AGENT = "Scriptwell On This Day Quiz (gallery script; iOS widget)";
const QUESTIONS = 5;
const MAX_EVENTS = 40;
const TIME_LIMITS = { app: 30_000, pwa: 30_000, shortcut: 20_000, background: 15_000, widget: 8_000 };

const AMBER = "#B45309";
const PAPER = { light: "#FFF7ED", dark: "#2A1A08" };
const TILE_BG = { light: "#F1F5F9", dark: "#1E293B" };
const BG = Widget.gradient([{ light: "#FFEDD5", dark: "#3B2410" }, { light: "#FED7AA", dark: "#1F1309" }], { direction: "topToBottom" });
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────── Stored state

const today = () => new Date().toLocaleDateString("en-CA");
const day = () => Storage.get("day");
const play = () => {
  const p = Storage.get("play");
  return p && p.date === today() ? p : null;
};
const history = () => Storage.get("history", []);
const settings = () => ({ sound: true, ai: true, ...Storage.get("settings", {}) });
const todayScore = () => history().find((h) => h.date === today())?.score ?? null;
const dateLabel = (date = new Date()) => date.toLocaleDateString(Script.env.locale, { day: "numeric", month: "long" });

function streak() {
  const done = new Set(history().map((h) => h.date));
  let count = 0;
  const cursor = new Date();
  if (!done.has(today())) cursor.setDate(cursor.getDate() - 1);
  while (done.has(cursor.toLocaleDateString("en-CA"))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

// ───────────────────────── Seeded randomness

function seedFor(date) {
  return Number(date.replace(/-/g, "")) % 2_147_483_647;
}

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ───────────────────────── Quiz building (pure code)

const hideYear = (text, year) => text.replace(new RegExp(`\\b${year}\\b`, "g"), "____");

// Three wrong years near the real one: closer for recent events, wider for older ones.
function distractors(year, random) {
  const spread = year >= 1900 ? 12 : year >= 1500 ? 35 : 120;
  const limit = new Date().getFullYear();
  const picks = new Set();
  let guard = 0;
  while (picks.size < 3 && guard++ < 200) {
    const sign = random() < 0.5 ? -1 : 1;
    const offset = 1 + Math.floor(random() * spread);
    const candidate = year + sign * offset;
    if (candidate !== year && candidate >= 1 && candidate <= limit) picks.add(candidate);
  }
  return [...picks];
}

function buildQuiz(events, date) {
  const random = rng(seedFor(date));
  const usable = events.filter((e) => e.year >= 1000 && e.text.length >= 40);
  const sorted = [...usable].sort((a, b) => a.year - b.year);
  const count = Math.min(QUESTIONS, sorted.length);
  const chosen = [];
  for (let i = 0; i < count; i++) {
    const bucket = sorted.slice(Math.floor((i * sorted.length) / count), Math.floor(((i + 1) * sorted.length) / count));
    chosen.push(bucket[Math.floor(random() * bucket.length)]);
  }
  const questions = shuffle(chosen, random).map((event) => ({
    ...event,
    short: hideYear(event.text, event.year),
    options: shuffle([event.year, ...distractors(event.year, random)], random),
  }));
  const rest = events.filter((e) => !chosen.includes(e) && e.year >= 1000);
  const featured = shuffle(rest, random).slice(0, 3);
  return { questions, featured };
}

// ───────────────────────── Wikipedia and AI

function clip(text, max) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : clean;
}

async function fetchEvents(date) {
  const [, month, dayOfMonth] = date.split("-");
  const limit = TIME_LIMITS[Script.env.mode] ?? 20_000;
  const response = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${dayOfMonth}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    timeout: Math.min(8000, limit - 2500),
  });
  if (!response.ok) throw new Error(`Wikipedia returned ${response.status}`);
  const feed = await response.json();
  const events = (feed.events ?? [])
    .filter((e) => typeof e.year === "number" && e.text)
    .map((e) => {
      const page = e.pages?.[0];
      return {
        year: e.year,
        text: clip(e.text, 260),
        title: page?.titles?.normalized ?? page?.title ?? null,
        url: page?.content_urls?.desktop?.page ?? null,
        extract: clip(page?.extract, 240) || null,
      };
    });
  if (events.length === 0) throw new Error("No events in the feed today");
  return events.slice(0, MAX_EVENTS);
}

// Shorter question text from the on-device model, one question at a time, with the original as fallback.
async function rephrase(questions) {
  try {
    const status = await AI.availability();
    if (!status.available) return questions;
  } catch { return questions; }
  const out = [];
  for (const q of questions) {
    let short = q.short;
    try {
      const reply = await AI.generate(q.text, {
        instructions: "Rewrite the user's sentence as one clear sentence of at most 18 words in the past tense. Keep the names and places. Never mention a year, a decade or a century. Reply with the sentence only.",
        temperature: 0.3,
      });
      const candidate = clip(reply, 200);
      if (candidate.length >= 20 && !/\b\d{3,4}\b/.test(candidate)) short = candidate;
    } catch (error) {
      console.warn("Rephrase failed:", error.message);
    }
    out.push({ ...q, short });
  }
  return out;
}

// Today's events and quiz, from the cache when it is today's, else from Wikipedia.
async function ensureDay() {
  const date = today();
  const cached = day();
  if (cached?.date === date) {
    if (!cached.rephrased && Script.env.mode === "app" && settings().ai) {
      const questions = await rephrase(cached.questions);
      Storage.set("day", { ...cached, questions, rephrased: true });
    }
    return day();
  }
  try {
    const events = await fetchEvents(date);
    let { questions, featured } = buildQuiz(events, date);
    let rephrased = false;
    if (Script.env.mode === "app" && settings().ai) {
      questions = await rephrase(questions);
      rephrased = true;
    }
    const fresh = { date, questions, featured, count: events.length, time: Date.now(), rephrased };
    Storage.set("day", fresh);
    Storage.remove("lastError");
    return fresh;
  } catch (error) {
    Storage.set("lastError", { message: error.message, time: Date.now() });
    return cached ?? null; // yesterday's events are better than nothing
  }
}

// ───────────────────────── Actions

// A round after the first one of the day is practice: it does not touch the history or the streak.
const newRound = () => ({ date: today(), index: 0, answers: [], practice: history().some((h) => h.date === today()) });

Script.action("start", async () => {
  const d = await ensureDay();
  if (!d) return UI.alert({ title: "Could not load today's events", message: Storage.get("lastError")?.message ?? "Try again in a moment." });
  Storage.set("play", newRound());
});

Script.action("answer", async ({ year }) => {
  const p = play();
  const d = day();
  if (!p || !d || p.answers.length > p.index) return;
  const correct = d.questions[p.index].year === year;
  const answers = [...p.answers, { picked: year, correct }];
  const finished = answers.length >= d.questions.length;
  Storage.set("play", { ...p, answers });
  if (finished && !p.practice && !history().some((h) => h.date === today())) {
    Storage.set("history", [...history(), { date: today(), score: answers.filter((a) => a.correct).length, of: d.questions.length }].slice(-60));
  }
  try {
    if (settings().sound) await Sound.play(correct ? "success" : "failure", { volume: 0.6 });
    await UI.haptic(correct ? "success" : "error");
  } catch (error) {
    console.warn(error.message);
  }
});

Script.action("next", () => {
  const p = play();
  if (p) Storage.set("play", { ...p, index: p.index + 1 });
});

Script.action("again", () => Storage.set("play", newRound()));
Script.action("done", () => Storage.remove("play"));
Script.action("link", ({ url }) => UI.openURL(url));
Script.action("setting", ({ key, isOn }) => Storage.set("settings", { ...settings(), [key]: isOn }));

Script.action("reload", async () => {
  Storage.remove("day");
  Storage.remove("play");
  await ensureDay();
});

// ───────────────────────── Run (Siri and Shortcuts)

Script.run(async () => {
  const d = await ensureDay();
  if (!d) return `Could not load today's events: ${Storage.get("lastError")?.message ?? "unknown error"}`;
  const f = d.featured[0] ?? d.questions[0];
  const score = todayScore();
  return `On this day in ${f.year}: ${f.text}${score != null ? ` Your quiz score today: ${score} of ${QUESTIONS}.` : " Open On This Day Quiz to play today's five questions."}`;
});

// ───────────────────────── Widget

const yearBadge = (year, font = "caption") => Widget.text(String(year), {
  font, weight: "bold", design: "rounded", color: "white",
  padding: { horizontal: 6, vertical: 2 }, background: AMBER, cornerRadius: 6,
});

function scoreBlock(size) {
  const score = todayScore();
  const s = streak();
  if (score == null) {
    return Widget.vstack([
      Widget.symbol("play.circle.fill", { size, color: AMBER, fallback: "▶️" }),
      Widget.text("Play today", { font: "caption2", weight: "semibold", color: AMBER }),
      s ? Widget.text(`${s}-day streak`, { font: "caption2", color: "secondary" }) : null,
    ], { spacing: 2 });
  }
  return Widget.vstack([
    Widget.progress(score / QUESTIONS, { style: "ring", color: score >= 4 ? "green" : score >= 2 ? "orange" : "red", label: `${score}/${QUESTIONS}` }),
    Widget.text("today", { font: "caption2", color: "secondary" }),
    s ? Widget.text(`🔥 ${s}`, { font: "caption2", weight: "semibold" }) : null,
  ], { spacing: 2 });
}

Script.widget(async ({ family }) => {
  const d = await ensureDay();
  const midnight = new Date();
  midnight.setHours(24, 0, 10, 0);
  if (!d) {
    return {
      content: Widget.vstack([
        Widget.symbol("calendar.badge.clock", { size: 26, color: AMBER, fallback: "📅" }),
        Widget.text(Storage.get("lastError")?.message ?? "Open On This Day Quiz once", { font: "caption", color: "secondary", align: "center", lineLimit: 3 }),
      ], { spacing: 6, url: APP_LINK }),
      refreshAfter: 30 * 60,
    };
  }
  const stale = d.date !== today();
  const featured = d.featured[0] ?? d.questions[0];
  const score = todayScore();
  const header = Widget.hstack([
    Widget.symbol("calendar.badge.clock", { size: 11, color: AMBER, fallback: "📅" }),
    Widget.text(`ON THIS DAY${stale ? " (YESTERDAY'S LIST)" : ""}`, { font: "caption2", weight: "bold", color: AMBER, lineLimit: 1, minimumScale: 0.6 }),
    Widget.spacer(),
  ], { spacing: 3 });
  let content;

  if (family === "small") {
    content = Widget.vstack([
      header,
      Widget.text(String(featured.year), { font: 34, weight: "heavy", design: "rounded", color: AMBER, lineLimit: 1, minimumScale: 0.6 }),
      Widget.text(featured.text, { font: "caption", lineLimit: 4, minimumScale: 0.8 }),
      Widget.spacer(),
      Widget.hstack([
        Widget.text(score == null ? "Play today's quiz" : `Today ${score}/${QUESTIONS}`, { font: "caption2", weight: "semibold", color: AMBER }),
        Widget.spacer(),
        streak() ? Widget.text(`🔥 ${streak()}`, { font: "caption2", weight: "semibold" }) : null,
      ]),
    ], { alignment: "leading", spacing: 3, padding: 14, background: BG, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
  } else if (family === "medium") {
    content = Widget.hstack([
      Widget.vstack([
        header,
        Widget.hstack([
          yearBadge(featured.year, "headline"),
          Widget.text(featured.title ?? dateLabel(), { font: "caption", weight: "semibold", color: "secondary", lineLimit: 1 }),
        ], { spacing: 6 }),
        Widget.text(featured.text, { font: "footnote", lineLimit: 4, minimumScale: 0.8 }),
        Widget.spacer(),
        Widget.text(score == null ? "Five questions are waiting →" : "Come back tomorrow for five more", { font: "caption2", color: "secondary" }),
      ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack([scoreBlock(34)], { frame: { width: 64, maxHeight: "infinity" } }),
    ], { spacing: 10, padding: 14, background: BG, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
  } else {
    const three = d.featured.slice(0, 3);
    content = Widget.vstack([
      Widget.hstack([
        Widget.vstack([
          header,
          Widget.text(dateLabel(stale ? new Date(d.time) : new Date()), { font: "title2", weight: "bold", design: "serif" }),
        ], { alignment: "leading", spacing: 2 }),
        Widget.spacer(),
        scoreBlock(36),
      ], { alignment: "top" }),
      ...three.map((e) => Widget.hstack([
        yearBadge(e.year),
        Widget.vstack([
          e.title ? Widget.text(e.title, { font: "caption", weight: "semibold", lineLimit: 1 }) : null,
          Widget.text(e.text, { font: "caption", lineLimit: 3 }),
        ], { alignment: "leading", spacing: 1 }),
      ], { spacing: 8, alignment: "top", padding: 8, background: PAPER, cornerRadius: 10, url: e.url ?? APP_LINK, frame: { maxWidth: "infinity", alignment: "leading" } })),
      Widget.spacer(),
      Widget.text(score == null ? `Quiz: ${QUESTIONS} more events from this day, guess the year` : `Today's quiz: ${score} of ${QUESTIONS} · ${streak()}-day streak`, { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 8, padding: 14, background: BG, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
  }

  return { content, refreshAt: midnight };
});

// ───────────────────────── Mini-app

function historyChart(height) {
  const recent = history().slice(-14);
  if (recent.length === 0) return Widget.text("Your scores show up here after the first quiz.", { color: "secondary" });
  return Widget.chart(recent.map((h) => ({ x: h.date.slice(5), y: h.score })), { kind: "bar", color: "orange", range: [0, QUESTIONS], frame: { height } });
}

function optionsCard() {
  const s = settings();
  return Widget.card([
    Widget.toggle("Sounds", s.sound, "setting", { key: "sound" }, { color: "orange" }),
    Widget.toggle("Shorten questions with on-device AI", s.ai, "setting", { key: "ai" }, { color: "orange" }),
    Widget.button("Reload today's events", "reload", null, { style: "plain" }),
  ], { title: "Options", symbol: "slider.horizontal.3", color: "gray" });
}

const tile = (value, label, color = "primary") => Widget.vstack([
  Widget.text(String(value), { font: "title2", weight: "bold", design: "rounded", color }),
  Widget.text(label, { font: "caption", color: "secondary" }),
], { alignment: "leading", spacing: 0, padding: 12, background: TILE_BG, cornerRadius: 12, frame: { maxWidth: "infinity", alignment: "leading" } });

function lobby(d) {
  const score = todayScore();
  const best = history().reduce((m, h) => Math.max(m, h.score), 0);
  return Widget.vstack([
    Widget.vstack([
      Widget.text("ON THIS DAY", { font: "caption", weight: "bold", color: AMBER }),
      Widget.text(dateLabel(), { font: "largeTitle", weight: "bold", design: "serif" }),
      Widget.text(`${d.count} events on Wikipedia · ${QUESTIONS} questions`, { font: "footnote", color: "secondary" }),
    ], { alignment: "leading", spacing: 2 }),
    Widget.hstack([
      tile(score == null ? "–" : `${score}/${QUESTIONS}`, "today", score == null ? "secondary" : "orange"),
      tile(`${streak()} 🔥`, "day streak"),
      tile(best ? `${best}/${QUESTIONS}` : "–", "best"),
    ], { spacing: 8 }),
    Widget.button(score == null ? "Play today's quiz" : "Play again (practice)", "start", null, { style: "prominent", color: "orange" }),
    Widget.card([
      ...d.featured.slice(0, 3).map((e) => Widget.hstack([
        yearBadge(e.year),
        Widget.text(e.text, { font: "footnote" }),
      ], { spacing: 8, alignment: "top", url: e.url })),
    ], { title: "Also on this day", subtitle: "Tap to read on Wikipedia", symbol: "book.fill", color: "brown" }),
    Widget.card([historyChart(160), Widget.text("Score out of five, first attempt of each day", { font: "caption", color: "secondary" })], { title: "Last 14 quizzes", symbol: "chart.bar.fill", color: "orange" }),
    optionsCard(),
  ], { alignment: "leading", spacing: 16 });
}

function question(d, p) {
  const q = d.questions[p.index];
  const answered = p.answers[p.index] ?? null;
  const last = p.index === d.questions.length - 1;
  const dots = Widget.hstack(d.questions.map((_, i) => ({
    type: "stack", direction: "horizontal", children: [],
    frame: { width: i === p.index ? 22 : 10, height: 10 }, cornerRadius: 5,
    background: p.answers[i] ? (p.answers[i].correct ? "green" : "red") : i === p.index ? AMBER : TILE_BG,
  })), { spacing: 5 });
  const buttons = (pair) => Widget.hstack(pair.map((year) => {
    const color = !answered ? "orange" : year === q.year ? "green" : year === answered.picked ? "red" : "gray";
    return Widget.button(Widget.text(String(year), { font: "title2", weight: "bold", design: "rounded", frame: { maxWidth: "infinity" } }), "answer", { year }, { style: answered && year !== q.year && year !== answered.picked ? "bordered" : "prominent", color });
  }), { spacing: 10 });

  return Widget.vstack([
    Widget.hstack([dots, Widget.spacer(), Widget.text(`${p.index + 1} / ${d.questions.length}`, { font: "caption", weight: "semibold", color: "secondary" })]),
    Widget.vstack([
      Widget.text("In which year did this happen?", { font: "caption", weight: "bold", color: AMBER }),
      Widget.text(q.short, { font: "title3", weight: "semibold", design: "serif" }),
    ], { alignment: "leading", spacing: 8, padding: 18, background: PAPER, cornerRadius: 16, frame: { maxWidth: "infinity", alignment: "leading" } }),
    buttons(q.options.slice(0, 2)),
    buttons(q.options.slice(2, 4)),
    answered ? Widget.vstack([
      Widget.hstack([
        Widget.symbol(answered.correct ? "checkmark.circle.fill" : "xmark.circle.fill", { size: 22, color: answered.correct ? "green" : "red", fallback: answered.correct ? "✅" : "❌" }),
        Widget.text(answered.correct ? `Right, it was ${q.year}.` : `It was ${q.year}${Math.abs(answered.picked - q.year) <= 3 ? ", close" : ""}.`, { font: "headline" }),
      ], { spacing: 8 }),
      Widget.text(q.text, { font: "callout" }),
      q.extract ? Widget.text(q.extract, { font: "footnote", color: "secondary" }) : null,
      Widget.hstack([
        q.url ? Widget.button(Widget.label(q.title ? clip(q.title, 28) : "Wikipedia", "safari"), "link", { url: q.url }, { style: "bordered" }) : null,
        Widget.spacer(),
        Widget.button(last ? "See results" : "Next", "next", null, { style: "prominent", color: "orange" }),
      ]),
    ], { alignment: "leading", spacing: 10, padding: 14, background: TILE_BG, cornerRadius: 14, frame: { maxWidth: "infinity", alignment: "leading" } }) : null,
  ], { alignment: "leading", spacing: 14 });
}

function results(d, p) {
  const score = p.answers.filter((a) => a.correct).length;
  const verdict = score === QUESTIONS ? "Perfect. A historian." : score >= 4 ? "Very good." : score >= 2 ? "Not bad at all." : "History is hard. Tomorrow is another day.";
  return Widget.vstack([
    Widget.vstack([
      Widget.text(`${score} / ${d.questions.length}`, { font: 56, weight: "heavy", design: "rounded", color: AMBER }),
      Widget.text(verdict, { font: "headline" }),
      Widget.text(`${streak()}-day streak${p.practice ? " · practice round, not counted" : ""}`, { font: "footnote", color: "secondary" }),
    ], { spacing: 4, padding: 20, background: PAPER, cornerRadius: 16, frame: { maxWidth: "infinity" } }),
    Widget.list(d.questions.map((q, i) => ({
      title: `${q.year} · ${clip(q.short, 70)}`,
      subtitle: p.answers[i].correct ? "Correct" : `You said ${p.answers[i].picked}`,
      symbol: p.answers[i].correct ? "checkmark.circle.fill" : "xmark.circle.fill",
      color: p.answers[i].correct ? "green" : "red",
      detail: q.url ? "Read" : "",
      url: q.url ?? undefined,
    })), { title: "Your answers" }),
    Widget.hstack([
      Widget.button("Practice again", "again", null, { style: "bordered" }),
      Widget.button("Done", "done", null, { style: "prominent", color: "orange" }),
    ], { spacing: 10 }),
    Widget.card([historyChart(160)], { title: "Last 14 quizzes", symbol: "chart.bar.fill", color: "orange" }),
  ], { alignment: "leading", spacing: 16 });
}

Script.ui(async () => {
  const d = await ensureDay();
  const error = Storage.get("lastError");
  let body;
  if (!d) {
    body = Widget.vstack([
      Widget.symbol("wifi.exclamationmark", { size: 48, color: "orange", fallback: "⚠️" }),
      Widget.text("Could not load today's events.", { font: "headline" }),
      Widget.text(error?.message ?? "", { color: "secondary", align: "center" }),
      Widget.button("Try again", "reload", null, { style: "prominent", color: "orange" }),
    ], { spacing: 12, padding: 24, frame: { maxWidth: "infinity" } });
  } else {
    // Lobby → five questions → results → (Done) lobby again.
    const p = play();
    if (!p) body = lobby(d);
    else if (p.index >= d.questions.length) body = results(d, p);
    else body = question(d, p);
  }
  return {
    title: "On This Day",
    content: Widget.vstack([
      d && d.date !== today() ? Widget.text("Showing an earlier day's events: Wikipedia could not be reached today.", { font: "footnote", color: "orange" }) : null,
      body,
    ], { alignment: "leading", spacing: 12, padding: 16 }),
  };
});
