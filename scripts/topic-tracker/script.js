// @name        Topic Tracker
// @description Follows up to five news topics through the GDELT project (api.gdeltproject.org): 30 days of coverage volume, a week-on-week trend, the latest headlines and the average tone of what is being written
// @permissions network
// @widget      small, medium, large
// @icon        chart.bar.xaxis
// @color       #2563EB
// @version     1.0.0
// @author      scriptwell
// @category    news

// How it works
// • Each topic is looked up in the GDELT DOC 2.0 API at api.gdeltproject.org: coverage volume and
//   average tone for the last 30 days, and the ten most recent articles. Only the topic text is sent.
// • Type topics in the mini-app. Put a phrase in quotes to keep the words together, for example
//   "heat pump" or "Mars sample return"; plain words are matched together in any order.
// • Answers are cached for 30 minutes. Widgets show the cache and only refresh stale volume data
//   within their time budget; background runs keep volume and tone fresh while the app is closed.
// • The trend arrow compares the last seven days with the seven before. Tone runs from negative to
//   positive on GDELT's scale, where most news sits between −5 and +5.
// • Widget parameter: the topic to feature in the small widget, spelled as in the mini-app.

// ───────────────────────── Constants

const GDELT = "https://api.gdeltproject.org/api/v2/doc/doc";
const DAY = 86_400_000;
const FRESH_MS = 30 * 60 * 1000;
const MAX_TOPICS = 5;
const COLORS = ["#2563EB", "#F97316", "#10B981", "#A855F7", "#EC4899"];
const TIME_LIMITS = { app: 30_000, pwa: 30_000, shortcut: 20_000, background: 15_000, widget: 8_000 };
const PARTS = ["volume", "tone", "articles"];

const TREND = {
  up: { symbol: "arrow.up.right", fallback: "↗", color: "orange", word: "more coverage" },
  down: { symbol: "arrow.down.right", fallback: "↘", color: "teal", word: "less coverage" },
  flat: { symbol: "arrow.right", fallback: "→", color: "secondary", word: "steady" },
};

const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;
const TILE = { light: "#F1F5F9", dark: "#1E293B" };
const FILL = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
const locale = Script.env.locale;

// ───────────────────────── Topics and cache

const topics = () => Storage.get("topics", []);
const topicKey = (topic) => topic.trim().toLowerCase();
const cacheKey = (topic) => `topic:${topicKey(topic)}`;
const cacheOf = (topic) => Storage.get(cacheKey(topic));
const RETRY_MS = 10 * 60 * 1000;    // wait this long before retrying a topic that failed
const isStale = (cache, part) => {
  if (cache?.error && cache.errorTime && Date.now() - cache.errorTime < RETRY_MS) return false;
  return !cache?.[`${part}Time`] || Date.now() - cache[`${part}Time`] > FRESH_MS;
};

function setTopics(list) {
  const clean = [];
  for (const topic of list) {
    const t = String(topic ?? "").trim().slice(0, 80);
    if (t && !clean.some((c) => topicKey(c) === topicKey(t))) clean.push(t);
  }
  const kept = clean.slice(0, MAX_TOPICS);
  Storage.set("topics", kept);
  // Drop caches of topics that are no longer tracked.
  const keep = new Set(kept.map(cacheKey));
  for (const key of Storage.keys()) if (key.startsWith("topic:") && !keep.has(key)) Storage.remove(key);
  return kept;
}

function makeBudget(margin = 3000) {
  const end = Date.now() + (TIME_LIMITS[Script.env.mode] ?? 20_000) - margin;
  return { left: () => end - Date.now() };
}

// ───────────────────────── GDELT

function parseGdeltDate(text) {
  // "20251113T120000Z"
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(text ?? ""));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

function dayLabel(day) {
  return new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8))).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
}

async function gdelt(query, mode, extra, timeout) {
  const url = new URL(GDELT);
  url.search = new URLSearchParams({ query, mode, format: "json", ...extra }).toString();
  const response = await fetch(url, { timeout });
  if (!response.ok) throw new Error(`GDELT returned ${response.status}`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    // GDELT explains problems (too short, too many results, rate limit) as plain text.
    throw new Error(text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140) || "GDELT sent an empty answer");
  }
}

// One value per UTC day, averaged if GDELT answers in finer steps.
function daily(series) {
  const byDay = new Map();
  for (const point of series?.data ?? []) {
    const day = String(point.date).slice(0, 8);
    const entry = byDay.get(day) ?? { sum: 0, n: 0 };
    entry.sum += Number(point.value) || 0;
    entry.n += 1;
    byDay.set(day, entry);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, e]) => ({ day, value: e.sum / e.n })).slice(-30);
}

async function fetchPart(topic, part, timeout) {
  if (part === "volume") return daily((await gdelt(topic, "timelinevol", { timespan: "30d" }, timeout)).timeline?.[0]);
  if (part === "tone") return daily((await gdelt(topic, "timelinetone", { timespan: "30d" }, timeout)).timeline?.[0]);
  const data = await gdelt(topic, "artlist", { maxrecords: "10", sort: "datedesc" }, timeout);
  return (data.articles ?? []).slice(0, 10).map((a) => ({
    title: String(a.title ?? "").trim() || a.domain,
    domain: a.domain,
    url: a.url,
    time: parseGdeltDate(a.seendate),
  }));
}

// Refreshes the stale parts of the given topics, most important part first, within the time budget.
async function refreshTopics(list, { parts = PARTS, budget = makeBudget(), force = false } = {}) {
  const errors = [];
  let partial = false;
  for (const part of parts) {
    for (const topic of list) {
      const key = cacheKey(topic);
      const cache = Storage.get(key) ?? { topic };
      if (!force && !isStale(cache, part)) continue;
      if (budget.left() < 3000) { partial = true; break; }
      try {
        cache[part] = await fetchPart(topic, part, Math.min(budget.left() - 500, 8000));
        cache[`${part}Time`] = Date.now();
        cache.error = null;
      } catch (error) {
        cache.error = error.message;
        cache.errorTime = Date.now();
        errors.push(`${topic}: ${error.message}`);
      }
      Storage.set(key, cache);
    }
  }
  if (errors.length || partial) Storage.set("lastError", { message: errors[0] ?? "Ran out of time; some topics are still loading", time: Date.now() });
  else Storage.remove("lastError");
  return { errors, partial };
}

// ───────────────────────── Numbers

const avg = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

function trend(volume) {
  if (!volume || volume.length < 8) return null;
  const values = volume.map((p) => p.value);
  const last = avg(values.slice(-7));
  const prev = avg(values.slice(-14, -7));
  const pct = prev > 0 ? ((last - prev) / prev) * 100 : last > 0 ? 100 : 0;
  return { pct, direction: pct >= 10 ? "up" : pct <= -10 ? "down" : "flat" };
}

const toneNow = (tone) => (tone?.length ? avg(tone.slice(-7).map((p) => p.value)) : null);
const toneColor = (t) => (t == null ? "secondary" : t <= -1.5 ? "red" : t >= 1.5 ? "green" : "orange");
const toneWord = (t) => (t == null ? "unknown" : t <= -3 ? "very negative" : t <= -1.5 ? "negative" : t < 1.5 ? "neutral" : t < 3 ? "positive" : "very positive");
const fmtPct = (n, digits = 0) => `${n > 0 ? "+" : ""}${n.toLocaleString(locale, { maximumFractionDigits: digits })}%`;
const fmtVolume = (v) => `${v.toLocaleString(locale, { maximumFractionDigits: v < 0.1 ? 3 : 2 })}%`;
const fmtTone = (t) => (t == null ? "—" : `${t > 0 ? "+" : ""}${t.toLocaleString(locale, { maximumFractionDigits: 1 })}`);

function ago(ms) {
  if (!ms) return "";
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

function rows() {
  return topics().map((topic, i) => {
    const cache = cacheOf(topic) ?? { topic };
    return { topic, color: COLORS[i], cache, trend: trend(cache.volume), tone: toneNow(cache.tone), latest: cache.volume?.at(-1)?.value ?? null };
  });
}

// ───────────────────────── Shared pieces

const dot = (color, size = 8) => ({ type: "stack", direction: "vertical", children: [], background: color, cornerRadius: size / 2, frame: { width: size, height: size } });

function trendLabel(t, { font = "caption", symbolSize = 11, showWord = false } = {}) {
  if (!t) return Widget.text("collecting…", { font, color: "secondary", lineLimit: 1 });
  const look = TREND[t.direction];
  return Widget.hstack([
    Widget.symbol(look.symbol, { size: symbolSize, color: look.color, fallback: look.fallback }),
    Widget.text(showWord ? `${fmtPct(t.pct)} · ${look.word}` : fmtPct(t.pct), { font, weight: "semibold", color: look.color, lineLimit: 1 }),
  ], { spacing: 3 });
}

function sparkline(volume, color, frame, kind = "area") {
  if (!volume || volume.length < 2) return Widget.text("no data yet", { font: "caption2", color: "secondary", frame });
  return Widget.chart(volume.map((p) => p.value), { kind, axes: false, smooth: true, color, frame });
}

function multiChart(list, frame, axes = true) {
  const points = [];
  for (const r of list) for (const p of r.cache.volume ?? []) points.push({ x: dayLabel(p.day), y: Number(p.value.toFixed(4)), series: r.topic });
  if (!points.length) return Widget.text("No data yet. Add a topic and refresh.", { font: "footnote", color: "secondary", frame });
  const colors = list.filter((r) => r.cache.volume?.length).map((r) => r.color);
  return Widget.chart(points, { kind: "line", smooth: true, axes, colors, frame });
}

function legend(list, font = "caption2") {
  return Widget.hstack(list.map((r) => Widget.hstack([dot(r.color, 7), Widget.text(r.topic, { font, color: "secondary", lineLimit: 1, minimumScale: 0.7 })], { spacing: 3 })), { spacing: 8 });
}

function placeholder(family, message) {
  return Widget.vstack([
    Widget.symbol("chart.line.uptrend.xyaxis", { size: family === "small" ? 24 : 30, color: "blue", fallback: "📈" }),
    Widget.text(message, { font: "caption", color: "secondary", align: "center", lineLimit: 4 }),
  ], { spacing: 8, padding: 14, url: APP_LINK, frame: { maxWidth: "infinity", maxHeight: "infinity" } });
}

// ───────────────────────── Widget

Script.widget(async ({ family, parameter }) => {
  if (!topics().length) return placeholder(family, "Open Topic Tracker and add a topic to follow");

  // Widgets only top up stale volume data, and stop well inside their 8 seconds.
  if (!Script.env.lowPowerMode) {
    try { await refreshTopics(topics(), { parts: ["volume"], budget: makeBudget(2500) }); } catch { /* cache below */ }
  }

  const list = rows();
  const wanted = parameter ? list.find((r) => topicKey(r.topic) === topicKey(parameter)) : null;
  const featured = wanted ?? list[0];
  const updated = Math.max(0, ...list.map((r) => r.cache.volumeTime ?? 0));
  let content;

  if (family === "small") {
    content = Widget.vstack([
      Widget.hstack([dot(featured.color, 9), Widget.text(featured.topic, { font: "headline", lineLimit: 1, minimumScale: 0.7 })], { spacing: 5 }),
      Widget.text(featured.latest == null ? "—" : fmtVolume(featured.latest), { font: 26, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
      Widget.text("of global coverage today", { font: "caption2", color: "secondary" }),
      sparkline(featured.cache.volume, featured.color, { height: 34 }),
      Widget.hstack([trendLabel(featured.trend), Widget.spacer(), Widget.text("vs last wk", { font: "caption2", color: "secondary" })]),
      parameter && !wanted ? Widget.text(`"${parameter}" is not tracked`, { font: "caption2", color: "orange", lineLimit: 1 }) : null,
    ], { alignment: "leading", spacing: 3, padding: 13, url: APP_LINK, frame: FILL });
  } else if (family === "medium") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.text("Topic Tracker", { font: "headline" }),
        Widget.spacer(),
        updated ? Widget.date(updated, { style: "relative", font: "caption2", color: "secondary" }) : null,
      ]),
      ...list.map((r) => Widget.hstack([
        dot(r.color, 8),
        Widget.text(r.topic, { font: "subheadline", weight: "medium", lineLimit: 1, minimumScale: 0.7, frame: { maxWidth: "infinity", alignment: "leading" } }),
        sparkline(r.cache.volume, r.color, { width: 84, height: 18 }, "line"),
        Widget.vstack([trendLabel(r.trend)], { alignment: "trailing", frame: { width: 62, alignment: "trailing" } }),
      ], { spacing: 8 })),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 6, padding: 13, url: APP_LINK, frame: FILL });
  } else {
    content = Widget.vstack([
      Widget.hstack([
        Widget.text("Topic Tracker", { font: "headline" }),
        Widget.text("30 days · share of global coverage", { font: "caption2", color: "secondary" }),
        Widget.spacer(),
        updated ? Widget.date(updated, { style: "relative", font: "caption2", color: "secondary" }) : null,
      ], { spacing: 6, alignment: "bottom" }),
      multiChart(list, { height: 118 }, false),
      legend(list),
      ...list.map((r) => {
        const headline = r.cache.articles?.[0];
        return Widget.vstack([
          Widget.hstack([
            dot(r.color, 8),
            Widget.text(r.topic, { font: "subheadline", weight: "semibold", lineLimit: 1, minimumScale: 0.7 }),
            Widget.spacer(),
            Widget.text(r.tone == null ? "" : `tone ${fmtTone(r.tone)}`, { font: "caption2", color: toneColor(r.tone) }),
            trendLabel(r.trend),
          ], { spacing: 6 }),
          Widget.text(headline ? `${headline.title} · ${headline.domain}` : "No headlines cached yet", { font: "caption2", color: "secondary", lineLimit: 1 }),
        ], { alignment: "leading", spacing: 1, padding: { horizontal: 8, vertical: 5 }, background: TILE, cornerRadius: 9 });
      }),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 6, padding: 14, url: APP_LINK, frame: FILL });
  }

  return { content, refreshAfter: 30 * 60 };
});

// ───────────────────────── Run and background

function summaryLine(r) {
  const t = r.trend ? `${fmtPct(r.trend.pct)} vs last week` : "trend not ready";
  const headline = r.cache.articles?.[0];
  return `${r.topic}: ${r.latest == null ? "no volume data" : `${fmtVolume(r.latest)} of coverage`}, ${t}, tone ${toneWord(r.tone)}${headline ? `. Latest: ${headline.title} (${headline.domain})` : ""}`;
}

Script.run(async (input) => {
  const query = String(input ?? "").trim();
  if (query) {
    // A one-off lookup from Siri or Shortcuts; the topic is not added to the list.
    await refreshTopics([query], { force: true });
    const cache = cacheOf(query) ?? {};
    const line = summaryLine({ topic: query, cache, trend: trend(cache.volume), tone: toneNow(cache.tone), latest: cache.volume?.at(-1)?.value ?? null });
    if (!topics().some((t) => topicKey(t) === topicKey(query))) Storage.remove(cacheKey(query));
    return cache.error ? `${query}: ${cache.error}` : line;
  }
  if (!topics().length) return "No topics yet. Open Topic Tracker and add up to five.";
  await refreshTopics(topics());
  return rows().map(summaryLine).join("\n");
});

Script.background(async () => {
  if (!topics().length) return;
  try { await refreshTopics(topics(), { parts: ["volume", "tone"], budget: makeBudget(3500) }); } catch { /* kept in lastError */ }
});

// ───────────────────────── Mini-app

let selectedTab = 0;

Script.action("topic", async ({ index, value }) => {
  const list = [...topics()];
  const text = String(value ?? "").trim();
  if (text) list[index] = text;
  else list.splice(index, 1);
  const kept = setTopics(list);
  if (text && kept.some((t) => topicKey(t) === topicKey(text))) await refreshTopics([text]);
});

Script.action("remove", ({ topic }) => {
  setTopics(topics().filter((t) => t !== topic));
  selectedTab = 0;
});

Script.action("refresh", async () => {
  const { errors, partial } = await refreshTopics(topics(), { force: true });
  await UI.haptic(errors.length || partial ? "warning" : "success");
});

Script.action("tab", ({ value }) => { selectedTab = value; });

function topicPane(r) {
  const c = r.cache;
  const stat = (label, node) => Widget.vstack([node, Widget.text(label, { font: "caption2", color: "secondary" })], { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", alignment: "leading" } });
  const gauge = Math.max(0, Math.min(1, ((r.tone ?? 0) + 10) / 20));
  const headlines = (c.articles ?? []).map((a) => ({ title: a.title, subtitle: `${a.domain}${a.time ? ` · ${ago(a.time)}` : ""}`, symbol: "newspaper", color: r.color, url: a.url }));

  return Widget.vstack([
    c.error ? Widget.text(`GDELT: ${c.error}`, { font: "footnote", color: "orange" }) : null,
    Widget.hstack([
      stat("of global coverage", Widget.text(r.latest == null ? "—" : fmtVolume(r.latest), { font: "title2", weight: "bold", design: "rounded", color: r.color })),
      stat("vs previous week", trendLabel(r.trend, { font: "title3", symbolSize: 16 })),
      stat("average tone", Widget.text(fmtTone(r.tone), { font: "title2", weight: "bold", design: "rounded", color: toneColor(r.tone) })),
    ], { spacing: 8, padding: 12, background: TILE, cornerRadius: 14 }),
    Widget.vstack([
      Widget.hstack([
        Widget.text("Negative", { font: "caption2", color: "red" }),
        Widget.spacer(),
        Widget.text(`Tone of the last 7 days: ${toneWord(r.tone)}`, { font: "caption2", color: "secondary" }),
        Widget.spacer(),
        Widget.text("Positive", { font: "caption2", color: "green" }),
      ]),
      Widget.progress(gauge, { color: toneColor(r.tone) }),
    ], { spacing: 4 }),
    c.volume?.length > 1
      ? Widget.chart(c.volume.map((p) => ({ x: dayLabel(p.day), y: Number(p.value.toFixed(4)) })), { kind: "area", smooth: true, color: r.color, frame: { height: 150 } })
      : null,
    headlines.length
      ? Widget.list(headlines, { title: "Latest headlines" })
      : Widget.text(c.articlesTime ? "No articles found for this topic." : "Headlines load on the next refresh.", { font: "footnote", color: "secondary" }),
    Widget.button("Stop following this topic", "remove", { topic: r.topic }, { style: "bordered", color: "red" }),
  ], { alignment: "leading", spacing: 14 });
}

Script.ui(async () => {
  const list0 = topics();
  if (list0.length) {
    try { await refreshTopics(list0); } catch { /* cache below */ }
  }
  const list = rows();
  const error = Storage.get("lastError");
  const updated = Math.max(0, ...list.map((r) => r.cache.volumeTime ?? 0));
  const fields = Array.from({ length: Math.min(MAX_TOPICS, list.length + 1) }, (_, i) =>
    Widget.textField(i < list.length ? "" : "Add a topic, e.g. \"heat pump\"", list[i]?.topic ?? "", "topic", { index: i }, { label: `Topic ${i + 1}`, keyboard: "search" }));

  const overview = Widget.vstack([
    list.length ? multiChart(list, { height: 220 }) : Widget.text("Add a topic below to start tracking.", { color: "secondary" }),
    list.length ? legend(list, "caption") : null,
    ...list.map((r) => Widget.hstack([
      dot(r.color, 10),
      Widget.vstack([
        Widget.text(r.topic, { font: "subheadline", weight: "semibold", lineLimit: 1 }),
        Widget.text(`${r.latest == null ? "no data" : fmtVolume(r.latest)} today · tone ${toneWord(r.tone)}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
      ], { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", alignment: "leading" } }),
      sparkline(r.cache.volume, r.color, { width: 80, height: 24 }),
      Widget.vstack([trendLabel(r.trend)], { alignment: "trailing", frame: { width: 64, alignment: "trailing" } }),
    ], { spacing: 10, padding: 10, background: TILE, cornerRadius: 12 })),
  ], { alignment: "leading", spacing: 10 });

  const tabs = [
    { title: "Overview", symbol: "chart.xyaxis.line", content: overview },
    ...list.map((r) => ({ title: r.topic.length > 14 ? `${r.topic.slice(0, 13)}…` : r.topic, content: topicPane(r) })),
  ];

  return {
    title: "Topic Tracker",
    content: Widget.vstack([
      Widget.hstack([
        Widget.button("Refresh", "refresh", null, { style: "prominent" }),
        Widget.spacer(),
        updated ? Widget.hstack([Widget.text("Updated", { font: "caption", color: "secondary" }), Widget.date(updated, { style: "relative", font: "caption", color: "secondary" })], { spacing: 3 }) : null,
      ]),
      error && (!updated || error.time > updated - FRESH_MS) ? Widget.text(error.message, { font: "caption", color: "orange" }) : null,
      Widget.tabs(tabs, { selected: Math.min(selectedTab, tabs.length - 1), action: "tab" }),
      Widget.card([
        ...fields,
        Widget.text("Up to five topics. Quotes keep a phrase together; separate words must all appear. Clear a field to stop following it.", { font: "caption2", color: "secondary" }),
      ], { title: "Topics", symbol: "text.magnifyingglass", color: "blue" }),
      Widget.text("Data: the GDELT Project", { font: "caption2", color: "secondary", url: "https://www.gdeltproject.org" }),
    ], { alignment: "leading", spacing: 16, padding: 16 }),
  };
});
