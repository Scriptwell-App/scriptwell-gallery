# Package Watch

Tracks versions and daily downloads of npm, PyPI and crates.io packages, charts the last 30 days and notifies you of new releases; contacts registry.npmjs.org, api.npmjs.org, pypi.org, pypistats.org and crates.io, with an optional on-device AI summary of npm READMEs.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `network` to fetch data over HTTPS; `notifications` to schedule local notifications

## How it works

- Add packages in the mini-app, choosing npm, PyPI or crates.io. Only the package names you type are sent, to the public registries: registry.npmjs.org and api.npmjs.org, pypi.org and pypistats.org, crates.io (with a descriptive User-Agent, as crates.io asks). No key is needed.
- Each package shows its latest version, the release date, the last 30 days of downloads and a trend arrow comparing the last seven days with the seven before.
- Background runs refresh everything while the app is closed and send a notification when a package publishes a new version (each version is announced once).
- When Apple Intelligence is available, the start of an npm package's README is summarised on-device into two sentences; otherwise the registry description is shown.
- Widget parameter: a package name (or "pypi:requests") to feature one package.
- Run the script once in the app before adding the widget so the permissions are approved.
