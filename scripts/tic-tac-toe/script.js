// @name        Tic-Tac-Toe
// @description Noughts and crosses against the computer, with a running score
// @icon        number.square.fill
// @color       #7C3AED
// @version     1.0.0
// @author      va4w
// @category    games

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

let board = Array(9).fill(null); // "X" is you, "O" is the computer
let youStart = true;

const winner = (b) => { for (const [x, y, z] of LINES) if (b[x] && b[x] === b[y] && b[x] === b[z]) return b[x]; return null; };
const full = (b) => b.every(Boolean);
const tally = () => Storage.get("tally", { you: 0, computer: 0, draws: 0 });

// The computer takes a win, blocks yours, then prefers the centre and corners.
// It does not look further ahead, so it can be beaten.
function computerMove() {
  const free = board.map((value, i) => (value ? null : i)).filter((i) => i !== null);
  const completes = (mark) => free.find((i) => { const copy = [...board]; copy[i] = mark; return winner(copy) === mark; });
  const pick = completes("O") ?? completes("X") ?? (free.includes(4) ? 4 : undefined)
    ?? [0, 2, 6, 8].filter((i) => free.includes(i))[Math.floor(Math.random() * 4)]
    ?? free[Math.floor(Math.random() * free.length)];
  if (pick !== undefined) board[pick] = "O";
}

function record() {
  const result = winner(board);
  if (!result && !full(board)) return;
  const t = tally();
  if (result === "X") t.you++; else if (result === "O") t.computer++; else t.draws++;
  Storage.set("tally", t);
}

Script.action("play", ({ cell }) => {
  if (board[cell] || winner(board)) return;
  board[cell] = "X";
  if (!winner(board) && !full(board)) computerMove();
  record();
});

Script.action("new", () => {
  board = Array(9).fill(null);
  youStart = !youStart; // take turns going first
  if (!youStart) computerMove();
});

Script.ui(() => {
  const result = winner(board);
  const done = result || full(board);
  const t = tally();

  const cell = (i) => Widget.button(
    Widget.zstack([
      Widget.text(board[i] ?? " ", { font: 44, weight: "bold", design: "rounded", color: board[i] === "X" ? "purple" : "orange" }),
    ], { background: { light: "#F1F5F9", dark: "#1E293B" }, cornerRadius: 12, frame: { width: 92, height: 92 } }),
    "play",
    { cell: i },
  );

  return {
    title: "Tic-Tac-Toe",
    content: Widget.vstack([
      Widget.text(result === "X" ? "You win!" : result === "O" ? "The computer wins" : done ? "A draw" : "Your turn (X)", {
        font: "title3", weight: "semibold", color: result === "X" ? "green" : result === "O" ? "red" : "primary",
      }),
      Widget.vstack([0, 3, 6].map((row) => Widget.hstack([cell(row), cell(row + 1), cell(row + 2)], { spacing: 8 })), { spacing: 8 }),
      Widget.button("New game", "new", null, { style: done ? "prominent" : "bordered", color: "purple" }),
      Widget.text(`You ${t.you} · Computer ${t.computer} · Draws ${t.draws}`, { font: "footnote", color: "secondary" }),
    ], { spacing: 16, padding: 20 }),
  };
});
