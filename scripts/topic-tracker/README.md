# Topic Tracker

Follows up to five news topics through the GDELT project (api.gdeltproject.org): 30 days of coverage volume, a week-on-week trend, the latest headlines and the average tone of what is being written.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `network` to fetch data over HTTPS

## How it works

- Each topic is looked up in the GDELT DOC 2.0 API at api.gdeltproject.org: coverage volume and average tone for the last 30 days, and the ten most recent articles. Only the topic text is sent.
- Type topics in the mini-app. Put a phrase in quotes to keep the words together, for example "heat pump" or "Mars sample return"; plain words are matched together in any order.
- Answers are cached for 30 minutes. Widgets show the cache and only refresh stale volume data within their time budget; background runs keep volume and tone fresh while the app is closed.
- The trend arrow compares the last seven days with the seven before. Tone runs from negative to positive on GDELT's scale, where most news sits between −5 and +5.
- Widget parameter: the topic to feature in the small widget, spelled as in the mini-app.
