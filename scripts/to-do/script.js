// @name        To-Do
// @description A simple task list you can tick off from the Home Screen
// @widget      small, medium, large
// @icon        checklist
// @color       #2563EB
// @version     1.0.0
// @author      scriptwell
// @category    productivity

// From Shortcuts or Siri, pass some text to add it as a task. With no input,
// the script returns what is still open.

const tasks = () => Storage.get("tasks", []); // [{ id, title, done }]
const open = () => tasks().filter((t) => !t.done);

function add(title) {
  const clean = String(title).trim().slice(0, 120);
  if (clean) Storage.set("tasks", [...tasks(), { id: Date.now().toString(36), title: clean, done: false }]);
}

Script.action("toggle", ({ id, isOn }) => {
  Storage.set("tasks", tasks().map((t) => (t.id === id ? { ...t, done: isOn === undefined ? !t.done : isOn } : t)));
});
Script.action("add", async () => { const title = await UI.prompt({ title: "New task", placeholder: "Call the dentist" }); if (title) add(title); });
Script.action("clear", () => Storage.set("tasks", open()));

const row = (task, font) => Widget.button(Widget.hstack([
  Widget.symbol(task.done ? "checkmark.circle.fill" : "circle", { size: 18, color: task.done ? "blue" : "secondary", fallback: task.done ? "✅" : "⚪️" }),
  Widget.text(task.title, { font, color: task.done ? "secondary" : "primary", lineLimit: 1 }),
  Widget.spacer(),
], { spacing: 8 }), "toggle", { id: task.id });

Script.widget(({ family }) => {
  const left = open();
  if (tasks().length === 0) return Widget.text("Add tasks in Scriptwell", { font: "caption", color: "secondary" });

  if (family === "small") {
    return Widget.vstack([
      Widget.text(left.length ? String(left.length) : "🎉", { font: 44, weight: "bold", design: "rounded", color: "blue" }),
      Widget.text(left.length ? `task${left.length === 1 ? "" : "s"} to do` : "All done", { font: "caption", color: "secondary" }),
      left[0] ? Widget.text(left[0].title, { font: "caption2", lineLimit: 2, align: "center" }) : null,
    ], { spacing: 2 });
  }

  // Open tasks first, then the ones just ticked, so a tap does not make a row vanish at once.
  const shown = [...left, ...tasks().filter((t) => t.done)].slice(0, family === "large" ? 9 : 4);
  return Widget.vstack([
    Widget.hstack([Widget.text("To-Do", { font: "headline" }), Widget.spacer(), Widget.text(`${left.length} left`, { font: "caption", color: "secondary" })]),
    ...shown.map((task) => row(task, "subheadline")),
    Widget.spacer(),
  ], { alignment: "leading", spacing: 7, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
});

Script.ui(() => {
  const all = tasks();
  return {
    title: "To-Do",
    content: Widget.vstack([
      all.length === 0 ? Widget.text("Nothing to do. Enjoy it, or add a task.", { color: "secondary" }) : null,
      ...all.map((task) => Widget.toggle(task.title, task.done, "toggle", { id: task.id }, {
        color: "blue", padding: 12, background: { light: "#FFFFFF", dark: "#1C1C1E" }, cornerRadius: 12,
      })),
      Widget.button("Add a task", "add", null, { style: "prominent", color: "blue" }),
      all.some((t) => t.done) ? Widget.button("Remove finished tasks", "clear", null, { color: "secondary" }) : null,
    ], { spacing: 10, padding: 16 }),
  };
});

Script.run((input) => {
  if (input?.trim()) {
    add(input);
    return `Added "${input.trim()}". ${open().length} to do.`;
  }
  return open().length ? open().map((t) => `• ${t.title}`).join("\n") : "Nothing to do.";
});
