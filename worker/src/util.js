/*
 * Small helpers shared by the Worker modules. No Node-only APIs: this runs in
 * Workers and, for the tests, in Node 20+.
 */

export const encoder = new TextEncoder();
export const decoder = new TextDecoder("utf-8", { fatal: true });

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export async function sha256Hex(input) {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64Encode(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** Strict decode: rejects characters outside the alphabet instead of skipping them. */
export function base64Decode(text) {
  const cleaned = String(text).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.length % 4 === 1) throw new Error("invalid base64");
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function base64UrlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : encoder.encode(String(input));
  return base64Encode(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PEM → DER. Accepts any "-----BEGIN …-----" block. */
export function pemToDer(pem) {
  const body = String(pem).replace(/-----(BEGIN|END)[^-]*-----/g, "").replace(/\s+/g, "");
  if (body === "") throw new Error("empty PEM");
  return base64Decode(body);
}

export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Today as YYYY-MM-DD in UTC; the rate-limit window. */
export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Untrusted text inside Markdown: as an inline code span, so it cannot add
 * links, images, headings or @mentions. Same rule as tools/lib/common.mjs.
 */
export function code(value, maxLength = 200) {
  let text = String(value ?? "").replace(/[`\r\n\t]+/g, " ").trim();
  if (text.length > maxLength) text = text.slice(0, maxLength - 1) + "…";
  return text === "" ? "—" : "`" + text + "`";
}

/** Untrusted text on one plain line (titles, commit messages). */
export function plain(value, maxLength = 80) {
  let text = String(value ?? "").replace(/[\u0000-\u001f\u007f`#@<>[\]]+/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > maxLength) text = text.slice(0, maxLength - 1) + "…";
  return text;
}
