# Trip Dashboard

Countdown, destination weather, exchange rate, tip calculator, country essentials and a smart packing list for your next trip, using restcountries.com, api.frankfurter.app, flag images from flagcdn.com and Apple Weather.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular, inline
- **Permissions:** `network` to fetch data over HTTPS

## How it works

- Type a destination; Apple's place search geocodes it (no location permission needed). Country facts come from restcountries.com (only the country code is sent), exchange rates from api.frankfurter.app (only the two currency codes), flags from flagcdn.com, and the 10-day forecast from Apple Weather.
- The mini-app has a trip picker with date pickers, and tabs for Essentials (currency, languages, dialling code, driving side, typical plug type, time difference), Money (converter and 10/15/20% tips), Weather, and a Packing checklist with suggestions drawn from the forecast.
- The widget counts down to the trip, shows the weather for your first day there and the exchange rate; the large size adds a five-day strip, essentials and packing progress. The inline Lock Screen size reads "Tokyo in 12 days".
- Widgets only read the cache; the mini-app, Shortcuts runs and background runs refresh it. Set the widget Parameter to a destination name to show a particular trip.
- Open the mini-app once before adding the widget so the network permission is approved and the first trip is saved.
