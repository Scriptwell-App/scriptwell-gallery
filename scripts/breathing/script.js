// @name        Breathing
// @description Box breathing guided by taps you can feel, one calm minute at a time
// @icon        wind
// @color       #0284C7
// @version     1.0.0
// @author      va4w
// @category    health-fitness

// Box breathing: breathe in for 4 seconds, hold for 4, out for 4, hold for 4.
// Tap Begin, rest your eyes, and follow the taps:
//   one tap = breathe in, two taps = hold, three taps = breathe out.
// Each press guides one full breath (16 seconds).

const SECONDS = 4;
const today = () => new Date().toLocaleDateString("en-CA");
const breaths = () => Storage.get(`breaths:${today()}`, 0);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cue(taps) {
  for (let i = 0; i < taps; i++) {
    await UI.haptic(i === 0 ? "medium" : "light");
    await sleep(180);
  }
}

Script.action("breathe", async () => {
  for (const taps of [1, 2, 3, 2]) { // in, hold, out, hold
    await cue(taps);
    await sleep(SECONDS * 1000 - taps * 180);
  }
  await UI.haptic("success");
  Storage.set(`breaths:${today()}`, breaths() + 1);
});

const step = (emoji, title, detail) => Widget.hstack([
  Widget.text(emoji, { font: "title2" }),
  Widget.vstack([Widget.text(title, { font: "headline" }), Widget.text(detail, { font: "caption", color: "secondary" })], { alignment: "leading", spacing: 1 }),
  Widget.spacer(),
], { spacing: 12 });

Script.ui(() => ({
  title: "Breathing",
  content: Widget.vstack([
    Widget.symbol("wind", { size: 52, color: "blue", fallback: "🌬" }),
    Widget.text(breaths() === 0 ? "Ready when you are" : `${breaths()} calm breath${breaths() === 1 ? "" : "s"} today`, { font: "title3", weight: "semibold" }),
    Widget.button(breaths() === 0 ? "Begin" : "Another breath", "breathe", null, { style: "prominent", color: "blue" }),
    Widget.divider(),
    step("①", "Breathe in", `One tap. ${SECONDS} seconds.`),
    step("②", "Hold", `Two taps. ${SECONDS} seconds.`),
    step("③", "Breathe out", `Three taps. ${SECONDS} seconds.`),
    step("②", "Hold", `Two taps. ${SECONDS} seconds.`),
    Widget.text("Four or five breaths is about a minute. The screen updates after each breath.", { font: "footnote", color: "secondary", align: "center" }),
  ], { spacing: 14, padding: 24 }),
}));
