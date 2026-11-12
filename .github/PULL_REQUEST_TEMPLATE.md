<!--
Submitting a script? Thank you. Fill this in; the automated checks post a
summary a minute after you open the pull request.
Changing the tools or workflows instead? Delete the checklist and describe the change.
-->

## What the script does

<!-- One or two sentences. What does a person see or get? -->

## Permissions and network

<!-- For each permission in meta.json: why the script needs it.
     If it uses the network: which hosts it contacts and what it sends. -->

## Checklist

- [ ] This pull request only adds or changes files in **one** folder: `scripts/<id>/`
- [ ] The folder has `script.js`, `meta.json` and `icon.png` (and optionally `README.md`), and nothing else
- [ ] `meta.json` `id` equals the folder name, and `author` is my GitHub handle
- [ ] `permissions` in `meta.json` matches the `// @permissions` line in `script.js`
- [ ] The source is readable: not minified, not obfuscated, no `eval`, no code loaded from the network
- [ ] I wrote this script or have the right to publish it under the license in `meta.json`
- [ ] I have read [GUIDELINES.md](../blob/main/GUIDELINES.md)
- [ ] For an update: I bumped `version`
