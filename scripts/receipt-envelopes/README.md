# Receipt Envelopes

Envelope budgeting with receipt scanning: photograph a receipt, on-device AI reads the merchant, total and date, you confirm, and the expense lands in its envelope. Nothing leaves your device.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `camera` to take photos and scan codes with the camera

## How it works

- Envelopes are categories with a monthly limit and a colour. Edit them in the Envelopes tab.
- Add an expense by hand, or scan a receipt with the camera or a photo. Text is read with Vision and the merchant, total, date and envelope are picked out by the on-device model (with a plain pattern-matching fallback when the model is not available). You confirm in a form before saving.
- Expenses are kept as JSON files in the script's folder, one per month. Export any month as CSV.
- From Shortcuts or Siri, run the script with text such as "12.50 coffee" to file an expense; the envelope is guessed from the words (coffee → Eating out) or named explicitly ("12.50 coffee fun").
- The widget shows envelopes as progress bars that turn red when over the limit; the large size adds the month's spending curve against budget pace. Set the Parameter to an envelope name to feature it.
