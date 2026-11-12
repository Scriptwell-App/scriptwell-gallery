// @name        JSON Tidy
// @description Format and validate the JSON on your clipboard
// @permissions clipboard
// @icon        curlybraces.square.fill
// @color       #CA8A04
// @version     1.0.0
// @author      scriptwell
// @category    developer-tools

// Copy some JSON, run this, and paste: it comes back neatly indented.
// From Shortcuts you can pass the JSON as Input instead; then the clipboard is not read.

function describe(value) {
  if (Array.isArray(value)) return `an array of ${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") return `an object with ${Object.keys(value).length} key${Object.keys(value).length === 1 ? "" : "s"}`;
  return `a ${value === null ? "null" : typeof value}`;
}

Script.run(async (input) => {
  const text = (input ?? await Clipboard.readText()).trim();
  if (!text) return "There is no text to format.";

  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    // Point at the place where parsing stopped, when the engine reports one.
    const position = /position (\d+)/.exec(error.message)?.[1];
    const near = position ? ` Near: “${text.slice(Math.max(0, position - 20), Number(position) + 20)}”` : "";
    return `Not valid JSON: ${error.message}.${near}`;
  }

  const formatted = JSON.stringify(value, null, 2);
  if (input) return formatted;

  await Clipboard.writeText(formatted);
  return `Formatted ${describe(value)} (${formatted.split("\n").length} lines). It is on your clipboard.`;
});
