# Warranty Vault

Keeps your receipts, warranties and return windows in one place: photograph a receipt, on-device AI reads the store, date and total, and you get a notification a week before each deadline. Nothing leaves the device.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `notifications` to schedule local notifications; `camera` to take photos and scan codes with the camera

## How it works

- Photograph a receipt (or pick one from Photos). Vision reads the text on the device and the on-device AI model pulls out the store, date, total and items; a plain regex takes over when the model is missing. You confirm or correct everything before it is saved.
- Each purchase has a warranty length (6–60 months) and a return window (14–90 days). The script works out the return deadline and the warranty end, and schedules a notification 7 days before each one.
- The mini-app lists purchases by soonest deadline with status badges (returnable, under warranty, expired), search, a detail page with the receipt picture and a share button, the total value still under warranty, and an archive for things you no longer own.
- Widget: the next deadlines; the large size adds the value under warranty and a count by status.
- Receipts are stored in the script's own Files folder. No network, no accounts, nothing uploaded.
