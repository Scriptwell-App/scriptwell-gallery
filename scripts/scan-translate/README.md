# Scan & Translate

Point the camera at a sign, menu or page, or pick a photo: the text is read and translated on the device, shown side by side with the original, read aloud, copied or shared, with a history of your last twenty scans.

- **Type:** Mini-app, Shortcuts action
- **Permissions:** `clipboard` to read and replace the clipboard; `camera` to take photos and scan codes with the camera

## How it works

- Take a photo or pick one. Text is read with on-device Vision, grouped into paragraphs by its position on the page, and translated with Apple's on-device translation. Nothing leaves the device.
- Choose the source language (or leave it on Auto) and the target language. Changing the target on a finished scan translates it again. The first time a language pair is used, iOS offers to download it.
- Each card shows the original on the left and the translation on the right. Speak reads the translation aloud in the target language; Copy and Share hand the text on.
- The last twenty scans are kept with thumbnails in the script's Files folder; swipe through them on the home screen and delete the ones you no longer need.
- From Shortcuts, pass an image in the Files parameter and a language code as Input (for example "es", or "de>en" for a fixed source) to get the translated text back.
