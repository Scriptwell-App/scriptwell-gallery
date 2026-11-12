// @name        Unit Converter
// @description Convert length, weight, temperature, volume and speed, in the app or from Shortcuts
// @icon        arrow.left.arrow.right.square.fill
// @color       #0F766E
// @version     1.0.0
// @author      va4w
// @category    reference

// From Shortcuts, ask in plain words: "12 km to mi", "70 f in c", "2.5 cups to ml".

// Each unit is [name, how many base units it is]. Temperature is handled separately.
const KINDS = {
  Length: { m: ["metres", 1], km: ["kilometres", 1000], cm: ["centimetres", 0.01], mm: ["millimetres", 0.001], mi: ["miles", 1609.344], yd: ["yards", 0.9144], ft: ["feet", 0.3048], in: ["inches", 0.0254] },
  Weight: { kg: ["kilograms", 1], g: ["grams", 0.001], lb: ["pounds", 0.45359237], oz: ["ounces", 0.028349523], st: ["stone", 6.35029318] },
  Volume: { l: ["litres", 1], ml: ["millilitres", 0.001], gal: ["US gallons", 3.785411784], qt: ["US quarts", 0.946352946], cup: ["US cups", 0.2365882365], floz: ["US fluid ounces", 0.0295735296], tbsp: ["tablespoons", 0.0147867648], tsp: ["teaspoons", 0.00492892159] },
  Speed: { "km/h": ["kilometres per hour", 1 / 3.6], mph: ["miles per hour", 0.44704], "m/s": ["metres per second", 1], kn: ["knots", 0.514444] },
  Temperature: { c: ["Celsius", 0], f: ["Fahrenheit", 0], k: ["Kelvin", 0] },
};

const toCelsius = { c: (v) => v, f: (v) => ((v - 32) * 5) / 9, k: (v) => v - 273.15 };
const fromCelsius = { c: (v) => v, f: (v) => (v * 9) / 5 + 32, k: (v) => v + 273.15 };

function convert(kind, value, from, to) {
  if (kind === "Temperature") return fromCelsius[to](toCelsius[from](value));
  return (value * KINDS[kind][from][1]) / KINDS[kind][to][1];
}

const round = (n) => (Math.abs(n) >= 100 ? n.toFixed(1) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toPrecision(3)).replace(/\.?0+$/, "");
const kindOf = (unit) => Object.keys(KINDS).find((kind) => unit in KINDS[kind]);
// "kilometres", "km", "kms" and "°C" all find their unit.
function unitNamed(text) {
  const word = text.toLowerCase().replace(/[°.]/g, "").replace(/\s+/g, "");
  for (const units of Object.values(KINDS)) {
    for (const [unit, [name]] of Object.entries(units)) {
      const plain = name.toLowerCase().replace(/^us /, "").replace(/\s+/g, "");
      if ([unit, `${unit}s`, plain, plain.replace(/s$/, ""), plain.replace(/re(s?)$/, "er$1")].includes(word)) return unit;
    }
  }
  return null;
}

const state = () => Storage.get("state", { kind: "Length", from: "km", value: 1 });
const save = (changes) => Storage.set("state", { ...state(), ...changes });

Script.action("kind", ({ kind }) => save({ kind, from: Object.keys(KINDS[kind])[0] }));
Script.action("from", ({ unit }) => save({ from: unit }));
Script.action("value", async () => {
  const answer = await UI.prompt({ title: "Value", placeholder: "12.5", defaultValue: String(state().value) });
  const value = Number(String(answer ?? "").replace(",", "."));
  if (answer !== null && Number.isFinite(value)) save({ value });
});

Script.ui(() => {
  const { kind, from, value } = state();
  const units = KINDS[kind];
  const chips = (names, selected, action, key) => Widget.hstack(names.map((name) =>
    Widget.button(name, action, { [key]: name }, { style: name === selected ? "prominent" : "bordered", color: "teal" })), { spacing: 6 });
  const unitNames = Object.keys(units);

  return {
    title: "Unit Converter",
    content: Widget.vstack([
      chips(Object.keys(KINDS).slice(0, 3), kind, "kind", "kind"),
      chips(Object.keys(KINDS).slice(3), kind, "kind", "kind"),
      Widget.button(Widget.vstack([
        Widget.text(`${round(value)} ${from}`, { font: 44, weight: "bold", design: "rounded", color: "primary", lineLimit: 1, minimumScale: 0.5 }),
        Widget.text(`${units[from][0]} · tap to change the value`, { font: "caption", color: "secondary" }),
      ], { spacing: 2 }), "value"),
      chips(unitNames.slice(0, 4), from, "from", "unit"),
      unitNames.length > 4 ? chips(unitNames.slice(4), from, "from", "unit") : null,
      Widget.divider(),
      ...unitNames.filter((unit) => unit !== from).map((unit) => Widget.hstack([
        Widget.text(units[unit][0], { color: "secondary" }),
        Widget.spacer(),
        Widget.text(`${round(convert(kind, value, from, unit))} ${unit}`, { font: "headline", design: "rounded" }),
      ])),
    ], { spacing: 12, padding: 16 }),
  };
});

Script.run((input) => {
  const match = /^\s*(-?[\d.,]+)\s*(.+?)\s+(?:to|in|as)\s+(.+?)\s*$/i.exec(input ?? "");
  const value = match ? Number(match[1].replace(",", ".")) : NaN;
  const from = match ? unitNamed(match[2]) : null, to = match ? unitNamed(match[3]) : null;
  if (!Number.isFinite(value) || !from || !to) return 'Ask like "12 km to mi" or "70 f in c".';
  if (kindOf(from) !== kindOf(to)) return `${KINDS[kindOf(from)][from][0]} and ${KINDS[kindOf(to)][to][0]} measure different things.`;
  return `${round(value)} ${from} = ${round(convert(kindOf(from), value, from, to))} ${to}`;
});
