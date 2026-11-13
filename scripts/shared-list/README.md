# Shared List

A family shopping list sorted by aisle that you tick off right in the widget, add to by typing or scanning a barcode (looked up at world.openfoodfacts.org), and mirror to a shared Reminders list so everyone sees it.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular
- **Permissions:** `network` to fetch data over HTTPS; `reminders` to read, add and complete reminders; `camera` to take photos and scan codes with the camera

## How it works

- Items live in the script's Storage, grouped by aisle (produce, dairy, bakery, household, …) with a quantity and a note. Tick them off in the widget or the mini-app; "Clear ticked" removes what you bought.
- Add items by typing ("2 oat milk (the blue one)") or by scanning a barcode. Only the barcode digits are sent to world.openfoodfacts.org, which answers with the product name, brand and pack size.
- Open items are mirrored to a Reminders list (default "Shopping"). Share that list in the Reminders app and the family sees it on their own devices; ticks and additions made there flow back the next time you open.
- "Usual items" are learned from how often you add something, so the things you always buy are one tap away.
- Storage.shared publishes "sharedList:openCount" (a number), "sharedList:items" (an array of { name, qty, note, aisle }) and "sharedList:updated" (ISO date) so your other scripts can show the list.
- Run the script once in the app to approve camera, network and reminders before adding the widget.
