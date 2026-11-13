# Match Day

Live scores, fixtures and results for the teams you follow, from ESPN's public scoreboard at site.api.espn.com, with kick-offs added to your calendar and a notification at full time.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular, inline
- **Permissions:** `network` to fetch data over HTTPS; `calendar` to read your calendar events; `notifications` to schedule local notifications

## How it works

- Scores come from ESPN's public scoreboard JSON at site.api.espn.com. The only things sent are the league and a date range; team crests are loaded from a.espncdn.com when a widget is drawn.
- Open the mini-app once, pick a league and follow a team or two. That first run also approves network, calendar and notification access, which the widget and background runs need.
- Widget: your team's live or next match with crests, score and clock. Medium adds recent and upcoming games, large adds today's slate, and the Lock Screen sizes show the score or a kick-off countdown. Set the widget Parameter to a team name to feature that team.
- Background runs refresh the cache a few times a day and send one notification per match when a followed team's game reaches full time (deduplicated by match id).
- "Add to Calendar" creates a two-hour event in your default calendar with an alert before kick-off.
- Widgets refresh about every 5 minutes while a game is live and every 30 minutes otherwise; everything falls back to the cached data when offline.
