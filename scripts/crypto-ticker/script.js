// @name        Crypto Ticker
// @description Bitcoin, Ether and other prices, with the change since midnight
// @permissions network
// @widget      small, medium
// @icon        bitcoinsign.circle.fill
// @color       #F7931A
// @version     1.0.0
// @author      va4w
// @category    finance

// Put symbols in the widget's Parameter field, for example "BTC, ETH, SOL".
// Prices: Coinbase's public spot price API (free, no key).

const DEFAULT = "BTC, ETH";

async function price(symbol) {
  const response = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`, { timeout: 6000 });
  if (!response.ok) throw new Error(`No price for ${symbol}`);
  return Number((await response.json()).data.amount);
}

async function quotes(parameter) {
  const symbols = (parameter ?? DEFAULT).toUpperCase().split(/[\s,]+/).filter((s) => /^[A-Z0-9]{2,6}$/.test(s)).slice(0, 4);
  const today = new Date().toDateString();
  const saved = Storage.get("quotes", {});

  const results = await Promise.all(symbols.map(async (symbol) => {
    const previous = saved[symbol];
    try {
      const now = await price(symbol);
      // The first price seen each day is the reference for "change today".
      const open = previous?.day === today ? previous.open : now;
      return [symbol, { now, open, day: today, time: Date.now() }];
    } catch (error) {
      return [symbol, previous ?? null]; // offline or unknown symbol
    }
  }));

  const fresh = Object.fromEntries(results.filter(([, quote]) => quote));
  Storage.set("quotes", { ...saved, ...fresh });
  return symbols.map((symbol) => ({ symbol, ...(fresh[symbol] ?? { now: null }) }));
}

const dollars = (n) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : n < 1000 ? 2 : 0 })}`;

function row(quote, large) {
  if (quote.now === null) return Widget.text(`${quote.symbol}: no price`, { font: "caption", color: "secondary" });
  const change = quote.open ? ((quote.now - quote.open) / quote.open) * 100 : 0;
  const color = change >= 0 ? "green" : "red";
  return Widget.hstack([
    Widget.text(quote.symbol, { font: large ? "headline" : "subheadline", weight: "semibold" }),
    Widget.spacer(),
    Widget.vstack([
      Widget.text(dollars(quote.now), { font: large ? "headline" : "subheadline", design: "rounded", lineLimit: 1, minimumScale: 0.7 }),
      Widget.text(`${change >= 0 ? "+" : ""}${change.toFixed(2)}%`, { font: "caption2", color }),
    ], { alignment: "trailing", spacing: 0 }),
  ]);
}

Script.widget(async ({ family, parameter }) => {
  const list = await quotes(parameter);
  return {
    content: Widget.vstack([
      ...list.slice(0, family === "small" ? 2 : 3).map((quote) => row(quote, family === "medium")),
      Widget.spacer(),
      Widget.date(new Date(), { style: "time", font: "caption2", color: "secondary" }),
    ], { alignment: "leading", spacing: 8, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    refreshAfter: 15 * 60,
  };
});

Script.run(async (input) => (await quotes(input)).map((q) => `${q.symbol}: ${q.now === null ? "no price" : dollars(q.now)}`).join("\n"));
