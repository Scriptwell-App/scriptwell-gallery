# Sun Shot Planner

Plans photographs around the sun: golden and blue hour, sunrise, sunset and solar noon for where you are or any searched place, a 24-hour elevation curve, an azimuth dial with your compass heading, and Apple Weather cloud cover for the day.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular
- **Permissions:** `location` to read your current location; `motion` to read the compass and motion sensors

## How it works

- The sun's azimuth and elevation are computed on the device with the NOAA solar position algorithm, so the planning itself sends nothing anywhere. Place searches go to Apple Maps and cloud cover comes from Apple Weather, both only with the place you chose.
- Tap "Use my location" or search a place, then pick a date and time. Golden hour is the sun between −4° and 6°, blue hour between −6° and −4°. Times are shown in your device's time zone.
- "Read compass" shows which way you are facing and how far to turn to line up with the sun.
- The widget counts down to the next golden hour for the saved place (or your location) and shows where the sun is right now; the large one adds the elevation curve and the day's cloud cover.
- Run the script once in the app, so location and motion are approved, before adding the widget.
