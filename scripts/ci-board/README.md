# CI Board

GitHub Actions status for the repositories you choose, with alerts when a workflow turns red; talks to api.github.com with a personal access token you enter once.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular, inline
- **Permissions:** `network` to fetch data over HTTPS; `notifications` to schedule local notifications

## How it works

- Open the mini-app, add repositories as owner/repo and paste a GitHub personal access token when asked (fine-grained with "Actions: read", or classic with the repo scope). The token is kept in the Keychain and is only ever sent to api.github.com.
- Each refresh loads the last ten workflow runs of every repository, plus the workflow names, from api.github.com. Nothing else leaves the device.
- The widget shows the latest run of each workflow, its branch, how long ago it ran and a sparkline of recent run durations. Tapping a row opens that run on GitHub.
- Background runs keep the board fresh while the app is closed and send a notification when a workflow that was green turns red (and, if you turn it on, when it is green again).
- Widget parameter: an owner/repo, or just the repository name, to pin one repository.
- Run the script once in the app before adding the widget so the token and permissions are set.
