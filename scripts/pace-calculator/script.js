// @name        Pace Calculator
// @description Running pace per kilometre and mile, plus predicted times for other distances
// @icon        figure.run
// @color       #EA580C
// @version     1.0.0
// @author      scriptwell
// @category    sports

// From Shortcuts, pass a distance in kilometres and a time: "10 52:30".
// Predictions use Riegel's formula (time grows a little faster than
// distance), which works well between 5 km and the marathon.

const RACES = { "5K": 5, "10K": 10, Half: 21.0975, Marathon: 42.195 };
const MILE = 1.609344;
const state = () => Storage.get("run", { km: 5, seconds: 25 * 60 });

// "25", "25:30" or "1:45:00" → seconds, or null.
function parseTime(text) {
  const parts = String(text ?? "").trim().split(":").map(Number);
  if (parts.length < 1 || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const seconds = parts.length === 1 ? parts[0] * 60 : parts.reduce((total, n) => total * 60 + n, 0);
  return seconds > 0 ? Math.round(seconds) : null;
}

function clock(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

const predict = ({ km, seconds }, target) => seconds * (target / km) ** 1.06;
const label = (km) => Object.keys(RACES).find((name) => RACES[name] === km) ?? `${km} km`;

function summary({ km, seconds }) {
  return `${label(km)} in ${clock(seconds)}: ${clock(seconds / km)} per km, ${clock((seconds / km) * MILE)} per mile, ${(km / (seconds / 3600)).toFixed(1)} km/h.`;
}

Script.action("distance", ({ km }) => Storage.set("run", { ...state(), km }));
Script.action("custom", async () => {
  const km = Number(String((await UI.prompt({ title: "Distance in kilometres", placeholder: "8" })) ?? "").replace(",", "."));
  if (Number.isFinite(km) && km > 0 && km <= 500) Storage.set("run", { ...state(), km });
});
Script.action("time", async () => {
  const answer = await UI.prompt({ title: "Your time", message: "Minutes, or 25:30, or 1:45:00", placeholder: "25:30", defaultValue: clock(state().seconds) });
  if (answer === null) return;
  const seconds = parseTime(answer);
  if (!seconds) { await UI.alert({ title: "Not a time", message: "Write it like 25:30 or 1:45:00." }); return; }
  Storage.set("run", { ...state(), seconds });
});

Script.ui(() => {
  const run = state();
  const stat = (title, value) => Widget.vstack([
    Widget.text(value, { font: "title2", weight: "bold", design: "rounded" }),
    Widget.text(title, { font: "caption", color: "secondary" }),
  ], { spacing: 2, frame: { maxWidth: "infinity" } });

  return {
    title: "Pace",
    content: Widget.vstack([
      Widget.hstack(Object.entries(RACES).map(([name, km]) => Widget.button(name, "distance", { km }, { style: run.km === km ? "prominent" : "bordered", color: "orange" })), { spacing: 6 }),
      Widget.button(Object.values(RACES).includes(run.km) ? "Another distance…" : `${run.km} km · change`, "custom", null, { color: "secondary" }),
      Widget.button(Widget.vstack([
        Widget.text(clock(run.seconds), { font: 56, weight: "bold", design: "rounded", color: "primary" }),
        Widget.text(`for ${label(run.km)} · tap to change`, { font: "caption", color: "secondary" }),
      ], { spacing: 2 }), "time"),
      Widget.hstack([stat("per km", clock(run.seconds / run.km)), stat("per mile", clock((run.seconds / run.km) * MILE)), stat("km/h", (run.km / (run.seconds / 3600)).toFixed(1))]),
      Widget.divider(),
      Widget.text("At the same fitness, roughly", { font: "caption", color: "secondary" }),
      ...Object.entries(RACES).filter(([, km]) => km !== run.km).map(([name, km]) => Widget.hstack([
        Widget.text(name),
        Widget.spacer(),
        Widget.text(clock(predict(run, km)), { font: "headline", design: "rounded" }),
        Widget.text(`${clock(predict(run, km) / km)}/km`, { font: "caption", color: "secondary", frame: { width: 70, alignment: "trailing" } }),
      ], { spacing: 8 })),
    ], { spacing: 14, padding: 20 }),
  };
});

Script.run((input) => {
  const [distance, time] = String(input ?? "").trim().split(/\s+/);
  const km = Number(String(distance).replace(",", ".")), seconds = time ? parseTime(time) : null;
  if (!Number.isFinite(km) || km <= 0 || !seconds) return `${summary(state())} Pass a distance and a time, like "10 52:30", to work out another.`;
  return summary({ km, seconds });
});
