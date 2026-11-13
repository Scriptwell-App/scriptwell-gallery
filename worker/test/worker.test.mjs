import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, generateKeyPairSync, verify as nodeVerify } from "node:crypto";
import { validateSubmission, checkMeta } from "../src/checks.js";
import { pkcs1ToPkcs8, importPrivateKey, signJWT } from "../src/jwt.js";
import { pemToDer, base64Encode, sha256Hex } from "../src/util.js";
import { GitHub } from "../src/github.js";
import { verifyDeviceToken } from "../src/devicecheck.js";
import { pullRequestBody, screenshotNames } from "../src/pull-request.js";
import worker from "../src/index.js";

// ---------- fixtures ----------

/** The smallest thing the icon check accepts: PNG signature + an IHDR chunk. */
function pngBytes(width, height) {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const be = (o, v) => { bytes[o] = v >>> 24; bytes[o + 1] = (v >>> 16) & 255; bytes[o + 2] = (v >>> 8) & 255; bytes[o + 3] = v & 255; };
  be(16, width);
  be(20, height);
  return bytes;
}

const SCRIPT = "// @name Repo Stats\n// @description Stars for a repository\n// @permissions network\n// @widget small\nconst r = await fetch('https://api.github.com/repos/a/b');\nScript.widget(() => Widget.text(String(r.status)));\n";

function goodPayload(overrides = {}) {
  return {
    meta: {
      id: "repo-stats-two", name: "Repo Stats", author: "octocat", version: "1.0.0", description: "Stars for a repository.",
      permissions: ["network"], minAppVersion: "1.0", widgetSizes: ["small"], license: "MIT", category: "developer-tools",
      ...(overrides.meta || {}),
    },
    script: overrides.script ?? SCRIPT,
    icon: overrides.icon ?? base64Encode(pngBytes(512, 512)),
    readme: overrides.readme,
    screenshots: overrides.screenshots,
    app: { version: "1.2", platform: "iOS" },
    deviceToken: overrides.deviceToken,
    ownerToken: overrides.ownerToken,
  };
}

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const RSA_PKCS1_PEM = rsa.privateKey.export({ type: "pkcs1", format: "pem" });
const RSA_PKCS8_PEM = rsa.privateKey.export({ type: "pkcs8", format: "pem" });
const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const EC_PKCS8_PEM = ec.privateKey.export({ type: "pkcs8", format: "pem" });

function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key, options) {
      const value = store.get(key);
      if (value === undefined) return null;
      return options && options.type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) { store.set(key, value); },
  };
}

/** A fake GitHub + Pages + Apple network. Records every call. */
function fakeNetwork({ existingBranch = false, openPull = null, indexIds = ["repo-stats"], deviceStatus = 200 } = {}) {
  const calls = [];
  let pullCounter = 41;
  const respond = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  // A regular function, so it can check `this` the way Workers' global fetch does.
  const fetchImpl = async function (url, init = {}) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
    const method = init.method || "GET";
    const u = new URL(url);
    const path = u.pathname + u.search;
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers || {} });
    if (u.hostname.endsWith("devicecheck.apple.com")) return respond(deviceStatus, deviceStatus === 200 ? undefined : { message: "no" });
    if (u.hostname === "va4w.github.io") return respond(200, { scripts: indexIds.map((id) => ({ id })) });
    if (path.startsWith("/app/installations/")) return respond(201, { token: "ghs_test", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (path === "/repos/va4w/scriptwell-gallery/git/ref/heads/main") return respond(200, { object: { sha: "base000" } });
    if (path.startsWith("/repos/va4w/scriptwell-gallery/git/commits/base000")) return respond(200, { tree: { sha: "tree000" } });
    if (path === "/repos/va4w/scriptwell-gallery/git/blobs") return respond(201, { sha: "blob" + calls.length });
    if (path === "/repos/va4w/scriptwell-gallery/git/trees") return respond(201, { sha: "tree111" });
    if (path === "/repos/va4w/scriptwell-gallery/git/commits") return respond(201, { sha: "commit111" });
    if (path.startsWith("/repos/va4w/scriptwell-gallery/git/ref/heads/submit/")) return existingBranch ? respond(200, { object: { sha: "old" } }) : respond(404, { message: "Not Found" });
    if (path.startsWith("/repos/va4w/scriptwell-gallery/git/refs/heads/submit/")) return respond(200, { object: { sha: "commit111" } });
    if (path === "/repos/va4w/scriptwell-gallery/git/refs") return respond(201, { ref: init.body && JSON.parse(init.body).ref });
    if (path.startsWith("/repos/va4w/scriptwell-gallery/pulls?")) return respond(200, openPull ? [openPull] : []);
    if (path === "/repos/va4w/scriptwell-gallery/pulls") { pullCounter += 1; return respond(201, { number: pullCounter, html_url: `https://github.com/va4w/scriptwell-gallery/pull/${pullCounter}` }); }
    if (/\/issues\/\d+\/(labels|comments)$/.test(path)) return respond(201, {});
    return respond(500, { message: `unexpected ${method} ${path}` });
  };
  return { calls, fetchImpl };
}

function env(network, kv, overrides = {}) {
  return {
    GALLERY_REPOSITORY: "va4w/scriptwell-gallery",
    GALLERY_INDEX_URL: "https://va4w.github.io/scriptwell-gallery/index.json",
    GALLERY_BRANCH: "main",
    GITHUB_APP_ID: "12345",
    GITHUB_INSTALLATION_ID: "67890",
    GITHUB_APP_PRIVATE_KEY: RSA_PKCS1_PEM,
    APPLE_TEAM_ID: "TEAM123456",
    DEVICECHECK_KEY_ID: "KEY1234567",
    DEVICECHECK_PRIVATE_KEY: EC_PKCS8_PEM,
    DEVICECHECK_ENVIRONMENT: "development",
    REQUIRE_DEVICE_CHECK: "true",
    IP_DAILY_LIMIT: "3",
    GLOBAL_DAILY_LIMIT: "100",
    SUBMISSIONS: kv,
    __fetch: network.fetchImpl,
    ...overrides,
  };
}

const ctx = { waitUntil(promise) { promise.catch(() => {}); } };

function post(body, ip = "203.0.113.9") {
  return new Request("https://submit.example/v1/submit", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ---------- checks ----------

test("a clean submission passes and produces canonical files", () => {
  const result = validateSubmission(goodPayload());
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.deepEqual(Object.keys(result.files).sort(), ["icon.png", "meta.json", "script.js"]);
  const meta = JSON.parse(new TextDecoder().decode(result.files["meta.json"]));
  assert.deepEqual(Object.keys(meta), ["id", "name", "author", "version", "description", "permissions", "minAppVersion", "widgetSizes", "license", "category"]);
  assert.deepEqual(result.analysis.usedPermissions, ["network"]);
});

test("hard findings: bad id, status set, eval, undeclared permission, wrong icon", () => {
  const result = validateSubmission(goodPayload({
    meta: { id: "X", status: "hidden", permissions: [] },
    script: SCRIPT + "eval('1');\n",
    icon: base64Encode(pngBytes(100, 100)),
  }));
  assert.equal(result.ok, false);
  const ids = new Set(result.findings.filter((f) => f.severity === "hard").map((f) => f.ruleId));
  assert.ok(ids.has("meta-schema"), "id/status");
  assert.ok(ids.has("permission-mismatch"), "permissions");
  assert.ok(ids.has("icon-size"), "icon");
  assert.ok([...ids].some((id) => /eval/.test(id)), `eval: ${[...ids].join(",")}`);
  assert.equal(result.files["meta.json"], undefined);
});

test("soft findings pass through: widget mismatch and filtered README words", () => {
  const result = validateSubmission(goodPayload({ meta: { widgetSizes: ["medium"] }, readme: "# Hi\n\nThis is shit.\n" }));
  assert.equal(result.ok, true);
  const soft = result.findings.filter((f) => f.severity === "soft").map((f) => f.ruleId);
  assert.ok(soft.includes("widget-mismatch"));
  assert.ok(soft.includes("readme-text"));
  assert.ok(result.files["README.md"]);
});

test("objectionable names and syntax errors are hard", () => {
  const sworn = validateSubmission(goodPayload({ meta: { name: "Shit widget" } }));
  assert.ok(sworn.findings.some((f) => f.ruleId === "objectionable-text" && f.severity === "hard"));
  const broken = validateSubmission(goodPayload({ script: "// @permissions network\nconst = ;" }));
  assert.ok(broken.findings.some((f) => f.ruleId === "syntax-error"));
});

test("checkMeta rejects unknown fields and accepts a homepage", () => {
  const findings = [];
  const add = (ruleId, severity, message) => findings.push({ ruleId, severity, message });
  const meta = checkMeta({ ...goodPayload().meta, homepage: "https://example.com/x", extra: 1 }, add);
  assert.equal(meta.homepage, "https://example.com/x");
  assert.ok(findings.some((f) => /unknown field "extra"/.test(f.message)));
});

// ---------- crypto ----------

test("PKCS#1 keys from GitHub are wrapped into PKCS#8 byte for byte", () => {
  const converted = pkcs1ToPkcs8(pemToDer(RSA_PKCS1_PEM));
  assert.deepEqual(Buffer.from(converted), Buffer.from(pemToDer(RSA_PKCS8_PEM)));
});

test("RS256 and ES256 JWTs verify with the public keys", async () => {
  for (const [algorithm, pem, publicKey, nodeAlg] of [
    ["RS256", RSA_PKCS1_PEM, rsa.publicKey, "sha256"],
    ["ES256", EC_PKCS8_PEM, ec.publicKey, "sha256"],
  ]) {
    const key = await importPrivateKey(pem, algorithm);
    const token = await signJWT({ algorithm, key, payload: { iss: "me", iat: 1 } });
    const [h, p, s] = token.split(".");
    const signature = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const options = algorithm === "ES256" ? { key: publicKey, dsaEncoding: "ieee-p1363" } : publicKey;
    assert.ok(nodeVerify(nodeAlg, Buffer.from(`${h}.${p}`), options, signature), algorithm);
    assert.equal(JSON.parse(Buffer.from(h, "base64url")).alg, algorithm);
  }
});

test("DeviceCheck: signs a JWT for Apple and reads the verdict", async () => {
  const ok = fakeNetwork();
  const e = env(ok, fakeKV());
  assert.deepEqual(await verifyDeviceToken(e, "x".repeat(40), ok.fetchImpl), { ok: true });
  const apple = ok.calls.find((c) => c.path.includes("validate_device_token"));
  assert.equal(apple.body.device_token, "x".repeat(40));
  assert.match(apple.headers.authorization, /^Bearer /);
  const [header] = apple.headers.authorization.slice(7).split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url")).kid, "KEY1234567");

  const bad = fakeNetwork({ deviceStatus: 400 });
  assert.equal((await verifyDeviceToken(e, "x".repeat(40), bad.fetchImpl)).ok, false);
  assert.equal((await verifyDeviceToken(e, undefined, bad.fetchImpl)).ok, false);
});

// ---------- GitHub ----------

test("GitHub.submit commits the files, creates the branch and opens a pull request", async () => {
  const net = fakeNetwork();
  const gh = new GitHub({ repository: "va4w/scriptwell-gallery", appId: "1", installationId: "2", privateKey: RSA_PKCS8_PEM, fetch: net.fetchImpl });
  const result = await gh.submit({ id: "abc", files: { "scripts/abc/script.js": "x", "scripts/abc/icon.png": pngBytes(256, 256) }, title: "T", body: "B", commitMessage: "C", comment: "U" });
  assert.equal(result.created, true);
  assert.equal(result.number, 42);
  const sequence = net.calls.map((c) => `${c.method} ${c.path.replace(/\?.*/, "")}`);
  assert.deepEqual(sequence, [
    "POST /app/installations/2/access_tokens",
    "GET /repos/va4w/scriptwell-gallery/git/ref/heads/main",
    "GET /repos/va4w/scriptwell-gallery/git/commits/base000",
    "POST /repos/va4w/scriptwell-gallery/git/blobs",
    "POST /repos/va4w/scriptwell-gallery/git/blobs",
    "POST /repos/va4w/scriptwell-gallery/git/trees",
    "POST /repos/va4w/scriptwell-gallery/git/commits",
    "GET /repos/va4w/scriptwell-gallery/git/ref/heads/submit/abc",
    "POST /repos/va4w/scriptwell-gallery/git/refs",
    "GET /repos/va4w/scriptwell-gallery/pulls",
    "POST /repos/va4w/scriptwell-gallery/pulls",
    "POST /repos/va4w/scriptwell-gallery/issues/42/labels",
  ]);
  const tree = net.calls.find((c) => c.path.endsWith("/git/trees")).body;
  assert.deepEqual(tree.tree.map((t) => t.path), ["scripts/abc/script.js", "scripts/abc/icon.png"]);
  assert.equal(tree.base_tree, "tree000");
  const pull = net.calls.find((c) => c.method === "POST" && c.path.endsWith("/pulls")).body;
  assert.deepEqual([pull.head, pull.base, pull.maintainer_can_modify], ["submit/abc", "main", true]);
  // The installation token, not the App JWT, is used for repository calls.
  assert.equal(net.calls[1].headers.authorization, "Bearer ghs_test");
});

test("GitHub.submit refreshes an existing branch and comments on the open pull request", async () => {
  const net = fakeNetwork({ existingBranch: true, openPull: { number: 7, html_url: "https://github.com/va4w/scriptwell-gallery/pull/7" } });
  const gh = new GitHub({ repository: "va4w/scriptwell-gallery", appId: "1", installationId: "2", privateKey: RSA_PKCS8_PEM, fetch: net.fetchImpl });
  const result = await gh.submit({ id: "abc", files: { "scripts/abc/script.js": "x" }, title: "T", body: "B", commitMessage: "C", comment: "U" });
  assert.deepEqual(result, { url: "https://github.com/va4w/scriptwell-gallery/pull/7", number: 7, created: false });
  const patch = net.calls.find((c) => c.method === "PATCH");
  assert.deepEqual(patch.body, { sha: "commit111", force: true });
  assert.ok(net.calls.some((c) => c.path.endsWith("/issues/7/comments")));
  assert.ok(!net.calls.some((c) => c.method === "POST" && c.path.endsWith("/pulls")));
});

test("pull request text renders submission strings as code spans", () => {
  const meta = { ...goodPayload().meta, description: "@octocat [click](https://evil.example) # heading" };
  const body = pullRequestBody({ meta, app: { version: "1" }, findings: [], analysis: { usedPermissions: ["network"] }, isUpdate: false });
  assert.ok(body.includes("`@octocat [click](https://evil.example) # heading`"));
  assert.ok(!body.includes("\n@octocat"));
});

test("screenshots: good ones become files, bad ones are hard findings", () => {
  const good = validateSubmission(goodPayload({ screenshots: { small: base64Encode(pngBytes(316, 316)), app: base64Encode(pngBytes(780, 1600)) } }));
  assert.equal(good.ok, true, JSON.stringify(good.findings));
  assert.deepEqual(Object.keys(good.files).sort(), ["icon.png", "meta.json", "screenshots/app.png", "screenshots/small.png", "script.js"]);
  assert.deepEqual(screenshotNames(good.files), ["small", "app"]);

  const bad = validateSubmission(goodPayload({ screenshots: { small: base64Encode(pngBytes(676, 316)), banner: base64Encode(pngBytes(316, 316)), medium: "***", large: base64Encode(new Uint8Array([1, 2, 3])) } }));
  assert.equal(bad.ok, false);
  const ids = bad.findings.filter((f) => f.severity === "hard").map((f) => f.ruleId).sort();
  assert.deepEqual(ids, ["screenshot-aspect", "screenshot-name", "screenshot-not-png", "screenshot-not-png"]);
  assert.ok(!Object.keys(bad.files).some((k) => k.startsWith("screenshots/")));

  const notAnObject = validateSubmission(goodPayload({ screenshots: ["x"] }));
  assert.ok(notAnObject.findings.some((f) => f.ruleId === "request" && /screenshots must be an object/.test(f.message)));
});

test("pull request body shows the screenshots from the submission branch", () => {
  const meta = goodPayload().meta;
  const files = { "script.js": new Uint8Array(1), "screenshots/small.png": new Uint8Array(1), "screenshots/app.png": new Uint8Array(1) };
  const body = pullRequestBody({ meta, app: { version: "1" }, findings: [], analysis: { usedPermissions: [] }, isUpdate: false, files, repository: "va4w/scriptwell-gallery" });
  assert.ok(body.includes('<img alt="small" src="https://raw.githubusercontent.com/va4w/scriptwell-gallery/submit/repo-stats-two/scripts/repo-stats-two/screenshots/small.png"'));
  assert.ok(body.includes('alt="app"'));
  const none = pullRequestBody({ meta, app: { version: "1" }, findings: [], analysis: null, isUpdate: false, files: { "script.js": new Uint8Array(1) }, repository: "va4w/scriptwell-gallery" });
  assert.ok(none.includes("None were sent."));
  const unsafe = pullRequestBody({ meta, app: { version: "1" }, findings: [], analysis: null, isUpdate: false, files, repository: "evil.example/x y" });
  assert.ok(!unsafe.includes("<img"));
});

// ---------- the handler ----------

test("POST /v1/submit: first submission opens a PR and returns an owner token", async () => {
  const net = fakeNetwork();
  const kv = fakeKV();
  const response = await worker.fetch(post(goodPayload({ deviceToken: "d".repeat(40) })), env(net, kv), ctx);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.pullRequest, "https://github.com/va4w/scriptwell-gallery/pull/42");
  assert.equal(body.created, true);
  assert.match(body.ownerToken, /^[A-Za-z0-9_-]{43}$/);
  const record = JSON.parse(kv.store.get("owner:repo-stats-two"));
  assert.equal(record.hash, await sha256Hex(body.ownerToken));
  assert.ok(net.calls.some((c) => c.path.includes("validate_device_token")), "DeviceCheck was consulted");
});

test("POST /v1/submit: updates need the owner token; a wrong one is refused", async () => {
  const net = fakeNetwork({ existingBranch: true, openPull: { number: 7, html_url: "https://github.com/va4w/scriptwell-gallery/pull/7" } });
  const kv = fakeKV({ "owner:repo-stats-two": JSON.stringify({ hash: await sha256Hex("secret-token") }) });
  const e = env(net, kv, { REQUIRE_DEVICE_CHECK: "false" });

  const refused = await worker.fetch(post(goodPayload({ ownerToken: "wrong" })), e, ctx);
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).code, "not-owner");
  assert.ok(!net.calls.some((c) => c.path.includes("/git/")), "nothing reached GitHub");

  const accepted = await worker.fetch(post(goodPayload({ ownerToken: "secret-token" })), e, ctx);
  const body = await accepted.json();
  assert.equal(accepted.status, 200, JSON.stringify(body));
  assert.equal(body.created, false);
  assert.equal(body.ownerToken, undefined);
});

test("POST /v1/submit: ids already published cannot be claimed", async () => {
  const net = fakeNetwork();
  const response = await worker.fetch(post(goodPayload({ meta: { id: "repo-stats" } })), env(net, fakeKV(), { REQUIRE_DEVICE_CHECK: "false" }), ctx);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "id-taken");
});

test("POST /v1/submit: hard findings come back as 422 with the list, before DeviceCheck is charged", async () => {
  const net = fakeNetwork();
  const response = await worker.fetch(post(goodPayload({ script: "eval('x')", deviceToken: "d".repeat(40) })), env(net, fakeKV()), ctx);
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.code, "checks");
  assert.ok(body.findings.some((f) => f.severity === "hard"));
  assert.ok(!net.calls.some((c) => c.path.includes("/git/")));
  assert.ok(!net.calls.some((c) => c.path.includes("validate_device_token")), "Apple was not called");
});

test("POST /v1/submit: missing device token is 401; bad JSON is 400; rate limit is 429", async () => {
  const net = fakeNetwork();
  const kv = fakeKV();
  const e = env(net, kv);
  assert.equal((await worker.fetch(post(goodPayload()), e, ctx)).status, 401);
  assert.equal((await worker.fetch(post("{nope"), e, ctx)).status, 400);
  const limited = fakeKV({ [`rl:ip:${await sha256Hex("203.0.113.9")}:${new Date().toISOString().slice(0, 10)}`]: "3" });
  assert.equal((await worker.fetch(post(goodPayload()), env(net, limited), ctx)).status, 429);
  assert.equal((await worker.fetch(new Request("https://submit.example/v1/health"), e, ctx)).status, 200);
  assert.equal((await worker.fetch(new Request("https://submit.example/nope"), e, ctx)).status, 404);
});
