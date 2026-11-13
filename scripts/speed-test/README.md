# Speed Test

Measures download speed and latency against Cloudflare's public speed test server (speed.cloudflare.com), keeps a history with charts by test and by hour of day, and shows the last result as a gauge in a widget.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `network` to fetch data over HTTPS

## How it works

- Tap "Run test" in the mini-app (or run the script from Shortcuts). It sends five tiny requests to speed.cloudflare.com to measure latency and jitter, then downloads test files of 1, 2 and 4 MB and keeps the best download speed. A full test moves about 7 MB; lower the largest file in Settings on a metered connection.
- The only host contacted is speed.cloudflare.com. It receives nothing but the request for test data; no identifiers, no results.
- Results are kept in the script's Files folder (history.json) and summarised in Storage for the widget. The widget never runs a test itself because a test takes longer than a widget is allowed; tapping it opens the mini-app.
- The mini-app redraws when an action finishes, so the result appears when the test is done, usually after 5 to 20 seconds.
