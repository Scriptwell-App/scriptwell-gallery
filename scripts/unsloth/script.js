// @name        Unsloth
// @description A pixel-art sloth that only wakes up when you move. Steps from Apple Health unsloth it and earn leaves to feed it.
// @icon        leaf.fill
// @color       #6B8E4E
// @permissions health
// @widget      small, medium, large, circular, rectangular, inline
// @version     1.0.0
// @author      va4w
// @category    health-fitness

// ───────────────────────── Palette and sprite

const PALETTE = {
  B: "#8B6A4B", // fur
  D: "#4A3426", // claws / dark fur
  L: "#E6D3B1", // face
  M: "#6B4A33", // eye mask
  E: "#161010", // eyes
  W: "#FFFFFF", // eye shine
  N: "#2A1B12", // nose / mouth
  T: "#7A5532", // branch
  G: "#5E9E4E", // leaf
  P: "#E59A8F", // blush
};

const EYES = {
  open:   [".BLMWMLLLLMWMLB.", ".BMMEMLLLLMEMMB."],
  drowsy: [".BLMMMLLLLMMMLB.", ".BMMEMLLLLMEMMB."],
  closed: [".BLMMMLLLLMMMLB.", ".BMEEMLLLLMEEMB."],
  happy:  [".BLMEMLLLLMEMLB.", ".BMEMELLLLEMEMB."],
};

const MOUTHS = {
  flat:  [".BLLLLLLLLLLLLB.", ".BBLLLLNNLLLLBB."],
  smile: [".BLLLLNLLNLLLLB.", ".BBLLLLNNLLLLBB."],
  blush: [".BPLLLNLLNLLLPB.", ".BBLLLLNNLLLLBB."],
  frown: [".BLLLLLNNLLLLLB.", ".BBLLLNLLNLLLBB."],
};

const LOOKS = {
  asleep:    { eyes: "closed", mouth: "flat" },
  drowsy:    { eyes: "drowsy", mouth: "flat" },
  awake:     { eyes: "open", mouth: "smile" },
  unslothed: { eyes: "happy", mouth: "blush" },
  hungry:    { eyes: "drowsy", mouth: "frown" },
};

function spriteRows(state) {
  const look = LOOKS[state];
  return [
    "..DD........DD.G",
    "TTTTTTTTTTTTTTGG",
    "..BB........BB..",
    "..BBBBBBBBBBBB..",
    ".BBBBBBBBBBBBBB.",
    ".BLLLLLLLLLLLLB.",
    ...EYES[look.eyes],
    ".BMMLLLNNLLLMMB.",
    ...MOUTHS[look.mouth],
    "..BBBBBBBBBBBB..",
    "...BBBBBBBBBB...",
    "....DD....DD....",
  ];
}

// Draws a sprite: each row is an hstack of colour runs (keeps the node count low).
function sprite(rows, px) {
  return Widget.vstack(rows.map((row) => {
    const runs = [];
    for (const ch of row) {
      const last = runs[runs.length - 1];
      if (last && last.ch === ch) last.n++;
      else runs.push({ ch, n: 1 });
    }
    return Widget.hstack(runs.map((run) => {
      const cell = { type: "stack", direction: "horizontal", children: [], frame: { width: run.n * px, height: px } };
      if (PALETTE[run.ch]) cell.background = PALETTE[run.ch];
      return cell;
    }), { spacing: 0 });
  }), { spacing: 0 });
}

const INK = { light: "#2F4A2A", dark: "#D7EBCD" };
const DIM = { light: "#00000022", dark: "#FFFFFF22" };

function pet(state, px) {
  let overlay = null;
  if (state === "asleep") overlay = Widget.text("z Z", { font: px * 3, weight: "heavy", design: "monospaced", color: INK });
  if (state === "unslothed") overlay = Widget.text("✦", { font: px * 3, weight: "bold", color: "#E8B923" });
  if (state === "hungry") overlay = Widget.text("?", { font: px * 3, weight: "heavy", design: "monospaced", color: "#C0563F" });
  return Widget.zstack([sprite(spriteRows(state), px), overlay], { alignment: "topTrailing" });
}

// A pixel bar made of little squares.
function bar(value, color, segments = 10, size = 6) {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * segments);
  return Widget.hstack(Array.from({ length: segments }, (_, i) => ({
    type: "stack", direction: "horizontal", children: [],
    background: i < filled ? color : DIM,
    frame: { width: size, height: size },
  })), { spacing: 1 });
}

const mono = (text, props = {}) => Widget.text(text, { design: "monospaced", color: INK, ...props });

// ───────────────────────── Game state

const dayKey = () => new Date().toLocaleDateString("en-CA");
const FOOD_DECAY_PER_HOUR = 4;
const LEAF_FOOD = 25;

const MESSAGES = {
  asleep: "Out cold. Walk to wake it.",
  drowsy: "One eye open. Keep moving.",
  awake: "Awake. Mildly impressed.",
  unslothed: "Fully unslothed. Unprecedented.",
  hungry: "Hungry. Walk to earn leaves.",
};

const LABELS = { asleep: "ASLEEP", drowsy: "DROWSY", awake: "AWAKE", unslothed: "UNSLOTHED", hungry: "HUNGRY" };

function currentFood() {
  const food = Storage.get("food", { value: 70, at: Date.now() });
  const hours = (Date.now() - food.at) / 3_600_000;
  return Math.max(0, Math.min(100, food.value - hours * FOOD_DECAY_PER_HOUR));
}

function snapshot() {
  const today = dayKey();
  const health = Storage.get("health");
  const fresh = health?.day === today;
  const steps = fresh ? health.steps : 0;
  const exercise = fresh ? health.exercise : 0;
  const goal = Storage.get("goal", 8000);
  const awake = Math.min(1, steps / goal);
  const food = currentFood();

  const earned = Math.floor(steps / 1000) + Math.floor(exercise / 15);
  const spentRecord = Storage.get("spent");
  const spent = spentRecord?.day === today ? spentRecord.n : 0;
  const leaves = Math.max(0, earned - spent);

  let state;
  if (food < 20) state = "hungry";
  else if (awake < 0.25) state = "asleep";
  else if (awake < 0.6) state = "drowsy";
  else if (awake < 1) state = "awake";
  else state = "unslothed";

  return {
    name: Storage.get("name", "Gerald"),
    steps, exercise, goal, awake, food, leaves, state,
    canFeed: leaves > 0 && food < 100,
    synced: health?.time ?? null,
    hasData: !!health,
  };
}

// Give up on a Health call after `ms`. With `ms` null there is no timer of our own.
function withTimeout(promise, ms, label) {
  if (ms == null) return promise;
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not answer in time`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// The first Health read shows iOS's permission sheet, one data type at a time.
// Time spent waiting on that sheet is not counted against the script's limit,
// but our own setTimeout would still fire while the person reads it. So in the
// app, until a read has succeeded once, no timer of our own is used.
// Where no prompt can appear (background, Shortcuts), keep a tight budget.
function healthBudget() {
  const mode = Script.env.mode;
  if (mode === "background") return 4000; // 15 s in total
  if (mode === "shortcut") return 5000;   // 20 s in total
  if (!Storage.get("healthReady", false)) return null; // first time: permission sheet may be up
  return 10000;
}

async function syncHealth() {
  const budget = healthBudget();
  try {
    const available = await withTimeout(Health.available(), budget, "Health");
    if (!available) throw new Error("Health is not available on this device");

    // One type at a time, so iOS permission prompts do not trip over each other.
    const steps = await withTimeout(Health.summary("steps"), budget, "Step count");

    let exerciseTotal = 0;
    try {
      const exercise = await withTimeout(Health.summary("exerciseMinutes"), budget, "Exercise minutes");
      exerciseTotal = exercise.total ?? 0;
    } catch (error) {
      // Exercise is a bonus; steps alone are enough.
      console.warn(error.message);
    }

    Storage.set("health", {
      day: dayKey(),
      steps: Math.round(steps.total ?? 0),
      exercise: Math.round(exerciseTotal),
      time: Date.now(),
    });
    Storage.set("healthReady", true);
    Storage.remove("lastError");
    return true;
  } catch (error) {
    const hint = Script.env.mode === "app" ? "" : ` Open ${Script.name} in the app once to allow Health.`;
    Storage.set("lastError", `${error.message}.${Storage.get("healthReady", false) ? "" : hint}`);
    return false;
  }
}

// ───────────────────────── Actions

Script.action("feed", () => {
  const s = snapshot();
  if (!s.canFeed) return;
  Storage.set("food", { value: Math.min(100, s.food + LEAF_FOOD), at: Date.now() });
  const today = dayKey();
  const spent = Storage.get("spent");
  Storage.set("spent", { day: today, n: (spent?.day === today ? spent.n : 0) + 1 });
  Storage.set("fedTotal", Storage.get("fedTotal", 0) + 1);
});

Script.action("sync", async () => { await syncHealth(); });

Script.action("name", ({ value }) => {
  const name = String(value ?? "").trim().slice(0, 14);
  if (name) Storage.set("name", name);
});

Script.action("goal", ({ value }) => Storage.set("goal", value));

// ───────────────────────── Run, background

Script.run(async () => {
  await syncHealth();
  const s = snapshot();
  const error = Storage.get("lastError");
  if (error) return `Could not read Health: ${error}`;
  return `${s.name} is ${LABELS[s.state].toLowerCase()}. ${s.steps.toLocaleString()} steps, ${s.leaves} leaves to give. ${MESSAGES[s.state]}`;
});

Script.background(syncHealth);

// ───────────────────────── Widget

const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const JUNGLE = Widget.gradient([
  { light: "#DDEFD2", dark: "#1F2E1C" },
  { light: "#B5D9A5", dark: "#121C10" },
], { direction: "topToBottom" });

const feedButton = (font = "caption") => Widget.button(
  mono("FEED 🍃", { font, weight: "bold" }), "feed", null, { style: "bordered", color: "green" },
);

Script.widget(({ family }) => {
  const s = snapshot();

  if (family === "inline") return Widget.text(`${s.name}: ${LABELS[s.state]} · ${s.steps.toLocaleString()} steps`);

  if (family === "circular") {
    return Widget.progress(s.awake, { style: "ring", label: s.state === "asleep" ? "zZ" : `${Math.round(s.awake * 100)}` });
  }

  if (family === "rectangular") {
    return Widget.vstack([
      Widget.text(`${s.name.toUpperCase()} · ${LABELS[s.state]}`, { font: "headline", design: "monospaced", lineLimit: 1 }),
      Widget.progress(s.awake),
      Widget.text(`${s.steps.toLocaleString()} / ${s.goal.toLocaleString()} steps`, { font: "caption", design: "monospaced" }),
    ], { alignment: "leading", spacing: 2 });
  }

  const root = { spacing: 4, padding: 10, background: JUNGLE, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity" } };

  if (family === "small") {
    return {
      content: Widget.vstack([
        Widget.hstack([
          mono(s.name.toUpperCase(), { font: "caption2", weight: "bold", lineLimit: 1 }),
          Widget.spacer(),
          mono(`🍃${s.leaves}`, { font: "caption2", weight: "bold" }),
        ]),
        pet(s.state, 4),
        Widget.hstack([mono("AWK", { font: 9 }), bar(s.awake, "#E8B923", 10, 5)], { spacing: 4 }),
        Widget.hstack([mono("FOD", { font: 9 }), bar(s.food / 100, "#5E9E4E", 10, 5)], { spacing: 4 }),
        s.canFeed ? feedButton("caption2") : mono(s.hasData ? LABELS[s.state] : "OPEN TO SYNC", { font: "caption2", weight: "bold" }),
      ], root),
      refreshAfter: 30 * 60,
    };
  }

  const info = [
    Widget.hstack([
      mono(s.name.toUpperCase(), { font: "headline", weight: "bold", lineLimit: 1 }),
      Widget.spacer(),
      mono(`🍃 ${s.leaves}`, { font: "subheadline", weight: "bold" }),
    ]),
    mono(s.hasData ? MESSAGES[s.state] : `Open ${Script.name} once to sync Health.`, { font: "caption", lineLimit: 2 }),
    Widget.hstack([mono("AWAKE", { font: "caption2", frame: { width: 40, alignment: "leading" } }), bar(s.awake, "#E8B923")], { spacing: 4 }),
    Widget.hstack([mono("FOOD ", { font: "caption2", frame: { width: 40, alignment: "leading" } }), bar(s.food / 100, "#5E9E4E")], { spacing: 4 }),
  ];

  if (family === "medium") {
    return {
      content: Widget.hstack([
        pet(s.state, 6),
        Widget.vstack([
          ...info,
          Widget.hstack([
            s.canFeed ? feedButton() : null,
            Widget.spacer(),
            s.synced ? Widget.date(s.synced, { style: "relative", font: "caption2", design: "monospaced", color: INK }) : null,
          ], { spacing: 6 }),
        ], { alignment: "leading", spacing: 5 }),
      ], { ...root, spacing: 12, padding: 12 }),
      refreshAfter: 30 * 60,
    };
  }

  // large
  const stat = (label, value) => Widget.hstack([
    mono(label, { font: "caption" }), Widget.spacer(), mono(value, { font: "caption", weight: "bold" }),
  ]);

  return {
    content: Widget.vstack([
      pet(s.state, 9),
      ...info,
      Widget.divider(),
      stat("STEPS", `${s.steps.toLocaleString()} / ${s.goal.toLocaleString()}`),
      stat("EXERCISE", `${s.exercise} min`),
      stat("LEAVES FED", String(Storage.get("fedTotal", 0))),
      Widget.hstack([
        s.canFeed ? feedButton() : mono("1 leaf per 1,000 steps", { font: "caption2" }),
        Widget.spacer(),
        s.synced ? Widget.date(s.synced, { style: "relative", font: "caption2", design: "monospaced", color: INK }) : null,
      ]),
    ], { ...root, spacing: 6, padding: 16 }),
    refreshAfter: 30 * 60,
  };
});

// ───────────────────────── Mini-app

let syncedOnce = false;

Script.ui(async () => {
  if (!syncedOnce) {
    syncedOnce = true;
    // The first time, this may show iOS's Health permission sheet; waiting on it does not count against the limit.
    await syncHealth();
  }
  const s = snapshot();
  const error = Storage.get("lastError");

  return {
    title: s.name,
    content: Widget.vstack([
      Widget.vstack([pet(s.state, 12)], { padding: 20, background: JUNGLE, cornerRadius: 16, frame: { maxWidth: "infinity" } }),
      mono(LABELS[s.state], { font: "title2", weight: "heavy" }),
      mono(MESSAGES[s.state], { font: "subheadline" }),
      Widget.card([
        Widget.hstack([mono("AWAKE", { font: "caption", frame: { width: 50, alignment: "leading" } }), bar(s.awake, "#E8B923", 12, 12)], { spacing: 6 }),
        Widget.hstack([mono("FOOD", { font: "caption", frame: { width: 50, alignment: "leading" } }), bar(s.food / 100, "#5E9E4E", 12, 12)], { spacing: 6 }),
        mono(`${s.steps.toLocaleString()} steps · ${s.exercise} min exercise · 🍃 ${s.leaves} leaves`, { font: "caption" }),
      ], { title: "Today", symbol: "figure.walk", color: "green" }),
      Widget.hstack([
        Widget.button(`Feed a leaf (${s.leaves})`, "feed", null, { style: "prominent", color: "green" }),
        Widget.button("Sync Health", "sync", null, { style: "bordered" }),
      ], { spacing: 10 }),
      error ? Widget.text(`Health: ${error}`, { font: "caption", color: "red" }) : null,
      Widget.divider(),
      Widget.textField("Name your sloth", s.name, "name", null, { label: "Name" }),
      Widget.stepper(`Wake-up goal: ${s.goal.toLocaleString()} steps`, s.goal, "goal", null, { min: 2000, max: 20000, step: 1000 }),
      mono("Every 1,000 steps or 15 exercise minutes earns a leaf. Food drops a little every hour.", { font: "caption2", color: "secondary" }),
    ], { alignment: "leading", spacing: 14, padding: 20 }),
  };
});
