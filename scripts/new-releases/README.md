# New Releases

Follow artists and see their upcoming and recent albums, EPs and singles from musicbrainz.org, with artwork from itunes.apple.com, calendar events and a notification on release day.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `network` to fetch data over HTTPS; `calendar` to read your calendar events; `notifications` to schedule local notifications

## How it works

- Search an artist in the mini-app and tap a result to follow it. Artist names you type are sent to musicbrainz.org (artist search); each followed artist's MusicBrainz id is sent to fetch its release groups. Artist and release titles are sent to itunes.apple.com to find artwork. Nothing else leaves the device.
- MusicBrainz asks for one request per second and a descriptive User-Agent; the script waits between calls and sends "ScriptWell-NewReleases/1.0". Syncs are spread over runs: each run works through the artists in turn within its time budget, and background runs continue where the last one stopped.
- Run the script once in the app, then add the widget. Widget parameter: an artist name to show only that artist, or "recent" to lead with what just came out.
- "Add to Calendar" creates all-day events for upcoming releases. Syncs schedule a notification for 9:00 on each release day (within the next 60 days); background runs also catch same-day releases.
