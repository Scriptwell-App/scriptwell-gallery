# Scriptwell Gallery

Community scripts for the Scriptwell app. Every script here was reviewed by a
maintainer before it was published. There are no accounts, comments or
profiles: the gallery is this repository plus a static `index.json` on GitHub
Pages.

- **Want to submit a script?** Read [CONTRIBUTING.md](CONTRIBUTING.md) and [GUIDELINES.md](GUIDELINES.md).
- **Want to report a script?** Use "Report script" in the app, or open a [report issue](../../issues/new?template=report-script.yml).
- **Privacy:** what the app and the gallery do and do not collect is in [PRIVACY.md](PRIVACY.md).
- **Maintaining this repo?** Read on.

## How it works

```
author opens PR ──> validate.yml ──> checks + automated review ──> summary comment + labels ──> maintainer reads script, merges
                          │                                                                          │
                          └── clearly malware / illegal / spam / objectionable: closed with the reason  │
app <── index.json, scripts and screenshots on GitHub Pages <── publish.yml <────────────────────────┘
```

| Path | What it is |
|---|---|
| `scripts/<id>/` | One folder per script: `script.js`, `meta.json`, `icon.png`, optional `README.md` and `screenshots/` (one PNG per widget size plus `app.png`, captured in the app). Scripts arrive by pull request |
| `featured.json` | The front page: `hero` (the banner), `editorsChoice` and one-line `blurbs`, all by script id |
| `stats.json` | Stars per script, written every six hours by the `stars.yml` workflow; never edit by hand |
| `schema/meta.schema.json` | JSON Schema for `meta.json` |
| `tools/analyzer/` | `analyzer-core.js` and `rules.json`: the same two files the app runs on imported scripts |
| `tools/*.mjs` | CI entry points: `review-pr`, `analyze`, `validate-meta`, `check-icon`, `build-index`, and `moderate` (the automated review, below) |
| `.github/workflows/validate.yml` | Runs on every pull request; checks, automated review, comments, labels, fails on blocking findings, closes clear rejections |
| `.github/workflows/cleanup.yml` | Deletes a `submit/<id>` branch once its pull request is closed |
| `worker/` | The submission service: a Cloudflare Worker that turns a submission from the app into a pull request, so authors need no GitHub account. Optional; see [worker/README.md](worker/README.md) |
| `.github/workflows/stars.yml` | Copies the star counts from the gallery service (`GET /v1/stars` on the Worker) into `stats.json` every six hours |
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
      "author": "octocat",
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
      "updatedAt": "2026-01-01T12:00:00+00:00",
      "createdAt": "2025-12-01T09:00:00+00:00",
      "featured": "hero",
      "blurb": "Stars, forks and open issues for any repository, right on your Home Screen.",
      "stars": 12,
      "installs": null,
      "starsURL": null,
      "homepage": null,
      "screenshots": { "small": "scripts/repo-stats/screenshots/small.png", "app": "scripts/repo-stats/screenshots/app.png" }
    }
  ],
  "hero": ["repo-stats"],
  "editorsChoice": []
}
```

On install the app downloads `script.js`, checks it against `sha256`, shows
the permission list, and never runs the script automatically. These field
names are a contract with the app: add fields if you need to, never rename.

## The front page

The app's Gallery tab shows shelves built from `index.json` alone:

- **Featured** (the hero banner) and **Editors' Choice**: the ids in `featured.json`, in that order, with the `blurbs` as one-line notes. Edit the file in a pull request like any other change; the build fails if an id has no script.
- **New**: scripts first published in the last 30 days (`createdAt`, the first commit of the script), newest first; the newest ten when nothing is that recent.
- **Recently Updated**: scripts changed since they were first published (`updatedAt`).
- **Most Starred**: scripts with stars. A star is a tap on the star button on a script's page in the app; no account is needed. The Worker counts one star per install per script (see [worker/README.md](worker/README.md#stars)), `stars.yml` copies the counts into `stats.json` every six hours, and the publish that commit triggers puts them in `index.json`. `starsURL` is left over from when stars were 👍 reactions on GitHub issues; it stays in the index for older app versions and is `null` now. Install counts (`installs`) are reserved: nothing measures them, because the app sends no analytics and GitHub Pages keeps no download logs.
- **Categories**: every category that has at least one public script, with counts.

Search in the app ranks matches by name, then id and author, then category, permissions and description, and needs every word to match; results can be narrowed by permission and "has a widget", and sorted by name, newest, recently updated or most starred.

## The automated review

`validate.yml` runs `tools/moderate.mjs` after the static checks when the
repository has an `ANTHROPIC_API_KEY` secret (Settings → Secrets and
variables → Actions). It reads the script, `meta.json`, the README, the
icon and the screenshots, with `GUIDELINES.md` as the standard, and answers
in a fixed shape: a verdict (`approve`, `review`, `reject`) with a
confidence and categories, a plain-language summary of what the script
does, every host it contacts and what is sent there, what each permission is
for, whether the description matches the code, and concerns for you. The
answer goes into the same sticky comment, under the checks.

What it may do on its own: close the pull request, and only for a
high-confidence `reject` in one of four categories: `malware`, `illegal`,
`spam`, `objectionable`. The comment then says why, the pull request gets
the `rejected` label, and the author can fix the script and submit again.
Reopening a closed pull request is your decision: a run started by a reopen
never closes it again. Everything else (`review`, a lower confidence, the
other categories) only adds `needs-careful-review` and a note.

The review runs nothing. The submission is sent as data, the instructions
say it is untrusted, the answer is constrained to a schema, and any free
text from it is stripped of Markdown, links and mentions before it is
posted. Treat it as a first opinion: it is good at summarising and at
catching the obvious, and the decision to merge stays yours. Without the
secret the step says "not set up" and everything else works as before. It
costs a few cents per submission; `--model` in the workflow changes what it
runs on. Read `tools/moderate.mjs` before changing the instructions.

## Reviewing a submission (about five minutes)

1. Read the bot's summary comment. `needs-changes` means the author has work
   to do; you can stop there. The automated review under it tells you what
   the script does and where to look; read it, then verify it against the
   code. Screenshots, when the author captured them, are inline.
2. Compare **permissions declared** with **permissions used**, and with what
   the description promises. A clock does not need your location.
3. Read `script.js` from top to bottom in the Files tab. It is one readable
   file by rule. For each `fetch`, check the host is expected and what is sent.
4. Clear every item under "Needs a look" (`needs-careful-review`): long
   strings, encoded data, an author that differs from the PR author, a status
   change, added permissions.
5. Look at the icon, name, description, README and screenshots against
   [GUIDELINES.md](GUIDELINES.md). A screenshot that shows the author's own
   data is a reason to ask for another. Then merge. `publish.yml` does the rest.

When unsure, do not merge. Ask the author in the pull request.

Pull requests labelled `from-app` were opened by the submission service on
behalf of someone without a GitHub account. They cannot answer here. If
something blocks the script, close the pull request with a one-line reason;
the app shows them the pull request, and submitting a fixed version from the
app opens a new one. A resubmission while the pull request is open updates
its branch and adds a comment.

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
  Do not edit them here alone: the app's tests compare the two copies, and the
  next sync would overwrite the change.
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
node analyze.mjs ../scripts/hn-top-story/script.js
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
