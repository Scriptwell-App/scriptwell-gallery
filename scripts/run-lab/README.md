# Run Lab

Your last 90 days of running from Apple Health: weekly distance, pace trend, longest run, 5k and 10k bests and VO₂max, plus the best hour to run today from Apple Weather for where you are. Health data stays on the device.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular
- **Permissions:** `location` to read your current location; `health` to read Apple Health data

## How it works

- Reads running workouts (and VO₂max, if present) from Apple Health when you open the mini-app, run the script, or iOS gives it a background refresh. Health data never leaves the device.
- Weekly distance, pace trend, longest run and 5k/10k personal bests (runs within 2% of the distance) are worked out on the device. Pace is min/km or min/mi from your locale; change it in Settings.
- "Good run window" scores each of the next 12 hours by temperature, rain chance, wind and UV. Only the mini-app asks for your location and Apple Weather (coordinates go to Apple's weather service); the result is cached so widgets never fetch anything.
- Open the mini-app once to approve Health and Location before adding a widget.
- Widget: this week vs last week and the next good window; the large size adds the charts.
