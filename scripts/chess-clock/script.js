// @name        Chess Clock
// @description A two-player chess clock with presets, increments, pause and move counts
// @icon        timer
// @color       #16A34A
// @version     1.0.0
// @author      scriptwell
// @category    utilities

// ───────────── Settings and state

const PRESETS = [
  { label: "Bullet · 1+0", base: 60, inc: 0 },
  { label: "Bullet · 2+1", base: 120, inc: 1 },
  { label: "Blitz · 3+2", base: 180, inc: 2 },
  { label: "Blitz · 5+0", base: 300, inc: 0 },
  { label: "Blitz · 5+3", base: 300, inc: 3 },
  { label: "Rapid · 10+0", base: 600, inc: 0 },
  { label: "Rapid · 15+10", base: 900, inc: 10 },
  { label: "Classical · 30+0", base: 1800, inc: 0 },
];

const NAMES = ["White", "Black"];

function newGame(base, inc) {
  return {
    base,
    inc,
    remaining: [base * 1000, base * 1000],
    active: null,      // whose clock is running: 0, 1 or null
    pausedTurn: null,  // whose turn it was when paused
    startedAt: null,   // when the active clock last started
    moves: [0, 0],
    flagged: null,     // who ran out of time
  };
}

const load = () => Storage.get("clock") ?? newGame(300, 0);
const save = (s) => Storage.set("clock", s);

// Brings the running clock up to date and detects a flag.
function settle(s, now = Date.now()) {
  if (s.active === null) return s;
  const p = s.active;
  s.remaining[p] -= now - s.startedAt;
  s.startedAt = now;
  if (s.remaining[p] <= 0) {
    s.remaining[p] = 0;
    s.flagged = p;
    s.active = null;
    s.pausedTurn = null;
  }
  return s;
}

const isStarted = (s) => s.active !== null || s.pausedTurn !== null || s.moves[0] + s.moves[1] > 0;

function formatTime(ms) {
  const total = Math.max(0, ms);
  if (total < 10_000) return (total / 1000).toFixed(1);
  const secs = Math.ceil(total / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

const controlLabel = (s) => {
  const mins = s.base / 60;
  return `${Number.isInteger(mins) ? mins : mins.toFixed(1)}+${s.inc}`;
};

async function feedback(kind) {
  try {
    if (kind === "flag") {
      await UI.haptic("error");
      Sound.play("alarm").catch(() => {});
    } else {
      await UI.haptic("light");
      Sound.play("tock", { volume: 0.6 }).catch(() => {});
    }
  } catch {
    // Feedback is optional.
  }
}

// ───────────── Actions

Script.action("press", async ({ player }) => {
  const s = settle(load());
  if (s.flagged !== null) return save(s);

  if (s.active === null) {
    // Not started or paused: pressing your side starts the opponent's clock.
    if (s.pausedTurn !== null && s.pausedTurn !== 1 - player) return;
    s.active = 1 - player;
    s.pausedTurn = null;
    s.startedAt = Date.now();
    save(s);
    await feedback("tap");
    return;
  }

  if (s.active !== player) return save(s); // not your turn

  s.remaining[player] += s.inc * 1000;
  s.moves[player] += 1;
  s.active = 1 - player;
  s.startedAt = Date.now();
  save(s);
  await feedback("tap");
});

Script.action("pause", async () => {
  const s = settle(load());
  if (s.active !== null) {
    s.pausedTurn = s.active;
    s.active = null;
    s.startedAt = null;
  }
  save(s);
  if (s.flagged !== null) await feedback("flag");
});

Script.action("resume", () => {
  const s = load();
  if (s.pausedTurn === null || s.flagged !== null) return;
  s.active = s.pausedTurn;
  s.pausedTurn = null;
  s.startedAt = Date.now();
  save(s);
});

Script.action("check", async () => {
  const s = settle(load());
  save(s);
  if (s.flagged !== null) await feedback("flag");
});

async function confirmReset(s) {
  if (!isStarted(s) || s.flagged !== null) return true;
  const choice = await UI.alert({ title: "Start a new game?", message: "The current game will be lost.", buttons: ["Cancel", "New Game"] });
  return choice === 1;
}

Script.action("reset", async () => {
  const s = load();
  if (!(await confirmReset(s))) return;
  save(newGame(s.base, s.inc));
});

Script.action("preset", async ({ base, inc }) => {
  const s = load();
  if (!(await confirmReset(s))) return;
  save(newGame(base, inc));
});

Script.action("custom", async () => {
  const s = load();
  const text = await UI.prompt({
    title: "Custom time control",
    message: "Minutes + increment in seconds, for example 7+5",
    placeholder: "7+5",
    defaultValue: controlLabel(s),
  });
  if (text === null) return;
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(?:\+\s*(\d+))?\s*$/.exec(text);
  const minutes = match ? Number(match[1].replace(",", ".")) : NaN;
  if (!match || !(minutes > 0) || minutes > 600) {
    await UI.alert({ title: "Not understood", message: `“${text}” is not a time control like 5+3.` });
    return;
  }
  if (!(await confirmReset(s))) return;
  save(newGame(Math.round(minutes * 60), Number(match[2] ?? 0)));
});

// ───────────── UI

function panel(s, player) {
  const isActive = s.active === player;
  const lost = s.flagged === player;
  const won = s.flagged === 1 - player;
  const ms = s.remaining[player];
  const low = ms < 20_000;

  const bg = lost
    ? "#DC2626"
    : isActive
      ? (low ? "#EA580C" : "#16A34A")
      : player === 0
        ? { light: "#F1F5F9", dark: "#2C2C2E" }
        : { light: "#1E293B", dark: "#111113" };

  const fg = lost || isActive ? "white" : player === 0 ? "primary" : { light: "#F8FAFC", dark: "#E5E5EA" };
  const sub = lost || isActive ? "#FFFFFFCC" : player === 0 ? "secondary" : { light: "#94A3B8", dark: "#8E8E93" };

  const timeProps = { font: 76, weight: "semibold", design: "rounded", color: fg, align: "center" };
  const timeNode = isActive
    ? Widget.date(s.startedAt + ms, { style: "timer", ...timeProps })
    : Widget.text(formatTime(ms), { ...timeProps, lineLimit: 1, minimumScale: 0.5 });

  let status;
  if (lost) status = "Out of time";
  else if (won) status = "Wins on time";
  else if (isActive) status = "Your move · tap when done";
  else if (s.active === null && s.pausedTurn === null && !isStarted(s))
    status = player === 1 ? "Black taps to start White's clock" : "Waiting";
  else if (s.pausedTurn === player) status = "Paused · your move";
  else status = "Waiting";

  return Widget.button(
    Widget.vstack([
      Widget.hstack([
        Widget.symbol(player === 0 ? "circle" : "circle.fill", { size: 14, color: fg, fallback: player === 0 ? "♔" : "♚" }),
        Widget.text(NAMES[player].toUpperCase(), { font: "caption", weight: "bold", color: fg }),
        Widget.spacer(),
        Widget.text(`Moves ${s.moves[player]}`, { font: "caption", weight: "medium", design: "monospaced", color: sub }),
      ], { spacing: 6 }),
      Widget.spacer(),
      timeNode,
      Widget.spacer(),
      Widget.text(status, { font: "footnote", weight: "medium", color: sub, align: "center" }),
    ], {
      spacing: 4,
      padding: 18,
      background: bg,
      cornerRadius: 28,
      frame: { maxWidth: "infinity", height: 250 },
    }),
    "press",
    { player },
    { style: "plain" },
  );
}

function controls(s) {
  const running = s.active !== null;
  const paused = s.pausedTurn !== null;
  const over = s.flagged !== null;

  const main = over
    ? Widget.button("New Game", "reset", null, { style: "prominent", color: "green" })
    : running
      ? Widget.button("Pause", "pause", null, { style: "bordered" })
      : paused
        ? Widget.button("Resume", "resume", null, { style: "prominent", color: "green" })
        : null;

  return Widget.hstack([
    Widget.vstack([
      Widget.text(controlLabel(s), { font: "title3", weight: "bold", design: "rounded" }),
      Widget.text(s.inc ? `+${s.inc}s per move` : "No increment", { font: "caption2", color: "secondary" }),
    ], { alignment: "leading", spacing: 0 }),
    Widget.spacer(),
    running ? Widget.button(Widget.symbol("flag.checkered", { size: 18, fallback: "🏁" }), "check", null, { style: "bordered" }) : null,
    main,
    Widget.menu("clock.arrow.circlepath", [
      ...PRESETS.map((p) => ({ title: p.label, symbol: "timer", action: "preset", args: { base: p.base, inc: p.inc } })),
      { title: "Custom…", symbol: "slider.horizontal.3", action: "custom" },
      { title: "Reset clock", symbol: "arrow.counterclockwise", action: "reset", destructive: true },
    ]),
  ], { spacing: 10, padding: { horizontal: 6 } });
}

Script.ui(() => {
  const s = settle(load());
  save(s);

  return {
    title: "Chess Clock",
    content: Widget.vstack([
      panel(s, 1),
      controls(s),
      panel(s, 0),
    ], { spacing: 14, padding: 12 }),
  };
});

// From Shortcuts or ▶: a quick summary of the clock.
Script.run(() => {
  const s = settle(load());
  save(s);
  if (s.flagged !== null) return `${NAMES[s.flagged]} ran out of time. ${NAMES[1 - s.flagged]} wins.`;
  return `${controlLabel(s)} · White ${formatTime(s.remaining[0])} · Black ${formatTime(s.remaining[1])}` +
    (s.active !== null ? ` · ${NAMES[s.active]} to move` : "");
});
