// @name        Dad Joke
// @description A fresh groan-worthy joke on your Home Screen
// @permissions network
// @widget      small, medium
// @icon        face.smiling.inverse
// @color       #F59E0B
// @version     1.0.0
// @author      va4w
// @category    entertainment

// Jokes come from https://icanhazdadjoke.com (free, no key).

async function freshJoke() {
  const response = await fetch("https://icanhazdadjoke.com/", { headers: { Accept: "application/json" }, timeout: 6000 });
  if (!response.ok) throw new Error(`Joke service returned ${response.status}`);
  const { joke } = await response.json();
  Storage.set("joke", { text: joke, time: Date.now() });
  return joke;
}

// A new joke every three hours; the last one is kept for when there is no connection.
async function joke() {
  const saved = Storage.get("joke");
  if (saved && Date.now() - saved.time < 3 * 60 * 60 * 1000) return saved.text;
  try {
    return await freshJoke();
  } catch (error) {
    return saved?.text ?? "I would tell you a joke about the internet, but it is not connected.";
  }
}

Script.action("another", freshJoke);

Script.widget(async ({ family }) => ({
  content: Widget.vstack([
    Widget.text(await joke(), { font: family === "small" ? "caption" : "subheadline", weight: "medium", lineLimit: family === "small" ? 8 : 5, minimumScale: 0.7 }),
    Widget.spacer(),
    family === "medium" ? Widget.button("Another one", "another", null, { style: "bordered", color: "orange" }) : null,
  ], { alignment: "leading", spacing: 6, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
  refreshAfter: 3 * 60 * 60,
}));

Script.run(freshJoke);
