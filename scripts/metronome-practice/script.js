// @name        Metronome & Practice
// @description A metronome with tap tempo, time signatures and an accented first beat, plus a practice log with pieces, a timer, weekly minutes and a streak. Everything stays on the device.
// @widget      small, medium, rectangular
// @icon        metronome.fill
// @color       #D97706
// @version     1.0.0
// @author      va4w
// @category    music

// How it works
// • Metronome: set the tempo with the slider, the stepper or tap tempo (the average of your last four
//   taps), pick 2/4, 3/4, 4/4 or 6/8, and tap Play. Beat one is a higher tone (Sound.tone), the rest a
//   lower one. The screen stays awake while it plays.
// • The beat loop is a setInterval started by the Play action. A mini-app keeps running while it is open,
//   so the loop keeps ticking between redraws; the count-in bar is awaited inside the action so the first
//   beats always play. A run stops itself after 20 minutes. The screen only redraws after a tap, so the
//   beat indicator shows the current bar when you tap Play, Stop or Tap.
// • Practice log: add pieces with a daily target, start the timer on one, stop to log the session. Sessions
//   are kept in Files (practice-log.json); the widget shows the streak, this week's minutes and a chart.
// • Nothing is sent anywhere. No permissions needed.

// ───────────────────────── Constants

const LOG_FILE = "practice-log.json";
const DAY = 86_400_000;
const MAX_RUN_MS = 20 * 60_000;
const ACCENT_HZ = 1320;
const BEAT_HZ = 880;
const TICK_SECONDS = 0.045;

const SIGNATURES = [
  { label: "2/4", beats: 2 },
  { label: "3/4", beats: 3 },
  { label: "4/4", beats: 4 },
  { label: "6/8", beats: 6, accents: [0, 3] },
];

const TEMPI = [
  { max: 24, name: "Larghissimo" },
  { max: 45, name: "Grave" },
  { max: 60, name: "Largo" },
  { max: 66, name: "Larghetto" },
  { max: 76, name: "Adagio" },
  { max: 108, name: "Andante" },
  { max: 120, name: "Moderato" },
  { max: 156, name: "Allegro" },
  { max: 176, name: "Vivace" },
  { max: 200, name: "Presto" },
  { max: Infinity, name: "Prestissimo" },
];

const AMBER = "#F59E0B";
const AMBER_SOFT = { light: "#FEF3C7", dark: "#451A03" };
const CARD_BG = { light: "#FFFFFF", dark: "#1C1C1E" };
const WIDGET_BG = Widget.gradient(["#7C2D12", "#B45309", "#D97706"], { direction: "topLeadingToBottomTrailing" });
const SOFT_WHITE = "#FFFFFFB3";
const locale = Script.env.locale;
const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

// ───────────────────────── Settings in Storage

const DEFAULTS = { bpm: 100, signature: "4/4", volume: 0.8, tab: "Metronome" };
const settings = () => ({ ...DEFAULTS, ...Storage.get("settings", {}) });
const save = (changes) => Storage.set("settings", { ...settings(), ...changes });
const clampBpm = (bpm) => Math.max(40, Math.min(240, Math.round(bpm)));
const tempoName = (bpm) => TEMPI.find((t) => bpm <= t.max).name;
const signatureFor = (label) => SIGNATURES.find((s) => s.label === label) ?? SIGNATURES[2];
const isAccent = (sig, beat) => (sig.accents ?? [0]).includes(beat);

const pieces = () => Storage.get("pieces", []);
const session = () => Storage.get("session"); // { pieceId, start }
const today = () => new Date().toLocaleDateString("en-CA");
const dayKey = (ms) => new Date(ms).toLocaleDateString("en-CA");

// ───────────────────────── Metronome engine (lives while the mini-app is open)

let ticker = null;        // setInterval handle
let beat = 0;             // beat shown by the indicator, 0-based
let runStartedAt = null;
let taps = [];
let notice = null;        // one-line message shown after an action

function playTick(accent) {
  const { volume } = settings();
  Sound.tone(accent ? ACCENT_HZ : BEAT_HZ, { duration: TICK_SECONDS, volume: accent ? volume : volume * 0.7 })
    .catch(() => { /* a missed tick is better than a stopped metronome */ });
}

function stopMetronome() {
  if (ticker !== null) clearInterval(ticker);
  ticker = null;
  runStartedAt = null;
  beat = 0;
  Device.keepAwake(false).catch(() => {});
}

async function startMetronome() {
  stopMetronome();
  const { bpm, signature } = settings();
  const sig = signatureFor(signature);
  const period = 60_000 / bpm;

  await Device.keepAwake(true).catch(() => {});
  runStartedAt = Date.now();

  // Count-in: one bar awaited here, so the first beats are guaranteed inside the action's budget.
  for (let b = 0; b < sig.beats; b++) {
    beat = b;
    playTick(isAccent(sig, b));
    await new Promise((resolve) => setTimeout(resolve, period));
  }

  // Then the interval carries on while the mini-app stays open.
  beat = 0;
  playTick(true);
  ticker = setInterval(() => {
    if (Date.now() - runStartedAt > MAX_RUN_MS) { stopMetronome(); return; }
    beat = (beat + 1) % sig.beats;
    playTick(isAccent(sig, beat));
  }, period);
}

Script.action("toggle", async () => {
  if (ticker !== null) { stopMetronome(); notice = null; return; }
  await startMetronome();
  notice = `Playing at ${settings().bpm} BPM. Tap Stop when you are done.`;
});

Script.action("bpm", ({ value }) => {
  save({ bpm: clampBpm(value) });
  if (ticker !== null) startMetronome();
});

Script.action("nudge", ({ by }) => {
  save({ bpm: clampBpm(settings().bpm + by) });
  if (ticker !== null) startMetronome();
});

Script.action("signature", ({ value }) => {
  save({ signature: value });
  if (ticker !== null) startMetronome();
});

Script.action("volume", ({ value }) => save({ volume: value }));

Script.action("tap", async () => {
  const now = Date.now();
  if (taps.length && now - taps[taps.length - 1] > 2500) taps = [];
  taps = [...taps, now].slice(-4);
  await UI.haptic("light");
  if (taps.length < 2) { notice = "Keep tapping…"; return; }
  const gaps = taps.slice(1).map((t, i) => t - taps[i]);
  const average = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const bpm = clampBpm(60_000 / average);
  save({ bpm });
  notice = `Tap tempo: ${bpm} BPM from ${taps.length} taps`;
  if (ticker !== null) await startMetronome();
});

Script.action("tab", ({ value }) => save({ tab: value }));

// ───────────────────────── Practice log (Files)

async function readLog() {
  if (!(await Files.exists(LOG_FILE))) return [];
  try { return await Files.readJSON(LOG_FILE); } catch { return []; }
}

async function writeLog(entries) {
  await Files.writeJSON(LOG_FILE, entries);
  Storage.set("summary", summarize(entries));
}

// Everything the widget needs, precomputed so it never reads Files.
function summarize(entries) {
  const now = Date.now();
  const minutesByDay = {};
  for (const e of entries) minutesByDay[dayKey(e.start)] = (minutesByDay[dayKey(e.start)] ?? 0) + e.minutes;

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(now - (6 - i) * DAY);
    const key = date.toLocaleDateString("en-CA");
    return { key, label: date.toLocaleDateString(locale, { weekday: "short" }), minutes: Math.round(minutesByDay[key] ?? 0) };
  });

  // Streak: consecutive days with practice, ending today or yesterday.
  let streak = 0;
  let cursor = new Date(now);
  if (!minutesByDay[dayKey(cursor)]) cursor = new Date(now - DAY);
  while (minutesByDay[dayKey(cursor)]) { streak++; cursor = new Date(cursor.getTime() - DAY); }

  const weekStart = new Date(`${days[0].key}T00:00:00`).getTime();
  const perPiece = {};
  for (const e of entries) {
    const p = perPiece[e.pieceId] ??= { week: 0, today: 0, total: 0, sessions: 0 };
    p.total += e.minutes;
    p.sessions += 1;
    if (e.start >= weekStart) p.week += e.minutes;
    if (dayKey(e.start) === today()) p.today += e.minutes;
  }

  return {
    streak,
    todayMinutes: Math.round(minutesByDay[today()] ?? 0),
    weekMinutes: days.reduce((sum, d) => sum + d.minutes, 0),
    days,
    perPiece,
    sessions: entries.length,
    updated: now,
  };
}

const summary = () => Storage.get("summary") ?? summarize([]);
const fmtMinutes = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);

Script.action("addPiece", async () => {
  const name = await UI.prompt({ title: "New piece", placeholder: "Clair de Lune" });
  if (!name?.trim()) return;
  const target = await UI.prompt({ title: "Daily target in minutes", defaultValue: "20" });
  const targetMinutes = Math.max(1, Math.min(600, Number(target) || 20));
  Storage.set("pieces", [...pieces(), { id: crypto.randomUUID(), name: name.trim(), targetMinutes, created: Date.now() }]);
});

Script.action("target", ({ id, value }) => {
  Storage.set("pieces", pieces().map((p) => (p.id === id ? { ...p, targetMinutes: value } : p)));
});

Script.action("removePiece", async ({ id }) => {
  const piece = pieces().find((p) => p.id === id);
  const choice = await UI.alert({ title: `Remove “${piece?.name}”?`, message: "Logged sessions are kept.", buttons: ["Cancel", "Remove"] });
  if (choice === 1) Storage.set("pieces", pieces().filter((p) => p.id !== id));
});

Script.action("start", async ({ id }) => {
  if (session()) { notice = "Stop the running timer first."; return; }
  Storage.set("session", { pieceId: id, start: Date.now() });
  await UI.haptic("medium");
});

Script.action("stop", async () => {
  const s = session();
  if (!s) return;
  Storage.remove("session");
  const minutes = (Date.now() - s.start) / 60_000;
  if (minutes < 0.5) { notice = "Sessions under 30 seconds are not logged."; return; }
  const entries = await readLog();
  entries.push({ id: crypto.randomUUID(), pieceId: s.pieceId, start: s.start, end: Date.now(), minutes: Math.round(minutes * 10) / 10, bpm: settings().bpm });
  await writeLog(entries.slice(-2000));
  await UI.haptic("success");
  notice = `Logged ${fmtMinutes(minutes)}.`;
});

Script.action("discard", async () => {
  const choice = await UI.alert({ title: "Discard this session?", buttons: ["Keep going", "Discard"] });
  if (choice === 1) Storage.remove("session");
});

Script.action("deleteEntry", async ({ id }) => {
  const entries = await readLog();
  await writeLog(entries.filter((e) => e.id !== id));
});

Script.action("export", async () => {
  const entries = await readLog();
  const names = Object.fromEntries(pieces().map((p) => [p.id, p.name]));
  const rows = entries.map((e) => `${new Date(e.start).toISOString()},${JSON.stringify(names[e.pieceId] ?? "Removed piece")},${e.minutes},${e.bpm ?? ""}`);
  await Files.write("exports/practice.csv", ["start,piece,minutes,bpm", ...rows].join("\n"));
  await UI.share({ file: "exports/practice.csv" });
});

// ───────────────────────── Mini-app pieces

function beatIndicator(sig, current, playing, size = 18) {
  return Widget.hstack(Array.from({ length: sig.beats }, (_, b) => {
    const accent = isAccent(sig, b);
    const active = playing && b === current;
    return {
      type: "stack", direction: "horizontal", children: [],
      frame: { width: accent ? size + 6 : size, height: accent ? size + 6 : size },
      background: active ? AMBER : accent ? "#F59E0B66" : "#9CA3AF55",
      cornerRadius: (accent ? size + 6 : size) / 2,
    };
  }), { spacing: 8, alignment: "center" });
}

function metronomePane() {
  const s = settings();
  const sig = signatureFor(s.signature);
  const playing = ticker !== null;
  return Widget.vstack([
    Widget.vstack([
      Widget.text(tempoName(s.bpm).toUpperCase(), { font: "caption", weight: "bold", color: AMBER }),
      Widget.text(String(s.bpm), { font: 84, weight: "bold", design: "rounded" }),
      Widget.text("beats per minute", { font: "caption", color: "secondary" }),
      beatIndicator(sig, beat, playing, 20),
      playing ? Widget.hstack([
        Widget.text("Playing", { font: "footnote", weight: "semibold", color: AMBER }),
        Widget.date(runStartedAt, { style: "timer", font: "footnote", design: "monospaced", color: "secondary" }),
      ], { spacing: 6 }) : Widget.text("Stopped", { font: "footnote", color: "secondary" }),
    ], { spacing: 8, padding: 20, background: CARD_BG, cornerRadius: 20, frame: { maxWidth: "infinity" } }),

    Widget.hstack([
      Widget.button(Widget.hstack([
        Widget.symbol(playing ? "stop.fill" : "play.fill", { size: 16, color: "white", fallback: playing ? "■" : "▶" }),
        Widget.text(playing ? "Stop" : "Play", { weight: "semibold", color: "white" }),
      ], { spacing: 6, padding: { horizontal: 22, vertical: 10 } }), "toggle", null, { style: "prominent", color: playing ? "red" : "orange" }),
      Widget.button("Tap tempo", "tap", null, { style: "bordered", color: "orange" }),
    ], { spacing: 12 }),

    Widget.slider(s.bpm, "bpm", null, { min: 40, max: 240, step: 1, color: "orange", label: "Tempo" }),
    Widget.hstack([
      Widget.stepper("Fine", s.bpm, "bpm", null, { min: 40, max: 240 }),
      Widget.spacer(),
      Widget.button("−5", "nudge", { by: -5 }, { style: "bordered" }),
      Widget.button("+5", "nudge", { by: 5 }, { style: "bordered" }),
    ], { spacing: 8 }),
    Widget.picker(SIGNATURES.map((x) => x.label), s.signature, "signature", null, { style: "segmented", label: "Time signature" }),
    Widget.slider(s.volume, "volume", null, { min: 0.1, max: 1, step: 0.1, color: "orange", label: "Click volume" }),
    Widget.text("Beat one is the higher tone. A run stops by itself after 20 minutes; the screen stays awake while it plays.", { font: "caption2", color: "secondary" }),
  ], { spacing: 14 });
}

function pieceCard(piece, sum) {
  const stats = sum.perPiece[piece.id] ?? { week: 0, today: 0, total: 0, sessions: 0 };
  const targetMet = stats.today >= piece.targetMinutes;
  const running = session()?.pieceId === piece.id;
  return Widget.vstack([
    Widget.hstack([
      Widget.vstack([
        Widget.text(piece.name, { font: "headline", lineLimit: 1 }),
        Widget.text(`${fmtMinutes(stats.week)} this week · ${fmtMinutes(stats.total)} total · ${stats.sessions} session${stats.sessions === 1 ? "" : "s"}`, { font: "caption", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
      ], { alignment: "leading", spacing: 2 }),
      Widget.spacer(),
      running
        ? Widget.button("Stop", "stop", null, { style: "prominent", color: "red" })
        : Widget.button("Start", "start", { id: piece.id }, { style: "bordered", color: "orange" }),
    ], { spacing: 8 }),
    running ? Widget.date(session().start, { style: "timer", font: 40, weight: "bold", design: "rounded", color: AMBER }) : null,
    Widget.hstack([
      Widget.progress(Math.min(1, stats.today / piece.targetMinutes), { color: targetMet ? "green" : "orange" }),
      Widget.text(targetMet ? "Target met" : `${fmtMinutes(Math.max(0, piece.targetMinutes - stats.today))} to go today`, { font: "caption2", color: targetMet ? "green" : "secondary", lineLimit: 1 }),
    ], { spacing: 8 }),
    Widget.hstack([
      Widget.stepper(`Target ${piece.targetMinutes} min/day`, piece.targetMinutes, "target", { id: piece.id }, { min: 5, max: 240 }),
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [{ title: "Remove piece", symbol: "trash", action: "removePiece", args: { id: piece.id }, destructive: true }]),
    ]),
  ], { alignment: "leading", spacing: 8, padding: 14, background: CARD_BG, cornerRadius: 16, frame: { maxWidth: "infinity", alignment: "leading" } });
}

function weekChart(sum, height) {
  const data = sum.days.map((d) => ({ x: d.label, y: d.minutes }));
  return Widget.chart(data, { color: "orange", frame: { height } });
}

async function practicePane() {
  const sum = summary();
  const list = pieces();
  const s = session();
  const entries = (await readLog()).slice(-8).reverse();
  const names = Object.fromEntries(list.map((p) => [p.id, p.name]));
  const stat = (value, label) => Widget.vstack([
    Widget.text(value, { font: "title2", weight: "bold", design: "rounded", color: AMBER }),
    Widget.text(label, { font: "caption2", color: "secondary" }),
  ], { spacing: 0, frame: { maxWidth: "infinity" } });

  return Widget.vstack([
    Widget.hstack([
      stat(`${sum.streak}`, "day streak"),
      stat(fmtMinutes(sum.todayMinutes), "today"),
      stat(fmtMinutes(sum.weekMinutes), "last 7 days"),
    ], { padding: 14, background: AMBER_SOFT, cornerRadius: 16 }),
    Widget.text("Minutes per day", { font: "caption", weight: "semibold", color: "secondary" }),
    weekChart(sum, 150),
    s && !list.some((p) => p.id === s.pieceId) ? Widget.hstack([
      Widget.text("Timer running on a removed piece", { font: "footnote" }),
      Widget.spacer(),
      Widget.button("Stop", "stop", null, { style: "bordered", color: "red" }),
    ]) : null,
    Widget.hstack([
      Widget.text("Pieces", { font: "headline" }),
      Widget.spacer(),
      s ? Widget.button("Discard session", "discard", null, { style: "plain", color: "red" }) : null,
      Widget.button("Add piece", "addPiece", null, { style: "bordered", color: "orange" }),
    ]),
    ...(list.length ? list.map((p) => pieceCard(p, sum)) : [Widget.text("Add a piece, then start its timer when you practise.", { color: "secondary", font: "footnote" })]),
    entries.length ? Widget.list(entries.map((e) => ({
      title: names[e.pieceId] ?? "Removed piece",
      subtitle: new Date(e.start).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      detail: `${fmtMinutes(e.minutes)}${e.bpm ? ` · ♩ ${e.bpm}` : ""}`,
      symbol: "music.note",
      color: "orange",
      action: "deleteEntry",
      args: { id: e.id },
    })), { title: "Recent sessions (tap to delete)" }) : null,
    entries.length ? Widget.button("Export CSV", "export", null, { style: "plain", color: "orange" }) : null,
  ], { alignment: "leading", spacing: 14 });
}

// ───────────────────────── Mini-app

Script.ui(async () => {
  const s = settings();
  const tabs = [
    { title: "Metronome", symbol: "metronome.fill", content: metronomePane() },
    { title: "Practice", symbol: "music.note.list", content: await practicePane() },
  ];
  return {
    title: s.tab === "Practice" ? "Practice" : `${tempoName(s.bpm)} · ${s.bpm}`,
    content: Widget.vstack([
      notice ? Widget.text(notice, { font: "footnote", color: AMBER, padding: { horizontal: 12, vertical: 8 }, background: AMBER_SOFT, cornerRadius: 10 }) : null,
      Widget.tabs(tabs, { selected: s.tab, action: "tab" }),
    ], { spacing: 12, padding: 16 }),
  };
});

// ───────────────────────── Widget

Script.widget(({ family }) => {
  const sum = summary();
  const s = session();
  const piece = s ? pieces().find((p) => p.id === s.pieceId) : null;
  const bpm = settings().bpm;
  let content;

  if (family === "rectangular") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("metronome.fill", { size: 12, fallback: "♩" }),
        Widget.text("PRACTICE", { font: "caption2", weight: "bold" }),
        Widget.spacer(),
        Widget.text(`${sum.streak}🔥`, { font: "caption2", weight: "semibold" }),
      ], { spacing: 4 }),
      s ? Widget.date(s.start, { style: "timer", font: "title2", weight: "bold", design: "rounded" })
        : Widget.text(fmtMinutes(sum.todayMinutes), { font: "title2", weight: "bold", design: "rounded" }),
      Widget.text(s ? `on ${piece?.name ?? "a piece"}` : `today · ${fmtMinutes(sum.weekMinutes)} this week`, { font: "caption", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 1 });
  } else if (family === "small") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("flame.fill", { size: 16, color: "#FDE68A", fallback: "🔥" }),
        Widget.text(`${sum.streak} day${sum.streak === 1 ? "" : "s"}`, { font: "headline", color: "white" }),
      ], { spacing: 4 }),
      Widget.spacer(),
      Widget.text(fmtMinutes(sum.weekMinutes), { font: 30, weight: "bold", design: "rounded", color: "white", lineLimit: 1, minimumScale: 0.6 }),
      Widget.text("last 7 days", { font: "caption", color: SOFT_WHITE }),
      Widget.hstack(sum.days.map((d) => ({
        type: "stack", direction: "vertical", children: [],
        frame: { width: 10, height: Math.max(3, Math.min(22, d.minutes / 3)) },
        background: d.key === today() ? "#FDE68A" : "#FFFFFF99", cornerRadius: 2,
      })), { spacing: 4, alignment: "bottom" }),
      Widget.text(s ? `Practising · ${piece?.name ?? ""}` : `♩ ${bpm} ${tempoName(bpm)}`, { font: "caption2", color: SOFT_WHITE, lineLimit: 1 }),
    ], { alignment: "leading", spacing: 3, padding: 14, background: WIDGET_BG, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
  } else {
    const top = pieces().map((p) => ({ p, week: sum.perPiece[p.id]?.week ?? 0 })).sort((a, b) => b.week - a.week).slice(0, 3);
    content = Widget.hstack([
      Widget.vstack([
        Widget.hstack([
          Widget.symbol("flame.fill", { size: 16, color: "#FDE68A", fallback: "🔥" }),
          Widget.text(`${sum.streak} day streak`, { font: "headline", color: "white" }),
        ], { spacing: 4 }),
        Widget.text(fmtMinutes(sum.weekMinutes), { font: 30, weight: "bold", design: "rounded", color: "white", lineLimit: 1, minimumScale: 0.6 }),
        Widget.text(`last 7 days · ${fmtMinutes(sum.todayMinutes)} today`, { font: "caption", color: SOFT_WHITE, lineLimit: 1 }),
        Widget.spacer(),
        ...top.map(({ p, week }) => Widget.hstack([
          Widget.text(p.name, { font: "caption2", color: "white", lineLimit: 1, minimumScale: 0.7 }),
          Widget.spacer(),
          Widget.text(fmtMinutes(week), { font: "caption2", weight: "semibold", color: "#FDE68A" }),
        ])),
        top.length === 0 ? Widget.text("Add pieces in the app", { font: "caption2", color: SOFT_WHITE }) : null,
      ], { alignment: "leading", spacing: 3, frame: { width: 140, maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack([
        Widget.text(s ? `Practising ${piece?.name ?? ""}` : `♩ ${bpm} · ${tempoName(bpm)}`, { font: "caption", weight: "semibold", color: "white", lineLimit: 1 }),
        s ? Widget.date(s.start, { style: "timer", font: "title3", weight: "bold", design: "rounded", color: "#FDE68A" }) : null,
        Widget.chart(sum.days.map((d) => ({ x: d.label, y: d.minutes })), { color: "#FDE68A", axes: false }),
      ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 12, padding: 14, background: WIDGET_BG, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
  }

  return { content, refreshAfter: 30 * 60 };
});

// ───────────────────────── Shortcuts and Siri

// "Run Metronome & Practice" with no input reads today's totals; "start <piece>" and "stop" drive the timer.
Script.run(async (input) => {
  const text = (input ?? "").trim();
  const sum = summary();
  if (/^stop$/i.test(text)) {
    const s = session();
    if (!s) return "No timer is running.";
    Storage.remove("session");
    const minutes = (Date.now() - s.start) / 60_000;
    const entries = await readLog();
    entries.push({ id: crypto.randomUUID(), pieceId: s.pieceId, start: s.start, end: Date.now(), minutes: Math.round(minutes * 10) / 10 });
    await writeLog(entries);
    return `Logged ${fmtMinutes(minutes)}.`;
  }
  const match = /^start\s+(.+)$/i.exec(text);
  if (match) {
    const piece = pieces().find((p) => p.name.toLowerCase().includes(match[1].toLowerCase()));
    if (!piece) return `No piece called “${match[1]}”.`;
    Storage.set("session", { pieceId: piece.id, start: Date.now() });
    return `Timer started on ${piece.name}.`;
  }
  return `${fmtMinutes(sum.todayMinutes)} today, ${fmtMinutes(sum.weekMinutes)} this week, ${sum.streak}-day streak. Metronome at ${settings().bpm} BPM (${tempoName(settings().bpm)}).`;
});
