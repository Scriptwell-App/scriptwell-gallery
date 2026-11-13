# TV Tonight

Tonight's TV schedule for your country, the shows you follow with a countdown to their next episode, and one-tap calendar reminders. Contacts api.tvmaze.com.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `network` to fetch data over HTTPS; `calendar` to read your calendar events

## How it works

- Tonight's schedule and show details come from api.tvmaze.com. The only things sent there are the country code you pick in Settings, today's date, show ids and the text you type in Search.
- Follow shows from Tonight or Search. The Following tab shows each one's next episode with a live countdown and a "Remind me" button that adds a calendar event with a 10-minute alarm.
- The widget shows the next episode of a followed show (or tonight's first pick) and, in the large size, a timeline of tonight's picks. Set the widget Parameter to a show's name to feature that show. Tapping the widget opens the mini-app.
- Open the mini-app once before adding the widget, so the network and calendar permissions are approved and the schedule is cached. The widget only refreshes caches that are stale.
