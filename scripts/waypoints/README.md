# Waypoints

Save places (where you stand, or a search result) and get a compass arrow and distance to the one you pick, on the Home Screen and the Lock Screen. Searches go to Apple Maps; nothing else leaves the device.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, circular, rectangular, inline
- **Permissions:** `location` to read your current location; `motion` to read the compass and motion sensors

## How it works

- Save a waypoint from your current position (best accuracy) with a name, or search a place by name. Search text goes to Apple's map servers (Location.search); positions and waypoints stay on the device.
- Tap a waypoint to make it active. The mini-app shows an arrow relative to the way you face (Compass.heading plus the bearing from you to the waypoint) and the distance (Location.distance), in metres/kilometres or feet/miles depending on your locale.
- The screen only redraws after a tap, so use Refresh to update the arrow; there is no timer that could redraw it for you. "Navigate" opens Apple Maps with directions to the waypoint.
- Widgets show the last known bearing and distance from Storage and, when iOS gives them a fresh position, an updated distance. The compass is not available in widgets, so the arrow there is relative to the heading from your last refresh (or points by compass direction when that is stale). The large widget shows a map with every pin. Tapping a widget opens the mini-app; "Navigate" opens Apple Maps.
- Run the script once in the app before adding a widget, so location and motion are approved.
