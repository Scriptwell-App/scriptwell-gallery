// @name        Times Tables
// @description A quick multiplication quiz with stars for every correct answer
// @icon        multiply.circle.fill
// @color       #16A34A
// @version     1.0.0
// @author      va4w
// @category    kids

const ROUND = 10; // questions per round
const level = () => Storage.get("level", 10); // highest table in the quiz

let asked = 0;
let correct = 0;
let question = null; // { a, b, choices }
let feedback = null; // { right, answer } after an answer

const pick = (max) => 2 + Math.floor(Math.random() * (max - 1));

function next() {
  const a = pick(level()), b = pick(10);
  // Wrong answers that look plausible: near misses and a neighbouring table.
  const options = new Set([a * b]);
  for (const candidate of [a * b + a, a * b - a, a * (b + 1) + 1, a * b + 2, (a + 1) * b, a * b - 1]) {
    if (candidate > 0 && options.size < 4) options.add(candidate);
  }
  question = { a, b, choices: [...options].sort(() => Math.random() - 0.5) };
  feedback = null;
}

Script.action("answer", ({ value }) => {
  if (feedback) return;
  const right = value === question.a * question.b;
  asked++;
  if (right) correct++;
  feedback = { right, answer: question.a * question.b };
});

Script.action("next", next);
Script.action("again", () => { asked = 0; correct = 0; next(); });
Script.action("level", ({ max }) => { Storage.set("level", max); asked = 0; correct = 0; next(); });

Script.ui(() => {
  if (!question) next();

  if (asked >= ROUND && feedback) {
    const stars = Storage.get("stars", 0) + correct;
    Storage.set("stars", stars);
    const result = Widget.vstack([
      Widget.text("⭐️".repeat(Math.max(1, Math.round(correct / 2))), { font: 34 }),
      Widget.text(`${correct} out of ${ROUND}`, { font: 48, weight: "bold", design: "rounded", color: "green" }),
      Widget.text(correct === ROUND ? "Perfect!" : correct >= 7 ? "Great work!" : "Good try. Go again?", { font: "title3" }),
      Widget.text(`${stars} stars collected so far`, { color: "secondary" }),
      Widget.button("Play again", "again", null, { style: "prominent", color: "green" }),
    ], { spacing: 12, padding: 24 });
    asked = 0; correct = 0; question = null; feedback = null; // the next draw starts a new round
    return { title: "Times Tables", content: result };
  }

  return {
    title: `Question ${Math.min(asked + 1, ROUND)} of ${ROUND}`,
    content: Widget.vstack([
      Widget.text(`${question.a} × ${question.b}`, { font: 72, weight: "bold", design: "rounded" }),
      feedback
        ? Widget.text(feedback.right ? "Correct! ⭐️" : `Not quite. It is ${feedback.answer}.`, { font: "title3", weight: "semibold", color: feedback.right ? "green" : "orange" })
        : Widget.text("Tap the answer", { color: "secondary" }),
      Widget.hstack(question.choices.slice(0, 2).map((value) => Widget.button(String(value), "answer", { value }, { style: "bordered", color: "green", frame: { width: 120 } })), { spacing: 12 }),
      Widget.hstack(question.choices.slice(2).map((value) => Widget.button(String(value), "answer", { value }, { style: "bordered", color: "green", frame: { width: 120 } })), { spacing: 12 }),
      feedback ? Widget.button(asked >= ROUND ? "See my score" : "Next", "next", null, { style: "prominent", color: "green" }) : null,
      Widget.divider(),
      Widget.text("Tables up to", { font: "caption", color: "secondary" }),
      Widget.hstack([5, 10, 12].map((max) => Widget.button(String(max), "level", { max }, { style: max === level() ? "prominent" : "bordered" })), { spacing: 8 }),
    ], { spacing: 14, padding: 20 }),
  };
});
