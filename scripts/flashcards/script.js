// @name        Flashcards
// @description Learn anything with spaced repetition; a widget shows what is due
// @widget      small
// @icon        rectangle.on.rectangle.angled.fill
// @color       #0D9488
// @version     1.0.0
// @author      va4w
// @category    education

// Cards move through five boxes. A correct answer moves a card up a box and it
// comes back later; a wrong answer sends it to box 1. Edit STARTER to change the first deck.

const STARTER = [
  ["Capital of Australia", "Canberra"], ["Capital of Canada", "Ottawa"], ["Capital of Brazil", "Brasília"],
  ["Capital of Turkey", "Ankara"], ["Capital of Switzerland", "Bern"], ["Capital of New Zealand", "Wellington"],
  ["Capital of Morocco", "Rabat"], ["Capital of Vietnam", "Hanoi"],
];
const DAYS_PER_BOX = [0, 1, 3, 7, 14]; // how long a card rests in boxes 1 to 5

const today = () => new Date().toLocaleDateString("en-CA");
const later = (days) => new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA");
const cards = () => Storage.get("cards", STARTER.map(([q, a], i) => ({ id: i + 1, q, a, box: 1, due: today() })));
const due = () => cards().filter((card) => card.due <= today());

let revealed = false;

Script.action("reveal", () => { revealed = true; });

Script.action("grade", ({ id, correct }) => {
  Storage.set("cards", cards().map((card) => {
    if (card.id !== id) return card;
    const box = correct ? Math.min(5, card.box + 1) : 1;
    return { ...card, box, due: later(DAYS_PER_BOX[box - 1]) };
  }));
  revealed = false;
});

Script.action("add", async () => {
  const q = await UI.prompt({ title: "New card", message: "Question", placeholder: "Capital of Kenya" });
  if (!q?.trim()) return;
  const a = await UI.prompt({ title: "New card", message: "Answer", placeholder: "Nairobi" });
  if (!a?.trim()) return;
  Storage.set("cards", [...cards(), { id: Date.now(), q: q.trim(), a: a.trim(), box: 1, due: today() }]);
});

Script.action("remove", ({ id }) => { Storage.set("cards", cards().filter((card) => card.id !== id)); revealed = false; });

Script.ui(() => {
  const queue = due();
  const card = queue[0];
  const mastered = cards().filter((c) => c.box === 5).length;

  if (!card) {
    return {
      title: "Flashcards",
      content: Widget.vstack([
        Widget.symbol("checkmark.seal.fill", { size: 56, color: "teal", fallback: "✅" }),
        Widget.text("All done for today", { font: "title2", weight: "bold" }),
        Widget.text(`${cards().length} cards, ${mastered} mastered`, { color: "secondary" }),
        Widget.button("Add a card", "add", null, { style: "prominent", color: "teal" }),
      ], { spacing: 12, padding: 24 }),
    };
  }

  return {
    title: `${queue.length} due`,
    content: Widget.vstack([
      Widget.vstack([
        Widget.text(`Box ${card.box}`, { font: "caption", color: "secondary" }),
        Widget.text(card.q, { font: "title2", weight: "semibold", align: "center" }),
        revealed ? Widget.divider() : null,
        revealed ? Widget.text(card.a, { font: "title", weight: "bold", color: "teal", align: "center" }) : null,
      ], { spacing: 14, padding: 24, background: { light: "#FFFFFF", dark: "#1C1C1E" }, cornerRadius: 18, frame: { maxWidth: "infinity" } }),
      revealed
        ? Widget.hstack([
            Widget.button("Again", "grade", { id: card.id, correct: false }, { style: "bordered", color: "red" }),
            Widget.button("Got it", "grade", { id: card.id, correct: true }, { style: "prominent", color: "teal" }),
          ], { spacing: 12 })
        : Widget.button("Show answer", "reveal", null, { style: "prominent", color: "teal" }),
      Widget.hstack([
        Widget.button("Add a card", "add", null, { style: "bordered" }),
        Widget.button("Delete this card", "remove", { id: card.id }, { color: "secondary" }),
      ], { spacing: 12 }),
    ], { spacing: 16, padding: 16 }),
  };
});

Script.widget(() => {
  const count = due().length;
  const midnight = new Date();
  midnight.setHours(24, 0, 10, 0);
  return {
    content: Widget.vstack([
      Widget.text(String(count), { font: 48, weight: "bold", design: "rounded", color: count ? "teal" : "secondary" }),
      Widget.text(count === 1 ? "card due" : "cards due", { font: "caption", color: "secondary" }),
    ], { spacing: 2, url: `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui` }),
    refreshAt: midnight,
  };
});
