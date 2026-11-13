# Newsstand

A front-page reader for the RSS and Atom feeds you choose, with unread tracking, a read-later list and newspaper-style widgets. Contacts only the feed hosts you add (The Guardian, BBC, The New York Times and The Atlantic by default).

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, extraLarge
- **Permissions:** `network` to fetch data over HTTPS

## How it works

- Fetches every feed you add (RSS or Atom) as plain text and parses it with regular expressions: no accounts, no keys. Only the feed hosts are contacted, and nothing is sent to them beyond the request for the feed. Article pictures in the large widgets come from the same publishers.
- Ships with four feeds: The Guardian (world), BBC News, The New York Times and The Atlantic. Remove or replace them under Feeds in the mini-app; any https RSS or Atom address works.
- Unread tracking lives in Storage, keyed by a hash of the article link; the read-later list is a JSON file in the script's folder. Tapping a headline marks it read and opens it in the browser.
- Widgets draw a front page: masthead, lead headline and three more. Small and medium rotate the lead story every ten minutes with a timeline. Large and extraLarge show several publications. Set the widget Parameter to a publication name (for example "BBC") to put that paper first.
- Open the mini-app once so the first fetch happens in the app; widgets then refresh every 30 minutes.
