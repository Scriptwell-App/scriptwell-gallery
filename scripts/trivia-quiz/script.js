// @name        Trivia Quiz
// @description Ten multiple-choice questions at a time, with your score
// @permissions network
// @icon        questionmark.bubble.fill
// @color       #DB2777
// @version     1.0.0
// @author      va4w
// @category    entertainment

// Questions come from the Open Trivia Database (https://opentdb.com), free and without a key.
// The service allows one request every few seconds; when it is busy, the
// last round is played again in a new order.

let questions = [];
let index = 0;
let score = 0;
let picked = null; // the answer chosen for the current question, or null

const shuffle = (list) => list.map((item) => [Math.random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);

let replay = false; // true while an earlier round is being shown again

async function load() {
  let results = null;
  try {
    const response = await fetch("https://opentdb.com/api.php?amount=10&type=multiple&encode=url3986", { timeout: 10000 });
    const data = response.ok ? await response.json() : null;
    if (data?.response_code === 0) results = data.results;
  } catch (error) {
    if (!Storage.has("round")) throw error; // offline with nothing saved
  }
  replay = !results;
  if (results) Storage.set("round", results); else results = Storage.get("round", []);

  questions = shuffle(results).map((q) => ({
    category: decodeURIComponent(q.category),
    text: decodeURIComponent(q.question),
    correct: decodeURIComponent(q.correct_answer),
    answers: shuffle([q.correct_answer, ...q.incorrect_answers].map(decodeURIComponent)),
  }));
  index = 0;
  score = 0;
  picked = null;
}

Script.action("answer", ({ text }) => {
  if (picked !== null) return;
  picked = text;
  if (text === questions[index].correct) score++;
});

Script.action("next", () => { index++; picked = null; });
Script.action("restart", load);

Script.ui(async () => {
  if (questions.length === 0) await load();

  if (questions.length === 0) {
    return {
      title: "Trivia Quiz",
      content: Widget.vstack([
        Widget.text("⏳", { font: 56 }),
        Widget.text("The trivia service is busy. Give it a few seconds.", { color: "secondary", align: "center" }),
        Widget.button("Try again", "restart", null, { style: "prominent", color: "pink" }),
      ], { spacing: 12, padding: 24 }),
    };
  }

  if (index >= questions.length) {
    const best = Math.max(score, Storage.get("best", 0));
    Storage.set("best", best);
    return {
      title: "Trivia Quiz",
      content: Widget.vstack([
        Widget.text(`${score} / ${questions.length}`, { font: 64, weight: "bold", design: "rounded", color: "pink" }),
        Widget.text(score === questions.length ? "A perfect round!" : score >= 7 ? "Nicely done" : "Have another go", { font: "title3" }),
        Widget.text(`Best so far: ${best}`, { color: "secondary" }),
        Widget.button("Play again", "restart", null, { style: "prominent", color: "pink" }),
      ], { spacing: 12, padding: 24 }),
    };
  }

  const q = questions[index];
  return {
    title: `Question ${index + 1} of ${questions.length}`,
    content: Widget.vstack([
      Widget.text(replay ? `${q.category} · replay` : q.category, { font: "caption", color: "secondary" }),
      Widget.text(q.text, { font: "title3", weight: "semibold", align: "center" }),
      ...q.answers.map((text) => {
        // After answering: the right answer turns green, a wrong pick turns red.
        const color = picked === null ? "pink" : text === q.correct ? "green" : text === picked ? "red" : "gray";
        return Widget.button(text, "answer", { text }, { style: picked !== null && text === q.correct ? "prominent" : "bordered", color, frame: { maxWidth: "infinity" } });
      }),
      picked !== null
        ? Widget.button(index + 1 === questions.length ? "See score" : "Next question", "next", null, { style: "prominent" })
        : Widget.text(`Score: ${score}`, { font: "footnote", color: "secondary" }),
    ], { spacing: 12, padding: 20 }),
  };
});
