// @name        Shopping List
// @description A shopping list that remembers what you usually buy, with a tick-off widget
// @widget      small, medium, large
// @icon        cart.fill
// @color       #059669
// @version     1.0.0
// @author      va4w
// @category    shopping

// Add several things at once by separating them with commas. From Shortcuts
// or Siri, pass the items as text: "milk, eggs, coffee".

const list = () => Storage.get("list", []); // [{ name, done }]
const usual = () => Storage.get("usual", {}); // { name: times bought }
const left = () => list().filter((item) => !item.done);

function add(text) {
  const names = String(text).split(/[,\n]+/).map((name) => name.trim().slice(0, 60)).filter(Boolean);
  const current = list();
  const counts = usual();
  for (const name of names) {
    const existing = current.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (existing) existing.done = false; else current.push({ name, done: false });
    counts[name] = (counts[name] ?? 0) + 1;
  }
  Storage.set("list", current);
  Storage.set("usual", counts);
  return names;
}

Script.action("tick", ({ name, isOn }) => {
  Storage.set("list", list().map((item) => (item.name === name ? { ...item, done: isOn === undefined ? !item.done : isOn } : item)));
});
Script.action("add", async () => { const text = await UI.prompt({ title: "Add to the list", message: "Separate several items with commas", placeholder: "Milk, eggs" }); if (text) add(text); });
Script.action("quick", ({ name }) => add(name));
Script.action("clear", () => Storage.set("list", left()));

Script.widget(({ family }) => {
  const open = left();
  if (list().length === 0) return Widget.vstack([Widget.text("🛒", { font: 32 }), Widget.text("The list is empty", { font: "caption", color: "secondary" })], { spacing: 6 });

  if (family === "small") {
    return Widget.vstack([
      Widget.hstack([Widget.text("🛒"), Widget.text(open.length ? `${open.length} to buy` : "All done", { font: "headline" })], { spacing: 6 }),
      ...open.slice(0, 4).map((item) => Widget.text(`• ${item.name}`, { font: "caption", lineLimit: 1 })),
      Widget.spacer(),
    ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
  }

  const shown = [...open, ...list().filter((item) => item.done)].slice(0, family === "large" ? 10 : 4);
  return Widget.vstack([
    Widget.hstack([Widget.text("Shopping", { font: "headline" }), Widget.spacer(), Widget.text(`${open.length} left`, { font: "caption", color: "secondary" })]),
    ...shown.map((item) => Widget.button(Widget.hstack([
      Widget.symbol(item.done ? "checkmark.circle.fill" : "circle", { size: 18, color: item.done ? "green" : "secondary", fallback: item.done ? "✅" : "⚪️" }),
      Widget.text(item.name, { font: "subheadline", color: item.done ? "secondary" : "primary", lineLimit: 1 }),
      Widget.spacer(),
    ], { spacing: 8 }), "tick", { name: item.name })),
    Widget.spacer(),
  ], { alignment: "leading", spacing: 7, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });
});

Script.ui(() => {
  const all = list();
  const onList = new Set(left().map((item) => item.name.toLowerCase()));
  // The six things bought most often that are not on the list right now.
  const suggestions = Object.entries(usual()).filter(([name]) => !onList.has(name.toLowerCase())).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name]) => name);

  return {
    title: "Shopping List",
    content: Widget.vstack([
      all.length === 0 ? Widget.text("Nothing on the list.", { color: "secondary" }) : null,
      ...all.map((item) => Widget.toggle(item.name, item.done, "tick", { name: item.name }, {
        color: "green", padding: 12, background: { light: "#FFFFFF", dark: "#1C1C1E" }, cornerRadius: 12,
      })),
      Widget.button("Add items", "add", null, { style: "prominent", color: "green" }),
      all.some((item) => item.done) ? Widget.button("Remove ticked items", "clear", null, { color: "secondary" }) : null,
      suggestions.length ? Widget.divider() : null,
      suggestions.length ? Widget.text("You often buy", { font: "caption", color: "secondary" }) : null,
      suggestions.length ? Widget.hstack(suggestions.slice(0, 3).map((name) => Widget.button(`+ ${name}`, "quick", { name }, { style: "bordered", color: "green" })), { spacing: 6 }) : null,
      suggestions.length > 3 ? Widget.hstack(suggestions.slice(3).map((name) => Widget.button(`+ ${name}`, "quick", { name }, { style: "bordered", color: "green" })), { spacing: 6 }) : null,
    ], { spacing: 10, padding: 16 }),
  };
});

Script.run((input) => {
  if (input?.trim()) {
    const names = add(input);
    return `Added ${names.join(", ")}. ${left().length} on the list.`;
  }
  return left().length ? left().map((item) => `• ${item.name}`).join("\n") : "The shopping list is empty.";
});
