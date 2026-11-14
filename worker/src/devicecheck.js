/*
 * Apple DeviceCheck: the app sends a one-time device token; Apple confirms it
 * came from a genuine device running an app signed by this team. The token
 * carries no identity, and the Worker keeps nothing from it.
 *
 * https://developer.apple.com/documentation/devicecheck/accessing-and-modifying-per-device-data
 */
import { importPrivateKey, signJWT } from "./jwt.js";

const ENDPOINTS = {
  production: "https://api.devicecheck.apple.com/v1/validate_device_token",
  development: "https://api.development.devicecheck.apple.com/v1/validate_device_token",
};

/**
 * `kind` tells an install Apple would not vouch for ("missing": no token, e.g.
 * the Simulator; "rejected": Apple refused the token, e.g. a sideloaded or
 * self-built copy signed by another team) from a problem on this side
 * ("server": not configured, key refused, Apple unreachable or failing).
 *
 * @returns {{ ok: true } | { ok: false, kind: "missing" | "rejected" | "server", reason: string }}
 */
export async function verifyDeviceToken(env, deviceToken, fetchImpl = fetch) {
  if (typeof deviceToken !== "string" || deviceToken.length < 16 || deviceToken.length > 16384) {
    return { ok: false, kind: "missing", reason: "The request did not include a device token." };
  }
  const endpoint = ENDPOINTS[env.DEVICECHECK_ENVIRONMENT || "production"];
  if (!endpoint) return { ok: false, kind: "server", reason: "DEVICECHECK_ENVIRONMENT must be production or development." };
  if (!env.APPLE_TEAM_ID || !env.DEVICECHECK_KEY_ID || !env.DEVICECHECK_PRIVATE_KEY) {
    return { ok: false, kind: "server", reason: "DeviceCheck is not configured on the server." };
  }

  const key = await importPrivateKey(env.DEVICECHECK_PRIVATE_KEY, "ES256");
  const jwt = await signJWT({
    algorithm: "ES256",
    key,
    header: { kid: env.DEVICECHECK_KEY_ID },
    payload: { iss: env.APPLE_TEAM_ID, iat: Math.floor(Date.now() / 1000) },
  });

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ device_token: deviceToken, transaction_id: crypto.randomUUID(), timestamp: Date.now() }),
  });
  if (response.status === 200) return { ok: true };
  const text = (await response.text().catch(() => "")).slice(0, 200);
  if (response.status === 401) return { ok: false, kind: "server", reason: "The server's DeviceCheck key was rejected by Apple." };
  // 400 is Apple's answer for a token it will not vouch for; anything else is Apple having trouble.
  const kind = response.status === 400 ? "rejected" : "server";
  return { ok: false, kind, reason: `Apple did not accept the device token (${response.status}${text ? ": " + text : ""}).` };
}
