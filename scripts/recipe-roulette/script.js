// @name        Recipe Roulette
// @description Stuck for dinner? Get a random meal with its ingredients
// @permissions network
// @widget      medium, large
// @icon        fork.knife.circle.fill
// @color       #E11D48
// @version     1.0.0
// @author      scriptwell
// @category    food-drink

// Recipes come from TheMealDB (https://www.themealdb.com), free and without a key.

async function spin() {
  const response = await fetch("https://www.themealdb.com/api/json/v1/1/random.php", { timeout: 8000 });
  if (!response.ok) throw new Error(`Recipe service returned ${response.status}`);
  const meal = (await response.json()).meals[0];

  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = meal[`strIngredient${i}`]?.trim();
    if (name) ingredients.push([meal[`strMeasure${i}`]?.trim(), name].filter(Boolean).join(" "));
  }
  const recipe = {
    name: meal.strMeal,
    kind: [meal.strArea, meal.strCategory].filter(Boolean).join(" · "),
    image: meal.strMealThumb,
    link: meal.strSource || meal.strYoutube || "",
    steps: meal.strInstructions ?? "",
    ingredients,
    day: new Date().toDateString(),
  };
  Storage.set("recipe", recipe);
  return recipe;
}

// One suggestion a day unless you ask for another.
async function recipe() {
  const saved = Storage.get("recipe");
  if (saved?.day === new Date().toDateString()) return saved;
  try { return await spin(); } catch (error) { if (saved) return saved; throw error; }
}

Script.action("spin", spin);
Script.action("open", async () => {
  const link = Storage.get("recipe")?.link;
  if (link?.startsWith("https://")) await UI.openURL(link);
});

Script.widget(async ({ family }) => {
  const r = await recipe();
  const text = Widget.vstack([
    Widget.text("TONIGHT?", { font: "caption2", weight: "bold", color: "pink" }),
    Widget.text(r.name, { font: "headline", lineLimit: 3 }),
    Widget.text(r.kind, { font: "caption", color: "secondary", lineLimit: 1 }),
    Widget.spacer(),
    Widget.button("Spin again", "spin", null, { style: "bordered", color: "pink" }),
  ], { alignment: "leading", spacing: 3, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } });

  const picture = Widget.image({ src: r.image, size: family === "large" ? 300 : 110, cornerRadius: 14 });
  return {
    content: family === "large"
      ? Widget.vstack([picture, text], { spacing: 10 })
      : Widget.hstack([picture, text], { spacing: 12 }),
    refreshAfter: 6 * 60 * 60,
  };
});

Script.ui(async () => {
  const r = await recipe();
  return {
    title: "Recipe Roulette",
    content: Widget.vstack([
      Widget.image({ src: r.image, size: 320, cornerRadius: 18 }),
      Widget.text(r.name, { font: "title2", weight: "bold", align: "center" }),
      Widget.text(r.kind, { color: "secondary" }),
      Widget.hstack([
        Widget.button("Spin again", "spin", null, { style: "prominent", color: "pink" }),
        r.link ? Widget.button("Open recipe", "open", null, { style: "bordered" }) : null,
      ], { spacing: 10 }),
      Widget.divider(),
      Widget.vstack([
        Widget.text("Ingredients", { font: "headline" }),
        ...r.ingredients.map((item) => Widget.text(`• ${item}`, { font: "subheadline" })),
        Widget.text("Method", { font: "headline", padding: { top: 8 } }),
        Widget.text(r.steps.slice(0, 1800), { font: "subheadline" }),
      ], { alignment: "leading", spacing: 4, frame: { maxWidth: "infinity", alignment: "leading" } }),
    ], { spacing: 12, padding: 16 }),
  };
});
