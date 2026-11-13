# Dinner Roulette

Spin for tonight's dinner from www.themealdb.com, scale the ingredients, send them to Reminders, keep favourites and plan the week; an optional on-device AI line says why you'll like it.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `network` to fetch data over HTTPS; `reminders` to read, add and complete reminders

## How it works

- Tap Spin to draw a random recipe from www.themealdb.com (free public API). Filters narrow the draw by category, cuisine and one ingredient; only those filter words are sent to the server.
- The recipe view shows the photo, ingredients with measures, instructions and a YouTube button. The servings stepper scales every measure that starts with a number (recipes are treated as serving 4).
- "Add to Reminders" writes the scaled ingredient list to the Reminders list you choose.
- Favourites and a Monday-to-Sunday plan live in the script's Storage. Fill the plan from favourites or spins.
- If Apple Intelligence is available, one on-device line explains why you'll like the dish; otherwise the category and cuisine are shown.
- Widget: tonight's planned meal with its photo; medium and large also show the week. Open the mini-app once before adding it.
