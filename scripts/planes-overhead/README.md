# Planes Overhead

Aircraft flying near you right now from the OpenSky Network's anonymous API at opensky-network.org: a live map, distance and bearing, altitude, speed and heading, a compass helper that tells you where to look, and a pop when a plane enters your 5 km circle.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `network` to fetch data over HTTPS; `location` to read your current location; `motion` to read the compass and motion sensors

## How it works

- Your location is used to build a bounding box (10–50 km, your choice) that is sent to opensky-network.org; nothing else is sent. Responses are cached for 60 seconds because the anonymous API is rate limited (a few hundred requests a day), and the mini-app says when it is showing cached data.
- Mini-app: a map with a pin per aircraft, a list sorted by distance with bearing, altitude (feet or metres by locale, switchable), speed (km/h or knots) and heading. Tap a plane, then "Point at it" compares the compass heading with the bearing and tells you how far to turn and how high to look.
- Auto-refresh re-scans every minute while the mini-app is open and plays a pop when a new aircraft enters the 5 km circle.
- Widget: how many aircraft are overhead, the closest callsign and its altitude; medium adds the three nearest; large shows the map. Widgets refresh about every ten minutes and fall back to the last scan when offline.
- Open the mini-app once before adding the widget so location, motion and network access are approved.
