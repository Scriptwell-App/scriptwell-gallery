# Quake Watch

Earthquakes near you from the USGS catalogue at earthquake.usgs.gov: a map, a magnitude chart, distance and depth for each quake, and a notification when a strong one happens within your radius.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular, inline
- **Permissions:** `network` to fetch data over HTTPS; `location` to read your current location; `notifications` to schedule local notifications

## How it works

- Loads the last seven days of earthquakes within your chosen radius from the USGS earthquake catalogue (earthquake.usgs.gov). Only rounded coordinates, the radius and a minimum magnitude are sent.
- Your location is read once and kept in Storage, so widgets and background runs reuse it. Tap "Update location" in the mini-app after you travel.
- Background runs look for new quakes and send one notification per event at or above the "Notify me" magnitude you choose. Set it to Off to stay quiet.
- Run the script once in the app to approve location and notifications before adding a widget.
- Widget parameter: a minimum magnitude to show, for example "3".
