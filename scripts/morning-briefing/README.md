# Morning Briefing

Pulls the latest headlines from the RSS feeds you choose (BBC News and The Guardian by default), condenses them into a short briefing with on-device AI, reads it aloud and shows it in a widget. Contacts only the feed hosts.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `network` to fetch data over HTTPS

## How it works

- Fetches the feeds listed under Settings (RSS or Atom, parsed with regular expressions), keeps the latest 20 headlines with the first sentence of each description, and groups them by publication. Only the feed hosts are contacted; nothing else is sent anywhere.
- Apple Intelligence (on-device AI.summarize) condenses them into about six bullet points. When the model is not available the briefing is the top headlines, word for word.
- Tap ▶, or run it from Shortcuts, and the briefing is read aloud with the system voice; the mini-app has Read aloud and Stop buttons. Pass "quiet" as the input to skip the voice.
- For a 7 am briefing: Shortcuts › Automation › Time of Day › 7:00, Run Immediately, then add the action Scriptwell › Run Script and choose Morning Briefing. Run Script returns the briefing text, so you can hand it to Speak Text, Messages or a note as well.
- The latest briefing is stored with its time; the widget shows it (medium: three bullets, large: all).
