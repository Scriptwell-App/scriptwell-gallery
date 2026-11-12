// @name        Next F1 Race
// @description Countdown to the next Formula 1 Grand Prix, with qualifying and sprint times in your time zone
// @permissions network
// @widget      small, medium, rectangular, inline
// @icon        flag.checkered
// @color       #E10600
// @version     1.0.0
// @author      va4w
// @category    sports

// The calendar comes from the community-run Jolpica F1 API (free, no key).
// Unofficial: not associated with Formula 1 or the FIA.

async function nextRace() {
  const saved = Storage.get("race");
  try {
    const response = await fetch("https://api.jolpi.ca/ergast/f1/current/next.json", { timeout: 8000 });
    if (!response.ok) throw new Error(`The F1 calendar answered ${response.status}`);
    const race = (await response.json()).MRData.RaceTable.Races[0];
    if (!race) return { over: true };
    const at = (session) => (session?.date ? Date.parse(`${session.date}T${session.time ?? "12:00:00Z"}`) : null);
    const fresh = {
      name: race.raceName,
      round: Number(race.round),
      circuit: race.Circuit.circuitName,
      place: `${race.Circuit.Location.locality}, ${race.Circuit.Location.country}`,
      race: at(race), qualifying: at(race.Qualifying), sprint: at(race.Sprint), practice: at(race.FirstPractice),
    };
    Storage.set("race", fresh);
    return fresh;
  } catch (error) {
    if (saved && saved.race > Date.now()) return { ...saved, offline: true };
    throw error;
  }
}

const when = (time) => new Date(time).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const day = (time) => new Date(time).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
const sessions = (r) => [["Practice", r.practice], ["Sprint", r.sprint], ["Qualifying", r.qualifying], ["Race", r.race]].filter(([, time]) => time);

Script.widget(async ({ family }) => {
  const r = await nextRace();
  const refreshAfter = 60 * 60;
  if (r.over) return { content: Widget.text("The season is over. See you next year 🏁", { font: "caption", color: "secondary", align: "center" }), refreshAfter: 24 * 60 * 60 };
  const live = r.race <= Date.now();

  if (family === "inline") return { content: Widget.text(`🏁 ${r.name.replace(" Grand Prix", " GP")} ${when(r.race)}`), refreshAfter };
  if (family === "rectangular") {
    return {
      content: Widget.vstack([
        Widget.text(r.name, { font: "headline", lineLimit: 1, minimumScale: 0.7 }),
        Widget.text(when(r.race), { font: "caption" }),
        live ? Widget.text("Race time", { font: "caption2" }) : Widget.date(r.race, { style: "relative", font: "caption2" }),
      ], { alignment: "leading", spacing: 1 }),
      refreshAfter,
    };
  }

  const main = Widget.vstack([
    Widget.hstack([Widget.symbol("flag.checkered", { size: 13, color: "red", fallback: "🏁" }), Widget.text(`ROUND ${r.round}`, { font: "caption2", weight: "heavy", color: "red" }), Widget.spacer()], { spacing: 4 }),
    Widget.text(r.name, { font: "headline", lineLimit: 2, minimumScale: 0.8 }),
    Widget.text(r.place, { font: "caption2", color: "secondary", lineLimit: 1 }),
    Widget.spacer(),
    live ? Widget.text("Race time", { font: "title3", weight: "bold", color: "red" }) : Widget.date(r.race, { style: "relative", font: "title3", weight: "bold", design: "rounded" }),
    Widget.text(when(r.race), { font: "caption", color: "secondary" }),
  ], { alignment: "leading", spacing: 2, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });

  return {
    content: family === "small" ? main : Widget.hstack([
      main,
      Widget.vstack([
        ...sessions(r).map(([name, time]) => Widget.vstack([
          Widget.text(name, { font: "caption2", color: "secondary" }),
          Widget.text(when(time), { font: "caption", weight: name === "Race" ? "bold" : "regular" }),
        ], { alignment: "leading", spacing: 0 })),
        Widget.spacer(),
      ], { alignment: "leading", spacing: 5, frame: { maxHeight: "infinity", alignment: "topLeading" } }),
    ], { spacing: 14 }),
    refreshAfter,
  };
});

Script.ui(async () => {
  const r = await nextRace();
  if (r.over) return { title: "Formula 1", content: Widget.vstack([Widget.text("🏁", { font: 64 }), Widget.text("The season is over. See you next year.", { color: "secondary" })], { spacing: 12, padding: 24 }) };
  return {
    title: `Round ${r.round}`,
    content: Widget.vstack([
      Widget.text(r.name, { font: "title", weight: "bold", align: "center" }),
      Widget.text(`${r.circuit} · ${r.place}`, { color: "secondary", align: "center" }),
      r.race > Date.now() ? Widget.date(r.race, { style: "timer", font: 44, weight: "bold", design: "rounded", color: "red" }) : Widget.text("Race time", { font: 44, weight: "bold", color: "red" }),
      Widget.text(day(r.race), { font: "headline" }),
      Widget.divider(),
      ...sessions(r).map(([name, time]) => Widget.hstack([
        Widget.text(name, { weight: name === "Race" ? "bold" : "regular" }),
        Widget.spacer(),
        Widget.text(when(time), { color: time < Date.now() ? "secondary" : "primary", weight: name === "Race" ? "bold" : "regular" }),
      ])),
      Widget.text(r.offline ? "Offline. Showing the saved calendar." : "Times are in your time zone. Unofficial.", { font: "caption", color: r.offline ? "orange" : "secondary" }),
    ], { spacing: 12, padding: 20 }),
  };
});

Script.run(async () => {
  const r = await nextRace();
  return r.over ? "The Formula 1 season is over." : `The ${r.name} in ${r.place} is on ${day(r.race)} at ${new Date(r.race).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`;
});
