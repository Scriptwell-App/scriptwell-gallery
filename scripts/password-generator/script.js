// @name        Password Generator
// @description Strong random passwords, made on your device and copied with one tap
// @permissions clipboard
// @icon        key.fill
// @color       #4338CA
// @version     1.0.0
// @author      scriptwell
// @category    utilities

// Passwords come from the system's secure random number generator. They are
// never saved or sent anywhere, and are copied only when you tap Copy.
// From Shortcuts, the script returns a fresh password with your saved settings.

const SETS = {
  letters: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*-_=+?",
};
const LOOKALIKES = /[0O1lI]/g;

const options = () => Storage.get("options", { length: 20, digits: true, symbols: true, readable: false });

function alphabet(o) {
  const all = SETS.letters + (o.digits ? SETS.digits : "") + (o.symbols ? SETS.symbols : "");
  return o.readable ? all.replace(LOOKALIKES, "") : all;
}

// An unbiased random index below `limit`: values that would favour some characters are thrown away.
function pick(limit) {
  const ceiling = Math.floor(256 / limit) * limit;
  const byte = new Uint8Array(1);
  do crypto.getRandomValues(byte); while (byte[0] >= ceiling);
  return byte[0] % limit;
}

function generate(o = options()) {
  const chars = alphabet(o);
  const has = (set) => [...password].some((ch) => set.includes(ch));
  let password;
  // Draw again in the rare case a chosen kind of character is missing altogether.
  do password = Array.from({ length: o.length }, () => chars[pick(chars.length)]).join("");
  while ((o.digits && !has(SETS.digits)) || (o.symbols && !has(SETS.symbols)));
  return password;
}

const bits = (o) => Math.round(o.length * Math.log2(alphabet(o).length));
const strength = (b) => (b >= 100 ? ["Excellent", "green"] : b >= 75 ? ["Strong", "green"] : b >= 55 ? ["Fair", "orange"] : ["Weak", "red"]);

let password = generate();
let copied = false;

const change = (changes) => { Storage.set("options", { ...options(), ...changes }); password = generate(); copied = false; };

Script.action("new", () => { password = generate(); copied = false; });
Script.action("copy", async () => { await Clipboard.writeText(password); await UI.haptic("success"); copied = true; });
Script.action("length", ({ by }) => change({ length: Math.min(40, Math.max(8, options().length + by)) }));
Script.action("option", ({ name, isOn }) => change({ [name]: isOn ?? !options()[name] }));

Script.ui(() => {
  const o = options();
  const [label, color] = strength(bits(o));
  return {
    title: "Password",
    content: Widget.vstack([
      Widget.text(password, { font: "title3", design: "monospaced", weight: "medium", align: "center", padding: 16, background: { light: "#EEF2FF", dark: "#1E1B4B" }, cornerRadius: 14, frame: { maxWidth: "infinity" } }),
      Widget.text(`${label} · about ${bits(o)} bits`, { font: "subheadline", weight: "semibold", color }),
      Widget.hstack([
        Widget.button(copied ? "Copied" : "Copy", "copy", null, { style: "prominent", color: "indigo" }),
        Widget.button("New", "new", null, { style: "bordered", color: "indigo" }),
      ], { spacing: 10 }),
      Widget.divider(),
      Widget.hstack([
        Widget.text("Length"),
        Widget.spacer(),
        Widget.button("−", "length", { by: -1 }, { style: "bordered" }),
        Widget.text(String(o.length), { font: "headline", frame: { width: 36 } }),
        Widget.button("+", "length", { by: 1 }, { style: "bordered" }),
      ], { spacing: 8 }),
      Widget.toggle("Digits", o.digits, "option", { name: "digits" }, { color: "indigo" }),
      Widget.toggle("Symbols", o.symbols, "option", { name: "symbols" }, { color: "indigo" }),
      Widget.toggle("Easy to read (no 0, O, 1, l, I)", o.readable, "option", { name: "readable" }, { color: "indigo" }),
      Widget.text("Made on this device and never saved.", { font: "caption", color: "secondary" }),
    ], { spacing: 14, padding: 20 }),
  };
});

Script.run(() => generate());
