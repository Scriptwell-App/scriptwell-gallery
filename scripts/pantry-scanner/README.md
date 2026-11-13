# Pantry Scanner

Scan food barcodes to stock a pantry with expiry reminders; product names, Nutri-Score and allergens are looked up on world.openfoodfacts.org.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular
- **Permissions:** `network` to fetch data over HTTPS; `reminders` to read, add and complete reminders; `notifications` to schedule local notifications; `camera` to take photos and scan codes with the camera

## How it works

- Scan tab: point the camera at an EAN or UPC barcode. Only the code is sent to world.openfoodfacts.org, which answers with the product name, brand, quantity, Nutri-Score, NOVA group and allergens.
- Pantry items (name, quantity, fridge / pantry / freezer, expiry date) stay in the script's Storage on your device.
- Every item gets two local notifications: two days before it expires and on the day, at the hour you choose. Editing an item replaces them, deleting an item cancels them.
- "Add to shopping list" creates a reminder in the Reminders list you pick in Settings.
- Open the mini-app once before adding the widget so camera, network, notification and reminder access are approved.
- Widget: the items expiring soonest, colour-coded; the large widget also counts items per location.
