// @name        Interval Timer
// @description Work and rest rounds for workouts, with an alert at every change
// @permissions notifications
// @icon        timer
// @color       #EA580C
// @version     1.0.0
// @author      va4w
// @category    health-fitness

// Starting a workout schedules a notification for the end of every work and
// rest period, so the alerts arrive even with the screen off.

const setup = () => Storage.get("setup", { work: 30, rest: 15, rounds: 8 });
const session = () => Storage.get("session", null); // { start, work, rest, rounds }

// Where a running session is right now.
function position(s) {
  const elapsed = (Date.now() - s.start) / 1000;
  const cycle = s.work + s.rest;
  const total = s.rounds * cycle - s.rest; // no rest after the last round
  if (elapsed >= total) return null;
  const round = Math.floor(elapsed / cycle);
  const inCycle = elapsed - round * cycle;
  const working = inCycle < s.work;
  const phaseEnd = s.start + (round * cycle + (working ? s.work : cycle)) * 1000;
  return { round: round + 1, working, phaseEnd, end: s.start + total * 1000 };
}

Script.action("adjust", ({ key, by }) => {
  const limits = { work: [5, 600], rest: [5, 600], rounds: [1, 30] }[key];
  Storage.set("setup", { ...setup(), [key]: Math.min(limits[1], Math.max(limits[0], setup()[key] + by)) });
});

Script.action("start", async () => {
  const s = { ...setup(), start: Date.now() + 3000 }; // three seconds to get ready
  const cycle = s.work + s.rest;
  for (let round = 0; round < s.rounds; round++) {
    const last = round === s.rounds - 1;
    await Notification.schedule({
      id: `work-${round}`, at: s.start + (round * cycle + s.work) * 1000,
      title: last ? "Workout complete" : "Rest", body: last ? `${s.rounds} rounds done. Nice work.` : `Round ${round + 1} done. ${s.rest} seconds.`,
    });
    if (!last) {
      await Notification.schedule({ id: `rest-${round}`, at: s.start + (round + 1) * cycle * 1000, title: "Go!", body: `Round ${round + 2} of ${s.rounds}` });
    }
  }
  Storage.set("session", s);
});

Script.action("stop", async () => {
  await Notification.cancelAll();
  Storage.remove("session");
});

Script.action("refresh", () => {});

Script.ui(() => {
  const s = session();
  const now = s ? position(s) : null;

  if (s && Date.now() < s.start) {
    return { title: "Get ready", content: Widget.vstack([
      Widget.date(s.start, { style: "timer", font: 80, weight: "bold", design: "rounded" }),
      Widget.button("Update", "refresh", null, { style: "bordered" }),
    ], { spacing: 16, padding: 24 }) };
  }

  if (now) {
    return {
      title: `Round ${now.round} of ${s.rounds}`,
      content: Widget.vstack([
        Widget.text(now.working ? "WORK" : "REST", { font: "title", weight: "heavy", color: now.working ? "orange" : "teal" }),
        Widget.date(now.phaseEnd, { style: "timer", font: 80, weight: "bold", design: "rounded" }),
        Widget.hstack([Widget.text("Finishes"), Widget.date(now.end, { style: "time", weight: "semibold" })], { spacing: 6 }),
        Widget.text("The clock counts down by itself. Tap Update to show the next round; alerts arrive either way.", { font: "footnote", color: "secondary", align: "center" }),
        Widget.hstack([
          Widget.button("Update", "refresh", null, { style: "bordered" }),
          Widget.button("Stop", "stop", null, { style: "bordered", color: "red" }),
        ], { spacing: 10 }),
      ], { spacing: 14, padding: 24 }),
    };
  }

  const { work, rest, rounds } = setup();
  const stepper = (label, key, value, step) => Widget.hstack([
    Widget.text(label),
    Widget.spacer(),
    Widget.button("−", "adjust", { key, by: -step }, { style: "bordered" }),
    Widget.text(value, { font: "headline", frame: { width: 56 } }),
    Widget.button("+", "adjust", { key, by: step }, { style: "bordered" }),
  ], { spacing: 8 });

  return {
    title: "Interval Timer",
    content: Widget.vstack([
      Widget.symbol("figure.run", { size: 48, color: "orange", fallback: "🏃" }),
      stepper("Work", "work", `${work}s`, 5),
      stepper("Rest", "rest", `${rest}s`, 5),
      stepper("Rounds", "rounds", String(rounds), 1),
      Widget.text(`Total ${Math.round((rounds * (work + rest) - rest) / 60 * 10) / 10} minutes`, { color: "secondary" }),
      Widget.button("Start", "start", null, { style: "prominent", color: "orange" }),
    ], { spacing: 14, padding: 24 }),
  };
});
