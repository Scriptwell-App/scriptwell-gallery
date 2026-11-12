# Scriptwell Gallery

Community scripts for the Scriptwell app. Every script here was reviewed by a
maintainer before it was published. There are no accounts, comments or
profiles: the gallery is this repository plus a static `index.json` on GitHub
Pages.

- **Want to submit a script?** Read [CONTRIBUTING.md](CONTRIBUTING.md) and [GUIDELINES.md](GUIDELINES.md).
- **Want to report a script?** Use "Report script" in the app, or open a [report issue](../../issues/new?template=report-script.yml).
- **Maintaining this repo?** Read on.

## How it works

```
author opens PR ──> validate.yml ──> summary comment + labels ──> maintainer reads script, merges
                                                                          │
app <── index.json + script files on GitHub Pages <── publish.yml <───────┘
```

| Path | What it is |
|---|---|
| `scripts/<id>/` | One folder per script: `script.js`, `meta.json`, `icon.png`, optional `README.md`. Starts with one script, Repo Stats; new ones arrive by pull request |
| `schema/meta.schema.json` | JSON Schema for `meta.json` |
| `tools/analyzer/` | `analyzer-core.js` and `rules.json`: the same two files the app runs on imported scripts |
| `tools/*.mjs` | CI entry points: `review-pr`, `analyze`, `validate-meta`, `check-icon`, `build-index` |
| `.github/workflows/validate.yml` | Runs on every pull request; comments, labels, fails on blocking findings |
| `.github/workflows/publish.yml` | Runs on merge to `main`; rebuilds `index.json` and deploys to Pages |

### What the app reads

The app fetches `index.json` from the Pages root (cached with ETag). Paths in
it are relative to `index.json`.

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-01-02T03:04:05.000Z",
  "scripts": [
    {
      "id": "repo-stats",
      "name": "Repo Stats",
      "author": "scriptwell",
      "version": "1.0.0",
      "description": "Stars, forks and open issues for any GitHub repository",
      "permissions": ["network"],
      "minAppVersion": "1.0",
      "widgetSizes": ["small", "medium"],
      "license": "MIT",
      "category": "developer-tools",
      "status": "public",
      "sha256": "…hex of script.js bytes…",
      "size": 612,
      "scriptPath": "scripts/repo-stats/script.js",
      "iconPath": "scripts/repo-stats/icon.png",
      "readmePath": "scripts/repo-stats/README.md",
      "updatedAt": "2026-01-01T12:00:00+00:00"
    }
  ]
}
```

On install the app downloads `script.js`, checks it against `sha256`, shows
the permission list, and never runs the script automatically. These field
names are a contract with the app: add fields if you need to, never rename.

## Maintainer quick start

1. **Create the repo** from this folder and push to `main`. Make it public.
2. **Replace placeholders:** `@scriptwell-maintainers` in `.github/CODEOWNERS`,
   `OWNER/REPO` in `.github/ISSUE_TEMPLATE/*.yml`, and
   `gallery@scriptwell.example` in `GUIDELINES.md` and the issue template.
3. **Commit a lockfile:** run `npm install` once in `tools/` and commit
   `tools/package-lock.json`. The workflows use `npm ci` when it exists.
4. **Enable Pages:** Settings → Pages → Source: **GitHub Actions**.
   It must be **GitHub Actions**, not "Deploy from a branch". With the branch
   option GitHub publishes the README as a website instead, and `index.json`
   returns 404 even though the publish workflow reports success.
5. **Protect `main`:** require a pull request, require review from Code
   Owners, require the status check **Gallery checks**, and disallow bypass.
6. **Actions settings:** Settings → Actions → General → require approval for
   first-time contributors' workflow runs.
7. **Labels** (created automatically on first use; create them up front for
   colors): `needs-changes`, `needs-careful-review`, `checks-passed`, `report`.
8. **Point the app at it:** set the gallery base URL in the app to
   `https://<owner>.github.io/<repo>/` and the report URL to this repo.

## Reviewing a submission (about five minutes)

1. Read the bot's summary comment. `needs-changes` means the author has work
   to do; you can stop there.
2. Compare **permissions declared** with **permissions used**, and with what
   the description promises. A clock does not need your location.
3. Read `script.js` from top to bottom in the Files tab. It is one readable
   file by rule. For each `fetch`, check the host is expected and what is sent.
4. Clear every item under "Needs a look" (`needs-careful-review`): long
   strings, encoded data, an author that differs from the PR author, a status
   change, added permissions.
5. Look at the icon, name, description and README against
   [GUIDELINES.md](GUIDELINES.md). Then merge. `publish.yml` does the rest.

When unsure, do not merge. Ask the author in the pull request.

## Taking a script down

Set one field in `scripts/<id>/meta.json` and merge:

```json
"status": "hidden"
```

After the next publish the app stops listing the script and stops offering
it for install; its files are removed from Pages. The entry stays in
`index.json` so the app can warn people who already installed it. No app
update is needed. Set it back to `"public"` to restore.

Use this for confirmed reports. Close the report issue with a link to the
commit.

## Changing the rules

- **Analyzer rules and the word list** live in `tools/analyzer/rules.json`
  (`rules` and `textFilter.words`). That file and `analyzer-core.js` are shared
  with the app: change them in the app repository and copy them here with its
  `scripts/sync-analyzer.sh`, so the gallery and the app never disagree.
  Extending `textFilter.words` here alone is fine; sync it back later.
- **`meta.json` fields:** edit `schema/meta.schema.json`. Removing or renaming
  a field needs an app change first.
- Run `npm test` in `tools/` before merging tool changes; `tools-test.yml`
  does the same on pull requests.

## Running the checks locally

```bash
cd tools && npm install
```

```bash
npm test
```

```bash
node analyze.mjs ../scripts/repo-stats/script.js
```

```bash
npm run validate
```

```bash
npm run index
```

## License

The tooling is MIT licensed ([LICENSE](LICENSE)). Each script is licensed by
its author under the license named in its `meta.json`.
