// @name        Minesweeper
// @description Classic Minesweeper played entirely inside a Home Screen widget, with a bigger board in the mini-app, a flag mode, a live timer and best times per size
// @widget      medium, large
// @icon        flag.checkered
// @color       #475569
// @version     1.0.0
// @author      va4w
// @category    games

// How it works
// • Every cell is a widget button, so the whole game runs on the Home Screen: medium is 8×6 with 8 mines,
//   large is 9×10 with 14 mines, and the mini-app plays 10×14 with 25 mines.
// • The first tap is never a mine: mines are placed after the first reveal, away from where you tapped.
// • Tap the flag button to switch between revealing and flagging. Empty areas open up by themselves.
// • The timer is a live date node that counts from your first tap. Best times per board size are kept in Storage.
// • Each board size keeps its own game, so a widget game and the mini-app game do not disturb each other.
// • Nothing leaves the device and no permissions are needed. Haptics and sounds play in the mini-app only.

// ───────────────────────── Boards and colours

const SIZES = {
  medium: { cols: 8, rows: 6, mines: 8, cell: 20, font: 11, gap: 2 },
  large: { cols: 9, rows: 10, mines: 14, cell: 27, font: 14, gap: 3 },
  app: { cols: 10, rows: 14, mines: 25, cell: 32, font: 17, gap: 3 },
};
const SIZE_LABELS = { medium: "Medium widget · 8×6", large: "Large widget · 9×10", app: "Mini-app · 10×14" };

const NUMBER_COLORS = ["primary", "#2563EB", "#16A34A", "#DC2626", "#1E3A8A", "#7F1D1D", "#0F766E", "#111827", "#6B7280"];
const CLOSED_BG = { light: "#94A3B8", dark: "#475569" };
const OPEN_BG = { light: "#E2E8F0", dark: "#1E293B" };
const FLAG_BG = { light: "#FDE68A", dark: "#92400E" };
const BOOM_BG = "#EF4444";
const SAFE_BG = { light: "#BBF7D0", dark: "#14532D" };
const BOARD_BG = { light: "#CBD5E1", dark: "#0F172A" };

const inApp = () => Script.env.mode === "app" || Script.env.mode === "pwa";
const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────── Game state

function freshGame(size) {
  const { cols, rows, mines } = SIZES[size];
  return {
    size, cols, rows, mines,
    mineAt: null,                       // array of booleans once placed
    open: Array(cols * rows).fill(false),
    flag: Array(cols * rows).fill(false),
    status: "ready",                    // ready | playing | won | lost
    flagMode: false,
    started: null,
    finished: null,
    hit: null,                          // the mine that ended the game
  };
}

const game = (size) => Storage.get(`board:${size}`) ?? freshGame(size);
const save = (g) => Storage.set(`board:${g.size}`, g);
const best = (size) => Storage.get(`best:${size}`);

function neighbours(g, i) {
  const x = i % g.cols, y = Math.floor(i / g.cols);
  const list = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < g.cols && ny >= 0 && ny < g.rows) list.push(ny * g.cols + nx);
    }
  }
  return list;
}

const countAround = (g, i) => neighbours(g, i).filter((n) => g.mineAt[n]).length;

// Mines go anywhere except the first tapped cell and the ring around it, so the first tap opens an area.
function placeMines(g, firstTap) {
  const forbidden = new Set([firstTap, ...neighbours(g, firstTap)]);
  const candidates = [];
  for (let i = 0; i < g.cols * g.rows; i++) if (!forbidden.has(i)) candidates.push(i);
  const random = new Uint32Array(g.mines);
  crypto.getRandomValues(random);
  g.mineAt = Array(g.cols * g.rows).fill(false);
  for (let k = 0; k < g.mines && candidates.length; k++) {
    const index = random[k] % candidates.length;
    g.mineAt[candidates[index]] = true;
    candidates.splice(index, 1);
  }
}

function reveal(g, start) {
  const queue = [start];
  while (queue.length) {
    const i = queue.pop();
    if (g.open[i] || g.flag[i]) continue;
    g.open[i] = true;
    if (g.mineAt[i]) continue;
    if (countAround(g, i) === 0) for (const n of neighbours(g, i)) if (!g.open[n]) queue.push(n);
  }
}

function checkWin(g) {
  const closed = g.open.filter((o) => !o).length;
  if (closed !== g.mines) return false;
  g.status = "won";
  g.finished = Date.now();
  const elapsed = g.finished - g.started;
  const record = best(g.size);
  if (!record || elapsed < record.ms) Storage.set(`best:${g.size}`, { ms: elapsed, at: g.finished });
  return true;
}

async function feedback(kind) {
  if (!inApp()) return;
  try {
    if (kind === "open") { await UI.haptic("light"); await Sound.play("click", { volume: 0.5 }); }
    if (kind === "flag") { await UI.haptic("medium"); await Sound.play("tink", { volume: 0.5 }); }
    if (kind === "won") { await UI.haptic("success"); await Sound.play("success"); }
    if (kind === "lost") { await UI.haptic("error"); await Sound.play("failure"); }
  } catch (error) {
    console.warn("Feedback:", error.message);
  }
}

// ───────────────────────── Actions

Script.action("tap", async ({ size, i }) => {
  const g = game(size);
  if (g.status === "won" || g.status === "lost") return;

  if (g.flagMode) {
    if (g.open[i]) return;
    g.flag[i] = !g.flag[i];
    save(g);
    await feedback("flag");
    return;
  }
  if (g.flag[i] || g.open[i]) return;

  if (!g.mineAt) {
    placeMines(g, i);
    g.status = "playing";
    g.started = Date.now();
  }
  reveal(g, i);

  if (g.mineAt[i]) {
    g.status = "lost";
    g.hit = i;
    g.finished = Date.now();
    g.open = g.open.map((o, k) => o || g.mineAt[k]);
    save(g);
    await feedback("lost");
    return;
  }
  const won = checkWin(g);
  save(g);
  await feedback(won ? "won" : "open");
});

Script.action("flagMode", ({ size }) => {
  const g = game(size);
  g.flagMode = !g.flagMode;
  save(g);
});

Script.action("reset", async ({ size }) => {
  save(freshGame(size));
  if (inApp()) await UI.haptic("light");
});

Script.action("clearBest", async () => {
  const choice = await UI.alert({ title: "Forget all best times?", buttons: ["Cancel", "Forget"] });
  if (choice === 1) for (const size of Object.keys(SIZES)) Storage.remove(`best:${size}`);
});

// ───────────────────────── Drawing

const formatMs = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

function cellNode(g, i, spec) {
  const open = g.open[i];
  let text = "";
  let background = CLOSED_BG;
  let color = "primary";

  if (open && g.mineAt?.[i]) {
    text = "✸";
    background = i === g.hit ? BOOM_BG : OPEN_BG;
    color = i === g.hit ? "white" : "#DC2626";
  } else if (open) {
    const n = countAround(g, i);
    text = n ? String(n) : "";
    background = g.status === "won" ? SAFE_BG : OPEN_BG;
    color = NUMBER_COLORS[n];
  } else if (g.flag[i]) {
    text = "⚑";
    background = FLAG_BG;
    color = g.status === "lost" && !g.mineAt[i] ? "#DC2626" : "#B45309";
  } else if (g.status === "won" && g.mineAt?.[i]) {
    text = "⚑";
    background = FLAG_BG;
    color = "#B45309";
  }

  const label = Widget.text(text, {
    font: spec.font, weight: "bold", design: "rounded", color, align: "center", lineLimit: 1,
    frame: { width: spec.cell, height: spec.cell }, background, cornerRadius: 3,
  });
  return Widget.button(label, "tap", { size: g.size, i }, { style: "plain" });
}

function board(g, spec) {
  const rows = [];
  for (let y = 0; y < g.rows; y++) {
    const cells = [];
    for (let x = 0; x < g.cols; x++) cells.push(cellNode(g, y * g.cols + x, spec));
    rows.push(Widget.hstack(cells, { spacing: spec.gap }));
  }
  return Widget.vstack(rows, { spacing: spec.gap, padding: spec.gap + 1, background: BOARD_BG, cornerRadius: 6 });
}

function face(g) {
  return g.status === "won" ? "😎" : g.status === "lost" ? "😵" : g.flagMode ? "🚩" : "🙂";
}

function clock(g, font) {
  if (g.status === "playing") return Widget.date(g.started, { style: "timer", font, weight: "semibold", design: "monospaced" });
  const shown = g.started && g.finished ? formatMs(g.finished - g.started) : "0:00";
  return Widget.text(shown, { font, weight: "semibold", design: "monospaced", color: g.status === "won" ? "green" : g.status === "lost" ? "red" : "secondary" });
}

function header(g, compact) {
  const left = g.mines - g.flag.filter(Boolean).length;
  const record = best(g.size);
  const font = compact ? "caption" : "subheadline";
  return Widget.hstack([
    Widget.hstack([
      Widget.symbol("flag.fill", { size: compact ? 10 : 12, color: "orange", fallback: "⚑" }),
      Widget.text(String(left), { font, weight: "bold", design: "monospaced", color: left < 0 ? "red" : "primary" }),
    ], { spacing: 3 }),
    Widget.spacer(),
    Widget.symbol("clock", { size: compact ? 10 : 12, color: "secondary", fallback: "⏱" }),
    clock(g, font),
    record ? Widget.text(`best ${formatMs(record.ms)}`, { font: "caption2", color: "secondary", lineLimit: 1 }) : null,
    Widget.spacer(),
    Widget.button(Widget.text("⚑", { font: compact ? 12 : 15, weight: "bold", color: g.flagMode ? "white" : "orange", padding: { horizontal: compact ? 6 : 9, vertical: compact ? 1 : 3 }, background: g.flagMode ? "orange" : OPEN_BG, cornerRadius: 6 }), "flagMode", { size: g.size }, { style: "plain" }),
    Widget.button(Widget.text(face(g), { font: compact ? 14 : 18, padding: { horizontal: compact ? 4 : 6, vertical: compact ? 0 : 2 }, background: OPEN_BG, cornerRadius: 6 }), "reset", { size: g.size }, { style: "plain" }),
  ], { spacing: compact ? 5 : 8 });
}

function statusLine(g) {
  if (g.status === "won") return `Cleared in ${formatMs(g.finished - g.started)}${best(g.size)?.at === g.finished ? " · new best!" : ""}`;
  if (g.status === "lost") return "Boom. Tap the face to try again.";
  if (g.flagMode) return "Flag mode: tap a cell to mark or unmark it.";
  if (g.status === "ready") return "Tap any cell to start. The first tap is always safe.";
  return `${g.open.filter(Boolean).length} of ${g.cols * g.rows - g.mines} safe cells open`;
}

// ───────────────────────── Widget

Script.widget(({ family }) => {
  const size = family === "large" ? "large" : "medium";
  const g = game(size);
  const spec = SIZES[size];
  const compact = size === "medium";
  return Widget.vstack([
    header(g, compact),
    board(g, spec),
    compact ? null : Widget.text(statusLine(g), { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.8 }),
  ], { spacing: compact ? 4 : 6, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
});

// ───────────────────────── Mini-app

Script.ui(() => {
  const g = game("app");
  const spec = SIZES.app;
  const records = Object.keys(SIZES).map((size) => {
    const r = best(size);
    return { title: SIZE_LABELS[size], symbol: size === "app" ? "iphone" : "square.grid.3x3.fill", color: r ? "green" : "gray", detail: r ? formatMs(r.ms) : "—", subtitle: r ? new Date(r.at).toLocaleDateString(Script.env.locale, { day: "numeric", month: "short" }) : "no win yet" };
  });

  return {
    title: "Minesweeper",
    content: Widget.vstack([
      header(g, false),
      Widget.text(statusLine(g), { font: "footnote", color: g.status === "won" ? "green" : g.status === "lost" ? "red" : "secondary", align: "center" }),
      Widget.hstack([Widget.spacer(), board(g, spec), Widget.spacer()]),
      Widget.hstack([
        Widget.button(g.flagMode ? "Flag mode on" : "Flag mode off", "flagMode", { size: "app" }, { style: g.flagMode ? "prominent" : "bordered", color: "orange" }),
        Widget.button("New game", "reset", { size: "app" }, { style: "bordered" }),
      ], { spacing: 10 }),
      Widget.list(records, { title: "Best times" }),
      Widget.text(`${spec.cols}×${spec.rows}, ${spec.mines} mines. Add the medium or large widget for a quick game on the Home Screen.`, { font: "caption", color: "secondary", align: "center" }),
      Widget.button("Forget best times", "clearBest", null, { style: "plain", color: "red" }),
    ], { spacing: 12, padding: 14 }),
  };
});

// ───────────────────────── Shortcuts and Siri

Script.run(() => {
  const lines = Object.keys(SIZES).map((size) => {
    const g = game(size);
    const r = best(size);
    const state = g.status === "playing" ? "in progress" : g.status;
    return `${SIZE_LABELS[size]}: ${state}${r ? `, best ${formatMs(r.ms)}` : ""}`;
  });
  return lines.join("\n");
});
