// @name        Medication Checklist
// @description A daily checklist for medicines and supplements, with reminders at the times you set
// @permissions notifications
// @widget      small, medium
// @icon        pills.fill
// @color       #0891B2
// @version     1.0.0
// @author      scriptwell
// @category    medical

// A personal checklist. It does not give medical advice; follow the
// instructions from your doctor or pharmacist.
//
// Reminders are scheduled for the next three days every time you open the
// app or tick something off, so open it at least every few days.

const DAY = 86400000;
const key = (date = new Date()) => date.toLocaleDateString("en-CA"); // 2026-03-14, local time
const items = () => Storage.get("items", []); // [{ name, time: "08:00" }]
const taken = () => Storage.get(`taken:${key()}`, []);
const sorted = () => [...items()].sort((a, b) => a.time.localeCompare(b.time));

// "8", "8:30" or "20:15" → "08:00", "08:30", "20:15"; anything else → null.
function parseTime(text) {
  const match = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(text ?? "").trim());
  if (!match || Number(match[1]) > 23 || Number(match[2] ?? 0) > 59) return null;
  return `${match[1].padStart(2, "0")}:${match[2] ?? "00"}`;
}

async function scheduleReminders() {
  if (Script.env.mode !== "app") return; // widgets cannot schedule notifications
  await Notification.cancelAll();
  for (const item of items()) {
    const [hours, minutes] = item.time.split(":").map(Number);
    for (let day = 0; day < 3; day++) {
      const at = new Date(Date.now() + day * DAY);
      at.setHours(hours, minutes, 0, 0);
      if (at <= Date.now() || (day === 0 && taken().includes(item.name))) continue;
      await Notification.schedule({ id: `${item.name}-${key(at)}`, at, title: item.name, body: `Scheduled for ${item.time}` });
    }
  }
}

Script.action("tick", async ({ name, isOn }) => {
  const set = new Set(taken());
  const on = isOn === undefined ? !set.has(name) : isOn;
  if (on) set.add(name); else set.delete(name);
  Storage.set(`taken:${key()}`, [...set]);
  await scheduleReminders();
});

Script.action("add", async () => {
  const name = (await UI.prompt({ title: "Name", placeholder: "Vitamin D" }))?.trim();
  if (!name) return;
  const answer = await UI.prompt({ title: "At what time?", message: "24-hour clock", placeholder: "08:00", defaultValue: "08:00" });
  if (answer === null) return;
  const time = parseTime(answer);
  if (!time) { await UI.alert({ title: "Not a time", message: "Write the time like 08:00 or 20:30." }); return; }
  Storage.set("items", [...items().filter((i) => i.name !== name), { name, time }]);
  await scheduleReminders();
});

Script.action("remove", async ({ name }) => {
  Storage.set("items", items().filter((i) => i.name !== name));
  await scheduleReminders();
});

Script.widget(({ family }) => {
  const list = sorted();
  const left = list.filter((i) => !taken().includes(i.name));
  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 5, 0);

  if (list.length === 0) return Widget.text("Add items in Scriptwell", { font: "caption", color: "secondary" });

  if (family === "small") {
    return {
      content: Widget.vstack([
        Widget.progress((list.length - left.length) / list.length, { style: "ring", color: "teal", label: `${list.length - left.length}/${list.length}`, frame: { width: 74, height: 74 } }),
        Widget.text(left.length ? `Next: ${left[0].name} ${left[0].time}` : "All taken today", { font: "caption2", color: "secondary", lineLimit: 2, align: "center" }),
      ], { spacing: 8 }),
      refreshAt: tomorrow,
    };
  }

  return {
    content: Widget.vstack([
      Widget.text(left.length ? `${left.length} left today` : "All taken today", { font: "headline" }),
      ...list.slice(0, 4).map((item) => {
        const done = taken().includes(item.name);
        return Widget.button(Widget.hstack([
          Widget.symbol(done ? "checkmark.circle.fill" : "circle", { size: 18, color: done ? "teal" : "secondary", fallback: done ? "✅" : "⚪️" }),
          Widget.text(item.name, { font: "subheadline", color: done ? "secondary" : "primary", lineLimit: 1 }),
          Widget.spacer(),
          Widget.text(item.time, { font: "caption", design: "monospaced", color: "secondary" }),
        ], { spacing: 8 }), "tick", { name: item.name });
      }),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    refreshAt: tomorrow,
  };
});

Script.ui(async () => {
  await scheduleReminders();
  const list = sorted();
  const done = list.filter((i) => taken().includes(i.name)).length;
  return {
    title: "Medication",
    content: Widget.vstack([
      list.length ? Widget.text(done === list.length ? "All taken today" : `${done} of ${list.length} taken today`, { font: "title2", weight: "bold" }) : null,
      ...list.map((item) => Widget.hstack([
        Widget.toggle(`${item.time}  ${item.name}`, taken().includes(item.name), "tick", { name: item.name }, { color: "teal", frame: { maxWidth: "infinity" } }),
        Widget.button(Widget.symbol("trash", { size: 15, color: "secondary", fallback: "🗑" }), "remove", { name: item.name }),
      ], { spacing: 10, padding: 12, background: { light: "#FFFFFF", dark: "#1C1C1E" }, cornerRadius: 12 })),
      list.length === 0 ? Widget.text("Add what you take and when. You get a reminder at that time until you tick it off.", { color: "secondary", align: "center" }) : null,
      Widget.button("Add", "add", null, { style: "bordered", color: "teal" }),
      Widget.text("A personal checklist, not medical advice.", { font: "caption2", color: "secondary" }),
    ], { spacing: 10, padding: 16 }),
  };
});
