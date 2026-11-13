/*
 * Minimal PNG inspection: signature + IHDR only. Pure module (no imports);
 * takes a Uint8Array (a Node Buffer is one). Shared by the review tool and
 * the submission Worker.
 */

export const ICON_LIMITS = {
  minSize: 256,
  maxSize: 1024,
  maxBytes: 200 * 1024,
};

/**
 * Screenshots live in scripts/<id>/screenshots/<name>.png. The app captures
 * them at submission: one per widget family the script declares, plus "app"
 * for the first screen of the mini-app. Nothing else is allowed in the folder.
 */
export const SCREENSHOT_NAMES = ["small", "medium", "large", "extraLarge", "circular", "rectangular", "inline", "app"];

export const SCREENSHOT_LIMITS = {
  maxBytes: 600 * 1024,
  /** Longest side of a widget picture; 2× the large family is 676×708. */
  maxWidgetSide: 1600,
  /** The app screen is a phone width tall-ish capture. */
  maxAppWidth: 1600,
  maxAppHeight: 4800,
  minSide: 24,
  /** Width ÷ height of each widget family (point sizes on a standard iPhone). */
  aspect: {
    small: 1,
    medium: 338 / 158,
    large: 338 / 354,
    extraLarge: 338 / 354,
    circular: 1,
    rectangular: 172 / 76,
    inline: 240 / 28,
  },
  aspectTolerance: 0.08,
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

/** "small.png" → "small", or null when the file name is not a screenshot the gallery knows. */
export function screenshotName(fileName) {
  const match = /^([A-Za-z]+)\.png$/.exec(String(fileName || ""));
  return match && SCREENSHOT_NAMES.includes(match[1]) ? match[1] : null;
}

/**
 * Check one screenshot: a PNG with the shape of the widget family it is named
 * after (or a phone-shaped capture for "app"), within the size limits.
 * @returns findings: { ruleId, severity: "hard", message, line: 0, column: 0 }
 */
export function checkScreenshotBytes(name, bytes, limits = SCREENSHOT_LIMITS) {
  const findings = [];
  const add = (ruleId, message) => findings.push({ ruleId, severity: "hard", message, line: 0, column: 0 });
  const file = `screenshots/${name}.png`;

  if (!SCREENSHOT_NAMES.includes(name)) {
    add("screenshot-name", `${file} is not a screenshot the gallery knows. Allowed: ${SCREENSHOT_NAMES.map((n) => n + ".png").join(", ")}.`);
    return findings;
  }
  const size = readPngSize(bytes);
  if (!size) {
    add("screenshot-not-png", `${file} is not a valid PNG file.`);
    return findings;
  }
  if (bytes.length > limits.maxBytes) {
    add("screenshot-too-large", `${file} is ${Math.ceil(bytes.length / 1024)} KB; the limit is ${Math.floor(limits.maxBytes / 1024)} KB.`);
  }
  if (size.width < limits.minSide || size.height < limits.minSide) {
    add("screenshot-size", `${file} is ${size.width}×${size.height}; each side must be at least ${limits.minSide} px.`);
  } else if (name === "app") {
    if (size.width > limits.maxAppWidth || size.height > limits.maxAppHeight) {
      add("screenshot-size", `${file} is ${size.width}×${size.height}; the limit is ${limits.maxAppWidth}×${limits.maxAppHeight} px.`);
    }
  } else {
    if (size.width > limits.maxWidgetSide || size.height > limits.maxWidgetSide) {
      add("screenshot-size", `${file} is ${size.width}×${size.height}; each side must be at most ${limits.maxWidgetSide} px.`);
    }
    const expected = limits.aspect[name];
    const actual = size.width / size.height;
    if (Math.abs(actual - expected) / expected > limits.aspectTolerance) {
      add("screenshot-aspect", `${file} is ${size.width}×${size.height}, which is not the shape of a ${name} widget (width ÷ height should be about ${expected.toFixed(2)}).`);
    }
  }
  return findings;
}
