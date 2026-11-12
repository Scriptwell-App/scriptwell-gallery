# Contributing a script

Scripts reach the gallery by pull request. A maintainer reads every script
before it is published. Read [GUIDELINES.md](GUIDELINES.md) first; it says
what gets accepted.

The fastest route: in Scriptwell, open your script and choose **Submit to
Gallery**. The app checks the script and prepares the folder for you. The
rest of this page explains what it prepares.

## Folder layout

One folder per script. The folder name is the script's permanent id.

```
scripts/
  my-script/
    script.js     required   the script, exactly as it runs in the app
    meta.json     required   metadata (below)
    icon.png      required   square PNG, 256–1024 px, at most 200 KB
    README.md     optional   setup notes, screenshots are not supported
```

Nothing else may be in the folder, and a submission may not touch files
outside it.

## meta.json

```json
{
  "id": "my-script",
  "name": "My Script",
  "author": "your-github-handle",
  "version": "1.0.0",
  "description": "One or two plain sentences, at most 280 characters.",
  "permissions": ["network"],
  "minAppVersion": "1.0",
  "widgetSizes": ["small", "medium"],
  "license": "MIT",
  "category": "utilities"
}
```

| Field | Rules |
|---|---|
| `id` | 3–50 characters: lowercase letters, digits, hyphens. Equals the folder name. Never changes. |
| `name` | 1–50 characters. |
| `author` | Your GitHub handle, without `@`. Should be the account that opens the pull request. |
| `version` | `x.y.z`. Bump it whenever `script.js` changes. |
| `description` | 1–280 characters. Say what the script does and what it contacts. |
| `permissions` | Any of `network`, `location`, `calendar`, `reminders`, `notifications`, `clipboard`, `camera`, `microphone`, `contacts`, `health`, `cloudai`, `bluetooth`. Must match the `// @permissions` line in `script.js`. `[]` for none. |
| `minAppVersion` | Lowest Scriptwell version it runs on, such as `1.0`. |
| `widgetSizes` | Any of `small`, `medium`, `large`, `extraLarge`, `circular`, `rectangular`, `inline`. `[]` if there is no widget. |
| `license` | SPDX id. Default `MIT`. |
| `category` | One of the App Store categories: `books`, `business`, `developer-tools`, `education`, `entertainment`, `finance`, `food-drink`, `games`, `graphics-design`, `health-fitness`, `kids`, `lifestyle`, `magazines-newspapers`, `medical`, `music`, `navigation`, `news`, `photo-video`, `productivity`, `reference`, `shopping`, `social-networking`, `sports`, `travel`, `utilities`, `weather`. |
| `homepage` | Optional `https://` link. |

Do not set `status`; maintainers use it to hide scripts.
The full schema is [schema/meta.schema.json](schema/meta.schema.json).

## script.js

Start with the header the app reads:

```js
// @name My Script
// @permissions network
// @widget small, medium
```

Then plain JavaScript. The automated checks **reject**:

- `eval`, `new Function`, `Function(...)`, string arguments to `setTimeout`/`setInterval`
- `import(...)`, `import`/`export` (a script is one classic script file)
- minified or obfuscated code: very long lines, `_0x…` identifiers, strings made of `\x`/`\u` escapes, identifiers written with `\u` escapes
- very large embedded strings (over 20,000 characters) and files over 200,000 characters
- computed access on `globalThis`/`window`/`self`, and `["constructor"]` tricks
- any API whose permission is not declared (`fetch` needs `network`, `Location` needs `location`, and so on)

They **flag for a closer look** (not a rejection): long or base64-looking
strings, many escapes, declared permissions that are never used, an `author`
that differs from the pull request author.

## Check it locally

You need Node 20 or later.

```bash
cd tools && npm install
```

```bash
node analyze.mjs ../scripts/my-script/script.js
```

```bash
node validate-meta.mjs ../scripts/my-script/meta.json
```

```bash
node check-icon.mjs ../scripts/my-script/icon.png
```

## Open the pull request

1. Fork this repository and add your folder under `scripts/`.
2. Open a pull request against `main` and fill in the template.
3. Within a minute or two a bot comments with the results and labels the
   pull request: `checks-passed`, `needs-careful-review` or `needs-changes`.
   Fix anything blocking and push again; the comment updates itself.
4. A maintainer reads the script. We aim to respond within a week. Expect
   questions about network hosts and permissions.
5. After merge, the script appears in the app within a few minutes.

## Updating your script

Open a new pull request that changes the same folder, and bump `version`.
People who installed it see a diff before they accept the update. If the
update adds a permission, the app asks them to approve it again, and
reviewers will ask why it is needed.

## Removing your script

Open a pull request or an issue asking for removal. A maintainer sets
`"status": "hidden"`, which removes it from the gallery.

## Changing the tools

Fixes to `tools/`, `schema/` and the workflows are welcome as separate pull
requests, never together with a script. Run `npm test` in `tools/` first.
