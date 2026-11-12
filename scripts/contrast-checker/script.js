// @name        Contrast Checker
// @description Check whether two colours have enough contrast for readable text (WCAG)
// @icon        circle.lefthalf.filled
// @color       #334155
// @version     1.0.0
// @author      va4w
// @category    graphics-design

// From Shortcuts, pass two hex colours, for example "#1E293B on #F8FAFC".

const state = () => Storage.get("colors", { text: "#1E293B", background: "#F8FAFC" });

// Accepts "#abc", "abc", "#aabbcc" or "aabbcc"; returns "#AABBCC" or null.
function normalize(input) {
  let hex = String(input ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

function luminance(hex) {
  const channel = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function ratio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const verdicts = (r) => [
  ["Body text (AA)", r >= 4.5], ["Large text (AA)", r >= 3], ["Body text (AAA)", r >= 7], ["Large text (AAA)", r >= 4.5],
];

async function ask(which) {
  const answer = await UI.prompt({ title: `${which === "text" ? "Text" : "Background"} colour`, placeholder: "#1E293B", defaultValue: state()[which] });
  if (answer === null) return;
  const hex = normalize(answer);
  if (!hex) { await UI.alert({ title: "Not a colour", message: "Use a hex code such as #1E293B." }); return; }
  Storage.set("colors", { ...state(), [which]: hex });
}

Script.action("text", () => ask("text"));
Script.action("background", () => ask("background"));
Script.action("swap", () => Storage.set("colors", { text: state().background, background: state().text }));

Script.ui(() => {
  const { text, background } = state();
  const r = ratio(text, background);
  return {
    title: "Contrast",
    content: Widget.vstack([
      Widget.vstack([
        Widget.text("The quick brown fox", { font: "title2", weight: "bold", color: text }),
        Widget.text("jumps over the lazy dog. 0123456789", { font: "body", color: text }),
      ], { spacing: 6, padding: 24, background, cornerRadius: 16, frame: { maxWidth: "infinity" } }),
      Widget.text(`${r.toFixed(2)} : 1`, { font: 44, weight: "bold", design: "rounded", color: r >= 4.5 ? "green" : r >= 3 ? "orange" : "red" }),
      ...verdicts(r).map(([label, pass]) => Widget.hstack([
        Widget.symbol(pass ? "checkmark.circle.fill" : "xmark.circle.fill", { size: 18, color: pass ? "green" : "red", fallback: pass ? "✅" : "❌" }),
        Widget.text(label),
        Widget.spacer(),
      ], { spacing: 8 })),
      Widget.hstack([
        Widget.button(`Text ${text}`, "text", null, { style: "bordered" }),
        Widget.button(`Background ${background}`, "background", null, { style: "bordered" }),
      ], { spacing: 8 }),
      Widget.button("Swap", "swap", null, { color: "secondary" }),
    ], { spacing: 12, padding: 20 }),
  };
});

Script.run((input) => {
  const found = (input ?? "").match(/#?[0-9a-f]{6}\b|#?[0-9a-f]{3}\b/gi) ?? [];
  const text = normalize(found[0]) ?? state().text;
  const background = normalize(found[1]) ?? state().background;
  const r = ratio(text, background);
  const passed = verdicts(r).filter(([, pass]) => pass).map(([label]) => label);
  return `${text} on ${background}: ${r.toFixed(2)}:1. ${passed.length ? `Passes ${passed.join(", ")}.` : "Fails every level."}`;
});
