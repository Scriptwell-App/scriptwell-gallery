// @name        Time & Invoice
// @description Track billable hours per client with live timers, manual entries and one-tap import of today's calendar events, see monthly totals and hours per weekday, and produce CSV and plain-text invoices; nothing leaves the device
// @permissions calendar
// @widget      small, medium, rectangular, inline
// @icon        clock.badge.checkmark.fill
// @color       #0F766E
// @version     1.0.0
// @author      scriptwell
// @category    business

// How it works
// • Add clients with an hourly rate and a currency in the Clients tab, then start and stop a timer per client in the Track tab. Only the start time is stored, so the timer survives closing the app.
// • Manual entries and "Import today's events" (your calendar, read on the device) add billable blocks; imported events are remembered so they are not added twice.
// • The Report tab shows hours and amounts per client for any month and a chart of hours per weekday. The Invoices tab writes a numbered invoice as CSV and plain text into the script's Files folder, to share or save anywhere.
// • Home Screen widgets show the running timer with a Stop button, or today's and this month's totals; Lock Screen widgets show the running timer and client.
// • Everything stays in Storage and Files on the device. No network is used. Run the script once in the app before adding a widget.

// ───────────────────────── Constants and helpers

const HOUR = 3_600_000;
const DAY = 86_400_000;
const TEAL = "#0F766E";
const TILE = { light: "#F0FDFA", dark: "#132A27" };
const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "CAD", "AUD", "NZD", "JPY", "SEK", "NOK", "DKK", "PLN", "CZK", "INR", "BRL", "ZAR"];
const COLORS = ["#0F766E", "#2563EB", "#7C3AED", "#DB2777", "#EA580C", "#CA8A04", "#16A34A", "#475569"];
const locale = Script.env.locale;
const appLink = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

const dayKey = (d = new Date()) => new Date(d).toLocaleDateString("en-CA");
const monthKey = (d = new Date()) => dayKey(d).slice(0, 7);
const startOfDay = (d = new Date()) => { const s = new Date(d); s.setHours(0, 0, 0, 0); return s; };
const fmtHours = (h) => `${h.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 })} h`;
const fmtTime = (d) => new Date(d).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
const fmtDate = (d, options = { day: "numeric", month: "short" }) => new Date(d).toLocaleDateString(locale, options);
const monthLabel = (key) => new Date(`${key}-01T12:00:00`).toLocaleDateString(locale, { month: "long", year: "numeric" });
const notice = (text, kind = "info") => Storage.set("notice", { text, kind, time: Date.now() });

function fmtMoney(amount, currency) {
  try {
    return amount.toLocaleString(locale, { style: "currency", currency, maximumFractionDigits: 2 });
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function defaultCurrency() {
  const region = (locale.split("-")[1] ?? "").toUpperCase();
  const map = { US: "USD", GB: "GBP", CH: "CHF", CA: "CAD", AU: "AUD", NZ: "NZD", JP: "JPY", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", IN: "INR", BR: "BRL", ZA: "ZAR" };
  return map[region] ?? (["DE", "FR", "ES", "IT", "NL", "AT", "BE", "IE", "PT", "FI"].includes(region) ? "EUR" : "USD");
}

// ───────────────────────── Data in Storage

const clients = () => Storage.get("clients", []);
const entries = () => Storage.get("entries", []);
const running = () => Storage.get("running");
const client = (id) => clients().find((c) => c.id === id) ?? null;
const clientName = (id) => client(id)?.name ?? "Unknown client";
const settings = () => ({ rounding: 0, me: { name: "", details: "" }, ...Storage.get("settings", {}) });
const saveSettings = (changes) => Storage.set("settings", { ...settings(), ...changes });
const newId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

// Billable hours of an entry, rounded up to the chosen number of minutes.
function billableHours(entry) {
  const minutes = Math.max(0, (entry.end - entry.start) / 60_000);
  const step = settings().rounding;
  const rounded = step > 0 ? Math.ceil(minutes / step) * step : minutes;
  return rounded / 60;
}

const amountOf = (entry) => billableHours(entry) * (client(entry.clientId)?.rate ?? 0);
const entriesOn = (day) => entries().filter((e) => dayKey(e.start) === day);
const entriesIn = (month, clientId = null) => entries().filter((e) => monthKey(e.start) === month && (!clientId || e.clientId === clientId));
const hoursOf = (list) => list.reduce((sum, e) => sum + billableHours(e), 0);
const runningHours = () => (running() ? (Date.now() - running().start) / HOUR : 0);

function addEntry(entry) {
  Storage.set("entries", [{ id: newId(), source: "manual", note: "", ...entry }, ...entries()].slice(0, 5000));
}

// Totals per client for a month, in the client's own currency.
function totals(month) {
  return clients().map((c) => {
    const list = entriesIn(month, c.id);
    const hours = hoursOf(list);
    return { client: c, hours, amount: hours * c.rate, count: list.length };
  }).filter((t) => t.count > 0).sort((a, b) => b.hours - a.hours);
}

function weekdayHours(month) {
  const sums = [0, 0, 0, 0, 0, 0, 0]; // Monday first
  for (const e of entriesIn(month)) sums[(new Date(e.start).getDay() + 6) % 7] += billableHours(e);
  const monday = new Date(2024, 0, 1); // a Monday
  return sums.map((y, i) => ({ x: new Date(monday.getTime() + i * DAY).toLocaleDateString(locale, { weekday: "short" }), y: Math.round(y * 100) / 100 }));
}

function months() {
  const list = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < 12; i++) {
    const key = monthKey(d);
    list.push({ label: monthLabel(key), value: key });
    d.setMonth(d.getMonth() - 1);
  }
  return list;
}

// ───────────────────────── Timers

Script.action("start", ({ clientId }) => {
  if (running()) stopTimer();
  Storage.set("running", { clientId, start: Date.now(), note: "" });
  Storage.set("lastClient", clientId);
});

function stopTimer() {
  const r = running();
  if (!r) return;
  Storage.remove("running");
  if (Date.now() - r.start >= 60_000) addEntry({ clientId: r.clientId, start: r.start, end: Date.now(), note: r.note ?? "", source: "timer" });
}

Script.action("stop", () => stopTimer());
Script.action("runningNote", ({ value }) => { const r = running(); if (r) Storage.set("running", { ...r, note: value }); });
Script.action("discard", async () => {
  const choice = await UI.alert({ title: "Discard the running timer?", buttons: ["Keep", "Discard"] });
  if (choice === 1) Storage.remove("running");
});

// ───────────────────────── Manual entries and calendar import

const draft = () => ({ clientId: clients()[0]?.id ?? null, start: new Date(Date.now() - HOUR).toISOString(), minutes: 60, note: "", ...Storage.get("draft", {}) });
Script.action("draft", ({ field, value }) => Storage.set("draft", { ...draft(), [field]: value }));

Script.action("addManual", async () => {
  const d = draft();
  if (!d.clientId || !client(d.clientId)) return notice("Pick a client first.", "warn");
  const start = new Date(d.start).getTime();
  addEntry({ clientId: d.clientId, start, end: start + d.minutes * 60_000, note: d.note.trim(), source: "manual" });
  Storage.set("draft", { ...d, note: "" });
  notice(`Added ${fmtHours(d.minutes / 60)} for ${clientName(d.clientId)}.`, "success");
  await UI.haptic("success");
});

Script.action("importClient", ({ value }) => Storage.set("importClient", value));

Script.action("importToday", async () => {
  const clientId = Storage.get("importClient") ?? clients()[0]?.id;
  if (!clientId) return notice("Add a client first.", "warn");
  try {
    const start = startOfDay();
    const events = await Calendar.events({ start, end: new Date(start.getTime() + DAY) });
    const known = new Set(entries().map((e) => e.eventId).filter(Boolean));
    const fresh = events.filter((ev) => !ev.allDay && !known.has(ev.id) && new Date(ev.end) > new Date(ev.start));
    for (const ev of fresh) {
      addEntry({ clientId, start: new Date(ev.start).getTime(), end: new Date(ev.end).getTime(), note: ev.title, source: "calendar", eventId: ev.id });
    }
    const skipped = events.length - fresh.length;
    notice(fresh.length
      ? `Imported ${fresh.length} event${fresh.length === 1 ? "" : "s"} (${fmtHours(hoursOf(fresh.map((ev) => ({ start: new Date(ev.start).getTime(), end: new Date(ev.end).getTime() }))))}) for ${clientName(clientId)}${skipped ? `; ${skipped} skipped` : ""}.`
      : events.length ? "Every timed event today was already imported." : "No timed events in your calendar today.", fresh.length ? "success" : "info");
  } catch (error) {
    notice(`Could not read the calendar: ${error.message}`, "warn");
  }
});

Script.action("deleteEntry", async ({ id }) => {
  const choice = await UI.alert({ title: "Delete this entry?", buttons: ["Cancel", "Delete"] });
  if (choice === 1) Storage.set("entries", entries().filter((e) => e.id !== id));
});

// ───────────────────────── Clients and settings

Script.action("addClient", async () => {
  const name = await UI.prompt({ title: "Client name", placeholder: "Acme Ltd" });
  if (!name?.trim()) return;
  const rateText = await UI.prompt({ title: `Hourly rate for ${name.trim()}`, placeholder: "95" });
  const rate = Number(String(rateText ?? "").replace(",", "."));
  const list = clients();
  const c = { id: newId(), name: name.trim(), rate: Number.isFinite(rate) && rate >= 0 ? rate : 0, currency: list[0]?.currency ?? defaultCurrency(), color: COLORS[list.length % COLORS.length] };
  Storage.set("clients", [...list, c]);
  Storage.set("lastClient", c.id);
});

Script.action("client", ({ id, field, value }) => {
  Storage.set("clients", clients().map((c) => {
    if (c.id !== id) return c;
    if (field === "rate") {
      const rate = Number(String(value).replace(",", "."));
      return Number.isFinite(rate) && rate >= 0 ? { ...c, rate } : c;
    }
    return { ...c, [field]: field === "name" ? (String(value).trim() || c.name) : value };
  }));
});

Script.action("deleteClient", async ({ id }) => {
  const count = entries().filter((e) => e.clientId === id).length;
  const choice = await UI.alert({ title: `Delete ${clientName(id)}?`, message: count ? `Its ${count} time entries are deleted too.` : "This cannot be undone.", buttons: ["Cancel", "Delete"] });
  if (choice !== 1) return;
  Storage.set("clients", clients().filter((c) => c.id !== id));
  Storage.set("entries", entries().filter((e) => e.clientId !== id));
  if (running()?.clientId === id) Storage.remove("running");
});

Script.action("rounding", ({ value }) => saveSettings({ rounding: value }));
Script.action("me", ({ field, value }) => saveSettings({ me: { ...settings().me, [field]: value } }));
Script.action("month", ({ value }) => Storage.set("month", value));
Script.action("invoiceClient", ({ value }) => Storage.set("invoiceClient", value));
Script.action("tab", ({ value }) => Storage.set("tab", value));

// ───────────────────────── Invoices

function invoiceText(inv, lines, c) {
  const me = settings().me;
  const pad = (text, width, right = false) => (right ? String(text).padStart(width) : String(text).padEnd(width)).slice(0, width);
  const rows = lines.map((l) => `${pad(l.date, 11)} ${pad(l.description, 30)} ${pad(l.hours.toFixed(2), 7, true)} ${pad(l.amount.toFixed(2), 11, true)}`);
  return [
    `INVOICE ${inv.number}`,
    `Date: ${fmtDate(inv.date, { day: "numeric", month: "long", year: "numeric" })}`,
    "",
    me.name ? `From: ${me.name}` : null,
    me.details ? me.details : null,
    me.name || me.details ? "" : null,
    `To: ${c.name}`,
    `Period: ${monthLabel(inv.month)}`,
    `Rate: ${fmtMoney(c.rate, c.currency)} per hour`,
    "",
    `${pad("Date", 11)} ${pad("Description", 30)} ${pad("Hours", 7, true)} ${pad("Amount", 11, true)}`,
    "-".repeat(62),
    ...rows,
    "-".repeat(62),
    `${pad("Total hours", 42)} ${pad(inv.hours.toFixed(2), 7, true)}`,
    `${pad("TOTAL", 42)} ${pad(fmtMoney(inv.total, c.currency), 19, true)}`,
    "",
    "Thank you.",
  ].filter((line) => line !== null).join("\n");
}

function invoiceCsv(inv, lines, c) {
  const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
  return [
    ["invoice", "date", "start", "end", "description", "hours", "rate", "currency", "amount"].join(","),
    ...lines.map((l) => [inv.number, l.date, l.start, l.end, cell(l.description), l.hours.toFixed(2), c.rate, c.currency, l.amount.toFixed(2)].join(",")),
    [inv.number, "", "", "", cell("TOTAL"), inv.hours.toFixed(2), c.rate, c.currency, inv.total.toFixed(2)].join(","),
  ].join("\n");
}

Script.action("createInvoice", async () => {
  const month = Storage.get("month", monthKey());
  const c = client(Storage.get("invoiceClient")) ?? client(totals(month)[0]?.client.id);
  if (!c) return notice("Pick a client with hours in this month.", "warn");
  const list = entriesIn(month, c.id).sort((a, b) => a.start - b.start);
  if (!list.length) return notice(`No entries for ${c.name} in ${monthLabel(month)}.`, "warn");

  const seq = Storage.get("invoiceSeq", 0) + 1;
  const number = `INV-${month.replace("-", "")}-${String(seq).padStart(3, "0")}`;
  const lines = list.map((e) => ({
    date: dayKey(e.start), start: fmtTime(e.start), end: fmtTime(e.end),
    description: e.note || (e.source === "calendar" ? "Meeting" : "Work"),
    hours: billableHours(e), amount: amountOf(e),
  }));
  const inv = { number, clientId: c.id, month, date: Date.now(), hours: hoursOf(list), total: lines.reduce((s, l) => s + l.amount, 0), currency: c.currency, csv: `invoices/${number}.csv`, txt: `invoices/${number}.txt` };
  await Files.write(inv.txt, invoiceText(inv, lines, c));
  await Files.write(inv.csv, invoiceCsv(inv, lines, c));
  Storage.set("invoiceSeq", seq);
  Storage.set("invoices", [inv, ...Storage.get("invoices", [])].slice(0, 200));
  notice(`${number} created: ${fmtHours(inv.hours)}, ${fmtMoney(inv.total, c.currency)}.`, "success");
  await UI.haptic("success");
});

Script.action("shareInvoice", async ({ path }) => { await UI.share({ file: path }); });
Script.action("exportInvoice", async ({ path, name }) => {
  const saved = await Files.export(path, { name });
  if (saved) notice(`Saved ${name}.`, "success");
});

Script.action("deleteInvoice", async ({ number }) => {
  const choice = await UI.alert({ title: `Delete ${number}?`, message: "The CSV and text files are removed. The time entries stay.", buttons: ["Cancel", "Delete"] });
  if (choice !== 1) return;
  const inv = Storage.get("invoices", []).find((i) => i.number === number);
  for (const path of [inv?.csv, inv?.txt]) {
    if (path) { try { await Files.remove(path); } catch { /* already gone */ } }
  }
  Storage.set("invoices", Storage.get("invoices", []).filter((i) => i.number !== number));
});

Script.action("exportMonth", async () => {
  const month = Storage.get("month", monthKey());
  const list = entriesIn(month).sort((a, b) => a.start - b.start);
  if (!list.length) return notice("Nothing to export for this month.", "warn");
  const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [
    "date,start,end,client,description,hours,rate,currency,amount,source",
    ...list.map((e) => [dayKey(e.start), fmtTime(e.start), fmtTime(e.end), cell(clientName(e.clientId)), cell(e.note ?? ""), billableHours(e).toFixed(2), client(e.clientId)?.rate ?? 0, client(e.clientId)?.currency ?? "", amountOf(e).toFixed(2), e.source].join(",")),
  ].join("\n");
  const path = `exports/hours-${month}.csv`;
  await Files.write(path, csv);
  await UI.share({ file: path });
});

// ───────────────────────── Widget

function monthSummary() {
  const month = monthKey();
  const t = totals(month);
  const byCurrency = {};
  for (const x of t) byCurrency[x.client.currency] = (byCurrency[x.client.currency] ?? 0) + x.amount;
  const parts = Object.entries(byCurrency).map(([cur, amount]) => fmtMoney(amount, cur));
  return { hours: hoursOf(entriesIn(month)), money: parts.join(" + ") || fmtMoney(0, clients()[0]?.currency ?? defaultCurrency()), top: t.slice(0, 3) };
}

Script.widget(({ family }) => {
  const r = running();
  const c = r ? client(r.clientId) : null;
  const today = hoursOf(entriesOn(dayKey())) + runningHours();
  const month = monthSummary();
  const last = client(Storage.get("lastClient")) ?? clients()[0] ?? null;
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };
  let content;

  if (family === "inline") {
    content = r ? Widget.date(r.start, { style: "timer" }) : Widget.text(`Today ${fmtHours(today)} · ${monthLabel(monthKey()).split(" ")[0]} ${fmtHours(month.hours)}`);
  } else if (family === "rectangular") {
    content = r
      ? Widget.vstack([
        Widget.hstack([
          Widget.symbol("record.circle.fill", { size: 11, fallback: "●" }),
          Widget.text(c?.name ?? "Timer", { font: "headline", lineLimit: 1 }),
        ], { spacing: 4 }),
        Widget.date(r.start, { style: "timer", font: "title2", weight: "bold", design: "rounded" }),
        Widget.text(r.note || `Today ${fmtHours(today)}`, { font: "caption2", lineLimit: 1 }),
      ], { alignment: "leading", spacing: 1 })
      : Widget.vstack([
        Widget.text("No timer running", { font: "headline" }),
        Widget.text(`Today ${fmtHours(today)}`, { font: "caption" }),
        Widget.text(`${monthLabel(monthKey()).split(" ")[0]}: ${fmtHours(month.hours)} · ${month.money}`, { font: "caption2", lineLimit: 1, minimumScale: 0.7 }),
      ], { alignment: "leading", spacing: 1 });
  } else {
    const hero = r
      ? Widget.vstack([
        Widget.hstack([
          Widget.symbol("record.circle.fill", { size: 11, color: "red", fallback: "●" }),
          Widget.text(c?.name ?? "Timer", { font: "caption", weight: "semibold", color: c?.color ?? TEAL, lineLimit: 1 }),
          Widget.spacer(),
        ], { spacing: 4 }),
        Widget.date(r.start, { style: "timer", font: family === "small" ? 30 : 34, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
        Widget.text(r.note || (c ? `${fmtMoney(c.rate, c.currency)}/h` : ""), { font: "caption2", color: "secondary", lineLimit: 1 }),
        Widget.spacer(),
        Widget.hstack([
          Widget.button(Widget.hstack([Widget.symbol("stop.fill", { size: 10, color: "white", fallback: "■" }), Widget.text("Stop", { font: "caption", weight: "bold", color: "white" })], { spacing: 4 }), "stop", null, { style: "prominent", color: "red" }),
          Widget.spacer(),
          Widget.text(`today ${fmtHours(today)}`, { font: "caption2", color: "secondary" }),
        ]),
      ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } })
      : Widget.vstack([
        Widget.text("TODAY", { font: "caption2", weight: "bold", color: "secondary" }),
        Widget.text(fmtHours(today), { font: family === "small" ? 30 : 34, weight: "bold", design: "rounded", color: TEAL, lineLimit: 1, minimumScale: 0.6 }),
        Widget.text(`${monthLabel(monthKey()).split(" ")[0]}: ${fmtHours(month.hours)}`, { font: "caption", color: "secondary" }),
        Widget.text(month.money, { font: "caption2", weight: "semibold", color: "secondary", lineLimit: 1, minimumScale: 0.7 }),
        Widget.spacer(),
        last ? Widget.button(Widget.hstack([Widget.symbol("play.fill", { size: 10, color: "white", fallback: "▶" }), Widget.text(last.name, { font: "caption", weight: "bold", color: "white", lineLimit: 1 })], { spacing: 4 }), "start", { clientId: last.id }, { style: "prominent", color: last.color }) : Widget.text("Add a client in the app", { font: "caption2", color: "secondary" }),
      ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });

    if (family === "small") {
      content = Widget.vstack([hero], { padding: 14, url: appLink, frame: fill });
    } else {
      const rows = month.top.map((t) => Widget.hstack([
        { type: "stack", direction: "vertical", children: [], background: t.client.color, cornerRadius: 3, frame: { width: 6, height: 22 } },
        Widget.vstack([
          Widget.text(t.client.name, { font: "caption", weight: "semibold", lineLimit: 1 }),
          Widget.text(fmtHours(t.hours), { font: "caption2", color: "secondary" }),
        ], { alignment: "leading", spacing: 0 }),
        Widget.spacer(),
        Widget.text(fmtMoney(t.amount, t.client.currency), { font: "caption", weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.7 }),
      ], { spacing: 8 }));
      content = Widget.hstack([
        Widget.vstack([hero], { padding: 10, background: TILE, cornerRadius: 14, frame: { width: 140, maxHeight: "infinity" } }),
        Widget.vstack([
          Widget.text(monthLabel(monthKey()).toUpperCase(), { font: "caption2", weight: "bold", color: "secondary" }),
          ...rows,
          rows.length ? null : Widget.text("No hours yet this month.", { font: "caption2", color: "secondary" }),
          Widget.spacer(),
        ], { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
      ], { spacing: 12, padding: 14, url: appLink, frame: fill });
    }
  }

  return { content, refreshAfter: r ? 15 * 60 : 60 * 60 };
});

// ───────────────────────── Script.run (Siri and Shortcuts)

Script.run((input) => {
  const r = running();
  const text = String(input ?? "").trim().toLowerCase();
  if (text === "stop" && r) {
    const hours = runningHours();
    stopTimer();
    return `Stopped ${clientName(r.clientId)} after ${fmtHours(hours)}.`;
  }
  if (text.startsWith("start ")) {
    const c = clients().find((x) => x.name.toLowerCase() === text.slice(6).trim());
    if (!c) return `No client called “${input.slice(6).trim()}”.`;
    if (r) stopTimer();
    Storage.set("running", { clientId: c.id, start: Date.now(), note: "" });
    Storage.set("lastClient", c.id);
    return `Timer started for ${c.name}.`;
  }
  const today = hoursOf(entriesOn(dayKey())) + runningHours();
  const month = monthSummary();
  return `${r ? `${clientName(r.clientId)} running for ${fmtHours(runningHours())}. ` : ""}${fmtHours(today)} today, ${fmtHours(month.hours)} this month (${month.money}). Say "start <client>" or "stop".`;
});

// ───────────────────────── Mini-app

const NOTICE_COLORS = { info: "blue", success: "green", warn: "orange" };

function noticeView() {
  const n = Storage.get("notice");
  if (!n || Date.now() - n.time > 5 * 60_000) return null;
  return Widget.text(n.text, { font: "footnote", color: NOTICE_COLORS[n.kind] ?? "secondary", padding: 10, background: TILE, cornerRadius: 10, frame: { maxWidth: "infinity", alignment: "leading" } });
}

const clientOptions = () => clients().map((c) => ({ label: c.name, value: c.id }));

function entryRow(e) {
  const c = client(e.clientId);
  return Widget.hstack([
    { type: "stack", direction: "vertical", children: [], background: c?.color ?? "gray", cornerRadius: 3, frame: { width: 5, height: 34 } },
    Widget.vstack([
      Widget.text(`${c?.name ?? "Unknown"}${e.note ? ` · ${e.note}` : ""}`, { font: "subheadline", weight: "medium", lineLimit: 1 }),
      Widget.text(`${fmtTime(e.start)}–${fmtTime(e.end)} · ${e.source === "calendar" ? "calendar" : e.source}`, { font: "caption", color: "secondary" }),
    ], { alignment: "leading", spacing: 1, frame: { maxWidth: "infinity", alignment: "leading" } }),
    Widget.vstack([
      Widget.text(fmtHours(billableHours(e)), { font: "subheadline", weight: "semibold", design: "rounded" }),
      Widget.text(fmtMoney(amountOf(e), c?.currency ?? "USD"), { font: "caption", color: "secondary" }),
    ], { alignment: "trailing", spacing: 1 }),
    Widget.menu("ellipsis.circle", [{ title: "Delete entry", symbol: "trash", action: "deleteEntry", args: { id: e.id }, destructive: true }]),
  ], { spacing: 10 });
}

function trackTab() {
  const r = running();
  const c = r ? client(r.clientId) : null;
  const list = clients();
  const today = entriesOn(dayKey());
  const d = draft();
  const todayHours = hoursOf(today) + runningHours();

  const timerCard = r
    ? Widget.vstack([
      Widget.text(c?.name ?? "Unknown client", { font: "headline", color: c?.color ?? TEAL }),
      Widget.date(r.start, { style: "timer", font: 56, weight: "bold", design: "rounded" }),
      Widget.text(`since ${fmtTime(r.start)}${c ? ` · ${fmtMoney(c.rate, c.currency)}/h` : ""}`, { font: "footnote", color: "secondary" }),
      Widget.textField("What are you working on?", r.note ?? "", "runningNote"),
      Widget.hstack([
        Widget.button(Widget.hstack([Widget.symbol("stop.fill", { size: 14, color: "white", fallback: "■" }), Widget.text("Stop", { color: "white", weight: "bold" })], { spacing: 6 }), "stop", null, { style: "prominent", color: "red" }),
        Widget.button("Discard", "discard", null, { style: "bordered" }),
      ], { spacing: 10 }),
    ], { spacing: 10, padding: 16, background: TILE, cornerRadius: 16, frame: { maxWidth: "infinity" } })
    : Widget.vstack([
      Widget.text(list.length ? "Start a timer" : "Add a client in the Clients tab to start tracking.", { font: "headline" }),
      ...Array.from({ length: Math.ceil(Math.min(list.length, 8) / 2) }, (_, row) => Widget.hstack(list.slice(row * 2, row * 2 + 2).map((x) =>
        Widget.button(Widget.hstack([Widget.symbol("play.fill", { size: 12, color: "white", fallback: "▶" }), Widget.text(x.name, { color: "white", weight: "semibold", lineLimit: 1 })], { spacing: 6, frame: { maxWidth: "infinity" } }), "start", { clientId: x.id }, { style: "prominent", color: x.color })), { spacing: 10 })),
    ], { alignment: "leading", spacing: 10, padding: 16, background: TILE, cornerRadius: 16, frame: { maxWidth: "infinity", alignment: "leading" } });

  return Widget.vstack([
    noticeView(),
    timerCard,
    Widget.card([
      today.length ? Widget.vstack(today.slice(0, 20).map(entryRow), { spacing: 8 }) : Widget.text("Nothing logged yet today.", { font: "footnote", color: "secondary" }),
    ], { title: "Today", subtitle: fmtHours(todayHours), symbol: "calendar.day.timeline.left", color: TEAL }),
    list.length ? Widget.card([
      Widget.picker(clientOptions(), d.clientId ?? list[0].id, "draft", { field: "clientId" }, { label: "Client" }),
      Widget.datePicker(d.start, "draft", { field: "start" }, { label: "Start", mode: "dateTime" }),
      Widget.stepper(`Duration ${fmtHours(d.minutes / 60)}`, d.minutes, "draft", { field: "minutes" }, { min: 15, max: 720, step: 15 }),
      Widget.textField("Description", d.note, "draft", { field: "note" }),
      Widget.button("Add entry", "addManual", null, { style: "prominent", color: TEAL }),
    ], { title: "Manual entry", symbol: "plus.circle.fill", color: "blue" }) : null,
    list.length ? Widget.card([
      Widget.picker(clientOptions(), Storage.get("importClient") ?? list[0].id, "importClient", null, { label: "Bill to" }),
      Widget.button(Widget.hstack([Widget.symbol("calendar.badge.plus", { size: 14, color: "white", fallback: "📅" }), Widget.text("Import today's events", { color: "white", weight: "semibold" })], { spacing: 6 }), "importToday", null, { style: "prominent", color: "indigo" }),
      Widget.text("Timed events from all your calendars become entries for this client; all-day events are skipped and nothing is imported twice.", { font: "caption2", color: "secondary" }),
    ], { title: "From the calendar", symbol: "calendar", color: "indigo" }) : null,
  ], { alignment: "leading", spacing: 14 });
}

function clientsTab() {
  const s = settings();
  return Widget.vstack([
    noticeView(),
    ...clients().map((c) => Widget.card([
      Widget.textField("Client name", c.name, "client", { id: c.id, field: "name" }, { label: "Name" }),
      Widget.hstack([
        Widget.textField("95", String(c.rate), "client", { id: c.id, field: "rate" }, { label: "Rate per hour", keyboard: "decimal" }),
        Widget.picker(CURRENCIES, c.currency, "client", { id: c.id, field: "currency" }, { label: "Currency" }),
      ], { spacing: 12, alignment: "bottom" }),
      Widget.hstack([
        Widget.colorPicker(c.color, "client", { id: c.id, field: "color" }, { label: "Colour" }),
        Widget.spacer(),
        Widget.text(`${entries().filter((e) => e.clientId === c.id).length} entries`, { font: "caption", color: "secondary" }),
        Widget.menu("ellipsis.circle", [{ title: "Delete client", symbol: "trash", action: "deleteClient", args: { id: c.id }, destructive: true }]),
      ]),
    ], { title: c.name, subtitle: `${fmtMoney(c.rate, c.currency)} per hour`, symbol: "person.crop.circle.fill", color: c.color })),
    Widget.button(Widget.hstack([Widget.symbol("person.badge.plus", { size: 14, color: "white", fallback: "+" }), Widget.text("Add client", { color: "white", weight: "semibold" })], { spacing: 6 }), "addClient", null, { style: "prominent", color: TEAL }),
    Widget.card([
      Widget.picker([{ label: "Exact", value: 0 }, { label: "6 min", value: 6 }, { label: "15 min", value: 15 }, { label: "30 min", value: 30 }], s.rounding, "rounding", null, { style: "segmented", label: "Round each entry up to" }),
      Widget.textField("Your name or company", s.me.name, "me", { field: "name" }, { label: "Invoice from" }),
      Widget.textField("Address, VAT number, bank details", s.me.details, "me", { field: "details" }, { label: "Details", multiline: true }),
    ], { title: "Billing", symbol: "gearshape.fill", color: "gray" }),
  ], { alignment: "leading", spacing: 14 });
}

function reportTab() {
  const month = Storage.get("month", monthKey());
  const t = totals(month);
  const chart = weekdayHours(month);
  const hours = hoursOf(entriesIn(month));
  return Widget.vstack([
    noticeView(),
    Widget.picker(months(), month, "month", null, { label: "Month" }),
    Widget.card([
      t.length ? Widget.list(t.map((x) => ({ title: x.client.name, subtitle: `${x.count} entr${x.count === 1 ? "y" : "ies"} · ${fmtHours(x.hours)}`, symbol: "circle.fill", color: x.client.color, detail: fmtMoney(x.amount, x.client.currency) })), { style: "plain" }) : Widget.text("No hours in this month.", { font: "footnote", color: "secondary" }),
    ], { title: monthLabel(month), subtitle: `${fmtHours(hours)} billable`, symbol: "sum", color: TEAL }),
    Widget.card([
      hours > 0 ? Widget.chart(chart, { kind: "bar", color: TEAL, frame: { height: 180 } }) : Widget.text("Log some time to see the pattern.", { font: "footnote", color: "secondary" }),
    ], { title: "Hours per weekday", symbol: "chart.bar.fill", color: "blue" }),
    t.length > 1 ? Widget.card([
      Widget.chart(t.map((x) => ({ x: x.client.name, y: Math.round(x.hours * 100) / 100 })), { kind: "donut", colors: t.map((x) => x.client.color), frame: { height: 200 } }),
    ], { title: "Share of hours", symbol: "chart.pie.fill", color: "purple" }) : null,
    hours > 0 ? Widget.button(Widget.hstack([Widget.symbol("square.and.arrow.up", { size: 14, color: TEAL, fallback: "↑" }), Widget.text("Share month as CSV", { color: TEAL })], { spacing: 6 }), "exportMonth", null, { style: "bordered" }) : null,
  ], { alignment: "leading", spacing: 14 });
}

function invoicesTab() {
  const month = Storage.get("month", monthKey());
  const t = totals(month);
  const chosen = client(Storage.get("invoiceClient")) ?? t[0]?.client ?? null;
  const list = chosen ? entriesIn(month, chosen.id) : [];
  const hours = hoursOf(list);
  const invoices = Storage.get("invoices", []);
  return Widget.vstack([
    noticeView(),
    Widget.card([
      Widget.picker(months(), month, "month", null, { label: "Month" }),
      clients().length ? Widget.picker(clientOptions(), chosen?.id ?? clients()[0].id, "invoiceClient", null, { label: "Client" }) : Widget.text("Add a client first.", { color: "secondary" }),
      chosen ? Widget.hstack([
        Widget.vstack([Widget.text("Entries", { font: "caption2", color: "secondary" }), Widget.text(String(list.length), { font: "headline" })], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
        Widget.vstack([Widget.text("Hours", { font: "caption2", color: "secondary" }), Widget.text(fmtHours(hours), { font: "headline" })], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
        Widget.vstack([Widget.text("Total", { font: "caption2", color: "secondary" }), Widget.text(fmtMoney(hours * chosen.rate, chosen.currency), { font: "headline", color: TEAL })], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
      ]) : null,
      Widget.button(Widget.hstack([Widget.symbol("doc.badge.plus", { size: 14, color: "white", fallback: "+" }), Widget.text("Create invoice", { color: "white", weight: "semibold" })], { spacing: 6 }), "createInvoice", null, { style: "prominent", color: TEAL }),
      Widget.text("Writes a numbered CSV and plain-text invoice into this script's Files folder.", { font: "caption2", color: "secondary" }),
    ], { title: "New invoice", symbol: "doc.text.fill", color: TEAL }),
    ...invoices.slice(0, 20).map((inv) => Widget.card([
      Widget.hstack([
        Widget.vstack([
          Widget.text(`${clientName(inv.clientId)} · ${monthLabel(inv.month)}`, { font: "subheadline", lineLimit: 1 }),
          Widget.text(`${fmtHours(inv.hours)} · created ${fmtDate(inv.date)}`, { font: "caption", color: "secondary" }),
        ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", alignment: "leading" } }),
        Widget.text(fmtMoney(inv.total, inv.currency), { font: "headline", color: TEAL }),
      ]),
      Widget.hstack([
        Widget.button("Share text", "shareInvoice", { path: inv.txt }, { style: "bordered" }),
        Widget.button("Share CSV", "shareInvoice", { path: inv.csv }, { style: "bordered" }),
        Widget.spacer(),
        Widget.menu("ellipsis.circle", [
          { title: "Save text file", symbol: "square.and.arrow.down", action: "exportInvoice", args: { path: inv.txt, name: `${inv.number}.txt` } },
          { title: "Save CSV file", symbol: "tablecells", action: "exportInvoice", args: { path: inv.csv, name: `${inv.number}.csv` } },
          { title: "Delete invoice", symbol: "trash", action: "deleteInvoice", args: { number: inv.number }, destructive: true },
        ]),
      ], { spacing: 8 }),
    ], { title: inv.number, symbol: "doc.text", color: "gray" })),
  ], { alignment: "leading", spacing: 14 });
}

Script.ui(() => ({
  title: "Time & Invoice",
  content: Widget.vstack([
    Widget.tabs([
      { title: "Track", symbol: "timer", content: trackTab() },
      { title: "Clients", symbol: "person.2.fill", content: clientsTab() },
      { title: "Report", symbol: "chart.bar.fill", content: reportTab() },
      { title: "Invoices", symbol: "doc.text.fill", content: invoicesTab() },
    ], { selected: Storage.get("tab", 0), action: "tab" }),
  ], { padding: 16 }),
}));
