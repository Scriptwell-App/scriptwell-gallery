// @name        Colour Vision Test
// @description A quick colour vision screening with dot plates, in the style of Ishihara tests
// @icon        eye.fill
// @color       #E11D48
// @version     1.0.0
// @author      va4w
// @category    utilities

// ───────────── Digit shapes (5 × 7 bitmaps)

const DIGITS = {
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};

// ───────────── Colour palettes per plate kind

const PALETTES = {
  control: { label: "Control", figure: { h: 225, s: 65, l: 38 }, ground: { h: 45, s: 80, l: 72 } },
  redGreen: { label: "Red–green", figure: { h: 12, s: 65, l: 55 }, ground: { h: 85, s: 45, l: 53 } },
  blueYellow: { label: "Blue–yellow", figure: { h: 205, s: 55, l: 60 }, ground: { h: 160, s: 40, l: 58 } },
};

function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

const jitter = (base, amount) => base + (Math.random() * 2 - 1) * amount;

function dotColor(c) {
  // Random hue and lightness changes so brightness alone does not give the number away.
  return hsl(jitter(c.h, 8), jitter(c.s, 8), jitter(c.l, 9));
}

function makePlate(kind) {
  const digit = Math.floor(Math.random() * 10);
  const shape = DIGITS[digit];
  const palette = PALETTES[kind];
  const dots = [];
  for (let row = 0; row < 9; row++) {
    const line = [];
    for (let col = 0; col < 7; col++) {
      const inside = row >= 1 && row <= 7 && col >= 1 && col <= 5 && shape[row - 1][col - 1] === "1";
      line.push(dotColor(inside ? palette.figure : palette.ground));
    }
    dots.push(line);
  }
  return { kind, digit, dots };
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ───────────── State

let page = "home"; // "home" | "test" | "result"
let test = null;   // { plates, index, answers }

function newTest() {
  const rest = shuffle([
    "control",
    "redGreen", "redGreen", "redGreen", "redGreen", "redGreen", "redGreen",
    "blueYellow", "blueYellow", "blueYellow", "blueYellow",
  ]);
  return { plates: ["control", ...rest].map(makePlate), index: 0, answers: [] };
}

function score(t) {
  const tally = { control: [0, 0], redGreen: [0, 0], blueYellow: [0, 0] };
  t.plates.forEach((plate, i) => {
    tally[plate.kind][1] += 1;
    if (t.answers[i] === plate.digit) tally[plate.kind][0] += 1;
  });
  return tally;
}

function verdict(tally) {
  const [c, cTotal] = tally.control;
  const [rg, rgTotal] = tally.redGreen;
  const [by, byTotal] = tally.blueYellow;
  if (c < cTotal) {
    return { text: "You missed a control plate that almost everyone can read, so these results may not be reliable. Turn up brightness, turn off Night Shift and True Tone, and try again.", color: "orange" };
  }
  const notes = [];
  if (rg <= rgTotal / 2) notes.push("possible red–green colour deficiency");
  if (by <= byTotal / 2) notes.push("possible blue–yellow colour deficiency");
  if (notes.length === 0) return { text: "No sign of a colour vision deficiency in this test.", color: "green" };
  return { text: `This result suggests a ${notes.join(" and a ")}. An eye care professional can confirm it.`, color: "red" };
}

// ───────────── Actions

Script.action("start", () => {
  test = newTest();
  page = "test";
});

Script.action("answer", ({ value }) => {
  if (!test) return;
  test.answers[test.index] = value;
  test.index += 1;
  if (test.index >= test.plates.length) {
    const tally = score(test);
    const history = Storage.get("results", []);
    Storage.set("results", [{
      date: new Date().toISOString(),
      control: tally.control,
      redGreen: tally.redGreen,
      blueYellow: tally.blueYellow,
      verdict: verdict(tally).text,
    }, ...history].slice(0, 10));
    page = "result";
  }
});

Script.action("quit", () => {
  test = null;
  page = "home";
});

Script.action("clearHistory", async () => {
  const choice = await UI.alert({ title: "Delete all past results?", buttons: ["Cancel", "Delete"] });
  if (choice === 1) Storage.remove("results");
});

// ───────────── Views

const dot = (color) => ({
  type: "stack", direction: "vertical", children: [],
  background: color, cornerRadius: 15, frame: { width: 30, height: 30 },
});

const plateView = (plate) => Widget.vstack(
  plate.dots.map((row) => Widget.hstack(row.map(dot), { spacing: 4 })),
  { spacing: 4, padding: 18, background: "#F4F1EA", cornerRadius: 28 },
);

const fraction = ([a, b]) => `${a}/${b}`;

function homeView() {
  const last = Storage.get("results", [])[0];
  return {
    title: "Colour Vision Test",
    content: Widget.vstack([
      Widget.symbol("eye.fill", { size: 56, color: "pink", fallback: "👁" }),
      Widget.card([
        Widget.text("You will see 11 plates made of coloured dots. Type the number hidden in each one, or tap “No number” if you cannot see one.", { font: "callout" }),
        Widget.text("For the best result: full brightness, Night Shift and True Tone off, normal viewing distance. Answer quickly; do not stare.", { font: "footnote", color: "secondary" }),
      ], { title: "How it works", symbol: "info.circle", color: "blue" }),
      Widget.button("Start the test", "start", null, { style: "prominent", color: "pink" }),
      last ? Widget.card([
        Widget.text(last.verdict, { font: "footnote" }),
        Widget.text(`Red–green ${fraction(last.redGreen)} · Blue–yellow ${fraction(last.blueYellow)} · Control ${fraction(last.control)}`, { font: "caption", color: "secondary" }),
        Widget.date(last.date, { style: "relative", font: "caption2", color: "secondary" }),
      ], { title: "Last result", symbol: "clock", color: "secondary" }) : null,
      Storage.get("results", []).length > 1
        ? Widget.button("Clear past results", "clearHistory", null, { style: "plain", color: "red" })
        : null,
      Widget.text("This is a screening for fun and curiosity, not a medical diagnosis. Screens show colours differently.", { font: "caption2", color: "secondary", align: "center" }),
    ], { spacing: 16, padding: 20 }),
  };
}

function testView() {
  const plate = test.plates[test.index];
  const total = test.plates.length;
  const numberButton = (n) => Widget.button(String(n), "answer", { value: n }, {
    style: "bordered", frame: { width: 52, height: 44 },
  });
  return {
    title: `Plate ${test.index + 1} of ${total}`,
    content: Widget.vstack([
      Widget.progress(test.index / total, { color: "pink" }),
      plateView(plate),
      Widget.text("What number do you see?", { font: "headline" }),
      Widget.hstack([1, 2, 3, 4, 5].map(numberButton), { spacing: 8 }),
      Widget.hstack([6, 7, 8, 9, 0].map(numberButton), { spacing: 8 }),
      Widget.button("No number", "answer", { value: -1 }, { style: "bordered", color: "secondary" }),
      Widget.button("Quit test", "quit", null, { style: "plain", color: "red" }),
    ], { spacing: 14, padding: 20 }),
  };
}

function resultView() {
  const tally = score(test);
  const v = verdict(tally);
  const rows = test.plates.map((plate, i) => {
    const answer = test.answers[i];
    const right = answer === plate.digit;
    return {
      title: `Plate ${i + 1}`,
      subtitle: PALETTES[plate.kind].label,
      detail: `you: ${answer === -1 ? "none" : answer} · was: ${plate.digit}`,
      symbol: right ? "checkmark.circle.fill" : "xmark.circle.fill",
      color: right ? "green" : "red",
    };
  });
  const stat = (label, pair, color) => Widget.vstack([
    Widget.text(fraction(pair), { font: "title2", weight: "bold", design: "rounded", color }),
    Widget.text(label, { font: "caption", color: "secondary" }),
  ], { spacing: 2, frame: { maxWidth: "infinity" } });

  return {
    title: "Your result",
    content: Widget.vstack([
      Widget.card([
        Widget.text(v.text, { font: "callout", weight: "medium", color: v.color }),
      ], { title: "Summary", symbol: "eye.fill", color: v.color }),
      Widget.hstack([
        stat("Red–green", tally.redGreen, "red"),
        stat("Blue–yellow", tally.blueYellow, "blue"),
        stat("Control", tally.control, "primary"),
      ]),
      Widget.list(rows, { title: "Plates" }),
      Widget.hstack([
        Widget.button("Try again", "start", null, { style: "prominent", color: "pink" }),
        Widget.button("Done", "quit", null, { style: "bordered" }),
      ], { spacing: 10 }),
      Widget.text("Not a medical diagnosis. If you are concerned, see an optometrist.", { font: "caption2", color: "secondary", align: "center" }),
    ], { spacing: 16, padding: 20 }),
  };
}

Script.ui(() => {
  if (page === "test" && test) return testView();
  if (page === "result" && test) return resultView();
  return homeView();
});

// From Shortcuts or ▶: report the latest result.
Script.run(() => {
  const last = Storage.get("results", [])[0];
  if (!last) return "No test taken yet. Open the mini-app to take the colour vision test.";
  return `${last.verdict} (Red–green ${fraction(last.redGreen)}, blue–yellow ${fraction(last.blueYellow)}, control ${fraction(last.control)})`;
});
