// @name        Palette Lab
// @description Build colour palettes with harmonies, a WCAG contrast matrix and live previews, then export them as JSON or CSS custom properties. Nothing leaves the device.
// @permissions clipboard
// @widget      small, medium, large
// @icon        paintpalette.fill
// @color       #DB2777
// @version     1.0.0
// @author      scriptwell
// @category    graphics-design

// How it works
// • Add colours with the colour well or by typing a hex code; tap a swatch to make it the base colour.
// • Harmonies (complementary, analogous, triadic, split-complementary, tints and shades) are worked
//   out from the base colour with HSL maths, and any of them can be added with one tap.
// • The Contrast tab checks every pair against WCAG 2 relative luminance and marks AA and AAA.
// • Export writes palette JSON and CSS custom properties to the script's Files folder and offers to
//   save them; "Copy CSS" puts the variables on the clipboard (the only reason for that permission).
// • The widget shows the current palette, or set its Parameter to a palette name to pin one.
//   The large widget adds the contrast grid of the first five colours. No network, no accounts.

// ───────────────────────── Colour maths

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const DEFAULT_COLORS = ["#0F172A", "#F8FAFC", "#DB2777", "#F59E0B", "#0EA5E9"];
const MAX_COLORS = 10;

function normalizeHex(text) {
  let hex = String(text ?? "").trim().replace(/^#/, "").toUpperCase();
  if (/^[0-9A-F]{3}$/.test(hex)) hex = hex.split("").map((c) => c + c).join("");
  return /^[0-9A-F]{6}$/.test(hex) ? `#${hex}` : null;
}

function hexToRgb(hex) {
  const h = normalizeHex(hex) ?? "#000000";
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255];
}

const hexToHsl = (hex) => rgbToHsl(hexToRgb(hex));
const hslToHex = (hsl) => rgbToHex(hslToRgb(hsl));
const shiftHue = (hex, degrees) => { const [h, s, l] = hexToHsl(hex); return hslToHex([h + degrees, s, l]); };

// WCAG 2 relative luminance and contrast ratio.
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const grade = (ratio) => (ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA+" : "✕"); // AA+ = large text only
const gradeColor = (ratio) => (ratio >= 7 ? "green" : ratio >= 4.5 ? "mint" : ratio >= 3 ? "orange" : "red");
const inkOn = (hex) => (contrast(hex, "#FFFFFF") >= contrast(hex, "#000000") ? "#FFFFFF" : "#000000");

function harmonies(base) {
  const [h, s, l] = hexToHsl(base);
  return [
    { name: "Complementary", colors: [base, shiftHue(base, 180)] },
    { name: "Analogous", colors: [shiftHue(base, -30), base, shiftHue(base, 30)] },
    { name: "Triadic", colors: [base, shiftHue(base, 120), shiftHue(base, 240)] },
    { name: "Split-complementary", colors: [base, shiftHue(base, 150), shiftHue(base, 210)] },
    { name: "Tints", colors: [1, 2, 3, 4].map((i) => hslToHex([h, s, l + (1 - l) * i * 0.2])) },
    { name: "Shades", colors: [1, 2, 3, 4].map((i) => hslToHex([h, s, l * (1 - i * 0.2)])) },
  ];
}

// ───────────────────────── Palette storage

const palettes = () => Storage.get("palettes", []);

function ensurePalettes() {
  if (palettes().length) return;
  const starter = { id: String(Date.now()), name: "Studio", colors: DEFAULT_COLORS };
  Storage.set("palettes", [starter]);
  Storage.set("currentId", starter.id);
}

function current() {
  ensurePalettes();
  const list = palettes();
  return list.find((p) => p.id === Storage.get("currentId")) ?? list[0];
}

function savePalette(changes) {
  const me = current();
  Storage.set("palettes", palettes().map((p) => (p.id === me.id ? { ...p, ...changes } : p)));
}

function addColor(hex) {
  const clean = normalizeHex(hex);
  if (!clean) { Storage.set("notice", `"${hex}" is not a hex colour`); return; }
  const colors = current().colors;
  if (colors.includes(clean)) { Storage.set("notice", `${clean} is already in the palette`); return; }
  if (colors.length >= MAX_COLORS) { Storage.set("notice", `A palette holds up to ${MAX_COLORS} colours`); return; }
  savePalette({ colors: [...colors, clean] });
  Storage.set("notice", null);
}

function paletteNamed(name) {
  if (!name) return current();
  const wanted = name.trim().toLowerCase();
  return palettes().find((p) => p.name.toLowerCase() === wanted) ?? current();
}

// ───────────────────────── Export text

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "palette";

function cssFor(palette) {
  const lines = palette.colors.map((hex, i) => {
    const [h, s, l] = hexToHsl(hex);
    return `  --${slug(palette.name)}-${i + 1}: ${hex}; /* hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%) */`;
  });
  return `/* ${palette.name} · made with Palette Lab */\n:root {\n${lines.join("\n")}\n}\n`;
}

function jsonFor(palette) {
  const pairs = [];
  palette.colors.forEach((a, i) => palette.colors.forEach((b, j) => {
    if (j > i) pairs.push({ foreground: a, background: b, ratio: Number(contrast(a, b).toFixed(2)) });
  }));
  return JSON.stringify({
    name: palette.name,
    colors: palette.colors.map((hex) => {
      const [h, s, l] = hexToHsl(hex);
      return { hex, rgb: hexToRgb(hex), hsl: [Math.round(h), Math.round(s * 100), Math.round(l * 100)], luminance: Number(luminance(hex).toFixed(4)) };
    }),
    contrast: pairs,
    exported: new Date().toISOString(),
  }, null, 2);
}

// ───────────────────────── Actions

Script.action("draft", ({ value }) => Storage.set("draft", value));
Script.action("addDraft", () => addColor(Storage.get("draft", "#DB2777")));
Script.action("addHex", ({ value }) => { if (String(value ?? "").trim()) addColor(value); });
Script.action("add", ({ hex }) => addColor(hex));
Script.action("select", ({ index }) => Storage.set("selected", index));

Script.action("remove", ({ index }) => {
  const colors = current().colors.filter((_, i) => i !== index);
  savePalette({ colors });
  Storage.set("selected", 0);
});

Script.action("move", ({ index, by }) => {
  const colors = [...current().colors];
  const target = index + by;
  if (target < 0 || target >= colors.length) return;
  [colors[index], colors[target]] = [colors[target], colors[index]];
  savePalette({ colors });
  Storage.set("selected", target);
});

Script.action("rename", ({ value }) => { const name = String(value ?? "").trim().slice(0, 30); if (name) savePalette({ name }); });
Script.action("switch", ({ value }) => { Storage.set("currentId", value); Storage.set("selected", 0); });

Script.action("new", async () => {
  const name = await UI.prompt({ title: "New palette", placeholder: "Sunset", defaultValue: `Palette ${palettes().length + 1}` });
  if (name === null) return;
  const palette = { id: String(Date.now()), name: name.trim() || `Palette ${palettes().length + 1}`, colors: [] };
  Storage.set("palettes", [...palettes(), palette]);
  Storage.set("currentId", palette.id);
  Storage.set("selected", 0);
});

Script.action("duplicate", () => {
  const me = current();
  const copy = { id: String(Date.now()), name: `${me.name} copy`, colors: [...me.colors] };
  Storage.set("palettes", [...palettes(), copy]);
  Storage.set("currentId", copy.id);
});

Script.action("delete", async () => {
  const me = current();
  const choice = await UI.alert({ title: `Delete "${me.name}"?`, message: "This cannot be undone.", buttons: ["Cancel", "Delete"] });
  if (choice !== 1) return;
  const rest = palettes().filter((p) => p.id !== me.id);
  Storage.set("palettes", rest);
  Storage.set("currentId", rest[0]?.id ?? null);
  Storage.set("selected", 0);
});

Script.action("exportCSS", async () => {
  const me = current();
  const path = `exports/${slug(me.name)}.css`;
  await Files.write(path, cssFor(me));
  const saved = await Files.export(path, { name: `${slug(me.name)}.css` });
  Storage.set("notice", saved ? "CSS saved" : null);
});

Script.action("exportJSON", async () => {
  const me = current();
  const path = `exports/${slug(me.name)}.json`;
  await Files.write(path, jsonFor(me));
  const saved = await Files.export(path, { name: `${slug(me.name)}.json` });
  Storage.set("notice", saved ? "JSON saved" : null);
});

Script.action("copyCSS", async () => {
  await Clipboard.writeText(cssFor(current()));
  await UI.haptic("success");
  Storage.set("notice", "CSS variables copied");
});

Script.action("copyHex", async ({ hex }) => {
  await Clipboard.writeText(hex);
  await UI.haptic("light");
  Storage.set("notice", `${hex} copied`);
});

Script.action("share", async () => {
  const me = current();
  await UI.share(`${me.name}: ${me.colors.join(" · ")}`);
});

Script.action("previewText", ({ value }) => Storage.set("previewText", String(value ?? "").slice(0, 60)));

// ───────────────────────── Shared pieces

const swatchBox = (hex, { width, height, radius = 10, children = [], alignment } = {}) => ({
  type: "stack", direction: "vertical", children, alignment,
  background: hex, cornerRadius: radius,
  frame: width ? { width, height } : { maxWidth: "infinity", height },
});

function hexLabel(hex, font = "caption2") {
  return Widget.text(hex, { font, weight: "semibold", design: "monospaced", color: inkOn(hex), lineLimit: 1, minimumScale: 0.6 });
}

// A contrast grid: rows are text colours, columns are backgrounds.
function contrastGrid(colors, { cell = 30, font = 9, ratios = false } = {}) {
  const header = Widget.hstack([
    { type: "stack", direction: "vertical", children: [], frame: { width: cell, height: cell / 2 } },
    ...colors.map((bg) => swatchBox(bg, { width: cell, height: cell / 2, radius: 4 })),
  ], { spacing: 2 });
  const rows = colors.map((fg) => Widget.hstack([
    swatchBox(fg, { width: cell, height: cell, radius: 4 }),
    ...colors.map((bg) => {
      if (fg === bg) return { type: "stack", direction: "vertical", children: [], frame: { width: cell, height: cell }, background: { light: "#E2E8F0", dark: "#1E293B" }, cornerRadius: 4 };
      const ratio = contrast(fg, bg);
      return Widget.text(ratios ? ratio.toFixed(1) : grade(ratio), {
        font, weight: "bold", design: "rounded", color: fg, align: "center", lineLimit: 1, minimumScale: 0.5,
        background: bg, cornerRadius: 4, frame: { width: cell, height: cell },
      });
    }),
  ], { spacing: 2 }));
  return Widget.vstack([header, ...rows], { spacing: 2 });
}

// ───────────────────────── Widget

const APP_LINK = `scriptwell://open?id=${encodeURIComponent(Script.id)}&view=ui`;

Script.widget(({ family, parameter }) => {
  const palette = paletteNamed(parameter);
  const colors = palette.colors;
  const fill = { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" };

  if (colors.length === 0) {
    return Widget.vstack([
      Widget.symbol("paintpalette.fill", { size: 28, color: "pink", fallback: "🎨" }),
      Widget.text(`"${palette.name}" is empty. Open Palette Lab to add colours.`, { font: "caption", color: "secondary", align: "center" }),
    ], { spacing: 8, url: APP_LINK });
  }

  const title = Widget.hstack([
    Widget.text(palette.name, { font: "headline", lineLimit: 1 }),
    Widget.spacer(),
    Widget.text(`${colors.length} colours`, { font: "caption2", color: "secondary" }),
  ]);

  if (family === "small") {
    const shown = colors.slice(0, 6);
    const rows = [];
    for (let i = 0; i < shown.length; i += 2) rows.push(shown.slice(i, i + 2));
    return Widget.vstack([
      title,
      ...rows.map((pair) => Widget.hstack(pair.map((hex) => swatchBox(hex, {
        height: rows.length > 2 ? 24 : 34, radius: 8, alignment: "center",
        children: [hexLabel(hex, 9)],
      })), { spacing: 4 })),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 4, url: APP_LINK, frame: fill });
  }

  if (family === "medium") {
    const shown = colors.slice(0, 6);
    return Widget.vstack([
      title,
      Widget.hstack(shown.map((hex) => Widget.vstack([
        swatchBox(hex, { height: 54, radius: 10 }),
        Widget.text(hex, { font: 9, design: "monospaced", color: "secondary", lineLimit: 1, minimumScale: 0.6 }),
      ], { spacing: 3, frame: { maxWidth: "infinity" } })), { spacing: 6 }),
      Widget.spacer(),
      Widget.text(`Base ${colors[0]} · best pair ${bestPair(colors)}`, { font: "caption2", color: "secondary", lineLimit: 1 }),
    ], { alignment: "leading", spacing: 6, url: APP_LINK, frame: fill });
  }

  // large
  const top = colors.slice(0, 5);
  return Widget.vstack([
    title,
    Widget.hstack(colors.slice(0, 8).map((hex) => Widget.vstack([
      swatchBox(hex, { height: 40, radius: 8 }),
      Widget.text(hex.slice(1), { font: 8, design: "monospaced", color: "secondary", lineLimit: 1, minimumScale: 0.5 }),
    ], { spacing: 2, frame: { maxWidth: "infinity" } })), { spacing: 4 }),
    Widget.text("Contrast · text colour by row, background by column", { font: "caption2", color: "secondary" }),
    contrastGrid(top, { cell: 40, font: 10 }),
    Widget.spacer(),
    Widget.text("AAA ≥ 7 · AA ≥ 4.5 · AA+ ≥ 3 (large text only)", { font: "caption2", color: "secondary", lineLimit: 1 }),
  ], { alignment: "leading", spacing: 6, url: APP_LINK, frame: fill });
});

function bestPair(colors) {
  let best = null;
  colors.forEach((a, i) => colors.forEach((b, j) => {
    if (j <= i) return;
    const ratio = contrast(a, b);
    if (!best || ratio > best.ratio) best = { a, b, ratio };
  }));
  return best ? `${best.a}/${best.b} ${best.ratio.toFixed(1)}:1` : "–";
}

// ───────────────────────── Mini-app panes

const CARD_BG = { light: "#F1F5F9", dark: "#1E293B" };

function buildPane(palette, selected) {
  const colors = palette.colors;
  const draft = Storage.get("draft", "#DB2777");
  const base = colors[selected] ?? colors[0];
  return Widget.vstack([
    colors.length
      ? Widget.hstack(colors.map((hex, index) => Widget.button(
          swatchBox(hex, {
            height: index === selected ? 64 : 48, radius: 12, alignment: "center",
            children: index === selected ? [Widget.symbol("checkmark", { size: 14, color: inkOn(hex), fallback: "✓" })] : [],
          }), "select", { index })), { spacing: 6, alignment: "bottom" })
      : Widget.text("No colours yet. Add one below.", { color: "secondary" }),
    base ? Widget.hstack([
      Widget.vstack([
        Widget.text(base, { font: "title3", weight: "bold", design: "monospaced" }),
        Widget.text(describe(base), { font: "caption", color: "secondary" }),
      ], { alignment: "leading", spacing: 2 }),
      Widget.spacer(),
      Widget.button(Widget.symbol("chevron.left", { size: 14, fallback: "◀" }), "move", { index: selected, by: -1 }, { style: "bordered" }),
      Widget.button(Widget.symbol("chevron.right", { size: 14, fallback: "▶" }), "move", { index: selected, by: 1 }, { style: "bordered" }),
      Widget.button(Widget.symbol("doc.on.doc", { size: 14, fallback: "⧉" }), "copyHex", { hex: base }, { style: "bordered" }),
      Widget.button(Widget.symbol("trash", { size: 14, fallback: "🗑" }), "remove", { index: selected }, { style: "bordered", color: "red" }),
    ], { spacing: 6 }) : null,
    Widget.divider(),
    Widget.hstack([
      Widget.colorPicker(draft, "draft", null, { label: "New colour" }),
      Widget.spacer(),
      Widget.button("Add", "addDraft", null, { style: "prominent", color: "pink" }),
    ]),
    Widget.textField("Or type a hex code, e.g. #14B8A6", "", "addHex", null, { label: "Hex", keyboard: "default" }),
  ], { alignment: "leading", spacing: 14 });
}

function describe(hex) {
  const [h, s, l] = hexToHsl(hex);
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r}, ${g}, ${b}) · hsl(${Math.round(h)}°, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%) · L ${luminance(hex).toFixed(3)}`;
}

function harmonyPane(palette, selected) {
  const base = palette.colors[selected] ?? palette.colors[0];
  if (!base) return Widget.text("Add a colour first, then tap it to make it the base.", { color: "secondary" });
  return Widget.vstack([
    Widget.text(`From ${base}. Tap a swatch to add it.`, { font: "footnote", color: "secondary" }),
    ...harmonies(base).map((group) => Widget.vstack([
      Widget.text(group.name, { font: "subheadline", weight: "semibold" }),
      Widget.hstack(group.colors.map((hex) => Widget.button(
        swatchBox(hex, {
          height: 56, radius: 10, alignment: "center",
          children: [
            hexLabel(hex, 10),
            palette.colors.includes(hex) ? Widget.text("in palette", { font: 8, color: inkOn(hex) }) : null,
          ],
        }), "add", { hex })), { spacing: 6 }),
    ], { alignment: "leading", spacing: 6 })),
  ], { alignment: "leading", spacing: 14 });
}

function contrastPane(palette) {
  const colors = palette.colors;
  if (colors.length < 2) return Widget.text("Two or more colours are needed for a contrast check.", { color: "secondary" });
  const pairs = [];
  colors.forEach((a, i) => colors.forEach((b, j) => { if (j > i) pairs.push({ a, b, ratio: contrast(a, b) }); }));
  pairs.sort((x, y) => y.ratio - x.ratio);
  const passing = pairs.filter((p) => p.ratio >= 4.5).length;
  const cell = colors.length > 7 ? 34 : 42;
  return Widget.vstack([
    Widget.text(`${passing} of ${pairs.length} pairs pass AA for body text`, { font: "subheadline", weight: "semibold" }),
    Widget.text("Rows are text colours, columns are backgrounds. Numbers are contrast ratios.", { font: "caption", color: "secondary" }),
    contrastGrid(colors, { cell, font: 10, ratios: true }),
    Widget.text("AAA ≥ 7:1 · AA ≥ 4.5:1 · large text (18 pt or 14 pt bold) ≥ 3:1", { font: "caption2", color: "secondary" }),
    Widget.list(pairs.slice(0, 10).map((p) => ({
      title: `${p.a} on ${p.b}`,
      subtitle: `${p.ratio.toFixed(2)}:1`,
      symbol: p.ratio >= 4.5 ? "checkmark.seal.fill" : p.ratio >= 3 ? "exclamationmark.triangle.fill" : "xmark.octagon.fill",
      color: gradeColor(p.ratio),
      detail: grade(p.ratio),
    })), { title: "Best pairs" }),
  ], { alignment: "leading", spacing: 12 });
}

function previewPane(palette) {
  const colors = palette.colors;
  if (colors.length < 2) return Widget.text("Add at least two colours to preview them together.", { color: "secondary" });
  const sample = Storage.get("previewText", "The quick brown fox jumps over the lazy dog");
  const pairs = [];
  colors.forEach((bg) => colors.forEach((fg) => { if (fg !== bg) pairs.push({ fg, bg, ratio: contrast(fg, bg) }); }));
  pairs.sort((x, y) => y.ratio - x.ratio);
  const shown = pairs.filter((p) => p.ratio >= 3).slice(0, 6);
  return Widget.vstack([
    Widget.textField("Sample text", sample, "previewText", null, { label: "Sample" }),
    ...(shown.length ? shown : pairs.slice(0, 3)).map((p) => Widget.vstack([
      Widget.text("Headline", { font: "title2", weight: "bold", color: p.fg }),
      Widget.text(sample, { font: "body", color: p.fg, lineLimit: 3 }),
      Widget.hstack([
        Widget.text(`${p.fg} on ${p.bg}`, { font: "caption2", design: "monospaced", color: p.fg, opacity: 0.8 }),
        Widget.spacer(),
        Widget.text(`${grade(p.ratio)} ${p.ratio.toFixed(1)}:1`, {
          font: "caption2", weight: "bold", color: inkOn(colors.find((c) => c !== p.bg) ?? p.fg),
          padding: { horizontal: 6, vertical: 2 }, background: p.fg, cornerRadius: 6,
        }),
      ]),
    ], { alignment: "leading", spacing: 6, padding: 16, background: p.bg, cornerRadius: 14, frame: { maxWidth: "infinity", alignment: "leading" } })),
    Widget.text("Cards use the pairs with the highest contrast first.", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 12 });
}

function exportPane(palette) {
  const css = cssFor(palette);
  return Widget.vstack([
    Widget.hstack([
      Widget.button("Copy CSS", "copyCSS", null, { style: "prominent", color: "pink" }),
      Widget.button("Save CSS", "exportCSS", null, { style: "bordered" }),
      Widget.button("Save JSON", "exportJSON", null, { style: "bordered" }),
    ], { spacing: 8 }),
    Widget.button("Share as text", "share", null, { style: "bordered" }),
    Widget.text(css, { font: "caption2", design: "monospaced", padding: 12, background: CARD_BG, cornerRadius: 10, frame: { maxWidth: "infinity", alignment: "leading" } }),
    Widget.text("JSON includes RGB, HSL, luminance and every contrast pair. Files are written to the script's folder before saving.", { font: "caption2", color: "secondary" }),
  ], { alignment: "leading", spacing: 12 });
}

// ───────────────────────── Mini-app

Script.ui(() => {
  const palette = current();
  const list = palettes();
  const selected = clamp(Storage.get("selected", 0), 0, Math.max(0, palette.colors.length - 1));
  const notice = Storage.get("notice");

  const header = Widget.vstack([
    Widget.hstack([
      Widget.picker(list.map((p) => ({ label: p.name, value: p.id })), palette.id, "switch", null, { style: "menu" }),
      Widget.spacer(),
      Widget.menu("ellipsis.circle", [
        { title: "New palette", symbol: "plus", action: "new" },
        { title: "Duplicate", symbol: "doc.on.doc", action: "duplicate" },
        { title: "Delete palette", symbol: "trash", action: "delete", destructive: true },
      ]),
    ]),
    Widget.textField("Palette name", palette.name, "rename", null, { label: "Name" }),
    palette.colors.length
      ? Widget.hstack(palette.colors.map((hex) => swatchBox(hex, { height: 14, radius: 4 })), { spacing: 2 })
      : null,
    notice ? Widget.text(notice, { font: "footnote", color: "pink" }) : null,
  ], { alignment: "leading", spacing: 10 });

  return {
    title: "Palette Lab",
    content: Widget.vstack([
      header,
      Widget.tabs([
        { title: "Build", symbol: "square.grid.2x2.fill", content: buildPane(palette, selected) },
        { title: "Harmony", symbol: "circle.hexagongrid.fill", content: harmonyPane(palette, selected) },
        { title: "Contrast", symbol: "textformat.abc", content: contrastPane(palette) },
        { title: "Preview", symbol: "rectangle.on.rectangle", content: previewPane(palette) },
        { title: "Export", symbol: "square.and.arrow.up", content: exportPane(palette) },
      ], { selected: 0 }),
    ], { alignment: "leading", spacing: 16, padding: 16 }),
  };
});

// ───────────────────────── Shortcuts and Siri

Script.run((input) => {
  const palette = paletteNamed(input);
  if (!palette.colors.length) return `${palette.name} has no colours yet.`;
  return `${palette.name}: ${palette.colors.join(", ")}. Best pair ${bestPair(palette.colors)}.`;
});
