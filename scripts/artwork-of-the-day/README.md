# Artwork of the Day

One public-domain artwork a day from the Art Institute of Chicago (api.artic.edu, www.artic.edu) in a theme you choose, with an elegant caption; browse, favourite and pick your own. Optional on-device AI note.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, extraLarge
- **Permissions:** `network` to fetch data over HTTPS

## How it works

- Searches the Art Institute of Chicago's public API (api.artic.edu) for public-domain works in your theme and caches the results for a week. Only the theme's search words are sent; nothing about you.
- The day's work is chosen from the date, so the widget shows the same piece all day and changes at midnight. The image is downloaded once a day (www.artic.edu IIIF) into Files; widgets only read it.
- Tap a widget to open the artwork's page at artic.edu. Set the widget Parameter to a theme such as "japanese prints" or "photography" to give each widget its own theme.
- The mini-app browses the theme as a grid, marks favourites and can make any work "today's". If Apple Intelligence is available, a one-line note is summarised on-device from the museum's own image description; otherwise the first sentence of that description is used.
- Run it once in the app before adding a widget, so the network permission is approved.
