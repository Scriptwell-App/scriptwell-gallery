/*
 * Minimal PNG inspection: signature + IHDR only. Pure module (no imports);
 * takes a Uint8Array (a Node Buffer is one).
 */

export const ICON_LIMITS = {
  minSize: 256,
  maxSize: 1024,
  maxBytes: 200 * 1024,
};

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** @returns {{ width: number, height: number } | null} null if not a PNG */
export function readPngSize(bytes) {
  if (!bytes || bytes.length < 24) return null;
  for (let i = 0; i < SIGNATURE.length; i++) if (bytes[i] !== SIGNATURE[i]) return null;
  // First chunk must be IHDR: 4-byte length, "IHDR", then width and height (big endian).
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const u32 = (o) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  return { width: u32(16), height: u32(20) };
}

/**
 * @returns findings: { ruleId, severity: "hard", message, line: 0, column: 0 }
 */
export function checkIconBytes(bytes, limits = ICON_LIMITS) {
  const findings = [];
  const add = (ruleId, message) => findings.push({ ruleId, severity: "hard", message, line: 0, column: 0 });

  const size = readPngSize(bytes);
  if (!size) {
    add("icon-not-png", "icon.png is not a valid PNG file.");
    return findings;
  }
  if (size.width !== size.height) {
    add("icon-not-square", `icon.png is ${size.width}×${size.height}; it must be square.`);
  }
  if (size.width < limits.minSize || size.height < limits.minSize || size.width > limits.maxSize || size.height > limits.maxSize) {
    add("icon-size", `icon.png is ${size.width}×${size.height}; each side must be ${limits.minSize}–${limits.maxSize} px.`);
  }
  if (bytes.length > limits.maxBytes) {
    add("icon-too-large", `icon.png is ${Math.ceil(bytes.length / 1024)} KB; the limit is ${Math.floor(limits.maxBytes / 1024)} KB.`);
  }
  return findings;
}
