// @name        2048
// @description The sliding-tile puzzle: combine tiles to reach 2048
// @icon        square.grid.3x3.fill
// @color       #EDC22E
// @version     1.0.0
// @author      scriptwell
// @category    games

const SIZE = 4;
const COLORS = {
  0: "#CDC1B4", 2: "#EEE4DA", 4: "#EDE0C8", 8: "#F2B179", 16: "#F59563", 32: "#F67C5F", 64: "#F65E3B",
  128: "#EDCF72", 256: "#EDCC61", 512: "#EDC850", 1024: "#EDC53F", 2048: "#EDC22E",
};

const empty = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));

function addTile(board) {
  const free = [];
  board.forEach((row, r) => row.forEach((value, c) => { if (!value) free.push([r, c]); }));
  if (free.length === 0) return board;
  const [r, c] = free[Math.floor(Math.random() * free.length)];
  board[r][c] = Math.random() < 0.9 ? 2 : 4;
  return board;
}

const fresh = () => ({ board: addTile(addTile(empty())), score: 0 });
let game = Storage.get("game") ?? fresh();

// Slides one row to the left, merging equal neighbours once. Returns the new row and the points earned.
function slide(row) {
  const tiles = row.filter(Boolean);
  let points = 0;
  for (let i = 0; i < tiles.length - 1; i++) {
    if (tiles[i] === tiles[i + 1]) {
      tiles[i] *= 2;
      points += tiles[i];
      tiles.splice(i + 1, 1);
    }
  }
  return [[...tiles, ...Array(SIZE - tiles.length).fill(0)], points];
}

const transpose = (board) => board[0].map((_, c) => board.map((row) => row[c]));
const mirror = (board) => board.map((row) => [...row].reverse());

function move(board, direction) {
  // Every direction is a left slide on a rotated or mirrored copy of the board.
  const prepare = { left: (b) => b, right: mirror, up: transpose, down: (b) => mirror(transpose(b)) }[direction];
  const restore = { left: (b) => b, right: mirror, up: transpose, down: (b) => transpose(mirror(b)) }[direction];
  let points = 0;
  const moved = prepare(board).map((row) => { const [next, earned] = slide(row); points += earned; return next; });
  return [restore(moved), points];
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stuck = (board) => ["left", "right", "up", "down"].every((direction) => same(move(board, direction)[0], board));

Script.action("move", ({ direction }) => {
  const [board, points] = move(game.board, direction);
  if (same(board, game.board)) return; // nothing moved
  game = { board: addTile(board), score: game.score + points };
  Storage.set("game", game);
  Storage.set("best", Math.max(Storage.get("best", 0), game.score));
});

Script.action("new", () => { game = fresh(); Storage.set("game", game); });

function tile(value) {
  return Widget.zstack([
    Widget.text(value ? String(value) : " ", {
      font: value >= 1024 ? 20 : value >= 128 ? 24 : 28, weight: "bold", design: "rounded",
      color: value <= 4 ? "#776E65" : "white",
    }),
  ], { background: COLORS[value] ?? "#3C3A32", cornerRadius: 8, frame: { width: 70, height: 70 } });
}

Script.ui(() => {
  const won = game.board.flat().some((value) => value >= 2048);
  const over = stuck(game.board);
  const arrow = (label, direction) => Widget.button(label, "move", { direction }, { style: "bordered", frame: { width: 64 } });

  return {
    title: "2048",
    content: Widget.vstack([
      Widget.hstack([
        Widget.vstack([Widget.text("SCORE", { font: "caption2", color: "secondary" }), Widget.text(String(game.score), { font: "title2", weight: "bold" })], { spacing: 0 }),
        Widget.spacer(),
        Widget.vstack([Widget.text("BEST", { font: "caption2", color: "secondary" }), Widget.text(String(Storage.get("best", 0)), { font: "title2", weight: "bold" })], { spacing: 0 }),
      ]),
      Widget.vstack(game.board.map((row) => Widget.hstack(row.map(tile), { spacing: 8 })), { spacing: 8, padding: 8, background: "#BBADA0", cornerRadius: 12 }),
      over
        ? Widget.text("No moves left", { font: "headline", color: "red" })
        : won ? Widget.text("You made 2048! Keep going?", { font: "headline", color: "green" }) : null,
      arrow("↑", "up"),
      Widget.hstack([arrow("←", "left"), arrow("↓", "down"), arrow("→", "right")], { spacing: 10 }),
      Widget.button("New game", "new", null, { color: "secondary" }),
    ], { spacing: 12, padding: 16 }),
  };
});
