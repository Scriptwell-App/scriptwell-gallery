# Keep in Touch

Remembers who you meant to call: pick people from Contacts, set how often you want to talk, log when you last spoke, and see who is overdue and whose birthday is next, with one-tap message, call and email. Everything stays on the device.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular, inline
- **Permissions:** `notifications` to schedule local notifications; `contacts` to read your contacts

## How it works

- "Add a person" opens the system contact picker (Contacts.pick), which hands over only the person you choose. "Import birthdays" uses Contacts.find to read everyone who has a birthday (up to 200 contacts) and adds them as birthday-only entries; that is the one feature that needs the contacts permission.
- Give each person a cadence (weekly, fortnightly, monthly, quarterly) and tap "Spoke today" after a chat. The app works out who is overdue and lists birthdays in the next 30 days, with the age when the year is known.
- Message, call and email buttons open Messages, Phone and Mail with the stored number or address.
- Background runs schedule notifications: one on the morning of each birthday and one the day someone becomes overdue (stable ids, so nothing doubles up). Run the script once in the app so iOS can ask about notifications.
- Widgets show the next birthday with a countdown and the most overdue person; the Lock Screen line reads "Birthday: Ana in 3 days". Nothing is fetched and contact data never leaves the device.
