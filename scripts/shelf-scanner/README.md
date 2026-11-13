# Shelf Scanner

Scan a book's barcode or search by title, track your reading pace and projected finish date, and turn library due dates into reminders; looks books up at openlibrary.org.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular
- **Permissions:** `network` to fetch data over HTTPS; `reminders` to read, add and complete reminders; `camera` to take photos and scan codes with the camera

## How it works

- Open the mini-app and point the camera at the barcode on the back of a book, or type a title or author into the search field.
- Books are looked up at openlibrary.org: the ISBN or your search words are the only things sent. Covers are loaded from covers.openlibrary.org.
- Your shelf stays in Storage on the device: status, current page and a dated reading log. The pace (pages a day) and the projected finish date are worked out from that log.
- A library due date adds a reminder in the Reminders app and shows a countdown; clearing the date removes the reminder again.
- Widgets show the book you are reading with progress, pace and finish date; the large widget adds a chart of pages read per day.
- Run the script once in the app before adding a widget, so the permissions are approved.
