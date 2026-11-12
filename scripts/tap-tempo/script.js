// @name        Tap Tempo
// @description Tap along to a song to find its tempo in beats per minute
// @icon        metronome.fill
// @color       #9333EA
// @version     1.0.0
// @author      va4w
// @category    music

let taps = []; // times of the recent taps, in milliseconds

// Italian tempo names, by the slowest tempo they cover.
const NAMES = [[0, "Grave"], [40, "Largo"], [60, "Adagio"], [76, "Andante"], [108, "Moderato"], [120, "Allegro"], [156, "Vivace"], [176, "Presto"]];

function tempo() {
  if (taps.length < 2) return null;
  const gaps = taps.slice(1).map((time, i) => time - taps[i]);
  const average = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return { bpm: Math.round(60000 / average), beat: Math.round(average) };
}

Script.action("tap", async () => {
  const now = Date.now();
  if (taps.length && now - taps[taps.length - 1] > 2500) taps = []; // a long pause starts a new count
  taps = [...taps, now].slice(-8);
  await UI.haptic("light");
});

Script.action("reset", () => { taps = []; });
Script.action("save", () => { const t = tempo(); if (t) Storage.set("saved", [t.bpm, ...Storage.get("saved", [])].slice(0, 5)); });

Script.ui(() => {
  const t = tempo();
  const name = t ? [...NAMES].reverse().find(([from]) => t.bpm >= from)[1] : "";
  const saved = Storage.get("saved", []);
  return {
    title: "Tap Tempo",
    content: Widget.vstack([
      Widget.text(t ? String(t.bpm) : "–", { font: 96, weight: "bold", design: "rounded", color: "purple" }),
      Widget.text(t ? `BPM · ${name} · ${t.beat} ms per beat` : taps.length === 1 ? "Keep tapping…" : "Tap the button in time with the music", { color: "secondary" }),
      Widget.button(
        Widget.zstack([Widget.text("TAP", { font: "largeTitle", weight: "heavy", color: "white" })], { background: "purple", cornerRadius: 28, frame: { maxWidth: "infinity", height: 190 } }),
        "tap",
      ),
      Widget.hstack([
        Widget.button("Reset", "reset", null, { style: "bordered", color: "secondary" }),
        t ? Widget.button("Keep this tempo", "save", null, { style: "bordered", color: "purple" }) : null,
      ], { spacing: 10 }),
      saved.length ? Widget.text(`Kept: ${saved.join(", ")} BPM`, { font: "footnote", color: "secondary" }) : null,
    ], { spacing: 14, padding: 20 }),
  };
});
