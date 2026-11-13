// @name        Mood Journal
// @description Log how you feel each day on a five-point scale with a note and tags. On-device AI pulls themes from your notes and writes a weekly reflection; a 12-week heatmap, weekday averages and tag counts show the patterns. Everything stays on the device.
// @widget      small, medium, large, circular
// @icon        face.smiling.fill
// @color       #8B5CF6
// @version     1.0.0
// @author      scriptwell
// @category    lifestyle

// How it works
// • Pick one of five moods, add an optional note and tags, and save. Entries are kept as one JSON file per
//   month in the script's Files folder; export them all from the History tab.
// • When Apple Intelligence is available, on-device AI extracts themes from your note and writes a short
//   weekly reflection. Without it, your own tags are used and the reflection is built from simple statistics.
// • The medium widget logs today's mood with one tap. The small widget shows today's mood, the large one the
//   12-week heatmap, and the Lock Screen circle shows this week's average.
// • No permissions and no network: nothing leaves the device.

// ───────────────────────── Constants

const MOODS = [
  { value: 1, label: "Rough", emoji: "😞", color: "#EF4444" },
  { value: 2, label: "Low", emoji: "😕", color: "#F97316" },
  { value: 3, label: "Okay", emoji: "😐", color: "#EAB308" },
  { value: 4, label: "Good", emoji: "🙂", color: "#22C55E" },
  { value: 5, label: "Great", emoji: "😄", color: "#0EA5E9" },
];
const moodInfo = (value) => MOODS[Math.max(1, Math.min(5, Math.round(value))) - 1];

const PRESET_TAGS = ["work", "family", "friends", "sleep", "exercise", "food", "health", "weather", "money", "rest"];
const WEEKS = 12;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const INDEX_DAYS = 400;
const MAX_NOTE = 600;

const PURPLE = "#8B5CF6";
const CARD = { light: "#FFFFFF", dark: "#1C1C1E" };
const PAGE = { light: "#F5F3FF", dark: "#0E0B16" };
const EMPTY = { light: "#E9E5F5", dark: "#2A2536" };

// ───────────────────────── Dates

const DAY = 86_400_000;
const isoDay = (date = new Date()) => date.toLocaleDateString("en-CA");
const noon = (day) => new Date(`${day}T12:00:00`);
function addDays(day, n) {
  const d = noon(day);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}
function mondayOf(day) {
  const d = noon(day);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDay(d);
}
const weekdayIndex = (day) => (noon(day).getDay() + 6) % 7; // 0 = Monday
const weekdayName = (day) => noon(day).toLocaleDateString(Script.env.locale, { weekday: "long" });
const shortDate = (day) => noon(day).toLocaleDateString(Script.env.locale, { day: "numeric", month: "short" });
const fmt = (n) => n.toLocaleString(Script.env.locale, { maximumFractionDigits: 1 });

// ───────────────────────── Data: a quick index in Storage, full entries in Files

const index = () => Storage.get("index", {});
const monthPath = (day) => `entries/${day.slice(0, 7)}.json`;

async function readMonth(day) {
  const path = monthPath(day);
  try {
    return (await Files.exists(path)) ? await Files.readJSON(path) : {};
  } catch {
    return {};
  }
}

async function readEntry(day) {
  return (await readMonth(day))[day] ?? null;
}

async function saveEntry(day, entry) {
  const month = await readMonth(day);
  month[day] = entry;
  await Files.writeJSON(monthPath(day), month);
  const cutoff = addDays(isoDay(), -INDEX_DAYS);
  const next = Object.fromEntries(Object.entries(index()).filter(([d]) => d >= cutoff));
  next[day] = entry.mood;
  Storage.set("index", next);
}

async function removeEntry(day) {
  const month = await readMonth(day);
  delete month[day];
  await Files.writeJSON(monthPath(day), month);
  const next = index();
  delete next[day];
  Storage.set("index", next);
}

// Entries from `from` to `to` (inclusive), newest first.
async function entriesBetween(from, to) {
  const months = new Set();
  for (let day = from; day <= to; day = addDays(day, 1)) months.add(monthPath(day));
  const out = [];
  for (const path of months) {
    let data = {};
    try { data = (await Files.exists(path)) ? await Files.readJSON(path) : {}; } catch { data = {}; }
    for (const [day, entry] of Object.entries(data)) if (day >= from && day <= to) out.push({ day, ...entry });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day));
}

function streak() {
  const idx = index();
  let day = isoDay();
  if (!idx[day]) day = addDays(day, -1);
  let count = 0;
  while (idx[day]) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}

function weekAverage(monday = mondayOf(isoDay())) {
  const idx = index();
  const values = Array.from({ length: 7 }, (_, i) => idx[addDays(monday, i)]).filter(Boolean);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// ───────────────────────── AI with fallbacks

async function aiReady() {
  try { return (await AI.availability()).available; } catch { return false; }
}

async function themesFor(note, tags) {
  if (!note.trim() || !(await aiReady())) return [];
  try {
    const result = await AI.extract(note, { themes: ["string: a one or two word theme, lower case"] });
    const seen = new Set(tags);
    return (result.themes ?? [])
      .map((t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim())
      .filter((t) => t && t.length <= 24 && !seen.has(t) && seen.add(t))
      .slice(0, 4);
  } catch (error) {
    console.warn("Theme extraction failed:", error.message);
    return [];
  }
}

function statsReflection(entries, lastWeekAverage) {
  if (entries.length === 0) return "Nothing logged this week yet. How are you today?";
  const average = entries.reduce((sum, e) => sum + e.mood, 0) / entries.length;
  const best = [...entries].sort((a, b) => b.mood - a.mood || a.day.localeCompare(b.day))[0];
  const worst = [...entries].sort((a, b) => a.mood - b.mood || a.day.localeCompare(b.day))[0];
  const parts = [`You logged ${entries.length} day${entries.length === 1 ? "" : "s"} this week, averaging ${fmt(average)} out of 5.`];
  parts.push(`Your best day was ${weekdayName(best.day)} (${moodInfo(best.mood).label.toLowerCase()})`);
  parts[1] += worst.day !== best.day ? `, your lowest ${weekdayName(worst.day)} (${moodInfo(worst.mood).label.toLowerCase()}).` : ".";
  if (lastWeekAverage !== null) {
    const delta = average - lastWeekAverage;
    parts.push(Math.abs(delta) < 0.15 ? "About the same as last week." : `${delta > 0 ? "Up" : "Down"} ${fmt(Math.abs(delta))} on last week.`);
  }
  return parts.join(" ");
}

async function reflectionFor(weekEntries) {
  const monday = mondayOf(isoDay());
  const key = `${monday}:${weekEntries.length}:${Math.max(0, ...weekEntries.map((e) => e.time ?? 0))}`;
  const cached = Storage.get("reflection");
  if (cached?.key === key) return cached;

  const lastWeek = weekAverage(addDays(monday, -7));
  let result = { key, text: statsReflection(weekEntries, lastWeek), source: "stats", time: Date.now() };
  if (weekEntries.length >= 2 && (await aiReady())) {
    try {
      const lines = [...weekEntries].reverse().map((e) =>
        `${weekdayName(e.day)}: mood ${e.mood}/5 (${moodInfo(e.mood).label})${e.note ? ` - ${e.note}` : ""}${e.tags?.length ? ` [${e.tags.join(", ")}]` : ""}`);
      const text = await AI.summarize(`A personal mood journal for this week, one line per day:\n${lines.join("\n")}`, { sentences: 2 });
      if (text?.trim()) result = { key, text: text.trim(), source: "ai", time: Date.now() };
    } catch (error) {
      console.warn("Reflection failed, using statistics:", error.message);
    }
  }
  Storage.set("reflection", result);
  return result;
}

// ───────────────────────── Draft and actions

const customTags = () => Storage.get("tags", []);
const allTags = () => [...PRESET_TAGS, ...customTags()];

function draft() {
  const d = Storage.get("draft");
  return d?.day === isoDay() ? d : { day: isoDay(), mood: null, note: "", tags: [], loaded: false };
}
const setDraft = (changes) => Storage.set("draft", { ...draft(), ...changes });

// Used by the widget buttons and the mini-app alike: one tap logs the mood for today.
Script.action("mood", async ({ value }) => {
  const day = isoDay();
  const existing = (await readEntry(day)) ?? { note: "", tags: [], themes: [] };
  await saveEntry(day, { ...existing, mood: value, time: Date.now() });
  setDraft({ mood: value, loaded: true, saved: true });
  if (Script.env.mode === "app") { try { await UI.haptic("light"); } catch { /* optional */ } }
});

Script.action("note", ({ value }) => setDraft({ note: String(value).slice(0, MAX_NOTE), saved: false }));

Script.action("tag", ({ tag, isOn }) => {
  const tags = new Set(draft().tags);
  if (isOn) tags.add(tag); else tags.delete(tag);
  setDraft({ tags: [...tags], saved: false });
});

Script.action("addTag", async () => {
  const text = await UI.prompt({ title: "New tag", placeholder: "travel" });
  const tag = String(text ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().slice(0, 20);
  if (!tag || allTags().includes(tag)) return;
  Storage.set("tags", [...customTags(), tag].slice(-20));
  setDraft({ tags: [...draft().tags, tag], saved: false });
});

Script.action("save", async () => {
  const d = draft();
  if (!d.mood) {
    await UI.alert({ title: "Pick a mood first", message: "Tap one of the five faces." });
    return;
  }
  const note = d.note.trim();
  const themes = await themesFor(note, d.tags);
  await saveEntry(d.day, { mood: d.mood, note, tags: d.tags, themes, time: Date.now() });
  setDraft({ saved: true, themes });
  try {
    await UI.haptic("success");
    await Sound.play("tink", { volume: 0.4 });
  } catch { /* optional */ }
});

Script.action("deleteToday", async () => {
  const choice = await UI.alert({ title: "Delete today's entry?", buttons: ["Cancel", "Delete"] });
  if (choice !== 1) return;
  await removeEntry(isoDay());
  Storage.remove("draft");
});

Script.action("refreshReflection", () => Storage.remove("reflection"));

Script.action("export", async () => {
  let names = [];
  try { names = (await Files.list("entries")).filter((f) => f.name.endsWith(".json")).map((f) => f.name); } catch { names = []; }
  const entries = [];
  for (const name of names.sort()) {
    try {
      const month = await Files.readJSON(`entries/${name}`);
      for (const [day, entry] of Object.entries(month)) entries.push({ date: day, ...entry });
    } catch { /* skip a damaged month */ }
  }
  await Files.writeJSON("exports/mood-journal.json", { exported: new Date().toISOString(), scale: "1 rough … 5 great", entries });
  await Files.export("exports/mood-journal.json", { name: `mood-journal-${isoDay()}.json` });
});

Script.action("deleteAll", async () => {
  const choice = await UI.alert({ title: "Delete every entry?", message: "Export first if you want to keep them. This cannot be undone.", buttons: ["Cancel", "Delete all"] });
  if (choice !== 1) return;
  let names = [];
  try { names = (await Files.list("entries")).map((f) => f.name); } catch { names = []; }
  for (const name of names) { try { await Files.remove(`entries/${name}`); } catch { /* already gone */ } }
  for (const key of ["index", "draft", "reflection"]) Storage.remove(key);
});

// ───────────────────────── Shared pieces

function moodButton(mood, selected, size, showLabel) {
  const on = selected === mood.value;
  const dimmed = selected !== null && !on;
  return Widget.button(Widget.vstack([
    Widget.text(mood.emoji, {
      font: size * 0.55, padding: size * 0.18,
      background: on ? mood.color : `${mood.color}${dimmed ? "22" : "40"}`,
      cornerRadius: size / 2, opacity: dimmed ? 0.6 : 1,
    }),
    showLabel ? Widget.text(mood.label, { font: "caption2", weight: on ? "bold" : "regular", color: on ? mood.color : "secondary" }) : null,
  ], { spacing: 3 }), "mood", { value: mood.value });
}

const moodRow = (selected, size, showLabel = false) =>
  Widget.hstack(MOODS.map((m) => moodButton(m, selected, size, showLabel)), { spacing: size > 40 ? 12 : 6 });

function heatmap(cell, gap, withLabels) {
  const idx = index();
  const today = isoDay();
  const firstMonday = addDays(mondayOf(today), -7 * (WEEKS - 1));
  const columns = Array.from({ length: WEEKS }, (_, w) => Widget.vstack(Array.from({ length: 7 }, (_, d) => {
    const day = addDays(firstMonday, w * 7 + d);
    const mood = idx[day];
    return {
      type: "stack", direction: "horizontal", children: [],
      frame: { width: cell, height: cell }, cornerRadius: Math.max(2, cell * 0.25),
      background: mood ? moodInfo(mood).color : day > today ? "#00000000" : EMPTY,
    };
  }), { spacing: gap }));
  const labels = withLabels ? Widget.vstack(DAY_LABELS.map((l) => Widget.text(l[0], { font: Math.max(8, cell * 0.6), color: "secondary", frame: { width: cell * 0.8, height: cell } })), { spacing: gap }) : null;
  return Widget.hstack([labels, ...columns], { spacing: gap, alignment: "top" });
}

const legend = () => Widget.hstack([
  Widget.text("Rough", { font: "caption2", color: "secondary" }),
  ...MOODS.map((m) => ({ type: "stack", direction: "horizontal", children: [], background: m.color, cornerRadius: 3, frame: { width: 10, height: 10 } })),
  Widget.text("Great", { font: "caption2", color: "secondary" }),
], { spacing: 4 });

// ───────────────────────── Widget

const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };

Script.widget(({ family }) => {
  const today = isoDay();
  const todayMood = index()[today] ?? null;
  const avg = weekAverage();
  const days = streak();
  const midnight = new Date();
  midnight.setHours(24, 0, 10, 0);
  let content;

  if (family === "circular") {
    content = avg === null
      ? Widget.vstack([Widget.symbol("face.smiling", { size: 20, fallback: "🙂" }), Widget.text("mood", { font: "caption2" })], { spacing: 1 })
      : Widget.progress(avg / 5, { style: "ring", label: fmt(avg) });
  } else if (family === "small") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.text(todayMood ? "TODAY" : "MOOD", { font: "caption2", weight: "bold", color: "secondary" }),
        Widget.spacer(),
        days ? Widget.text(`${days}🔥`, { font: "caption2", weight: "semibold", color: "secondary" }) : null,
      ]),
      Widget.spacer(),
      todayMood
        ? Widget.text(moodInfo(todayMood).emoji, { font: 54, padding: 10, background: `${moodInfo(todayMood).color}33`, cornerRadius: 40 })
        : Widget.symbol("face.dashed", { size: 48, color: PURPLE, fallback: "🙂" }),
      Widget.spacer(),
      Widget.text(todayMood ? moodInfo(todayMood).label : "How are you?", { font: "headline", color: todayMood ? moodInfo(todayMood).color : "primary" }),
      Widget.text(todayMood ? (avg !== null ? `week avg ${fmt(avg)}` : "") : "Tap to log today", { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { alignment: "center", spacing: 2, padding: 12, background: PAGE, url: appLink, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
  } else if (family === "medium") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.text(todayMood ? `Today: ${moodInfo(todayMood).label}` : "How are you today?", { font: "headline", color: todayMood ? moodInfo(todayMood).color : "primary" }),
        Widget.spacer(),
        Widget.text(noon(today).toLocaleDateString(Script.env.locale, { weekday: "short", day: "numeric" }), { font: "caption", color: "secondary" }),
      ]),
      Widget.spacer(),
      moodRow(todayMood, 44, true),
      Widget.spacer(),
      Widget.hstack([
        Widget.text(avg !== null ? `This week ${fmt(avg)} / 5` : "Nothing logged this week", { font: "caption2", color: "secondary" }),
        Widget.spacer(),
        Widget.text(days ? `${days}-day streak 🔥` : "Start a streak", { font: "caption2", color: "secondary" }),
      ]),
    ], { alignment: "center", spacing: 4, padding: 14, background: PAGE, frame: fill });
  } else {
    content = Widget.vstack([
      Widget.hstack([
        Widget.text(todayMood ? `Today: ${moodInfo(todayMood).label}` : "How are you today?", { font: "headline", color: todayMood ? moodInfo(todayMood).color : "primary" }),
        Widget.spacer(),
        Widget.text(days ? `${days}-day streak 🔥` : "", { font: "caption", color: "secondary" }),
      ]),
      moodRow(todayMood, 40, false),
      Widget.text(`Last ${WEEKS} weeks`, { font: "caption", weight: "semibold", color: "secondary" }),
      heatmap(16, 3, true),
      Widget.hstack([
        legend(),
        Widget.spacer(),
        Widget.text(avg !== null ? `week avg ${fmt(avg)}` : "", { font: "caption2", color: "secondary" }),
      ]),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 10, padding: 14, background: PAGE, url: appLink, frame: fill });
  }
  return { content, refreshAt: midnight };
});

// ───────────────────────── Mini-app

function todayTab(d, entry) {
  const selected = d.mood;
  const themes = entry?.themes ?? d.themes ?? [];
  const tagRows = [];
  const tags = allTags();
  for (let i = 0; i < tags.length; i += 3) tagRows.push(tags.slice(i, i + 3));
  return Widget.vstack([
    Widget.text(noon(d.day).toLocaleDateString(Script.env.locale, { weekday: "long", day: "numeric", month: "long" }), { font: "caption", weight: "semibold", color: "secondary" }),
    Widget.text(selected ? `Feeling ${moodInfo(selected).label.toLowerCase()}` : "How are you today?", { font: "title", weight: "bold", color: selected ? moodInfo(selected).color : "primary" }),
    moodRow(selected, 56, true),
    Widget.textField("What happened today? A few words are enough.", d.note, "note", null, { label: "Note", multiline: true }),
    Widget.text("Tags", { font: "caption", color: "secondary" }),
    ...tagRows.map((row) => Widget.hstack(row.map((tag) => Widget.toggle(tag, d.tags.includes(tag), "tag", { tag }, { style: "button", color: PURPLE })), { spacing: 6 })),
    Widget.button(Widget.label("Add a tag", "plus.circle"), "addTag", null, { style: "plain" }),
    Widget.button(entry ? "Save changes" : "Save today", "save", null, { style: "prominent", color: PURPLE }),
    entry ? Widget.vstack([
      Widget.hstack([
        Widget.symbol("checkmark.seal.fill", { size: 16, color: "green", fallback: "✅" }),
        Widget.text(`Logged ${new Date(entry.time).toLocaleTimeString(Script.env.locale, { hour: "2-digit", minute: "2-digit" })}`, { font: "subheadline", weight: "semibold" }),
        Widget.spacer(),
        Widget.button("Delete", "deleteToday", null, { style: "plain", color: "red" }),
      ], { spacing: 6 }),
      themes.length
        ? Widget.hstack([
            Widget.symbol("sparkles", { size: 12, color: PURPLE, fallback: "✨" }),
            Widget.text(`Themes: ${themes.join(", ")}`, { font: "caption", color: "secondary", lineLimit: 2 }),
          ], { spacing: 4 })
        : Widget.text(entry.note ? "Themes come from on-device AI when it is available; your tags are used otherwise." : "Add a note and themes are picked out for you.", { font: "caption2", color: "secondary" }),
    ], { alignment: "leading", spacing: 6, padding: 12, background: CARD, cornerRadius: 14 }) : null,
  ], { alignment: "leading", spacing: 14 });
}

function insightsTab(recent, reflection) {
  const idx = index();
  const byWeekday = Array.from({ length: 7 }, () => []);
  const cutoff = addDays(isoDay(), -7 * WEEKS);
  for (const [day, mood] of Object.entries(idx)) if (day >= cutoff) byWeekday[weekdayIndex(day)].push(mood);
  const chartData = byWeekday.map((values, i) => ({ x: DAY_LABELS[i], y: values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : 0 }));
  const logged = Object.keys(idx).filter((d) => d >= cutoff).length;
  const overall = logged ? Object.entries(idx).filter(([d]) => d >= cutoff).reduce((s, [, m]) => s + m, 0) / logged : null;
  const bestDay = chartData.filter((p) => p.y > 0).sort((a, b) => b.y - a.y)[0];

  const counts = {};
  for (const e of recent) for (const t of [...(e.tags ?? []), ...(e.themes ?? [])]) counts[t] = (counts[t] ?? 0) + 1;
  const topTags = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const stat = (title, value) => Widget.vstack([
    Widget.text(value, { font: "title3", weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
    Widget.text(title, { font: "caption2", color: "secondary" }),
  ], { spacing: 1, padding: 10, background: CARD, cornerRadius: 12, frame: { maxWidth: "infinity" } });

  return Widget.vstack([
    Widget.card([
      Widget.text(reflection.text, { font: "body" }),
      Widget.hstack([
        Widget.text(reflection.source === "ai" ? "Written by on-device AI from this week's notes" : "From this week's numbers", { font: "caption2", color: "secondary" }),
        Widget.spacer(),
        Widget.button("Refresh", "refreshReflection", null, { style: "plain" }),
      ]),
    ], { title: "This week", symbol: reflection.source === "ai" ? "sparkles" : "chart.bar.fill", color: PURPLE }),
    Widget.hstack([
      stat(`days of ${7 * WEEKS}`, String(logged)),
      stat("average", overall !== null ? fmt(overall) : "–"),
      stat("streak", `${streak()}🔥`),
    ], { spacing: 8 }),
    Widget.card([
      heatmap(20, 4, true),
      legend(),
    ], { title: `Last ${WEEKS} weeks`, symbol: "square.grid.3x3.fill", color: PURPLE }),
    Widget.card([
      Widget.chart(chartData, { kind: "bar", color: PURPLE, range: [0, 5], frame: { height: 180 } }),
      Widget.text(bestDay ? `${weekdayName(addDays(mondayOf(isoDay()), DAY_LABELS.indexOf(bestDay.x)))}s are your best days (${fmt(bestDay.y)}).` : "Log a few days to see a pattern.", { font: "caption", color: "secondary" }),
    ], { title: "Average by weekday", symbol: "calendar", color: PURPLE }),
    topTags.length
      ? Widget.list(topTags.map(([tag, n]) => ({ title: tag, symbol: "tag.fill", color: PURPLE, detail: `${n}×` })), { title: "Tags and themes" })
      : Widget.text("Tags and AI themes will be counted here.", { font: "footnote", color: "secondary" }),
  ], { alignment: "leading", spacing: 14 });
}

function historyTab(recent) {
  return Widget.vstack([
    recent.length
      ? Widget.list(recent.slice(0, 30).map((e) => ({
          title: `${moodInfo(e.mood).emoji}  ${moodInfo(e.mood).label}`,
          subtitle: e.note ? e.note.slice(0, 80) : (e.tags ?? []).join(", "),
          detail: shortDate(e.day),
        })), { title: `Last ${Math.min(recent.length, 30)} entries` })
      : Widget.text("No entries yet. Log today's mood on the first tab.", { color: "secondary" }),
    Widget.button(Widget.label("Export all entries as JSON", "square.and.arrow.up"), "export", null, { style: "bordered" }),
    Widget.text("Entries are plain JSON files in this script's Files folder, one per month.", { font: "caption2", color: "secondary" }),
    Widget.hstack([
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [
        { title: "Delete all entries", symbol: "trash", action: "deleteAll", destructive: true },
      ]),
    ]),
  ], { alignment: "leading", spacing: 14 });
}

Script.ui(async () => {
  const today = isoDay();
  let d = draft();
  const entry = await readEntry(today);
  if (!d.loaded) {
    d = { day: today, mood: entry?.mood ?? null, note: entry?.note ?? "", tags: entry?.tags ?? [], themes: entry?.themes ?? [], loaded: true, saved: Boolean(entry) };
    Storage.set("draft", d);
  }
  const recent = await entriesBetween(addDays(today, -7 * WEEKS), today);
  const monday = mondayOf(today);
  const reflection = await reflectionFor(recent.filter((e) => e.day >= monday));

  return {
    title: "Mood Journal",
    content: Widget.vstack([
      Widget.tabs([
        { title: "Today", symbol: "face.smiling.fill", content: todayTab(d, entry) },
        { title: "Insights", symbol: "chart.bar.xaxis", content: insightsTab(recent, reflection) },
        { title: "History", symbol: "clock.arrow.circlepath", content: historyTab(recent) },
      ], { selected: 0 }),
    ], { padding: 16, background: PAGE }),
  };
});

// ───────────────────────── Siri and Shortcuts

Script.run(async (input) => {
  const value = Number(String(input ?? "").trim());
  if (value >= 1 && value <= 5) {
    const day = isoDay();
    const existing = (await readEntry(day)) ?? { note: "", tags: [], themes: [] };
    await saveEntry(day, { ...existing, mood: value, time: Date.now() });
    Storage.remove("draft");
    return `Logged ${moodInfo(value).label.toLowerCase()} for today.`;
  }
  const todayMood = index()[isoDay()];
  const avg = weekAverage();
  return `${todayMood ? `Today you felt ${moodInfo(todayMood).label.toLowerCase()}.` : "No mood logged today."} ${avg !== null ? `This week averages ${fmt(avg)} out of 5.` : ""} ${streak()} day streak. Pass a number from 1 to 5 to log a mood.`.trim();
});
