// @name        Keep in Touch
// @description Remembers who you meant to call: pick people from Contacts, set how often you want to talk, log when you last spoke, and see who is overdue and whose birthday is next, with one-tap message, call and email. Everything stays on the device.
// @permissions contacts, notifications
// @widget      small, medium, large, rectangular, inline
// @icon        person.2.wave.2.fill
// @color       #DB2777
// @version     1.0.0
// @author      scriptwell
// @category    social-networking

// How it works
// • "Add a person" opens the system contact picker (Contacts.pick), which hands over only the person you choose.
//   "Import birthdays" uses Contacts.find to read everyone who has a birthday (up to 200 contacts) and adds them
//   as birthday-only entries; that is the one feature that needs the contacts permission.
// • Give each person a cadence (weekly, fortnightly, monthly, quarterly) and tap "Spoke today" after a chat.
//   The app works out who is overdue and lists birthdays in the next 30 days, with the age when the year is known.
// • Message, call and email buttons open Messages, Phone and Mail with the stored number or address.
// • Background runs schedule notifications: one on the morning of each birthday and one the day someone becomes
//   overdue (stable ids, so nothing doubles up). Run the script once in the app so iOS can ask about notifications.
// • Widgets show the next birthday with a countdown and the most overdue person; the Lock Screen line reads
//   "Birthday: Ana in 3 days". Nothing is fetched and contact data never leaves the device.

// ───────────────────────────────────────────── Constants

const DAY = 86_400_000;
const BIRTHDAY_WINDOW = 30;
const MAX_SCHEDULED = 20;
const PINK = "#DB2777";
const TILE_BG = { light: "#F1F5F9", dark: "#1E293B" };
const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

const CADENCES = [
  { id: "weekly", label: "Weekly", days: 7 },
  { id: "fortnightly", label: "Fortnightly", days: 14 },
  { id: "monthly", label: "Monthly", days: 30 },
  { id: "quarterly", label: "Quarterly", days: 91 },
  { id: "none", label: "Birthdays only", days: null },
];
const cadence = (id) => CADENCES.find((c) => c.id === id) ?? CADENCES[4];

// ───────────────────────────────────────────── Storage

const people = () => Storage.get("people", []);
const savePeople = (list) => Storage.set("people", list);
const settings = () => ({ birthdayNotify: true, overdueNotify: true, hour: 9, ...Storage.get("settings", {}) });
const ui = () => Storage.get("ui", { page: "home" });
const setUi = (changes) => Storage.set("ui", { ...ui(), ...changes });

const isoDay = (date) => new Date(date).toLocaleDateString("en-CA");
const today = () => isoDay(new Date());
const dayDiff = (fromIso, toIso) => Math.round((new Date(`${toIso}T12:00:00`) - new Date(`${fromIso}T12:00:00`)) / DAY);

function fromContact(contact, extra = {}) {
  return {
    id: contact.id,
    name: contact.name,
    givenName: contact.givenName || contact.name.split(" ")[0],
    phone: contact.phones?.[0] ?? null,
    email: contact.emails?.[0] ?? null,
    birthday: contact.birthday ?? null,
    cadence: "monthly",
    lastSpoke: null,
    added: today(),
    notifiedFor: null,
    source: "pick",
    ...extra,
  };
}

// ───────────────────────────────────────────── Dates

// "1990-05-14" or "--05-14" → { month, day, year|null }
function parseBirthday(text) {
  const m = /^(\d{4}|-)?-?(\d{2})-(\d{2})$/.exec(text ?? "");
  if (!m) return null;
  return { year: m[1] && m[1] !== "-" ? Number(m[1]) : null, month: Number(m[2]), day: Number(m[3]) };
}

function nextBirthday(text) {
  const b = parseBirthday(text);
  if (!b) return null;
  const now = new Date(`${today()}T12:00:00`);
  let next = new Date(now.getFullYear(), b.month - 1, b.day, 12);
  if (isoDay(next) < today()) next = new Date(now.getFullYear() + 1, b.month - 1, b.day, 12);
  const days = dayDiff(today(), isoDay(next));
  return { date: isoDay(next), days, age: b.year ? next.getFullYear() - b.year : null };
}

function derive(p) {
  const c = cadence(p.cadence);
  const base = p.lastSpoke ?? p.added;
  const due = c.days ? isoDay(new Date(new Date(`${base}T12:00:00`).getTime() + c.days * DAY)) : null;
  const overdueDays = due ? dayDiff(due, today()) : null;
  return { ...p, cadenceLabel: c.label, due, overdueDays, overdue: overdueDays != null && overdueDays >= 0, birthdayNext: nextBirthday(p.birthday) };
}

function overview() {
  const all = people().map(derive);
  const overdue = all.filter((p) => p.overdue).sort((a, b) => b.overdueDays - a.overdueDays);
  const birthdays = all.filter((p) => p.birthdayNext && p.birthdayNext.days <= BIRTHDAY_WINDOW).sort((a, b) => a.birthdayNext.days - b.birthdayNext.days);
  const upcoming = all.filter((p) => p.due && !p.overdue).sort((a, b) => a.due.localeCompare(b.due));
  return { all, overdue, birthdays, upcoming };
}

const sinceText = (iso) => {
  if (!iso) return "never";
  const d = dayDiff(iso, today());
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};
const inText = (days) => (days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`);
const longDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(Script.env.locale, { weekday: "short", day: "numeric", month: "short" });

// ───────────────────────────────────────────── Notifications

function atHour(iso, hour) {
  const d = new Date(`${iso}T00:00:00`);
  d.setHours(hour, 0, 0, 0);
  return d;
}

// Notification is not available inside a widget, so a "Spoke" tap from the widget only updates Storage;
// the next app open or background run fixes the schedule.
const canNotify = () => Script.env.mode !== "widget";

// Stable ids per person, so a re-run replaces instead of adding. Runs in the app and in the background.
async function scheduleAll() {
  const s = settings();
  if (!canNotify()) return { overdue: 0, birthdays: 0 };
  const { all, overdue, birthdays } = overview();
  const now = new Date();
  let changed = false;

  for (const p of birthdays.slice(0, MAX_SCHEDULED)) {
    const at = atHour(p.birthdayNext.date, s.hour);
    if (!s.birthdayNotify || at <= now) { await Notification.cancel(`bday:${p.id}`); continue; }
    const age = p.birthdayNext.age ? ` ${p.givenName} turns ${p.birthdayNext.age}.` : "";
    await Notification.schedule({ id: `bday:${p.id}`, title: `It is ${p.givenName}'s birthday`, body: `${age} Send a message or give them a call.`.trim(), at });
  }

  let scheduled = 0;
  for (const p of all.filter((x) => x.due)) {
    const id = `overdue:${p.id}`;
    if (!s.overdueNotify) { await Notification.cancel(id); continue; }
    const at = atHour(p.due, s.hour);
    const key = p.lastSpoke ?? p.added;
    if (at > now) {
      if (scheduled < MAX_SCHEDULED) { await Notification.schedule({ id, title: `Time to catch up with ${p.givenName}`, body: `You wanted to talk ${p.cadenceLabel.toLowerCase()}; the last time was ${sinceText(p.lastSpoke)}.`, at }); scheduled += 1; }
    } else if (p.overdue && p.notifiedFor !== key) {
      // Became overdue while the app was closed: nudge once for this stretch.
      await Notification.schedule({ id, title: `Time to catch up with ${p.givenName}`, body: `${p.overdueDays === 0 ? "Due today" : `${p.overdueDays} days overdue`}; the last time was ${sinceText(p.lastSpoke)}.`, after: 60 });
      p.notifiedFor = key;
      changed = true;
    }
  }
  if (changed) savePeople(people().map((p) => ({ ...p, notifiedFor: all.find((x) => x.id === p.id)?.notifiedFor ?? p.notifiedFor })));
  return { overdue: overdue.length, birthdays: birthdays.length };
}

async function forget(id) {
  await Notification.cancel(`bday:${id}`);
  await Notification.cancel(`overdue:${id}`);
}

// ───────────────────────────────────────────── Actions

Script.action("pick", async () => {
  let contact;
  try {
    contact = await Contacts.pick();
  } catch (error) {
    await UI.alert({ title: "The contact picker is not available here", message: error.message });
    return;
  }
  if (!contact) return;
  const list = people();
  const existing = list.find((p) => p.id === contact.id);
  const person = existing
    ? { ...existing, name: contact.name, givenName: contact.givenName || existing.givenName, phone: contact.phones?.[0] ?? existing.phone, email: contact.emails?.[0] ?? existing.email, birthday: contact.birthday ?? existing.birthday, source: "pick", cadence: existing.cadence === "none" ? "monthly" : existing.cadence }
    : fromContact(contact);
  savePeople(existing ? list.map((p) => (p.id === person.id ? person : p)) : [...list, person]);
  setUi({ page: "person", selected: person.id });
  await scheduleAll();
});

Script.action("import", async () => {
  const choice = await UI.alert({
    title: "Import birthdays?",
    message: "Scriptwell reads your contacts on this device and adds everyone with a birthday as a birthday-only entry. Nothing is uploaded.",
    buttons: ["Cancel", "Import"],
  });
  if (choice !== 1) return;
  const everyone = await Contacts.find("", { limit: 200 });
  const list = people();
  const known = new Set(list.map((p) => p.id));
  const added = everyone.filter((c) => c.birthday && !known.has(c.id)).map((c) => fromContact(c, { cadence: "none", source: "birthdays" }));
  savePeople([...list, ...added]);
  Storage.set("lastImport", { time: Date.now(), added: added.length, scanned: everyone.length });
  await scheduleAll();
  await UI.alert({ title: added.length ? `Added ${added.length} ${added.length === 1 ? "person" : "people"}` : "Nothing new", message: everyone.length >= 200 ? "Only the first 200 contacts were read. Add the rest with the picker." : `${everyone.length} contacts checked.` });
});

Script.action("open", ({ id, value }) => setUi({ page: "person", selected: id ?? value }));
Script.action("page", ({ page }) => setUi({ page }));

Script.action("spoke", async ({ id }) => {
  savePeople(people().map((p) => (p.id === id ? { ...p, lastSpoke: today(), notifiedFor: null } : p)));
  if (!canNotify()) return;
  await Notification.cancel(`overdue:${id}`);
  await scheduleAll();
});

Script.action("lastSpoke", async ({ id, value }) => {
  savePeople(people().map((p) => (p.id === id ? { ...p, lastSpoke: isoDay(value), notifiedFor: null } : p)));
  await scheduleAll();
});

Script.action("cadence", async ({ id, value }) => {
  savePeople(people().map((p) => (p.id === id ? { ...p, cadence: value } : p)));
  await scheduleAll();
});

Script.action("contact", async ({ id, kind }) => {
  const p = people().find((x) => x.id === id);
  if (!p) return;
  const phone = (p.phone ?? "").replace(/[^\d+]/g, "");
  if (kind === "sms" && phone) await UI.openURL(`sms:${phone}`);
  if (kind === "tel" && phone) await UI.openURL(`tel:${phone}`);
  if (kind === "mail" && p.email) await UI.openURL(`mailto:${p.email}`);
});

Script.action("remove", async ({ id }) => {
  const p = people().find((x) => x.id === id);
  if (!p) return;
  const choice = await UI.alert({ title: `Remove ${p.name}?`, message: "Only from this list; the contact itself is untouched.", buttons: ["Cancel", "Remove"] });
  if (choice !== 1) return;
  await forget(id);
  savePeople(people().filter((x) => x.id !== id));
  setUi({ page: "home", selected: null });
});

Script.action("removeAll", async () => {
  const choice = await UI.alert({ title: "Remove everyone?", message: "The list and its notifications are cleared. Contacts are not changed.", buttons: ["Cancel", "Remove all"] });
  if (choice !== 1) return;
  for (const p of people()) await forget(p.id);
  savePeople([]);
  Storage.remove("lastImport");
});

Script.action("setting", async ({ key, value, isOn }) => {
  Storage.set("settings", { ...settings(), [key]: value ?? isOn });
  await scheduleAll();
});

Script.action("reschedule", async () => {
  const result = await scheduleAll();
  await UI.alert({ title: "Notifications updated", message: `${result.birthdays} birthday${result.birthdays === 1 ? "" : "s"} in the next ${BIRTHDAY_WINDOW} days and ${result.overdue} overdue.` });
});

// ───────────────────────────────────────────── Widget

function birthdayLine(p) {
  const b = p.birthdayNext;
  return `${p.givenName} ${inText(b.days)}${b.age ? ` (${b.age})` : ""}`;
}

function spokeButton(id, font = "caption2") {
  return Widget.button(Widget.text("Spoke", { font, weight: "semibold", color: PINK, padding: { horizontal: 7, vertical: 3 }, background: { light: "#DB277722", dark: "#DB277744" }, cornerRadius: 7 }), "spoke", { id });
}

function overdueRow(p, withButton) {
  return Widget.hstack([
    Widget.symbol("clock.badge.exclamationmark", { size: 12, color: "orange", fallback: "⏰" }),
    Widget.vstack([
      Widget.text(p.name, { font: "footnote", weight: "medium", lineLimit: 1 }),
      Widget.text(`${p.overdueDays === 0 ? "due today" : `${p.overdueDays} d overdue`} · ${p.cadenceLabel.toLowerCase()}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 0 }),
    Widget.spacer(),
    withButton ? spokeButton(p.id) : null,
  ], { spacing: 6 });
}

function birthdayCard(p, big) {
  if (!p) {
    return Widget.vstack([
      Widget.symbol("gift", { size: big ? 26 : 20, color: "secondary", fallback: "🎁" }),
      Widget.text(`No birthdays in ${BIRTHDAY_WINDOW} days`, { font: "caption2", color: "secondary", lineLimit: 2 }),
    ], { alignment: "leading", spacing: 4 });
  }
  const b = p.birthdayNext;
  return Widget.vstack([
    Widget.hstack([
      Widget.symbol("gift.fill", { size: 12, color: PINK, fallback: "🎁" }),
      Widget.text("NEXT BIRTHDAY", { font: "caption2", weight: "bold", color: "secondary" }),
    ], { spacing: 4 }),
    Widget.text(p.name, { font: big ? "headline" : "subheadline", weight: "semibold", lineLimit: 1, minimumScale: 0.8 }),
    b.days === 0
      ? Widget.text("Today 🎂", { font: big ? 28 : 22, weight: "bold", design: "rounded", color: PINK })
      : Widget.hstack([
          Widget.text(String(b.days), { font: big ? 34 : 26, weight: "bold", design: "rounded", color: PINK }),
          Widget.text(b.days === 1 ? "day" : "days", { font: "caption", weight: "medium", color: "secondary" }),
        ], { spacing: 3, alignment: "bottom" }),
    Widget.text(`${longDate(b.date)}${b.age ? ` · turns ${b.age}` : ""}`, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
  ], { alignment: "leading", spacing: 1 });
}

Script.widget(({ family }) => {
  const { all, overdue, birthdays } = overview();
  const next = birthdays[0] ?? null;
  const worst = overdue[0] ?? null;
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  const midnight = new Date(); midnight.setHours(24, 0, 10, 0);
  let content;

  if (family === "inline") {
    content = Widget.text(next ? `Birthday: ${birthdayLine(next)}` : worst ? `Overdue: ${worst.givenName} · ${worst.overdueDays} d` : all.length ? "Keep in Touch: all caught up" : "Keep in Touch: add people");
  } else if (family === "rectangular") {
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol(next ? "gift.fill" : "person.2.fill", { size: 12, fallback: "🎁" }),
        Widget.text(next ? birthdayLine(next) : all.length ? "No birthdays soon" : "Add people in Scriptwell", { font: "headline", lineLimit: 1, minimumScale: 0.8 }),
      ], { spacing: 4 }),
      Widget.text(worst ? `Overdue: ${overdue.slice(0, 2).map((p) => `${p.givenName} ${p.overdueDays} d`).join(", ")}${overdue.length > 2 ? ` +${overdue.length - 2}` : ""}` : "Nobody overdue", { font: "caption", lineLimit: 1, minimumScale: 0.8 }),
      next && next.birthdayNext.days > 0 ? Widget.text(longDate(next.birthdayNext.date), { font: "caption2" }) : null,
    ], { alignment: "leading", spacing: 1 });
  } else if (all.length === 0) {
    content = Widget.vstack([
      Widget.symbol("person.2.wave.2.fill", { size: family === "small" ? 30 : 40, color: PINK, fallback: "👋" }),
      Widget.text("Keep in Touch", { font: "headline" }),
      Widget.text("Add people in Scriptwell", { font: "caption2", color: "secondary", align: "center" }),
    ], { spacing: 4, url: APP_LINK });
  } else if (family === "small") {
    content = Widget.vstack([
      birthdayCard(next, false),
      Widget.spacer(),
      Widget.divider(),
      worst
        ? Widget.vstack([
            Widget.text(`${overdue.length} OVERDUE`, { font: "caption2", weight: "bold", color: "orange" }),
            Widget.text(`${worst.name} · ${worst.overdueDays} d`, { font: "caption", lineLimit: 1, minimumScale: 0.7 }),
          ], { alignment: "leading", spacing: 0 })
        : Widget.hstack([
            Widget.symbol("checkmark.circle.fill", { size: 11, color: "green", fallback: "✓" }),
            Widget.text("All caught up", { font: "caption", color: "secondary" }),
          ], { spacing: 4 }),
    ], { alignment: "leading", spacing: 4, url: APP_LINK, frame: fill });
  } else if (family === "medium") {
    content = Widget.hstack([
      Widget.vstack([birthdayCard(next, true), Widget.spacer(), birthdays.length > 1 ? Widget.text(`then ${birthdays[1].givenName} ${inText(birthdays[1].birthdayNext.days)}`, { font: "caption2", color: "secondary", lineLimit: 1 }) : null],
        { alignment: "leading", spacing: 2, padding: 10, background: TILE_BG, cornerRadius: 12, frame: { width: 128, maxHeight: "infinity", alignment: "topLeading" } }),
      Widget.vstack([
        Widget.text(overdue.length ? `${overdue.length} OVERDUE` : "OVERDUE", { font: "caption2", weight: "bold", color: overdue.length ? "orange" : "secondary" }),
        ...overdue.slice(0, 3).map((p) => overdueRow(p, true)),
        overdue.length === 0 ? Widget.text("All caught up. Nice.", { font: "footnote", color: "secondary" }) : null,
        overdue.length > 3 ? Widget.text(`+${overdue.length - 3} more`, { font: "caption2", color: "secondary" }) : null,
        Widget.spacer(),
      ], { alignment: "leading", spacing: 5, frame: fill }),
    ], { spacing: 10, url: APP_LINK, frame: fill });
  } else {
    content = Widget.vstack([
      Widget.hstack([
        Widget.symbol("person.2.wave.2.fill", { size: 15, color: PINK, fallback: "👋" }),
        Widget.text("Keep in Touch", { font: "headline" }),
        Widget.spacer(),
        Widget.text(`${all.length} people`, { font: "caption", color: "secondary" }),
      ], { spacing: 6 }),
      Widget.text(`BIRTHDAYS · NEXT ${BIRTHDAY_WINDOW} DAYS`, { font: "caption2", weight: "bold", color: "secondary" }),
      ...birthdays.slice(0, 4).map((p) => Widget.hstack([
        Widget.symbol("gift.fill", { size: 12, color: PINK, fallback: "🎁" }),
        Widget.text(p.name, { font: "footnote", weight: "medium", lineLimit: 1 }),
        Widget.spacer(),
        Widget.text(`${longDate(p.birthdayNext.date)}${p.birthdayNext.age ? ` · ${p.birthdayNext.age}` : ""}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
        Widget.text(inText(p.birthdayNext.days), { font: "footnote", weight: "semibold", design: "rounded", color: p.birthdayNext.days <= 3 ? PINK : "primary" }),
      ], { spacing: 6 })),
      birthdays.length === 0 ? Widget.text("No birthdays coming up.", { font: "footnote", color: "secondary" }) : null,
      Widget.text(overdue.length ? `${overdue.length} OVERDUE` : "OVERDUE", { font: "caption2", weight: "bold", color: overdue.length ? "orange" : "secondary" }),
      ...overdue.slice(0, 5).map((p) => overdueRow(p, true)),
      overdue.length === 0 ? Widget.text("Everyone has heard from you recently.", { font: "footnote", color: "secondary" }) : null,
      Widget.spacer(),
    ], { alignment: "leading", spacing: 6, url: APP_LINK, frame: fill });
  }

  return { content, refreshAt: midnight };
});

// ───────────────────────────────────────────── Mini-app pages

function contactButtons(p, compact) {
  const phone = Boolean(p.phone);
  const btn = (symbol, kind, label, enabled) => (enabled
    ? Widget.button(compact ? Widget.symbol(symbol, { size: 18, color: PINK, fallback: label }) : Widget.label(label, symbol), "contact", { id: p.id, kind }, { style: compact ? "plain" : "bordered" })
    : null);
  return Widget.hstack([
    btn("message.fill", "sms", "Message", phone),
    btn("phone.fill", "tel", "Call", phone),
    btn("envelope.fill", "mail", "Email", Boolean(p.email)),
  ], { spacing: compact ? 12 : 8 });
}

function homePage() {
  const { all, overdue, birthdays } = overview();
  const stat = (n, label, color) => Widget.vstack([
    Widget.text(String(n), { font: "title2", weight: "bold", design: "rounded", color }),
    Widget.text(label, { font: "caption2", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
  ], { alignment: "leading", spacing: 0, padding: 10, background: TILE_BG, cornerRadius: 12, frame: { maxWidth: "infinity", alignment: "leading" } });

  const overdueCards = overdue.map((p) => Widget.vstack([
    Widget.hstack([
      Widget.button(Widget.vstack([
        Widget.text(p.name, { font: "headline", lineLimit: 1 }),
        Widget.text(`${p.overdueDays === 0 ? "Due today" : `${p.overdueDays} days overdue`} · ${p.cadenceLabel.toLowerCase()} · last spoke ${sinceText(p.lastSpoke)}`, { font: "caption", color: "secondary", lineLimit: 2 }),
      ], { alignment: "leading", spacing: 1 }), "open", { id: p.id }, { style: "plain" }),
      Widget.spacer(),
      contactButtons(p, true),
    ], { spacing: 8 }),
    Widget.button("Spoke today", "spoke", { id: p.id }, { style: "prominent", color: "pink" }),
  ], { alignment: "leading", spacing: 8, padding: 12, background: { light: "#F9731622", dark: "#F9731633" }, cornerRadius: 14 }));

  const birthdayRows = birthdays.map((p) => ({
    title: p.name,
    subtitle: `${longDate(p.birthdayNext.date)}${p.birthdayNext.age ? ` · turns ${p.birthdayNext.age}` : ""}`,
    symbol: "gift.fill", color: "pink",
    detail: inText(p.birthdayNext.days),
    action: "open", args: { id: p.id },
  }));

  const everyoneRows = [...all].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({
    title: p.name,
    subtitle: p.due ? `${p.cadenceLabel} · last spoke ${sinceText(p.lastSpoke)}` : p.birthday ? "Birthdays only" : "No cadence",
    symbol: p.overdue ? "clock.badge.exclamationmark" : p.due ? "checkmark.circle" : "gift",
    color: p.overdue ? "orange" : p.due ? "green" : "gray",
    detail: p.overdue ? `${p.overdueDays} d late` : p.due ? `due ${inText(dayDiff(today(), p.due))}` : "",
    action: "open", args: { id: p.id },
  }));

  return Widget.vstack([
    Widget.hstack([
      stat(overdue.length, "overdue", overdue.length ? "orange" : "green"),
      stat(birthdays.length, `birthdays · ${BIRTHDAY_WINDOW} d`, "pink"),
      stat(all.length, "people", "primary"),
    ], { spacing: 8 }),
    Widget.hstack([
      Widget.button("Add a person", "pick", null, { style: "prominent", color: "pink" }),
      Widget.button("Import birthdays", "import", null, { style: "bordered" }),
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [
        { title: "Settings", symbol: "gearshape", action: "page", args: { page: "settings" } },
        { title: "Update notifications", symbol: "bell.badge", action: "reschedule" },
        { title: "Remove everyone", symbol: "trash", action: "removeAll", destructive: true },
      ]),
    ], { spacing: 8 }),
    all.length === 0 ? Widget.vstack([
      Widget.symbol("person.2.wave.2.fill", { size: 48, color: "pink", fallback: "👋" }),
      Widget.text("Who do you want to stay close to?", { font: "headline" }),
      Widget.text("Pick people one at a time from Contacts, or import everyone with a birthday.", { font: "footnote", color: "secondary", align: "center" }),
    ], { spacing: 6, padding: 24, frame: { maxWidth: "infinity" } }) : null,
    overdue.length ? Widget.text("OVERDUE", { font: "caption2", weight: "bold", color: "orange" }) : null,
    ...overdueCards,
    birthdayRows.length ? Widget.list(birthdayRows, { title: `Birthdays in the next ${BIRTHDAY_WINDOW} days` }) : null,
    all.length ? Widget.list(everyoneRows, { title: "Everyone" }) : null,
  ], { alignment: "leading", spacing: 14, padding: 16 });
}

function personPage() {
  const p = people().map(derive).find((x) => x.id === ui().selected);
  if (!p) return Widget.vstack([Widget.button("‹ Back", "page", { page: "home" }, { style: "plain" })], { padding: 16 });
  const b = p.birthdayNext;
  const status = p.overdue ? { text: p.overdueDays === 0 ? "Due today" : `${p.overdueDays} days overdue`, color: "orange" }
    : p.due ? { text: `Next catch-up ${inText(dayDiff(today(), p.due))}`, color: "green" } : { text: "Birthday reminders only", color: "secondary" };
  return Widget.vstack([
    Widget.button("‹ Back", "page", { page: "home" }, { style: "plain" }),
    Widget.hstack([
      Widget.symbol("person.crop.circle.fill", { size: 56, color: "pink", fallback: "👤" }),
      Widget.vstack([
        Widget.text(p.name, { font: "title2", weight: "bold", lineLimit: 2 }),
        Widget.text(status.text, { font: "subheadline", color: status.color }),
      ], { alignment: "leading", spacing: 2 }),
    ], { spacing: 12 }),
    contactButtons(p, false),
    Widget.card([
      Widget.hstack([Widget.text("Phone", { color: "secondary" }), Widget.spacer(), Widget.text(p.phone ?? "none", { weight: "medium" })]),
      Widget.hstack([Widget.text("Email", { color: "secondary" }), Widget.spacer(), Widget.text(p.email ?? "none", { weight: "medium", lineLimit: 1, minimumScale: 0.7 })]),
      Widget.hstack([Widget.text("Birthday", { color: "secondary" }), Widget.spacer(), Widget.text(b ? `${longDate(b.date)} · ${inText(b.days)}${b.age ? ` · turns ${b.age}` : ""}` : "not in Contacts", { weight: "medium", lineLimit: 1, minimumScale: 0.7 })]),
    ], { title: "From Contacts", symbol: "person.text.rectangle", color: "pink" }),
    Widget.vstack([
      Widget.text("How often do you want to talk?", { font: "caption", color: "secondary" }),
      Widget.picker(CADENCES.map((c) => ({ label: c.label, value: c.id })), p.cadence, "cadence", { id: p.id }),
    ], { alignment: "leading", spacing: 4 }),
    Widget.vstack([
      Widget.text(`Last spoke ${sinceText(p.lastSpoke)}`, { font: "caption", color: "secondary" }),
      Widget.hstack([
        Widget.datePicker(`${p.lastSpoke ?? today()}T12:00:00`, "lastSpoke", { id: p.id }, { mode: "date", max: new Date().toISOString() }),
        Widget.spacer(),
        Widget.button("Spoke today", "spoke", { id: p.id }, { style: "prominent", color: "pink" }),
      ], { spacing: 8 }),
    ], { alignment: "leading", spacing: 4 }),
    Widget.divider(),
    Widget.text(p.source === "birthdays" ? "Added by the birthday import." : "Added with the contact picker.", { font: "caption", color: "secondary" }),
    Widget.button("Remove from Keep in Touch", "remove", { id: p.id }, { style: "bordered", color: "red" }),
  ], { alignment: "leading", spacing: 16, padding: 16 });
}

function settingsPage() {
  const s = settings();
  const last = Storage.get("lastImport");
  const hours = Array.from({ length: 15 }, (_, i) => i + 7).map((h) => ({ label: `${String(h).padStart(2, "0")}:00`, value: h }));
  return Widget.vstack([
    Widget.button("‹ Back", "page", { page: "home" }, { style: "plain" }),
    Widget.text("Settings", { font: "title2", weight: "bold" }),
    Widget.toggle("Birthday notifications", s.birthdayNotify, "setting", { key: "birthdayNotify" }, { color: "pink" }),
    Widget.toggle("Overdue notifications", s.overdueNotify, "setting", { key: "overdueNotify" }, { color: "pink" }),
    Widget.vstack([Widget.text("Notify at", { font: "caption", color: "secondary" }), Widget.picker(hours, s.hour, "setting", { key: "hour" })], { alignment: "leading", spacing: 4 }),
    Widget.text("Notifications are scheduled when you use the app and during background runs, which iOS allows a few times a day. Keep Background App Refresh on for Scriptwell.", { font: "caption", color: "secondary" }),
    Widget.divider(),
    Widget.text("Privacy", { font: "headline" }),
    Widget.text("Names, numbers, emails and birthdays are copied into this script's private storage on your device and nowhere else. The script has no network permission.", { font: "caption", color: "secondary" }),
    last ? Widget.text(`Last birthday import ${sinceText(isoDay(last.time))}: ${last.added} added from ${last.scanned} contacts.`, { font: "caption", color: "secondary" }) : null,
  ], { alignment: "leading", spacing: 14, padding: 16 });
}

Script.ui(() => {
  const page = ui().page ?? "home";
  const { overdue } = overview();
  const titles = { home: overdue.length ? `Keep in Touch (${overdue.length})` : "Keep in Touch", person: "Person", settings: "Settings" };
  const pages = { home: homePage, person: personPage, settings: settingsPage };
  return { title: titles[page] ?? "Keep in Touch", content: (pages[page] ?? homePage)() };
});

// ───────────────────────────────────────────── Run and background

Script.background(async () => {
  try { await scheduleAll(); } catch (error) { Storage.set("lastError", `${new Date().toISOString()} ${error.message}`); }
});

Script.run(async () => {
  await scheduleAll();
  const { all, overdue, birthdays } = overview();
  if (all.length === 0) return "Nobody in Keep in Touch yet. Open the mini-app to add people.";
  const lines = [];
  if (birthdays.length) lines.push(`Birthdays: ${birthdays.slice(0, 5).map(birthdayLine).join(", ")}.`);
  else lines.push(`No birthdays in the next ${BIRTHDAY_WINDOW} days.`);
  if (overdue.length) lines.push(`Overdue: ${overdue.slice(0, 5).map((p) => `${p.givenName} (${p.overdueDays} d)`).join(", ")}.`);
  else lines.push("Nobody is overdue.");
  return lines.join("\n");
});
