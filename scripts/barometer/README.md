# Barometer

Logs your iPhone's barometer and shows the pressure, its 3-hour tendency in the classic rising and falling words, a dial, a 48-hour chart against Apple Weather's sea-level pressure and a rule-of-thumb outlook, in widgets and a mini-app.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, circular, rectangular, inline
- **Permissions:** `location` to read your current location; `motion` to read the compass and motion sensors

## How it works

- Motion.altitude reads the phone's own barometer. Readings are logged to the script's Files folder (readings.json, 72 hours) on every run, background run and visit to the mini-app. The sensor is not available inside widgets, so widgets show the last reading and the chart from Storage.
- iOS asks about Motion & Fitness the first time, because the same permission covers the barometer.
- The mini-app and background runs also fetch Apple Weather's pressure for your location, which is reduced to sea level. The difference to the phone (which measures station pressure at your altitude) becomes a calibration offset, so both lines in the chart line up.
- Tendency is the change over the last 3 hours, worded the way weather observers do. The outlook is the old barometer rule of thumb, not a forecast.
- Only your coordinates, rounded to about a kilometre, are sent to Apple Weather. Nothing else leaves the device. For a denser log, add a Shortcuts automation that runs this script every hour.
