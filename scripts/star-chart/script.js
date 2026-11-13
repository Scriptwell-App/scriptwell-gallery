// @name        Star Chart
// @description A chore chart for children: tick today's chores from the widget, collect stars towards a reward, and manage children, chores and rewards in a parent area behind a PIN. Nothing leaves the device.
// @widget      medium, large
// @icon        star.circle.fill
// @color       #F59E0B
// @version     1.0.0
// @author      va4w
// @category    kids

// How it works
// • Open the mini-app once: choose a 4-digit parent PIN, then add your children, their chores and a reward.
// • Every chore done today earns a star. Stars pile up towards the reward until the child redeems it.
// • The widget shows one child's chores for today as switches. Set the widget Parameter to the child's
//   name; without one it shows the first child.
// • The chore grid starts again every Monday. Finished weeks are kept as a history in the parent area.
// • The PIN is kept only as a salted SHA-256 hash in the script's storage. No network, no permissions.

// ───────────────────────── Constants

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_INDEX = [1, 2, 3, 4, 5, 6, 0]; // getDay() numbers, Monday first
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const EMOJIS = ["🦊", "🐼", "🦄", "🐸", "🐯", "🐙", "🦖", "🐨", "🦋", "🐧", "🚀", "🌈"];
const PALETTE = ["#F97316", "#EC4899", "#8B5CF6", "#0EA5E9", "#22C55E", "#F59E0B"];
const CHORE_IDEAS = ["Make the bed", "Brush teeth", "Tidy toys", "Feed the pet", "Homework", "Set the table", "Read 20 minutes"];
const MAX_HISTORY_WEEKS = 12;
const PARENT_MINUTES = 5;
const STAR = "★";

const CARD = { light: "#FFFFFF", dark: "#1C1C1E" };
const PAGE = { light: "#FFF7ED", dark: "#0F0E0D" };
const DIM = { light: "#E7E5E4", dark: "#2C2A28" };

// ───────────────────────── Dates

const isoDay = (date = new Date()) => date.toLocaleDateString("en-CA");
const noon = (day) => new Date(`${day}T12:00:00`);

function mondayOf(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function weekDays(monday) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return isoDay(d);
  });
}

const prettyDate = (day) => noon(day).toLocaleDateString(Script.env.locale, { day: "numeric", month: "short" });

// ───────────────────────── Data

const kids = () => Storage.get("kids", []);
const saveKids = (list) => Storage.set("kids", list);
const kidById = (id) => kids().find((k) => k.id === id) ?? null;
const updateKid = (id, changes) => saveKids(kids().map((k) => (k.id === id ? { ...k, ...changes } : k)));

const doneMap = (kidId) => Storage.get(`done:${kidId}`, {});
const stars = (kidId) => Storage.get(`stars:${kidId}`, 0);
const target = (kid) => Math.max(1, kid.reward?.stars ?? 20);
const ui = () => Storage.get("ui", { page: "kid" });
const setUi = (changes) => Storage.set("ui", { ...ui(), ...changes });

const isScheduled = (chore, day) => (chore.days ?? EVERY_DAY).includes(noon(day).getDay());
const choresFor = (kid, day) => (kid.chores ?? []).filter((c) => isScheduled(c, day));
const doneToday = (kid, day) => new Set(doneMap(kid.id)[day] ?? []);

function daysText(days) {
  if (!days || days.length === 7) return "Every day";
  if (days.length === 0) return "Never";
  return DAY_INDEX.filter((d) => days.includes(d)).map((d) => DAY_LABELS[DAY_INDEX.indexOf(d)]).join(" ");
}

// Which child a widget shows: the Parameter names one, otherwise the first.
function pickKid(parameter) {
  const list = kids();
  const wanted = (parameter ?? "").trim().toLowerCase();
  return list.find((k) => k.name.toLowerCase() === wanted) ?? list.find((k) => k.name.toLowerCase().startsWith(wanted) && wanted) ?? list[0] ?? null;
}

// Monday reset: days before this week move out of the live grid and into the history.
function rollover(kid) {
  const thisMonday = isoDay(mondayOf(new Date()));
  const map = doneMap(kid.id);
  const old = Object.keys(map).filter((day) => day < thisMonday);
  if (old.length === 0) return;

  const weeks = {};
  for (const day of old) {
    const start = isoDay(mondayOf(noon(day)));
    weeks[start] ??= { start, done: 0, possible: 0 };
    weeks[start].done += map[day].length;
    delete map[day];
  }
  for (const week of Object.values(weeks)) {
    week.possible = weekDays(noon(week.start)).reduce((sum, day) => sum + choresFor(kid, day).length, 0);
  }

  const history = [...Storage.get(`history:${kid.id}`, []).filter((w) => !weeks[w.start]), ...Object.values(weeks)]
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(-MAX_HISTORY_WEEKS);
  Storage.set(`history:${kid.id}`, history);
  Storage.set(`done:${kid.id}`, map);
}

function newKid(name) {
  const used = kids().length;
  return {
    id: crypto.randomUUID(),
    name,
    emoji: EMOJIS[used % EMOJIS.length],
    color: PALETTE[used % PALETTE.length],
    reward: { name: "A treat", stars: 20 },
    chores: CHORE_IDEAS.slice(0, 3).map((title) => ({ id: crypto.randomUUID(), title, days: EVERY_DAY })),
  };
}

// ───────────────────────── Parent PIN

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hashPin(pin) {
  let salt = Storage.get("pinSalt");
  if (!salt) {
    salt = crypto.randomUUID();
    Storage.set("pinSalt", salt);
  }
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${pin}`)));
}

async function askPin(title, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await UI.prompt({ title, message, placeholder: "4 digits", secure: true });
    if (text === null) return null;
    if (/^\d{4}$/.test(text.trim())) return text.trim();
    await UI.alert({ title: "Four digits, please", message: "The PIN is exactly four numbers." });
  }
  return null;
}

async function choosePin(title) {
  const first = await askPin(title, "Choose four digits only a grown-up knows.");
  if (first === null) return false;
  const second = await askPin("Type it again", "Just to be sure.");
  if (second === null) return false;
  if (first !== second) {
    await UI.alert({ title: "They did not match", message: "Try again from the parent button." });
    return false;
  }
  Storage.set("pinHash", await hashPin(first));
  return true;
}

async function unlockParent() {
  if (Storage.get("parentUntil", 0) > Date.now()) return true;
  if (!Storage.get("pinHash")) {
    if (!(await choosePin("Set a parent PIN"))) return false;
  } else {
    const pin = await askPin("Parent PIN", "Grown-ups only.");
    if (pin === null) return false;
    if ((await hashPin(pin)) !== Storage.get("pinHash")) {
      await UI.haptic("error");
      await UI.alert({ title: "Wrong PIN", message: "That is not the parent PIN." });
      return false;
    }
  }
  Storage.set("parentUntil", Date.now() + PARENT_MINUTES * 60_000);
  return true;
}

const inApp = () => Script.env.mode === "app";

// ───────────────────────── Actions: chores and stars

Script.action("tick", async ({ kidId, choreId, isOn }) => {
  const kid = kidById(kidId);
  if (!kid) return;
  rollover(kid);
  const day = isoDay();
  const map = doneMap(kidId);
  const done = new Set(map[day] ?? []);
  const was = done.has(choreId);
  const on = typeof isOn === "boolean" ? isOn : !was;
  if (on === was) return;

  if (on) done.add(choreId); else done.delete(choreId);
  map[day] = [...done];
  Storage.set(`done:${kidId}`, map);
  Storage.set(`stars:${kidId}`, Math.max(0, stars(kidId) + (on ? 1 : -1)));
  Storage.set(`total:${kidId}`, Math.max(0, Storage.get(`total:${kidId}`, 0) + (on ? 1 : -1)));

  if (inApp() && on) {
    const allDone = choresFor(kid, day).every((c) => done.has(c.id));
    try {
      await UI.haptic(allDone ? "success" : "light");
      await Sound.play(allDone ? "success" : "pop", { volume: 0.6 });
    } catch { /* sound is optional */ }
  }
});

Script.action("redeem", async ({ kidId }) => {
  const kid = kidById(kidId);
  if (!kid || stars(kidId) < target(kid)) return;
  const choice = await UI.alert({
    title: `Redeem ${kid.reward.name}?`,
    message: `${kid.name} will spend ${target(kid)} stars.`,
    buttons: ["Not yet", "Redeem"],
  });
  if (choice !== 1) return;
  Storage.set(`stars:${kidId}`, stars(kidId) - target(kid));
  Storage.set(`redeemed:${kidId}`, [{ name: kid.reward.name, stars: target(kid), at: isoDay() }, ...Storage.get(`redeemed:${kidId}`, [])].slice(0, 20));
  try {
    await Sound.play("chime");
    await UI.haptic("success");
  } catch { /* optional */ }
});

Script.action("pickKid", ({ value }) => setUi({ kidId: value }));

// ───────────────────────── Actions: parent area

Script.action("parent", async () => {
  if (await unlockParent()) setUi({ page: "parent", editKidId: ui().editKidId ?? kids()[0]?.id ?? null });
});

Script.action("leaveParent", () => {
  Storage.remove("parentUntil");
  setUi({ page: "kid", editChoreId: null });
});

Script.action("changePin", async () => {
  if (await choosePin("New parent PIN")) await UI.alert("The PIN was changed.");
});

Script.action("addKid", async () => {
  const name = await UI.prompt({ title: "Child's name", placeholder: "Mia" });
  if (!name?.trim()) return;
  const kid = newKid(name.trim().slice(0, 20));
  saveKids([...kids(), kid]);
  setUi({ editKidId: kid.id, kidId: ui().kidId ?? kid.id });
});

Script.action("editKid", ({ value }) => setUi({ editKidId: value, editChoreId: null }));
Script.action("kidField", ({ kidId, field, value }) => updateKid(kidId, { [field]: String(value).trim().slice(0, 30) }));
Script.action("kidEmoji", ({ kidId, emoji }) => updateKid(kidId, { emoji }));
Script.action("kidColor", ({ kidId, value }) => updateKid(kidId, { color: value }));
Script.action("rewardName", ({ kidId, value }) => updateKid(kidId, { reward: { ...kidById(kidId).reward, name: String(value).trim().slice(0, 30) || "A treat" } }));
Script.action("rewardStars", ({ kidId, value }) => updateKid(kidId, { reward: { ...kidById(kidId).reward, stars: value } }));

Script.action("removeKid", async ({ kidId }) => {
  const kid = kidById(kidId);
  const choice = await UI.alert({ title: `Remove ${kid.name}?`, message: "Their chores, stars and history are deleted. This cannot be undone.", buttons: ["Cancel", "Remove"] });
  if (choice !== 1) return;
  saveKids(kids().filter((k) => k.id !== kidId));
  for (const key of ["done", "stars", "total", "history", "redeemed"]) Storage.remove(`${key}:${kidId}`);
  const next = kids()[0]?.id ?? null;
  setUi({ editKidId: next, kidId: next, editChoreId: null });
});

Script.action("resetStars", async ({ kidId }) => {
  const choice = await UI.alert({ title: "Set stars back to zero?", buttons: ["Cancel", "Reset"] });
  if (choice === 1) Storage.set(`stars:${kidId}`, 0);
});

Script.action("addChore", async ({ kidId }) => {
  const kid = kidById(kidId);
  const title = await UI.prompt({ title: "New chore", placeholder: CHORE_IDEAS[(kid.chores?.length ?? 0) % CHORE_IDEAS.length] });
  if (!title?.trim()) return;
  const chore = { id: crypto.randomUUID(), title: title.trim().slice(0, 40), days: EVERY_DAY };
  updateKid(kidId, { chores: [...(kid.chores ?? []), chore] });
  setUi({ editChoreId: chore.id });
});

Script.action("renameChore", async ({ kidId, choreId }) => {
  const kid = kidById(kidId);
  const chore = kid.chores.find((c) => c.id === choreId);
  const title = await UI.prompt({ title: "Rename chore", defaultValue: chore.title });
  if (!title?.trim()) return;
  updateKid(kidId, { chores: kid.chores.map((c) => (c.id === choreId ? { ...c, title: title.trim().slice(0, 40) } : c)) });
});

Script.action("removeChore", ({ kidId, choreId }) => {
  const kid = kidById(kidId);
  updateKid(kidId, { chores: kid.chores.filter((c) => c.id !== choreId) });
  if (ui().editChoreId === choreId) setUi({ editChoreId: null });
});

Script.action("editChore", ({ choreId }) => setUi({ editChoreId: ui().editChoreId === choreId ? null : choreId }));

Script.action("choreDays", ({ kidId, choreId, value }) => {
  const kid = kidById(kidId);
  updateKid(kidId, { chores: kid.chores.map((c) => (c.id === choreId ? { ...c, days: value } : c)) });
});

// ───────────────────────── Shared pieces

const avatar = (kid, size) => Widget.text(kid.emoji, {
  font: size * 0.55, padding: size * 0.2, background: `${kid.color}33`, cornerRadius: size / 2,
});

function meter(kid, { compact = false } = {}) {
  const have = stars(kid.id);
  const need = target(kid);
  return Widget.vstack([
    Widget.hstack([
      Widget.text(`${Math.min(have, need)} / ${need} ${STAR}`, { font: compact ? "caption" : "subheadline", weight: "bold", color: kid.color, lineLimit: 1 }),
      Widget.spacer(),
      Widget.text(have >= need ? `${kid.reward.name} earned!` : kid.reward.name, { font: compact ? "caption2" : "caption", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
    ]),
    Widget.progress(Math.min(1, have / need), { color: kid.color }),
  ], { alignment: "leading", spacing: 3 });
}

function weekStrip(kid, size) {
  const days = weekDays(mondayOf(new Date()));
  const map = doneMap(kid.id);
  const today = isoDay();
  return Widget.hstack(days.map((day, i) => {
    const possible = choresFor(kid, day).length;
    const done = (map[day] ?? []).filter((id) => kid.chores.some((c) => c.id === id)).length;
    const full = possible > 0 && done >= possible;
    const future = day > today;
    return Widget.vstack([
      Widget.text(DAY_LABELS[i][0], { font: "caption2", weight: day === today ? "bold" : "regular", color: day === today ? kid.color : "secondary" }),
      Widget.text(future || possible === 0 ? "·" : `${done}`, {
        font: size * 0.45, weight: "bold", design: "rounded",
        color: full ? "white" : future ? "secondary" : "primary",
        background: full ? kid.color : done > 0 ? `${kid.color}33` : DIM,
        cornerRadius: size / 2, frame: { width: size, height: size },
      }),
    ], { spacing: 2, frame: { maxWidth: "infinity" } });
  }), { spacing: 2 });
}

// ───────────────────────── Widget

const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

Script.widget(({ family, parameter }) => {
  const kid = pickKid(parameter);
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  if (!kid) {
    return Widget.vstack([
      Widget.symbol("star.circle.fill", { size: 30, color: "orange", fallback: "⭐️" }),
      Widget.text("Open Star Chart and add a child", { font: "caption", color: "secondary", align: "center" }),
    ], { spacing: 8, url: appLink, background: PAGE, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
  }

  rollover(kid);
  const day = isoDay();
  const chores = choresFor(kid, day);
  const done = doneToday(kid, day);
  const left = chores.filter((c) => !done.has(c.id)).length;
  const rows = chores.slice(0, family === "large" ? 7 : 3).map((chore) =>
    Widget.toggle(chore.title, done.has(chore.id), "tick", { kidId: kid.id, choreId: chore.id }, { color: kid.color }));

  const header = Widget.hstack([
    avatar(kid, 34),
    Widget.vstack([
      Widget.text(kid.name, { font: "headline", lineLimit: 1 }),
      Widget.text(chores.length === 0 ? "Nothing to do today" : left === 0 ? "All done today!" : `${left} to go today`, { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 0 }),
    Widget.spacer(),
    Widget.hstack([
      Widget.symbol("star.fill", { size: 14, color: kid.color, fallback: STAR }),
      Widget.text(stars(kid.id), { font: "title3", weight: "bold", design: "rounded", color: kid.color }),
    ], { spacing: 3 }),
  ], { spacing: 8 });

  const content = Widget.vstack([
    header,
    meter(kid, { compact: true }),
    ...rows,
    chores.length > rows.length ? Widget.text(`+ ${chores.length - rows.length} more in the app`, { font: "caption2", color: "secondary" }) : null,
    Widget.spacer(),
    family === "large" ? weekStrip(kid, 26) : null,
  ], { alignment: "leading", spacing: family === "large" ? 8 : 5, padding: 14, background: PAGE, url: appLink, frame: fill });

  const midnight = new Date();
  midnight.setHours(24, 0, 10, 0);
  return { content, refreshAt: midnight };
});

// ───────────────────────── Mini-app: kid view

function choreButton(kid, chore, isDone) {
  return Widget.button(Widget.hstack([
    Widget.symbol(isDone ? "checkmark.circle.fill" : "circle", { size: 30, color: isDone ? kid.color : "secondary", fallback: isDone ? "✅" : "⚪️" }),
    Widget.text(chore.title, { font: "title3", weight: "semibold", color: isDone ? "secondary" : "primary", lineLimit: 2 }),
    Widget.spacer(),
    Widget.text(isDone ? `+1 ${STAR}` : "", { font: "headline", color: kid.color }),
  ], { spacing: 12, padding: 14, background: CARD, cornerRadius: 16, frame: { maxWidth: "infinity", alignment: "leading" } }), "tick", { kidId: kid.id, choreId: chore.id });
}

function weekGrid(kid) {
  const days = weekDays(mondayOf(new Date()));
  const map = doneMap(kid.id);
  const today = isoDay();
  const cell = (chore, day) => {
    const scheduled = isScheduled(chore, day);
    const isDone = (map[day] ?? []).includes(chore.id);
    return {
      type: "stack", direction: "horizontal", children: [],
      frame: { width: 24, height: 24 }, cornerRadius: 7,
      background: isDone ? kid.color : scheduled ? DIM : "#00000000",
      opacity: !scheduled ? 1 : day > today && !isDone ? 0.45 : 1,
    };
  };
  return Widget.vstack([
    Widget.hstack([
      Widget.text("", { frame: { width: 90 } }),
      ...days.map((day, i) => Widget.text(DAY_LABELS[i][0], { font: "caption2", weight: "bold", color: day === today ? kid.color : "secondary", frame: { width: 24 }, align: "center" })),
    ], { spacing: 4 }),
    ...kid.chores.map((chore) => Widget.hstack([
      Widget.text(chore.title, { font: "caption", lineLimit: 1, minimumScale: 0.7, frame: { width: 90, alignment: "leading" } }),
      ...days.map((day) => cell(chore, day)),
    ], { spacing: 4 })),
  ], { alignment: "leading", spacing: 6 });
}

function kidView() {
  const list = kids();
  const state = ui();
  const kid = kidById(state.kidId) ?? list[0];
  if (!kid) {
    return Widget.vstack([
      Widget.text("⭐️", { font: 72 }),
      Widget.text("Welcome to Star Chart", { font: "title", weight: "bold" }),
      Widget.text("A grown-up adds children, chores and a reward in the parent area.", { color: "secondary", align: "center" }),
      Widget.button("Open the parent area", "parent", null, { style: "prominent", color: "orange" }),
    ], { spacing: 14, padding: 24 });
  }
  rollover(kid);
  const day = isoDay();
  const chores = choresFor(kid, day);
  const done = doneToday(kid, day);
  const have = stars(kid.id);
  const need = target(kid);
  const ready = have >= need;

  return Widget.vstack([
    list.length > 1 ? Widget.picker(list.map((k) => ({ label: `${k.emoji} ${k.name}`, value: k.id })), kid.id, "pickKid", null, { style: "segmented" }) : null,
    Widget.vstack([
      Widget.hstack([
        avatar(kid, 72),
        Widget.vstack([
          Widget.text(`Hi ${kid.name}!`, { font: "title", weight: "bold", lineLimit: 1, minimumScale: 0.6 }),
          Widget.text(`${have} star${have === 1 ? "" : "s"} saved`, { font: "headline", color: kid.color }),
          Widget.text(`${Storage.get(`total:${kid.id}`, 0).toLocaleString(Script.env.locale)} chores done ever`, { font: "caption", color: "secondary" }),
        ], { alignment: "leading", spacing: 2 }),
        Widget.spacer(),
        Widget.progress(Math.min(1, have / need), { style: "ring", color: kid.color, label: `${Math.min(have, need)}/${need}` }),
      ], { spacing: 14 }),
      ready
        ? Widget.button(`🎁 Redeem ${kid.reward.name}`, "redeem", { kidId: kid.id }, { style: "prominent", color: kid.color })
        : Widget.text(`${need - have} more ${STAR} for ${kid.reward.name}`, { font: "subheadline", weight: "medium", color: "secondary" }),
    ], { alignment: "leading", spacing: 12, padding: 16, background: CARD, cornerRadius: 20 }),

    Widget.text(chores.length ? "Today's chores" : "No chores today. Enjoy!", { font: "title3", weight: "bold" }),
    ...chores.map((chore) => choreButton(kid, chore, done.has(chore.id))),
    chores.length && chores.every((c) => done.has(c.id)) ? Widget.text("🎉 All done today!", { font: "headline", color: kid.color, align: "center", frame: { maxWidth: "infinity" } }) : null,

    kid.chores.length ? Widget.card([weekGrid(kid)], { title: "This week", subtitle: `from ${prettyDate(weekDays(mondayOf(new Date()))[0])}`, symbol: "calendar", color: kid.color }) : null,

    Widget.hstack([
      Widget.spacer(),
      Widget.button(Widget.label("Parent area", "lock.fill", { color: "secondary" }), "parent", null, { style: "plain" }),
    ]),
  ], { alignment: "leading", spacing: 14, padding: 16, background: PAGE });
}

// ───────────────────────── Mini-app: parent view

function choreEditor(kid, chore, editing) {
  return Widget.vstack([
    Widget.hstack([
      Widget.button(Widget.hstack([
        Widget.symbol(editing ? "chevron.down" : "chevron.right", { size: 12, color: "secondary", fallback: "›" }),
        Widget.vstack([
          Widget.text(chore.title, { font: "subheadline", weight: "medium", lineLimit: 1 }),
          Widget.text(daysText(chore.days), { font: "caption2", color: "secondary" }),
        ], { alignment: "leading", spacing: 1 }),
      ], { spacing: 8 }), "editChore", { choreId: chore.id }),
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [
        { title: "Rename", symbol: "pencil", action: "renameChore", args: { kidId: kid.id, choreId: chore.id } },
        { title: "Remove", symbol: "trash", action: "removeChore", args: { kidId: kid.id, choreId: chore.id }, destructive: true },
      ]),
    ]),
    editing ? Widget.checklist(DAY_LABELS.map((label, i) => ({ label, value: DAY_INDEX[i] })), chore.days ?? EVERY_DAY, "choreDays", { kidId: kid.id, choreId: chore.id }, { label: "Days" }) : null,
  ], { alignment: "leading", spacing: 8, padding: 12, background: CARD, cornerRadius: 12 });
}

function kidEditor(kid) {
  const state = ui();
  const history = Storage.get(`history:${kid.id}`, []).slice().reverse();
  const redeemed = Storage.get(`redeemed:${kid.id}`, []);
  return Widget.vstack([
    Widget.textField("Name", kid.name, "kidField", { kidId: kid.id, field: "name" }, { label: "Name" }),
    Widget.text("Avatar", { font: "caption", color: "secondary" }),
    ...[0, 6].map((start) => Widget.hstack(EMOJIS.slice(start, start + 6).map((emoji) =>
      Widget.button(Widget.text(emoji, { font: 26, padding: 6, background: emoji === kid.emoji ? `${kid.color}55` : CARD, cornerRadius: 10 }), "kidEmoji", { kidId: kid.id, emoji })), { spacing: 6 })),
    Widget.colorPicker(kid.color, "kidColor", { kidId: kid.id }, { label: "Colour" }),
    Widget.divider(),
    Widget.textField("Reward", kid.reward.name, "rewardName", { kidId: kid.id }, { label: "Reward" }),
    Widget.stepper(`Stars needed: ${target(kid)}`, target(kid), "rewardStars", { kidId: kid.id }, { min: 5, max: 100 }),
    Widget.hstack([
      Widget.text(`${stars(kid.id)} ${STAR} saved so far`, { font: "footnote", color: "secondary" }),
      Widget.spacer(),
      Widget.button("Reset stars", "resetStars", { kidId: kid.id }, { style: "plain", color: "red" }),
    ]),
    Widget.divider(),
    Widget.hstack([
      Widget.text("Chores", { font: "headline" }),
      Widget.spacer(),
      Widget.button("Add chore", "addChore", { kidId: kid.id }, { style: "bordered" }),
    ]),
    ...(kid.chores ?? []).map((chore) => choreEditor(kid, chore, state.editChoreId === chore.id)),
    kid.chores?.length ? null : Widget.text("No chores yet.", { font: "footnote", color: "secondary" }),
    history.length ? Widget.list(history.slice(0, 8).map((w) => ({
      title: `Week of ${prettyDate(w.start)}`,
      subtitle: w.possible ? `${Math.round((w.done / w.possible) * 100)}% done` : "",
      symbol: "star.fill", color: kid.color,
      detail: `${w.done} / ${w.possible} ${STAR}`,
    })), { title: "Past weeks" }) : null,
    redeemed.length ? Widget.list(redeemed.slice(0, 5).map((r) => ({ title: r.name, subtitle: prettyDate(r.at), symbol: "gift.fill", color: "pink", detail: `${r.stars} ${STAR}` })), { title: "Rewards redeemed" }) : null,
    Widget.button(`Remove ${kid.name}`, "removeKid", { kidId: kid.id }, { style: "bordered", color: "red" }),
  ], { alignment: "leading", spacing: 12 });
}

function parentView() {
  const list = kids();
  const state = ui();
  const editing = kidById(state.editKidId) ?? list[0] ?? null;
  return Widget.vstack([
    Widget.hstack([
      Widget.button(Widget.label("Done", "chevron.left"), "leaveParent", null, { style: "plain" }),
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [
        { title: "Change PIN", symbol: "lock.rotation", action: "changePin" },
        { title: "Add child", symbol: "person.badge.plus", action: "addKid" },
      ]),
    ]),
    Widget.text("Parent area", { font: "largeTitle", weight: "bold" }),
    Widget.text(`Unlocked for ${PARENT_MINUTES} minutes. Changes save as you go.`, { font: "footnote", color: "secondary" }),
    list.length
      ? Widget.picker(list.map((k) => ({ label: `${k.emoji} ${k.name}`, value: k.id })), editing?.id, "editKid", null, { style: list.length <= 3 ? "segmented" : "menu", label: "Child" })
      : null,
    editing ? kidEditor(editing) : Widget.vstack([
      Widget.text("No children yet.", { color: "secondary" }),
      Widget.button("Add a child", "addKid", null, { style: "prominent", color: "orange" }),
    ], { spacing: 12 }),
    list.length ? Widget.button("Add another child", "addKid", null, { style: "bordered" }) : null,
  ], { alignment: "leading", spacing: 14, padding: 16, background: PAGE });
}

Script.ui(() => {
  const state = ui();
  const parent = state.page === "parent" && Storage.get("parentUntil", 0) > Date.now();
  if (state.page === "parent" && !parent) setUi({ page: "kid" });
  return { title: parent ? "Star Chart · Parents" : "Star Chart", content: parent ? parentView() : kidView() };
});

// ───────────────────────── Siri and Shortcuts

Script.run(() => {
  const list = kids();
  if (!list.length) return "No children yet. Open Star Chart to add one.";
  const day = isoDay();
  return list.map((kid) => {
    rollover(kid);
    const chores = choresFor(kid, day);
    const left = chores.filter((c) => !doneToday(kid, day).has(c.id)).length;
    return `${kid.name}: ${stars(kid.id)} of ${target(kid)} stars for ${kid.reward.name}, ${left === 0 ? "all chores done today" : `${left} chore${left === 1 ? "" : "s"} left today`}.`;
  }).join("\n");
});
