// @name        Palette Maker
// @description Generate harmonious colour palettes and copy the hex codes
// @permissions clipboard
// @widget      medium
// @icon        paintpalette.fill
// @color       #C026D3
// @version     1.0.0
// @author      scriptwell
// @category    graphics-design

// In the app, tap a swatch to copy its hex code. The widget shows the current palette.

const MODES = {
  Analogous: [-30, -15, 0, 15, 30],
  Complementary: [0, 0, 180, 180, 180],
  Triadic: [0, 0, 120, 240, 240],
  Monochrome: [0, 0, 0, 0, 0],
};

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
}

function make(mode, hue) {
  // Vary the lightness across the five swatches so even a single hue gives a usable range.
  const lightness = [0.82, 0.68, 0.54, 0.4, 0.26];
  const saturation = [0.55, 0.65, 0.7, 0.65, 0.6];
  return MODES[mode].map((shift, i) => hslToHex((hue + shift + 360) % 360, saturation[i], lightness[i]));
}

const state = () => Storage.get("palette", { mode: "Analogous", hue: 280, colors: make("Analogous", 280), copied: null });
const save = (changes) => Storage.set("palette", { ...state(), copied: null, ...changes });

Script.action("new", () => {
  const hue = Math.floor(Math.random() * 360);
  save({ hue, colors: make(state().mode, hue) });
});

Script.action("mode", ({ mode }) => save({ mode, colors: make(mode, state().hue) }));

Script.action("copy", async ({ hex }) => {
  await Clipboard.writeText(hex);
  await UI.haptic("success");
  save({ copied: hex });
});

const readable = (hex) => (parseInt(hex.slice(1, 3), 16) * 0.299 + parseInt(hex.slice(3, 5), 16) * 0.587 + parseInt(hex.slice(5, 7), 16) * 0.114 > 150 ? "#000000" : "#FFFFFF");

Script.widget(() => Widget.vstack([
  Widget.hstack(state().colors.map((hex) => ({
    type: "stack", direction: "vertical", children: [], background: hex, frame: { maxWidth: "infinity", height: 76 },
  })), { spacing: 0, cornerRadius: 12 }),
  Widget.hstack([
    Widget.text(state().mode, { font: "caption", color: "secondary" }),
    Widget.spacer(),
    Widget.button("New palette", "new", null, { style: "bordered", color: "purple" }),
  ]),
], { spacing: 10 }));

Script.ui(() => {
  const { colors, mode, copied } = state();
  return {
    title: "Palette",
    content: Widget.vstack([
      ...colors.map((hex) => Widget.button(
        Widget.hstack([
          Widget.text(hex, { font: "headline", design: "monospaced", color: readable(hex) }),
          Widget.spacer(),
          Widget.text(copied === hex ? "Copied" : "Tap to copy", { font: "caption", color: readable(hex) }),
        ], { padding: 16, background: hex, cornerRadius: 12 }),
        "copy",
        { hex },
      )),
      Widget.button("New palette", "new", null, { style: "prominent", color: "purple" }),
      Widget.hstack(Object.keys(MODES).slice(0, 2).map((name) =>
        Widget.button(name, "mode", { mode: name }, { style: name === mode ? "prominent" : "bordered" })), { spacing: 8 }),
      Widget.hstack(Object.keys(MODES).slice(2).map((name) =>
        Widget.button(name, "mode", { mode: name }, { style: name === mode ? "prominent" : "bordered" })), { spacing: 8 }),
    ], { spacing: 10, padding: 16 }),
  };
});
