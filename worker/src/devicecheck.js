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
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export async function verifyDeviceToken(env, deviceToken, fetchImpl = fetch) {
  if (typeof deviceToken !== "string" || deviceToken.length < 16 || deviceToken.length > 16384) {
    return { ok: false, reason: "The request did not include a device token." };
  }
  const endpoint = ENDPOINTS[env.DEVICECHECK_ENVIRONMENT || "production"];
  if (!endpoint) return { ok: false, reason: "DEVICECHECK_ENVIRONMENT must be production or development." };
  if (!env.APPLE_TEAM_ID || !env.DEVICECHECK_KEY_ID || !env.DEVICECHECK_PRIVATE_KEY) {
    return { ok: false, reason: "DeviceCheck is not configured on the server." };
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
  if (response.status === 401) return { ok: false, reason: "The server's DeviceCheck key was rejected by Apple." };
  return { ok: false, reason: `Apple did not accept the device token (${response.status}${text ? ": " + text : ""}).` };
}
