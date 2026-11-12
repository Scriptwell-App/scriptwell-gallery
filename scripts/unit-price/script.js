// @name        Unit Price
// @description Which pack is the better deal? Compare prices by weight, volume or count
// @icon        tag.fill
// @color       #CA8A04
// @version     1.0.0
// @author      va4w
// @category    shopping

// Enter the price and the amount for each pack, for example "2.49 500" for
// 2.49 for 500 g. The amounts only need to be in the same unit as each other.
// From Shortcuts: "2.49/500 3.99/1000".

const LETTERS = ["A", "B", "C", "D"];
const packs = () => Storage.get("packs", [null, null]); // [{ price, amount } | null]

// "2.49 500", "2,49 / 500" or "2.49 for 500" → { price, amount }, or null.
function parse(text) {
  const numbers = (String(text ?? "").replace(/,/g, ".").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  return numbers.length === 2 && numbers[0] > 0 && numbers[1] > 0 ? { price: numbers[0], amount: numbers[1] } : null;
}

const each = (pack) => pack.price / pack.amount;

// Index of the cheapest pack and how much more each other pack costs, in percent.
function compare(list) {
  const filled = list.map((pack, i) => ({ pack, i })).filter(({ pack }) => pack);
  if (filled.length < 2) return null;
  const best = filled.reduce((a, b) => (each(b.pack) < each(a.pack) ? b : a));
  return { best: best.i, extra: list.map((pack) => (pack ? Math.round((each(pack) / each(best.pack) - 1) * 100) : null)) };
}

// Show the price for a sensible quantity: per 100 or per 1000 when the amounts are large.
function perUnit(pack, list) {
  const biggest = Math.max(...list.filter(Boolean).map((p) => p.amount));
  const scale = biggest >= 1000 ? 1000 : biggest >= 100 ? 100 : 1;
  return `${(each(pack) * scale).toFixed(2)} per ${scale === 1 ? "unit" : scale}`;
}

Script.action("edit", async ({ index }) => {
  const current = packs()[index];
  const answer = await UI.prompt({
    title: `Pack ${LETTERS[index]}`, message: "Price, then amount", placeholder: "2.49 500",
    defaultValue: current ? `${current.price} ${current.amount}` : "",
  });
  if (answer === null) return;
  const pack = parse(answer);
  if (!pack) { await UI.alert({ title: "Two numbers, please", message: "Write the price and then the amount, like 2.49 500." }); return; }
  Storage.set("packs", packs().map((p, i) => (i === index ? pack : p)));
});
Script.action("more", () => { if (packs().length < 4) Storage.set("packs", [...packs(), null]); });
Script.action("reset", () => Storage.set("packs", [null, null]));

Script.ui(() => {
  const list = packs();
  const result = compare(list);
  return {
    title: "Unit Price",
    content: Widget.vstack([
      ...list.map((pack, i) => {
        const best = result?.best === i;
        return Widget.button(Widget.hstack([
          Widget.text(LETTERS[i], { font: "title2", weight: "bold", design: "rounded", color: best ? "white" : "secondary", frame: { width: 34 } }),
          pack
            ? Widget.vstack([
              Widget.text(`${pack.price.toFixed(2)} for ${pack.amount}`, { font: "headline", color: best ? "white" : "primary" }),
              Widget.text(perUnit(pack, list), { font: "subheadline", color: best ? "white" : "secondary" }),
            ], { alignment: "leading", spacing: 2 })
            : Widget.text("Tap to enter price and amount", { color: "secondary" }),
          Widget.spacer(),
          result && pack ? Widget.text(best ? "Best deal" : `+${result.extra[i]}%`, { font: "subheadline", weight: "semibold", color: best ? "white" : "red" }) : null,
        ], { spacing: 10, padding: 14, background: best ? "green" : { light: "#FFFFFF", dark: "#1C1C1E" }, cornerRadius: 14 }), "edit", { index: i });
      }),
      result ? null : Widget.text("Enter at least two packs to compare them.", { font: "footnote", color: "secondary" }),
      Widget.hstack([
        list.length < 4 ? Widget.button("Add a pack", "more", null, { style: "bordered" }) : null,
        Widget.button("Start over", "reset", null, { style: "bordered", color: "secondary" }),
      ], { spacing: 10 }),
    ], { spacing: 10, padding: 16 }),
  };
});

Script.run((input) => {
  const list = String(input ?? "").trim().split(/\s+(?=\d+(?:[.,]\d+)?\s*\/)/).map(parse).filter(Boolean);
  const result = compare(list);
  if (!result) return 'Pass two or more packs as price/amount, for example "2.49/500 3.99/1000".';
  const others = result.extra.map((extra, i) => (i === result.best ? null : `${LETTERS[i]} costs ${extra}% more`)).filter(Boolean);
  return `Pack ${LETTERS[result.best]} is the best deal (${perUnit(list[result.best], list)}). ${others.join(", ")}.`;
});
