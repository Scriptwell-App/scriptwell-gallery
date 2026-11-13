# Med Schedule

A medication log with reminders: doses per day and weekday, notifications for today and tomorrow, a tap-to-log widget, 30-day adherence and refill countdowns, plus optional label excerpts from the US openFDA service (api.fda.gov).

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular, inline
- **Permissions:** `network` to fetch data over HTTPS; `notifications` to schedule local notifications

## How it works

- Add each medication in the mini-app: dose, times per day (time pickers), days of the week, notes and, if you like, how many pills are left. Everything is stored on the device.
- Reminders: every dose for today and tomorrow gets a local notification with a stable id (medication, day and time), so rescheduling replaces rather than duplicates. Background runs keep the next 48 hours covered; opening the app, logging a dose or running the script does the same.
- The widget lists today's doses; tap one to mark it taken (tap again to undo). The mini-app logs taken or skipped with a timestamp in log.json, shows adherence per medication over 30 days as a bar chart, and counts down to a refill (pills left ÷ doses per day) with a reminder at 5 days.
- Leaflet: the only network use. It asks api.fda.gov for the US label matching the medication name and shows purpose, dosage and warnings excerpts. That is the US label text, not advice for you.
- This script is a log and a set of reminders. It does not give medical guidance; follow the directions from your prescriber and pharmacist.
