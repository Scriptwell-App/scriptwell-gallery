// @name        Birthdays
// @description The next 5 birthdays from your contacts, first names only
// @icon        gift.fill
// @color       #EC4899
// @permissions contacts
// @widget      small, medium, large, rectangular, inline
// @version     1.0.0
// @author      va4w
// @category    utilities

const COUNT = 5;

// Load contacts and keep only first names and "MM-DD" birthdays (no years, no other details).
async function loadBirthdays() {
  const people = await Contacts.find("", { limit: 200 });
  const list = people
    .filter((p) => p.birthday)
    .map((p) => ({
      name: (p.givenName || p.name || "").trim().split(/\s+/)[0] || "Someone",
      birthday: p.birthday.slice(-5), // "MM-DD"
    }));
  Storage.set("birthdays", { list, time: Date.now() });
  return list;
}

async function getBirthdays() {
  try {
    return await loadBirthdays();
  } catch (error) {
    Storage.set("lastError", `${new Date().toISOString()} ${error.name}: ${error.message}`);
    const saved = Storage.get("birthdays");
    if (saved) return saved.list;
    throw error;
  }
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Next occurrence of a "MM-DD" birthday; Feb 29 falls on Feb 28 in other years.
function nextOccurrence(mmdd, today) {
  const month = Number(mmdd.slice(0, 2)) - 1;
  const day = Number(mmdd.slice(3, 5));
  const make = (year) => {
    const date = new Date(year, month, day);
    return date.getMonth() === month ? date : new Date(year, month, 28);
  };
  let next = make(today.getFullYear());
  if (next < today) next = make(today.getFullYear() + 1);
  return next;
}

function upcoming(list) {
  const today = startOfToday();
  return list
    .map((entry) => {
      const date = nextOccurrence(entry.birthday, today);
      const days = Math.round((date - today) / 86_400_000);
      return { name: entry.name, date, days };
    })
    .sort((a, b) => a.days - b.days || a.name.localeCompare(b.name))
    .slice(0, COUNT);
}

function whenText(days) {
  if (days === 0) return "Today 🎉";
  if (days === 1) return "Tomorrow";
  return `in ${days} days`;
}

const monthShort = (date) => date.toLocaleDateString(Script.env.locale, { month: "short" }).toUpperCase();

function dayBadge(date, highlight) {
  return Widget.vstack([
    Widget.text(monthShort(date), { font: 8, weight: "bold", color: highlight ? "white" : "pink" }),
    Widget.text(date.getDate(), { font: 13, weight: "bold", design: "rounded", color: highlight ? "white" : "primary" }),
  ], {
    spacing: 0,
    frame: { width: 32, height: 30 },
    background: highlight ? "pink" : { light: "#FCE7F3", dark: "#500724" },
    cornerRadius: 7,
  });
}

function row(entry, compact) {
  if (compact) {
    return Widget.hstack([
      Widget.circle({
        fill: entry.days <= 7 ? "pink" : { light: "#D1D1D6", dark: "#48484A" },
        frame: { width: 6, height: 6 },
      }),
      Widget.text(entry.name, { font: "caption", weight: "semibold", lineLimit: 1 }),
      Widget.spacer(),
      Widget.text(entry.days === 0 ? "Today" : `${entry.date.getDate()} ${monthShort(entry.date).slice(0, 3)}`, {
        font: "caption2", color: entry.days === 0 ? "pink" : "secondary", monospacedDigit: true,
      }),
    ], { spacing: 6 });
  }
  return Widget.hstack([
    dayBadge(entry.date, entry.days === 0),
    Widget.text(entry.name, { font: "subheadline", weight: "semibold", lineLimit: 1 }),
    Widget.spacer(),
    Widget.text(whenText(entry.days), { font: "caption", color: entry.days <= 7 ? "pink" : "secondary" }),
  ], { spacing: 8 });
}

function header(size) {
  return Widget.hstack([
    Widget.symbol("gift.fill", { size, color: "pink", fallback: "🎁" }),
    Widget.text("Birthdays", { font: size > 14 ? "headline" : "caption", weight: "bold" }),
  ], { spacing: 5 });
}

// The next birthday, shown larger.
function featured(entry, big) {
  const dateText = entry.date.toLocaleDateString(Script.env.locale, { day: "numeric", month: "short" });
  return Widget.vstack([
    Widget.text(entry.days === 0 ? "Today" : "Next up", {
      font: "caption2", weight: "bold", color: "secondary", transform: "uppercase", tracking: 1,
    }),
    Widget.text(entry.name, {
      font: big ? "title2" : "title3", weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6,
    }),
    Widget.text(`${dateText} · ${whenText(entry.days)}`, {
      font: "caption", weight: "medium", color: entry.days <= 7 ? "pink" : "secondary", lineLimit: 1, minimumScale: 0.8,
    }),
  ], { alignment: "leading", spacing: 1 });
}

const PANEL = { light: "#F2F2F7", dark: "#2C2C2E" };

function nextMidnight() {
  const d = new Date();
  d.setHours(24, 0, 10, 0);
  return d;
}

Script.widget(async ({ family }) => {
  let list;
  try {
    list = await getBirthdays();
  } catch (error) {
    return Widget.text("Open Birthdays in Scriptwell once to allow Contacts", {
      font: "caption", color: "secondary", align: "center",
    });
  }

  const next = upcoming(list);

  if (next.length === 0) {
    return { content: Widget.text("No birthdays in your contacts", { font: "caption", color: "secondary" }), refreshAt: nextMidnight() };
  }

  let content;
  switch (family) {
    case "inline":
      content = Widget.text(`🎂 ${next[0].name} ${whenText(next[0].days).replace(" 🎉", "")}`);
      break;

    case "rectangular":
      content = Widget.vstack(
        next.slice(0, 3).map((e) => Widget.text(`${e.name} · ${e.days === 0 ? "today" : e.days === 1 ? "tomorrow" : `${e.days}d`}`, { font: "caption", lineLimit: 1 })),
        { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", alignment: "leading" } },
      );
      break;

    case "small":
      content = Widget.vstack([
        header(13),
        Widget.spacer(2),
        featured(next[0], false),
        next.length > 1 ? Widget.divider() : null,
        ...next.slice(1, 3).map((e) => row(e, true)),
        Widget.spacer(),
      ], { alignment: "leading", spacing: 5, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
      break;

    case "large": {
      const now = new Date();
      const thisMonth = list
        .filter((e) => Number(e.birthday.slice(0, 2)) - 1 === now.getMonth())
        .map((e) => Number(e.birthday.slice(3, 5)));
      content = Widget.vstack([
        header(18),
        Widget.text(now.toLocaleDateString(Script.env.locale, { month: "long", year: "numeric" }), { font: "caption", color: "secondary" }),
        Widget.calendarGrid(now, { marked: thisMonth, color: "pink", weekStart: 1, cellSize: 18, frame: { maxWidth: "infinity" } }),
        Widget.divider(),
        ...next.map((e) => row(e, false)),
        Widget.spacer(),
      ], { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
      break;
    }

    default: { // medium
      const rest = next.slice(1);
      content = Widget.hstack([
        Widget.vstack([
          header(14),
          Widget.spacer(),
          dayBadge(next[0].date, next[0].days === 0),
          featured(next[0], true),
        ], { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
        Widget.vstack([
          ...(rest.length
            ? rest.map((e) => row(e, true))
            : [Widget.text("No other birthdays", { font: "caption", color: "secondary" })]),
          Widget.spacer(),
        ], {
          alignment: "leading", spacing: 7, padding: 10,
          background: PANEL, cornerRadius: 12,
          frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" },
        }),
      ], { spacing: 12 });
    }
  }

  return { content, refreshAt: nextMidnight() };
});

// Keep the cached list fresh while the app is closed.
Script.background(async () => {
  await loadBirthdays();
});

// Run in the app (once, to approve Contacts) or from Shortcuts/Siri.
Script.run(async () => {
  const next = upcoming(await getBirthdays());
  if (next.length === 0) return "No birthdays found in your contacts.";
  return next
    .map((e) => `${e.name}: ${e.date.toLocaleDateString(Script.env.locale, { day: "numeric", month: "long" })} (${whenText(e.days)})`)
    .join("\n");
});
