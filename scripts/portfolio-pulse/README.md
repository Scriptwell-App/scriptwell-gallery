# Portfolio Pulse

Your stocks, ETFs and crypto in one place: total value, today's change, allocation, gain per holding and a 30-day history, all in the currency you choose. Contacts stooq.com, api.coingecko.com and api.frankfurter.app.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular, inline
- **Permissions:** `network` to fetch data over HTTPS

## How it works

- Enter holdings in the mini-app: symbol, quantity, cost per unit and kind. Stocks and ETFs use Stooq symbols with an exchange suffix, for example AAPL.US, VUSA.UK, SAP.DE, 7203.JP. Crypto uses CoinGecko ids such as bitcoin, ethereum, solana.
- Prices come from stooq.com (one small CSV per symbol) and api.coingecko.com (one request for all coins). Exchange rates come from api.frankfurter.app. Only symbols, coin ids and currency codes are sent; quantities and costs never leave the device.
- Quotes are cached for 10 minutes to stay well inside each service's limits. Today's change for stocks is the move since the day's open; for crypto it is the 24-hour change.
- A snapshot of the total is kept once a day in Storage for the 30-day chart. Set the widget Parameter to "private" to hide amounts and show only percentages.
