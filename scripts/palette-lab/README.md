# Palette Lab

Build colour palettes with harmonies, a WCAG contrast matrix and live previews, then export them as JSON or CSS custom properties. Nothing leaves the device.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `clipboard` to read and replace the clipboard

## How it works

- Add colours with the colour well or by typing a hex code; tap a swatch to make it the base colour.
- Harmonies (complementary, analogous, triadic, split-complementary, tints and shades) are worked out from the base colour with HSL maths, and any of them can be added with one tap.
- The Contrast tab checks every pair against WCAG 2 relative luminance and marks AA and AAA.
- Export writes palette JSON and CSS custom properties to the script's Files folder and offers to save them; "Copy CSS" puts the variables on the clipboard (the only reason for that permission).
- The widget shows the current palette, or set its Parameter to a palette name to pin one. The large widget adds the contrast grid of the first five colours. No network, no accounts.
