// @name        Blood Pressure Log
// @description Record readings, see your weekly average and share the log with your doctor
// @widget      small, medium
// @icon        heart.text.square.fill
// @color       #BE123C
// @version     1.0.0
// @author      va4w
// @category    medical

// A personal log. It does not diagnose anything and is not medical advice:
// talk to a doctor about what your readings mean for you.
//
// From Shortcuts, pass a reading such as "124/82" or "124/82 68" (with pulse).

const DAY = 86400000;
const readings = () => Storage.get("readings", []); // newest first: [{ sys, dia, pulse, time }]

// "124/82", "124 82" or "124/82 68" → a reading, or null.
function parse(text) {
  const match = /^(\d{2,3})\s*[\/\s]\s*(\d{2,3})(?:\s+(\d{2,3}))?$/.exec(String(text ?? "").trim());
  if (!match) return null;
  const [sys, dia, pulse] = [Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : null];
  if (sys < 60 || sys > 260 || dia < 30 || dia > 160 || dia >= sys) return null;
  return { sys, dia, pulse, time: Date.now() };
}

// The ranges printed on most home monitors (American Heart Association).
function range({ sys, dia }) {
  if (sys > 180 || dia > 120) return { label: "Very high", color: "red" };
  if (sys >= 140 || dia >= 90) return { label: "High (stage 2)", color: "red" };
  if (sys >= 130 || dia >= 80) return { label: "High (stage 1)", color: "orange" };
  if (sys >= 120) return { label: "Elevated", color: "yellow" };
  return { label: "Normal", color: "green" };
}

function average(days) {
  const recent = readings().filter((r) => r.time > Date.now() - days * DAY);
  if (recent.length === 0) return null;
  const mean = (pick) => Math.round(recent.reduce((sum, r) => sum + pick(r), 0) / recent.length);
  return { sys: mean((r) => r.sys), dia: mean((r) => r.dia), count: recent.length };
}

const add = (reading) => Storage.set("readings", [reading, ...readings()].slice(0, 500));
const line = (r) => `${new Date(r.time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}  ${r.sys}/${r.dia}${r.pulse ? `  pulse ${r.pulse}` : ""}`;

Script.action("add", async () => {
  const answer = await UI.prompt({ title: "New reading", message: "Upper/lower, then pulse if you like", placeholder: "124/82 68" });
  if (answer === null) return;
  const reading = parse(answer);
  if (!reading) { await UI.alert({ title: "Could not read that", message: "Write it like 124/82, or 124/82 68 with your pulse." }); return; }
  add(reading);
});

Script.action("undo", () => Storage.set("readings", readings().slice(1)));
Script.action("share", () => UI.share(["Blood pressure log", ...readings().slice(0, 60).map(line)].join("\n")));

Script.widget(({ family }) => {
  const latest = readings()[0];
  if (!latest) return Widget.text("Add a reading in Scriptwell", { font: "caption", color: "secondary" });
  const week = average(7);

  const last = Widget.vstack([
    Widget.text(`${latest.sys}/${latest.dia}`, { font: 32, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
    Widget.text(range(latest).label, { font: "caption", weight: "semibold", color: range(latest).color }),
    Widget.date(latest.time, { style: "relative", font: "caption2", color: "secondary" }),
  ], { spacing: 3 });

  if (family === "small" || !week) return last;
  return Widget.hstack([
    last,
    Widget.vstack([
      Widget.text("7-day average", { font: "caption", color: "secondary" }),
      Widget.text(`${week.sys}/${week.dia}`, { font: "title2", weight: "semibold", design: "rounded" }),
      Widget.text(`${week.count} reading${week.count === 1 ? "" : "s"}`, { font: "caption2", color: "secondary" }),
    ], { spacing: 3 }),
  ], { spacing: 24 });
});

Script.ui(() => {
  const list = readings();
  const week = average(7), month = average(30);
  const stat = (title, value) => Widget.vstack([
    Widget.text(title, { font: "caption", color: "secondary" }),
    Widget.text(value ? `${value.sys}/${value.dia}` : "–", { font: "title3", weight: "semibold", design: "rounded" }),
  ], { spacing: 2, padding: 12, background: { light: "#FFFFFF", dark: "#1C1C1E" }, cornerRadius: 12, frame: { maxWidth: "infinity" } });

  return {
    title: "Blood Pressure",
    content: Widget.vstack([
      list[0]
        ? Widget.vstack([
          Widget.text(`${list[0].sys}/${list[0].dia}`, { font: 54, weight: "bold", design: "rounded" }),
          Widget.text(range(list[0]).label, { font: "headline", color: range(list[0]).color }),
        ], { spacing: 2 })
        : Widget.text("No readings yet", { font: "title3", color: "secondary" }),
      Widget.hstack([stat("7 days", week), stat("30 days", month)], { spacing: 10 }),
      Widget.button("Add reading", "add", null, { style: "prominent", color: "red" }),
      ...list.slice(0, 8).map((r) => Widget.hstack([
        Widget.symbol("circle.fill", { fallback: "●", size: 9, color: range(r).color }),
        Widget.text(`${r.sys}/${r.dia}`, { font: "headline", design: "rounded" }),
        r.pulse ? Widget.text(`♥ ${r.pulse}`, { font: "subheadline", color: "secondary" }) : null,
        Widget.spacer(),
        Widget.date(r.time, { style: "date", font: "caption", color: "secondary" }),
      ], { spacing: 8 })),
      list.length ? Widget.hstack([
        Widget.button("Share log", "share", null, { style: "bordered" }),
        Widget.button("Remove last", "undo", null, { style: "bordered", color: "secondary" }),
      ], { spacing: 10 }) : null,
      Widget.text("A personal log, not medical advice. The labels are the general ranges used on home monitors.", { font: "caption2", color: "secondary", align: "center" }),
    ], { spacing: 12, padding: 16 }),
  };
});

Script.run((input) => {
  const reading = parse(input);
  if (reading) {
    add(reading);
    return `Saved ${reading.sys}/${reading.dia}. ${range(reading).label}.`;
  }
  const week = average(7);
  return week ? `7-day average: ${week.sys}/${week.dia} from ${week.count} readings.` : "No readings in the last 7 days. Pass one like 124/82.";
});
