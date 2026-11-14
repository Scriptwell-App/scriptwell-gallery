# Scriptwell privacy policy

*Last updated: 13 November 2026. Applies to the Scriptwell app for iPhone, iPad and Mac, and to this gallery.*

The short version: Scriptwell collects nothing. There are no accounts, no analytics, no advertising and no tracking, and the developer receives nothing from the app unless you submit a script to the gallery or star one (see "The gallery" below). What follows describes, feature by feature, what stays on your device, what leaves it and why, so you can check it against the app itself.

## What Scriptwell collects

Nothing. The app has no sign-in, no telemetry, no crash reporting service and no third-party SDKs. The App Store privacy label is "Data Not Collected". The app's privacy manifest declares no collected data types and no tracking domains.

## When the app itself uses the network

Apart from submitting a script and starring one, which are described under "The gallery" below, the app makes network requests on its own in two cases.

1. **Loading the gallery.** The Gallery tab downloads `index.json`, script files, icons and readme files from this repository's GitHub Pages site (`scriptwell-app.github.io`). GitHub receives the ordinary request data any web server sees, such as your IP address; see [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement). Nothing about you is sent along, and the app does not tell the gallery which scripts you install.
2. **The cloud model.** The writing assistant uses Claude, and only with an Anthropic API key you enter in Settings; without one it is unavailable. Only when you use the assistant, or when a script you approved for the `cloudai` permission calls `AI.cloud`, does the app send your request, the script you are editing and Scriptwell's documentation to Anthropic's API, authenticated with your key. Scripts' own `AI` calls use Apple's on-device model and send nothing. The app shows which model is in use on every assistant request. Your key is stored in the Keychain on your device and is sent nowhere else. Anthropic's handling of those requests is governed by [Anthropic's privacy policy](https://www.anthropic.com/privacy).

Weather, places and maps shown by scripts are fetched from Apple's services (WeatherKit, Apple Maps), the same way any weather or map app does; only the coordinates or search text a script passes are sent.

## What scripts can access, and how that is controlled

Scripts are small JavaScript files. A script can use a capability only if it declares it in its header **and** you approved it for that script. The approval sheet lists every capability by name before the first run and again if the list grows. Approving one script never approves another. iOS asks its own permission questions on top, so for example location or Health access needs both your approval in Scriptwell and the system prompt.

| Capability | What a script gets | What else protects it |
|---|---|---|
| `network` | HTTPS requests to any server the script names | The URL is in the source; the gallery shows a globe icon on scripts that use it |
| `location` | Your location while the script runs | iOS prompt; nothing in the background |
| `calendar`, `reminders` | Read and write events or reminders | iOS prompts |
| `contacts` | Search contacts; or the system picker, which hands over one contact you choose without any permission | iOS prompt for search only |
| `health` | Read steps, heart rate, sleep, workouts and similar; add weight, water and similar | iOS asks per data type, and only for the types the script actually reads or writes. Nothing is read in widgets |
| `camera` | One photo through the system camera, or a live scanner for codes and text, only while the script is on screen | No background capture, no recording |
| `microphone` | Speech recognition while a listening sheet is on screen | Recognition is on-device only; no audio is stored |
| `clipboard` | Read the pasteboard | iOS shows its paste notice |
| `notifications` | Schedule local notifications | iOS prompt |
| `bluetooth` | Scan and talk to Bluetooth LE devices while the script runs | iOS prompt; connections end with the run |
| `motion` | Compass, motion sensors, pedometer, barometer | iOS prompt where the system requires one |
| `ar` | A camera view with objects placed in your surroundings, only while the script is on screen | iOS camera prompt |
| `cloudai` | Send text to the cloud model you configured | Off unless you chose the cloud model and entered a key |

Photos come through the system photo picker, which runs outside the app; the app has no photo-library access and asks for none. Pictures a script receives are re-encoded without location or camera metadata and stored in that script's own folder. Text, barcode and image recognition run on the device with Apple's Vision framework. Translation and the on-device model also run on the device.

Every script runs in a sandbox with time and memory limits, cannot load code it did not come with (`eval`, `new Function` and dynamic `import` are disabled), and cannot read another script's storage, files or secrets.

What a script then does with the data it was allowed to read is determined by its source, which is always visible in the editor. A script with the `network` permission can send data to the server it names. That is why the gallery reviews every script and shows its permissions before you install it.

## Where your data lives

- **Scripts** are plain `.js` files in the "Scriptwell" folder of your iCloud Drive, or in the app's folder on the device when iCloud Drive is off. iCloud sync is Apple's service under [Apple's iCloud terms](https://www.apple.com/legal/internet-services/icloud/). You can read, copy, edit or delete the files from the Files app at any time.
- **Script storage and files** (what scripts keep between runs) live in the app's own container on the device, in a separate area per script.
- **Versions** of your scripts, kept by the editor so you can go back, live in the same container.
- **Secrets** (API keys a script asks you for) are stored in the device Keychain, listed by name under Settings › Script Secrets, never displayed, and can be forgotten there.
- **Approvals** (which permissions you granted to which script) are stored on the device and can be revoked under Settings › Script Permissions or per script.

Deleting the app deletes everything except the script files in iCloud Drive.

## Widgets, Shortcuts and background runs

Widgets, Shortcuts actions and background refreshes run only scripts you installed, with only the permissions you already approved in the app. A widget cannot show prompts. Background refresh runs a script's `Script.background` handler for a few seconds when iOS chooses to; the app uses no location, audio or other background modes.

## The gallery

The gallery is this public repository plus a static site. Submitting a script makes it a public pull request on GitHub under GitHub's terms. From the app, the script, its listing (name, description, category, version, the author name you typed), its icon and the screenshots you captured and kept in the submit sheet are sent to the gallery's submission service, a Cloudflare Worker run by the gallery's maintainer, which opens the pull request on your behalf; the author name you typed appears on it, and nothing else about you. Screenshots show whatever the script showed on your device when you captured them, so look at them before you submit; they become part of the public pull request and of the script's gallery page, and like the rest of the pull request they are read by the gallery's automated checks. The request includes a one-time Apple DeviceCheck token, which proves to Apple that it comes from a genuine copy of the app and carries no identity; the service forwards it to Apple and does not keep it. The service stores, per script id, a hash of the secret your device uses to submit updates, and daily request counters by hashed network address; Cloudflare's own request logs apply. If you open the pull request from your own GitHub account instead, your GitHub username appears as the author. Tapping the star button on a script's page sends that script's id, whether you starred or unstarred it, a one-time DeviceCheck token (handled as above) and a random secret your device makes the first time you star a script and keeps in its Keychain, to the same service. The service stores only a hash of that secret combined with the script id, which lets it count your device once per script and take the star back if you tap again, but cannot be used to link your stars to one another or to your device; it also keeps daily request counters by hashed network address. Only the total per script is published. There are no accounts, comments, reviews, profiles or messages in the app. Hiding an author in the app is stored only on your device. "Report This Script" opens a GitHub issue form in your browser, which you fill in yourself.

## Children

Scriptwell is rated 4+ and has no content, accounts or data collection aimed at children or anyone else. The gallery guidelines exclude mature content.

## Changes

Changes to this policy are made as commits to this file, so its history is public. The date at the top is updated with each change.

## Contact

Open an issue in this repository: https://github.com/Scriptwell-App/scriptwell-gallery/issues
