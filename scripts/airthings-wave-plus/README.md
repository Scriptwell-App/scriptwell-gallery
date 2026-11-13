# Airthings Wave Plus

Reads radon, CO₂, VOC, humidity, temperature and pressure from an Airthings Wave Plus over Bluetooth, keeps a history and shows it with sparklines.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular, inline
- **Permissions:** `bluetooth` to talk to Bluetooth devices

## How it works

- Bluetooth is not available inside a widget, so readings are taken when you tap "Read now" in the mini-app, when the script runs (▶, Shortcuts, Siri), and in background runs.
- iOS only gives background runs a few times a day. For a denser history, add a Shortcuts automation (for example every hour) that runs this script with "Run Script".
- Widget parameter: the metric to feature, one of "radon", "co2", "voc", "humidity", "temp" or "pressure" (radon if empty). Add "pci" to show radon in pCi/L instead of Bq/m³, for example "co2" or "radon pci".
- When connecting, the script checks the characteristics the device actually has. Devices without the Wave Plus sensor characteristic (another Airthings model, or something else named "Wave") are skipped and remembered, and the next candidate is tried.
- Every reading works against a time budget (30 s in the app, 20 s from Shortcuts, 15 s in the background), so a slow connection stops cleanly instead of hitting the time limit.
