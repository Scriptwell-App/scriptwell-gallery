/*
 * Compact JWS signing with WebCrypto, for the two tokens the Worker mints:
 * RS256 for the GitHub App, ES256 for Apple DeviceCheck.
 */
import { base64UrlEncode, concat, encoder, pemToDer } from "./util.js";

const ALGORITHMS = {
  RS256: {
    import: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    sign: { name: "RSASSA-PKCS1-v1_5" },
  },
  ES256: {
    import: { name: "ECDSA", namedCurve: "P-256" },
    // WebCrypto returns ECDSA signatures as r‖s, which is exactly the JWS form.
    sign: { name: "ECDSA", hash: "SHA-256" },
  },
};

function derLength(n) {
  if (n < 0x80) return [n];
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

function derTagged(tag, content) {
  return concat(Uint8Array.from([tag, ...derLength(content.length)]), content);
}

/**
 * GitHub hands out App keys as PKCS#1 ("BEGIN RSA PRIVATE KEY"); WebCrypto
 * imports only PKCS#8. The PKCS#8 form is the PKCS#1 blob wrapped in a fixed
 * header, so wrap it here rather than making maintainers run openssl.
 */
export function pkcs1ToPkcs8(pkcs1) {
  const version = Uint8Array.from([0x02, 0x01, 0x00]);
  const rsaEncryption = Uint8Array.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  return derTagged(0x30, concat(version, rsaEncryption, derTagged(0x04, pkcs1)));
}

export async function importPrivateKey(pem, algorithm) {
  const spec = ALGORITHMS[algorithm];
  if (!spec) throw new Error(`unsupported algorithm ${algorithm}`);
  let der = pemToDer(pem);
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) der = pkcs1ToPkcs8(der);
  if (/BEGIN EC PRIVATE KEY/.test(pem)) throw new Error("the DeviceCheck key must be the .p8 file from Apple (PKCS#8)");
  return crypto.subtle.importKey("pkcs8", der, spec.import, false, ["sign"]);
}

export async function signJWT({ algorithm, key, header = {}, payload }) {
  const spec = ALGORITHMS[algorithm];
  const encodedHeader = base64UrlEncode(JSON.stringify({ alg: algorithm, typ: "JWT", ...header }));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(spec.sign, key, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(signature)}`;
}
