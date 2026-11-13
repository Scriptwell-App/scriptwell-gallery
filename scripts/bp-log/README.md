# BP Log

A blood pressure log that reads systolic, diastolic and heart rate from Apple Health (or your own entries), charts them against common reference ranges, compares mornings with evenings, and exports a CSV for your doctor. Everything stays on the device.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular
- **Permissions:** `health` to read Apple Health data

## How it works

- Reads the last 90 days of systolic, diastolic and heart-rate samples from Apple Health, pairs them into readings, and merges in entries you type yourself (kept in manual.json). Nothing is sent anywhere: there is no network permission, and Health data never leaves the device.
- Open the mini-app once so iOS can ask for Health access; after that the script runs in the background and the widget reads a cached copy (Health itself is not available inside a widget).
- Charts: systolic and diastolic over time with the common reference lines (normal below 120/80, elevated, stage 1 from 130/80, stage 2 from 140/90, as in the widely used AHA categories), morning against evening averages, weekly averages and pulse pressure. The labels are reference ranges, not a diagnosis.
- Export: a CSV of every reading, saved with the Files picker or handed to the share sheet.
- This is a log, not medical advice. Talk to a clinician about what your readings mean.
