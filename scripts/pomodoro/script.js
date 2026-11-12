// @name        Pomodoro
// @description Focus for 25 minutes, take a break, repeat. With alerts and a daily count
// @permissions notifications
// @widget      small
// @icon        timer
// @color       #DC2626
// @version     1.0.0
// @author      va4w
// @category    productivity

// Start a focus session in the app. A notification tells you when it ends,
// and the widget counts down by itself. After four sessions the break is longer.

const MINUTE = 60000;
const FOCUS = 25, SHORT = 5, LONG = 15;
const key = () => new Date().toLocaleDateString("en-CA");
const done = () => Storage.get(`done:${key()}`, 0);
const session = () => Storage.get("session", null); // { kind: "focus" | "break", end, minutes }

// Counts a focus session once its time is up, then forgets it.
function settle() {
  const s = session();
  if (!s || s.end > Date.now()) return s;
  if (s.kind === "focus") Storage.set(`done:${key()}`, done() + 1);
  Storage.remove("session");
  Storage.set("last", s.kind);
  return null;
}

async function start(kind, minutes) {
  const end = Date.now() + minutes * MINUTE;
  Storage.set("session", { kind, end, minutes });
  await Notification.schedule({
    id: "pomodoro", at: end,
    title: kind === "focus" ? "Focus session done" : "Break is over",
    body: kind === "focus" ? "Nice work. Time for a break." : "Ready for the next session?",
  });
}

Script.action("focus", () => start("focus", FOCUS));
Script.action("break", () => start("break", done() > 0 && done() % 4 === 0 ? LONG : SHORT));
Script.action("stop", async () => { Storage.remove("session"); await Notification.cancel("pomodoro"); });
Script.action("refresh", () => {});

const tomatoes = () => (done() ? "🍅".repeat(Math.min(done(), 10)) : "No sessions yet today");

Script.widget(() => {
  const s = settle();
  if (!s) {
    return Widget.vstack([
      Widget.text("🍅", { font: 34 }),
      Widget.text(`${done()} today`, { font: "headline" }),
      Widget.text("Start in Scriptwell", { font: "caption2", color: "secondary" }),
    ], { spacing: 4 });
  }
  return {
    content: Widget.vstack([
      Widget.text(s.kind === "focus" ? "FOCUS" : "BREAK", { font: "caption", weight: "heavy", color: s.kind === "focus" ? "red" : "green" }),
      Widget.date(s.end, { style: "timer", font: 34, weight: "bold", design: "rounded", align: "center" }),
      Widget.text(`${done()} done today`, { font: "caption2", color: "secondary" }),
    ], { spacing: 4 }),
    refreshAt: new Date(s.end + 2000),
  };
});

Script.ui(() => {
  const s = settle();
  if (s) {
    return {
      title: s.kind === "focus" ? "Focus" : "Break",
      content: Widget.vstack([
        Widget.text(s.kind === "focus" ? "Stay with one thing" : "Step away for a moment", { color: "secondary" }),
        Widget.date(s.end, { style: "timer", font: 84, weight: "bold", design: "rounded", color: s.kind === "focus" ? "red" : "green" }),
        Widget.hstack([Widget.text("Ends at"), Widget.date(s.end, { style: "time", weight: "semibold" })], { spacing: 6 }),
        Widget.hstack([
          Widget.button("Update", "refresh", null, { style: "bordered" }),
          Widget.button("Stop", "stop", null, { style: "bordered", color: "red" }),
        ], { spacing: 10 }),
        Widget.text(tomatoes(), { font: "title3" }),
      ], { spacing: 16, padding: 24 }),
    };
  }

  const afterFocus = Storage.get("last") === "focus";
  const long = done() > 0 && done() % 4 === 0;
  return {
    title: "Pomodoro",
    content: Widget.vstack([
      Widget.text("🍅", { font: 72 }),
      Widget.text(afterFocus ? "Session done. Take a break?" : "Ready to focus?", { font: "title2", weight: "bold" }),
      Widget.button(`Focus for ${FOCUS} minutes`, "focus", null, { style: afterFocus ? "bordered" : "prominent", color: "red" }),
      Widget.button(`${long ? "Long break" : "Break"} for ${long ? LONG : SHORT} minutes`, "break", null, { style: afterFocus ? "prominent" : "bordered", color: "green" }),
      Widget.divider(),
      Widget.text(tomatoes(), { font: done() ? "title3" : "footnote", color: "secondary" }),
      done() ? Widget.text(`${done()} session${done() === 1 ? "" : "s"} · ${done() * FOCUS} minutes of focus today`, { font: "footnote", color: "secondary" }) : null,
    ], { spacing: 14, padding: 24 }),
  };
});
