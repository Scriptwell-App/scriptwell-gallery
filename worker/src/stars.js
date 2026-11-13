/*
 * Stars: one per install per script, kept in D1 (binding STARS).
 *
 *   POST /v1/star    JSON { id, starred, voterToken, deviceToken }
 *                    → 200 { id, starred, stars }
 *   GET  /v1/stars   → 200 { "<id>": { "stars": n }, … }   (the gallery's stats.json format)
 *
 * The app makes one random secret per install (voterToken) and keeps it in the
 * Keychain. The Worker stores only sha256(voterToken + ":" + id): enough to
 * count an install once per script and to let it take the star back, and
 * nothing that ties two stars, or a star and a device, together.
 */
import { verifyDeviceToken } from "./devicecheck.js";
import { publishedIds } from "./gallery-index.js";
import { HttpError, json, sha256Hex, utcDay } from "./util.js";

const ID = /^[a-z0-9][a-z0-9-]{2,49}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

export async function star(request, env, ctx) {
  if (!env.STARS) throw new HttpError(503, "Stars are not set up on this server.", { code: "not-configured" });
  const fetchImpl = env.__fetch || fetch;
  const text = await request.text();
  if (text.length > 20000) throw new HttpError(413, "The request is too large.", { code: "too-large" });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.", { code: "bad-json" });
  }
  const id = body && body.id;
  if (typeof id !== "string" || !ID.test(id)) throw new HttpError(400, "Unknown script id.", { code: "bad-id" });
  if (typeof body.starred !== "boolean") throw new HttpError(400, "starred must be true or false.", { code: "bad-request" });
  if (typeof body.voterToken !== "string" || !TOKEN.test(body.voterToken)) throw new HttpError(400, "The request did not include a voter token.", { code: "bad-request" });

  await checkRateLimits(env, request, ctx);

  const published = await publishedIds(env, fetchImpl);
  if (published === null) throw new HttpError(503, "The gallery index could not be read. Try again later.", { code: "index" });
  if (!published.has(id)) throw new HttpError(404, "That script is not in the gallery.", { code: "unknown-script" });

  if (env.REQUIRE_DEVICE_CHECK !== "false") {
    const device = await verifyDeviceToken(env, body.deviceToken, fetchImpl);
    if (!device.ok) throw new HttpError(401, device.reason, { code: "device-check" });
  }

  const voter = await sha256Hex(`${body.voterToken}:${id}`);
  const write = body.starred
    ? env.STARS.prepare("INSERT OR IGNORE INTO stars (script_id, voter, created_at) VALUES (?1, ?2, ?3)").bind(id, voter, new Date().toISOString())
    : env.STARS.prepare("DELETE FROM stars WHERE script_id = ?1 AND voter = ?2").bind(id, voter);
  const [, counted] = await env.STARS.batch([
    write,
    env.STARS.prepare(
      "SELECT (SELECT COUNT(*) FROM stars WHERE script_id = ?1) + COALESCE((SELECT stars FROM star_baseline WHERE script_id = ?1), 0) AS stars"
    ).bind(id),
  ]);
  const stars = Number((counted.results && counted.results[0] && counted.results[0].stars) || 0);
  return json(200, { id, starred: body.starred, stars });
}

export async function starCounts(request, env, ctx) {
  if (!env.STARS) throw new HttpError(503, "Stars are not set up on this server.", { code: "not-configured" });
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(new URL("/v1/stars", request.url).toString());
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const { results } = await env.STARS.prepare(
    `SELECT script_id, SUM(n) AS stars FROM (
       SELECT script_id, COUNT(*) AS n FROM stars GROUP BY script_id
       UNION ALL SELECT script_id, stars AS n FROM star_baseline
     ) GROUP BY script_id ORDER BY script_id`
  ).all();
  const out = {};
  for (const row of results || []) out[row.script_id] = { stars: Number(row.stars) };
  const response = new Response(JSON.stringify(out, null, 2) + "\n", {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
  });
  if (cache) ctx.waitUntil(cache.put(key, response.clone()));
  return response;
}

/**
 * Daily counters in D1 rather than KV: KV's free plan allows 1,000 writes a day,
 * which stars would use up. Counted before DeviceCheck, so a flood never reaches Apple.
 */
async function checkRateLimits(env, request, ctx) {
  const day = utcDay();
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const limits = [
    { key: `ip:${await sha256Hex(ip)}:${day}`, limit: Number(env.STAR_IP_DAILY_LIMIT || 300) },
    { key: `all:${day}`, limit: Number(env.STAR_GLOBAL_DAILY_LIMIT || 20000) },
  ];
  const bump = "INSERT INTO star_limits (key, day, count) VALUES (?1, ?2, 1) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count";
  const rows = await env.STARS.batch(limits.map(({ key }) => env.STARS.prepare(bump).bind(key, day)));
  limits.forEach(({ limit }, index) => {
    const count = Number(rows[index].results && rows[index].results[0] && rows[index].results[0].count);
    if (count > limit) throw new HttpError(429, "Too many stars today. Try again tomorrow.", { code: "rate-limited" });
  });
  // Sweep old days now and then; one in a hundred requests is plenty.
  if (Math.random() < 0.01) ctx.waitUntil(env.STARS.prepare("DELETE FROM star_limits WHERE day < ?1").bind(day).run().catch(() => {}));
}
