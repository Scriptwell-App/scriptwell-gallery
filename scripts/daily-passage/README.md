# Daily Passage

One passage a day from a public-domain book of your choice, read aloud on request, with bookmarks and a book-like widget; searches gutendex.com and downloads the text from gutenberg.org.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `network` to fetch data over HTTPS

## How it works

- In the mini-app, search Project Gutenberg (the query goes to gutendex.com) and pick a book. Its plain-text edition is downloaded once from gutenberg.org into the script's Files folder; only the first megabyte is kept.
- The text between the Gutenberg "*** START OF" and "*** END OF" markers is split into passages of about 120 words at paragraph boundaries.
- Each day shows one new passage, chosen from the date, so the widget and the mini-app agree. "Another one" moves on today; "In order" or "Shuffle" sets how days advance.
- Read aloud with the system voice, keep bookmarks, and browse back and forth; the mini-app reopens where you left off.
- Widgets draw today's passage on warm paper in light mode and dark ink in dark mode. Pick a book in the app before adding a widget.
