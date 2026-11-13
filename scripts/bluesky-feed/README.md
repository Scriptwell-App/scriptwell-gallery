# Bluesky Feed

Follow Bluesky accounts, searches and custom feeds without logging in, using the public API at public.api.bsky.app: post cards with pictures and counts, a profile header with a posting sparkline, and widgets with the latest posts or follower growth.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, extraLarge
- **Permissions:** `network` to fetch data over HTTPS

## How it works

- Everything comes from Bluesky's public, read-only API at public.api.bsky.app. No account, no login and no token: the only things sent are the handle, search words or feed address you typed.
- The mini-app keeps a list of sources (handles, searches and custom feeds), one tab each. Post cards show the avatar, name, text, time, like/repost/reply counts and image thumbnails; tapping one opens it on bsky.app. Handles also get a profile header with follower, following and post counts and a 7-day posting sparkline.
- Widget parameter: the handle to show, for example "bsky.app" (the first handle in the app if empty). Small shows the follower count and the change since yesterday (the count is stored once a day), medium shows the latest post, large three posts, extra large the profile and four posts.
- Pictures are loaded from Bluesky's image servers; turn them off in the app if you prefer text only.
