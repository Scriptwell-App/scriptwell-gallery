# Submission service

A Cloudflare Worker that lets people submit scripts to the gallery from the
Scriptwell app without a GitHub account, and counts the stars people give
scripts from the app (see [Stars](#stars)). The app sends the script, its
metadata, icon and the screenshots the author captured; the Worker runs the
gallery's checks, verifies with Apple that the request came from a real
install of the app, and opens a pull request on this repository through a
GitHub App. Maintainers review it like
any other pull request. Nothing is published without a merge.

```
app ──POST /v1/submit──► Worker ──checks, DeviceCheck, ownership──► GitHub App ──► branch submit/<id> + pull request
                              │                                                          │
                              └── KV: sha256(owner secret) per id, daily counters        └── validate.yml runs as usual
```

The GitHub route (fork, pull request from your own account) still works and
is documented in [CONTRIBUTING.md](../CONTRIBUTING.md). The Worker is for
everyone else.

## What it stores

- `owner:<id>`: the SHA-256 of the secret handed to the device that first
  submitted `<id>`, the date, and the pull request number. Updates to that id
  must present the secret. Nothing identifies the device or the person.
- `rl:ip:<sha256 of address>:<day>` and `rl:all:<day>`: counters that expire
  after two days.
- In D1 (`STARS`), for stars: one row per script and install, holding
  `sha256(<install secret> + ":" + <script id>)` and the date; carried-over
  counts in `star_baseline`; daily counters in `star_limits`.

The DeviceCheck token is forwarded to Apple and not kept. Request logs are
whatever Cloudflare keeps for your account.

## Setting it up (once, about twenty minutes)

You need a Cloudflare account (the free plan is enough), the GitHub account
that owns the gallery repository, and the Apple Developer account that signs
the app.

### 1. GitHub App

GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**.

- Name: anything (it shows as the author of the pull requests, e.g. `scriptwell-submissions`).
- Homepage URL: the gallery repository.
- Webhook: untick **Active**.
- Repository permissions: **Contents: Read and write**, **Pull requests: Read and write**, **Issues: Read and write** (labels and comments; optional, the Worker copes without it).
- Where can this app be installed: **Only on this account**.

Create it, note the **App ID**, then **Generate a private key** and keep the
downloaded `.pem`. Install the App on the gallery repository only
(**Install App** in the sidebar); the number at the end of the resulting URL
(`…/installations/12345678`) is the **Installation ID**.

Create the `from-app` label in the repository (Issues → Labels) so the pull
requests are easy to filter.

### 2. DeviceCheck key

Apple Developer → Certificates, Identifiers & Profiles → **Keys** → **+**.
Name it, tick **DeviceCheck**, download the `.p8` (only offered once) and
note the **Key ID**. Your **Team ID** is in the top right of that page.

DeviceCheck needs no entitlement and no change to the app's capabilities.

### 3. Deploy

```bash
cd worker && npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler kv namespace create SUBMISSIONS
```

Paste the printed `id` into `wrangler.toml` under `[[kv_namespaces]]`.

```bash
npx wrangler d1 create scriptwell-stars
```

Paste the printed `database_id` into `wrangler.toml` under `[[d1_databases]]`
(the deploy fails until the placeholder is replaced), then create the tables:

```bash
npx wrangler d1 migrations apply scriptwell-stars --remote
```

Then fill in `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, `APPLE_TEAM_ID` and
`DEVICECHECK_KEY_ID` under `[vars]`. Check `GALLERY_REPOSITORY` and
`GALLERY_INDEX_URL` match your gallery.

```bash
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < path/to/app.private-key.pem
```

```bash
npx wrangler secret put DEVICECHECK_PRIVATE_KEY < path/to/AuthKey_XXXXXXXXXX.p8
```

```bash
npx wrangler deploy
```

The deploy prints the Worker's URL. `wrangler.toml` gives it a custom domain
(`routes`, `custom_domain = true`), which needs the zone on the same
Cloudflare account; delete that line to use the `workers.dev` address. Put
the URL plus `/v1/submit` in the app: `submissionURL` in
`GalleryConfig.standard` (`ScriptwellKit/Gallery/Gallery.swift`).

`GET /v1/health` should answer `{"ok":true,…,"configured":{"github":true,"deviceCheck":true,"kv":true,"stars":true}}`.
A `false` names the part whose variables or secrets are missing. The ids can
also be set in the Cloudflare dashboard instead of `wrangler.toml`
(`keep_vars = true` stops a deploy from deleting them).

### 4. Branch protection

Protect `main` so the App cannot push to it: Settings → Branches → add a
rule for `main` with **Require a pull request before merging** and
**Require review from Code Owners**. The App then has exactly one power: to
open pull requests for `scripts/<id>/`, which is what submissions are.

## Day to day

- Pull requests from the App carry the `from-app` label, a body that explains
  the submission and shows the screenshots, and the author's display name. The author cannot reply on
  GitHub. If something blocks the script, close the pull request with a short
  comment; the app shows the state of the pull request to the author, who can
  fix the script and submit again (which reopens a new pull request on the
  same branch).
- A resubmission while a pull request is open updates the branch and adds a
  comment; CI runs again.
- `cleanup.yml` deletes `submit/*` branches when their pull request closes.

### Testing from the Simulator

DeviceCheck does not work in the Simulator. Deploy a second Worker (for
example `wrangler deploy --name scriptwell-gallery-submit-staging --var REQUIRE_DEVICE_CHECK:false`)
pointing at a test repository, and set its URL as `submissionURL` in a debug
build. Never set `REQUIRE_DEVICE_CHECK=false` on the Worker the shipping app
uses.

Xcode builds installed on a device use Apple's development DeviceCheck
environment; TestFlight and App Store builds use production. The Worker
checks one of them (`DEVICECHECK_ENVIRONMENT`), so a staging Worker set to
`development` is the way to test on a device from Xcode.

### Freeing an id

If someone needs an id that another device claimed (a submission that was
closed and never followed up, say), delete its ownership record:

```bash
npx wrangler kv key delete --binding SUBMISSIONS "owner:<id>"
```

The next submission of that id gets a fresh secret. Ids already published in
`index.json` can never be claimed through the Worker; updates to those come
from GitHub or from the device that holds the secret.

### Limits

`IP_DAILY_LIMIT` (default 30 per address per day) and `GLOBAL_DAILY_LIMIT`
(300 per day across everyone) are circuit breakers against floods. Raise
them if the gallery becomes popular; the 429 message tells people to try
tomorrow.

## Stars

People star a script from its page in the app; no account is needed.

```
app ──POST /v1/star { id, starred, voterToken, deviceToken }──► Worker ──limits, index, DeviceCheck──► D1
stars.yml (every 6 h) ──GET /v1/stars──► Worker ──► stats.json ──► publish.yml ──► index.json
```

- **One star per install per script.** The app makes a random `voterToken`
  once and keeps it in the Keychain. The Worker stores only
  `sha256(voterToken + ":" + id)`, so it can count an install once and let it
  take the star back, but cannot link two stars, or a star and a device.
- **Only real installs.** Every tap carries a DeviceCheck token, checked like
  submissions. Several devices can still star several times; that is the limit
  of what can be done without accounts.
- **Only published scripts.** The id must be in `index.json` (cached five
  minutes).
- **Limits** live in D1, not KV (KV's free plan allows 1,000 writes a day):
  `STAR_IP_DAILY_LIMIT` (300 taps per address per day) and
  `STAR_GLOBAL_DAILY_LIMIT` (20,000 a day). They are counted before
  DeviceCheck, so a flood never reaches Apple.
- `GET /v1/stars` answers `{ "<id>": { "stars": n } }`, the format of
  `stats.json`, cached at the edge for five minutes. `stars.yml` reads it from
  the repository variable `STARS_URL`, or `https://scriptwellworker.o-h.dev/v1/stars`.

### Carrying over the old 👍 counts

Before the first run of the new `stars.yml` overwrites `stats.json`, copy its
counts into D1 once, so no script loses its stars:

```bash
node scripts/stars-baseline.mjs ../stats.json > baseline.sql
```

```bash
npx wrangler d1 execute scriptwell-stars --remote --file baseline.sql
```

The baseline is added to the live count. The old `Star: <id>` issues can be
closed afterwards.

### Taking a star count down

```bash
npx wrangler d1 execute scriptwell-stars --remote --command "DELETE FROM stars WHERE script_id = '<id>'"
```

## Development

```bash
npm test
```

Tests cover the checks, the key handling (GitHub's PKCS#1 keys are converted
to PKCS#8 in the Worker, so the `.pem` is used as downloaded), the DeviceCheck
request, the GitHub call sequence and the handler, all against fake network
and KV. The star tests run the real migration on Node's built-in SQLite as a stand-in
for D1. `wrangler dev` runs it locally; without a device token set
`REQUIRE_DEVICE_CHECK=false` in a `.dev.vars` file.

The request body (`src/index.js`) is `{ meta, script, icon, readme?,
screenshots?, deviceToken, ownerToken?, app }`, where `screenshots` maps a
widget size or `app` to a base64 PNG; limits are in `src/checks.js`.
The checks import the gallery's own `tools/analyzer`, `tools/lib/png.mjs`
and `tools/lib/ast-checks.mjs`, so the Worker and CI never disagree. The
`meta.json` rules are mirrored in `src/checks.js` (`META`); change both when
the schema changes.
