// Prints SQL that carries the old 👍 counts from the gallery's stats.json into
// D1's star_baseline table, so no script loses its stars in the switch.
//
//   node scripts/stars-baseline.mjs ../stats.json > baseline.sql
//   npx wrangler d1 execute scriptwell-stars --remote --file baseline.sql
//
// Run it once, before the stars workflow first overwrites stats.json from the service.
import { readFileSync } from "node:fs";

const file = process.argv[2] || "../stats.json";
const stats = JSON.parse(readFileSync(file, "utf8"));
const rows = Object.entries(stats)
  .filter(([id, value]) => /^[a-z0-9][a-z0-9-]{2,49}$/.test(id) && Number.isInteger(value && value.stars) && value.stars > 0)
  .map(([id, value]) => `('${id}', ${value.stars})`);
if (rows.length === 0) {
  console.error("No stars to carry over.");
} else {
  console.log(`INSERT OR REPLACE INTO star_baseline (script_id, stars) VALUES\n  ${rows.join(",\n  ")};`);
}
