# Atlas

Country facts from restcountries.com with flags (flagcdn.com), maps, local time, exchange rates from api.frankfurter.app and Apple Weather for the capital; search, compare two countries, keep favourites, and a country of the day widget.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `network` to fetch data over HTTPS

## How it works

- Country data (name, capital, population, area, languages, currencies, flag, time zones, borders) comes from restcountries.com. Only the name or country code you look up is sent.
- Exchange rates between your home currency and the country's come from api.frankfurter.app, which covers about thirty major currencies; others are shown as unavailable.
- Weather for the capital is Apple Weather, fetched in the mini-app and cached for the widget.
- The widget shows a country of the day: set the widget Parameter to a country code such as JPN or a name, otherwise it rotates through your favourites, or a built-in list of sixty countries.
- Flags are loaded as images from flagcdn.com (the address restcountries.com provides). Local time comes from the country's UTC offset and is refreshed every 15 minutes in the widget.
