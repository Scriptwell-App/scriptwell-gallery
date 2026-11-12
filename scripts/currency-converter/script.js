// @name        Currency Converter
// @description Convert between currencies with daily European Central Bank rates
// @permissions network
// @widget      small
// @icon        dollarsign.arrow.circlepath
// @color       #15803D
// @version     1.0.0
// @author      scriptwell
// @category    finance

// Rates: https://frankfurter.dev (free, no key), updated on working days.
// From Shortcuts, pass text such as "250 usd to eur".

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "CNY", "INR", "SEK"];
const state = () => Storage.get("state", { from: "USD", to: "EUR", amount: 100 });

async function rates(base) {
  const key = `rates:${base}`;
  const cached = Storage.get(key);
  if (cached && Date.now() - cached.time < 6 * 60 * 60 * 1000) return cached;
  try {
    const response = await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}`, { timeout: 8000 });
    if (!response.ok) throw new Error(`Rates service returned ${response.status}`);
    const data = await response.json();
    const fresh = { rates: { ...data.rates, [base]: 1 }, date: data.date, time: Date.now() };
    Storage.set(key, fresh);
    return fresh;
  } catch (error) {
    if (cached) return cached; // offline: use the last rates
    throw error;
  }
}

async function convert(amount, from, to) {
  const table = await rates(from);
  const rate = table.rates[to];
  if (rate === undefined) throw new Error(`No rate for ${from} to ${to}`);
  return { value: amount * rate, rate, date: table.date };
}

const money = (n) => n.toLocaleString(Script.env.locale, { maximumFractionDigits: n >= 100 ? 2 : 4 });

Script.action("from", ({ code }) => Storage.set("state", { ...state(), from: code }));
Script.action("to", ({ code }) => Storage.set("state", { ...state(), to: code }));
Script.action("swap", () => Storage.set("state", { ...state(), from: state().to, to: state().from }));
Script.action("amount", async () => {
  const text = await UI.prompt({ title: "Amount", defaultValue: String(state().amount) });
  const value = Number(String(text).replace(",", "."));
  if (text !== null && value >= 0) Storage.set("state", { ...state(), amount: value });
});

const chips = (action, selected) => [CURRENCIES.slice(0, 5), CURRENCIES.slice(5)].map((row) =>
  Widget.hstack(row.map((code) =>
    Widget.button(code, action, { code }, { style: code === selected ? "prominent" : "bordered", color: "green" })), { spacing: 6 }));

Script.ui(async () => {
  const { from, to, amount } = state();
  const result = await convert(amount, from, to);
  return {
    title: "Currency",
    content: Widget.vstack([
      Widget.button(`${money(amount)} ${from}`, "amount", null, { style: "bordered" }),
      Widget.text(`${money(result.value)} ${to}`, { font: 44, weight: "bold", design: "rounded", color: "green", minimumScale: 0.5, lineLimit: 1 }),
      Widget.text(`1 ${from} = ${money(result.rate)} ${to} · ${result.date}`, { font: "footnote", color: "secondary" }),
      Widget.button("Swap", "swap", null, { style: "bordered" }),
      Widget.text("From", { font: "caption", color: "secondary" }),
      ...chips("from", from),
      Widget.text("To", { font: "caption", color: "secondary" }),
      ...chips("to", to),
    ], { spacing: 10, padding: 16 }),
  };
});

Script.widget(async () => {
  const { from, to } = state();
  const result = await convert(1, from, to);
  return {
    content: Widget.vstack([
      Widget.text(`1 ${from}`, { font: "caption", color: "secondary" }),
      Widget.text(money(result.rate), { font: "title", weight: "bold", design: "rounded", color: "green", minimumScale: 0.6, lineLimit: 1 }),
      Widget.text(to, { font: "headline" }),
      Widget.text(result.date, { font: "caption2", color: "secondary" }),
    ], { spacing: 2 }),
    refreshAfter: 6 * 60 * 60,
  };
});

Script.run(async (input) => {
  const match = /^\s*([\d.,]+)?\s*([a-z]{3})\s+(?:to|in)\s+([a-z]{3})\s*$/i.exec(input ?? "");
  const amount = match?.[1] ? Number(match[1].replace(",", ".")) : state().amount;
  const from = (match?.[2] ?? state().from).toUpperCase();
  const to = (match?.[3] ?? state().to).toUpperCase();
  const result = await convert(amount, from, to);
  return `${money(amount)} ${from} = ${money(result.value)} ${to}`;
});
