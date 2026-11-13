# Podcast Queue

Follow podcasts, see new episodes with artwork, build a listening queue with its total time, and let background runs fetch new episodes. Contacts itunes.apple.com and each show's own RSS feed.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `network` to fetch data over HTTPS

## How it works

- Search sends the text you type to itunes.apple.com, which returns each show's RSS feed address and artwork. Following a show stores that address; nothing else is sent to Apple.
- Each followed show's feed is downloaded directly from its own host and parsed for the latest 20 episodes, which are kept as JSON in the script's Files folder. Background runs refresh the feeds a few times a day and mark anything new.
- Tap an episode to play its audio in Safari, open the show in Podcasts, queue it or mark it played. The queue keeps its order and shows how long everything left adds up to.
- The widget shows the newest unplayed episodes with artwork; set its Parameter to "queue" to show the queue instead. Open the mini-app once before adding the widget.
