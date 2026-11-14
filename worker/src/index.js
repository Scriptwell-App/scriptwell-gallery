/*
 * Scriptwell gallery submission service.
 *
 *   POST /v1/submit   JSON { meta, script, icon, readme?, screenshots?, deviceToken, ownerToken?, app }
 *                     → 200 { pullRequest, number, created, ownerToken?, findings }
 *                     → 4xx { error, code, findings? }
 *   POST /v1/star     JSON { id, starred, voterToken, deviceToken } → 200 { id, starred, stars }
 *   GET  /v1/stars    → 200 { "<id>": { "stars": n }, … }   (see stars.js)
 *   GET  /v1/health   → 200 { ok: true }
 *
 * What it does, in order: size and shape checks; rate limits (KV counters per
 * IP and overall, per UTC day); the gallery's own checks (schema, analyzer,
 * word filter, icon); Apple DeviceCheck (the request comes from a real install
 * of the app; when Apple will not vouch for it, as for sideloaded and
 * self-built copies, the submission goes on as "unverified" under much lower
 * daily limits and its pull request says so); ownership (the first submitter of an id gets a secret the
 * app keeps; updates must present it and keep the author name of the first
 * submission; ids already in the gallery that have no owner here cannot be
 * claimed); then one commit and one pull request on the
 * gallery repository through a GitHub App.
 *
 * It stores: the SHA-256 of each owner secret and the author name it was first
 * submitted under, keyed by script id, and the
 * daily counters (KV); and for stars, one hash per install and script (D1).
 * Nothing about devices or people.
 */
import { validateSubmission, LIMITS } from "./checks.js";
import { verifyDeviceToken } from "./devicecheck.js";
import { publishedIds } from "./gallery-index.js";
import { star, starCounts } from "./stars.js";
import { GitHub, GitHubError } from "./github.js";
import { commitMessage, pullRequestBody, pullRequestTitle, updateComment } from "./pull-request.js";
import { HttpError, json, randomToken, sha256Hex, utcDay } from "./util.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/v1/health")) {
        // Which parts are configured, as booleans only; never the values.
        const configured = {
          github: Boolean(env.GITHUB_APP_ID && env.GITHUB_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY),
          deviceCheck: env.REQUIRE_DEVICE_CHECK === "false" || Boolean(env.APPLE_TEAM_ID && env.DEVICECHECK_KEY_ID && env.DEVICECHECK_PRIVATE_KEY),
          kv: Boolean(env.SUBMISSIONS),
          stars: Boolean(env.STARS),
        };
        return json(200, { ok: true, repository: env.GALLERY_REPOSITORY, deviceCheckEnvironment: env.DEVICECHECK_ENVIRONMENT || "production", configured });
      }
      if (url.pathname === "/v1/submit") {
        if (request.method !== "POST") throw new HttpError(405, "Use POST.", { code: "method" });
        return await submit(request, env, ctx);
      }
      if (url.pathname === "/v1/star") {
        if (request.method !== "POST") throw new HttpError(405, "Use POST.", { code: "method" });
        return await star(request, env, ctx);
      }
      if (url.pathname === "/v1/stars") {
        if (request.method !== "GET") throw new HttpError(405, "Use GET.", { code: "method" });
        return await starCounts(request, env, ctx);
      }
      throw new HttpError(404, "Not found.", { code: "not-found" });
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: error.message, ...error.extra });
      if (error instanceof GitHubError) {
        console.error(`GitHub failure: ${error.message}`);
        return json(502, { error: "The gallery repository did not accept the pull request. Try again later.", code: "github" });
      }
      console.error(error && error.stack ? error.stack : String(error));
      return json(500, { error: "The submission service hit an unexpected error.", code: "internal" });
    }
  },
};

async function readBody(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > LIMITS.body) throw new HttpError(413, "The submission is too large.", { code: "too-large" });
  const text = await request.text();
  if (text.length > LIMITS.body) throw new HttpError(413, "The submission is too large.", { code: "too-large" });
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.", { code: "bad-json" });
  }
}

/** KV counters: one per client address and one overall, both per UTC day. */
async function checkRateLimits(env, request) {
  const day = utcDay();
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  return countAgainst(env, [
    { key: `rl:ip:${await sha256Hex(ip)}:${day}`, limit: Number(env.IP_DAILY_LIMIT || 30) },
    { key: `rl:all:${day}`, limit: Number(env.GLOBAL_DAILY_LIMIT || 300) },
  ], () => new HttpError(429, "Too many submissions today. Try again tomorrow.", { code: "rate-limited" }));
}

/**
 * Tighter counters for submissions Apple did not vouch for. Every one is still
 * reviewed by a person before it is published; these only keep a scripted
 * flood from burying the real ones.
 */
async function checkUnverifiedLimits(env, request) {
  const day = utcDay();
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  return countAgainst(env, [
    { key: `rl:unverified:ip:${await sha256Hex(ip)}:${day}`, limit: Number(env.UNVERIFIED_IP_DAILY_LIMIT || 3) },
    { key: `rl:unverified:all:${day}`, limit: Number(env.UNVERIFIED_DAILY_LIMIT || 20) },
  ], () => new HttpError(429, "Copies of the app that are not from the App Store or TestFlight can send only a few submissions a day. Try again tomorrow, or open a pull request on GitHub.", { code: "unverified-limit" }));
}

/** Throws `error()` when any counter is at its limit; returns a function that adds one to each. */
async function countAgainst(env, keys, error) {
  const counts = await Promise.all(keys.map(({ key }) => env.SUBMISSIONS.get(key)));
  keys.forEach(({ limit }, index) => {
    if (Number(counts[index] || 0) >= limit) throw error();
  });
  return async () => {
    // KV is eventually consistent; these are soft limits against floods, not accounting.
    await Promise.all(keys.map(({ key }, index) => env.SUBMISSIONS.put(key, String(Number(counts[index] || 0) + 1), { expirationTtl: 2 * 86400 })));
  };
}

async function submit(request, env, ctx) {
  const fetchImpl = env.__fetch || fetch; // tests inject a fake network
  const payload = await readBody(request);
  const count = await checkRateLimits(env, request);
  ctx.waitUntil(count());

  // The gallery checks are pure CPU, so they run first: an honest mistake costs
  // no call to Apple, and a flood of junk never gets further than this.
  const checked = validateSubmission(payload);
  if (!checked.ok) {
    throw new HttpError(422, "The submission did not pass the gallery checks.", { code: "checks", findings: checked.findings });
  }
  const { meta, files, findings, analysis } = checked;

  // Sideloaded and self-built copies are signed by another team, so Apple will
  // not vouch for them. They may still submit, as "unverified", within much
  // lower limits; a problem on this side is still an error for everyone.
  let verified = true;
  if (env.REQUIRE_DEVICE_CHECK !== "false") {
    const device = await verifyDeviceToken(env, payload.deviceToken, fetchImpl);
    if (!device.ok) {
      if (device.kind === "server" || env.ALLOW_UNVERIFIED_SUBMISSIONS !== "true") throw new HttpError(401, device.reason, { code: "device-check" });
      const countUnverified = await checkUnverifiedLimits(env, request);
      ctx.waitUntil(countUnverified());
      verified = false;
    }
  }

  // Ownership of the id.
  const ownerKey = `owner:${meta.id}`;
  const record = await env.SUBMISSIONS.get(ownerKey, { type: "json" });
  let newOwnerToken = null;
  if (record) {
    const presented = typeof payload.ownerToken === "string" ? await sha256Hex(payload.ownerToken) : "";
    if (presented !== record.hash) {
      throw new HttpError(403, "This id was submitted from another device. Choose a different id, or submit the update from the device that first submitted it.", { code: "not-owner" });
    }
  } else {
    const published = await publishedIds(env, fetchImpl);
    if (published === null) throw new HttpError(503, "The gallery index could not be read. Try again later.", { code: "index" });
    if (published.has(meta.id)) {
      throw new HttpError(403, "A script with this id is already in the gallery. Choose a different id, or open the update on GitHub.", { code: "id-taken" });
    }
    newOwnerToken = randomToken();
  }
  const isUpdate = Boolean(record);

  const app = payload.app && typeof payload.app === "object" ? payload.app : {};
  const github = new GitHub({
    repository: env.GALLERY_REPOSITORY,
    branch: env.GALLERY_BRANCH || "main",
    appId: env.GITHUB_APP_ID,
    installationId: env.GITHUB_INSTALLATION_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    fetch: fetchImpl,
  });

  // Every update keeps the author of the first submission, so people who installed the
  // script can trust an update comes from the same person. Records from before the
  // author was stored never take the update's word for it: the author is read from the
  // gallery's own meta.json, published or last submitted.
  let firstAuthor = record && typeof record.author === "string" ? record.author : undefined;
  if (record && firstAuthor === undefined) firstAuthor = await github.recordedAuthor(meta.id);
  if (firstAuthor !== undefined && firstAuthor.toLowerCase() !== meta.author.toLowerCase()) {
    throw new HttpError(403, `Updates must use the author name of the first submission, "${firstAuthor}".`, { code: "author-changed", author: firstAuthor });
  }
  const prefixed = {};
  for (const [name, bytes] of Object.entries(files)) prefixed[`scripts/${meta.id}/${name}`] = bytes;

  const pull = await github.submit({
    id: meta.id,
    files: prefixed,
    title: pullRequestTitle(meta, isUpdate),
    body: pullRequestBody({ meta, app, findings, analysis, isUpdate, files, repository: env.GALLERY_REPOSITORY, verified }),
    commitMessage: commitMessage(meta, isUpdate),
    comment: updateComment({ meta, app, findings, verified }),
    labels: verified ? ["from-app"] : ["from-app", "unverified"],
  });

  if (newOwnerToken) {
    await env.SUBMISSIONS.put(ownerKey, JSON.stringify({ hash: await sha256Hex(newOwnerToken), author: meta.author, createdAt: new Date().toISOString(), pullRequest: pull.number }));
  } else if (typeof record.author !== "string") {
    await env.SUBMISSIONS.put(ownerKey, JSON.stringify({ ...record, author: firstAuthor ?? meta.author }));
  }

  const response = { pullRequest: pull.url, number: pull.number, created: pull.created, verified, findings: findings.filter((f) => f.severity === "soft") };
  if (newOwnerToken) response.ownerToken = newOwnerToken;
  return json(200, response);
}
