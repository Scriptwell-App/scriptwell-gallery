// @name        Distance Home
// @description How far you are from home and which way it is, at a glance
// @permissions location
// @widget      small, medium, circular, inline
// @icon        house.fill
// @color       #0D9488
// @version     1.0.0
// @author      va4w
// @category    navigation

// Open the script once at home and tap "I am home now". After that the widget
// shows the straight-line distance and the compass direction back.
// Your location stays on the device: this script has no network permission.

const home = () => Storage.get("home", null); // { latitude, longitude }
const miles = () => Storage.get("miles", /-(US|GB|LR|MM)$/.test(Script.env.locale));
const radians = (degrees) => (degrees * Math.PI) / 180;

// Great-circle distance in metres and the initial compass bearing in degrees.
function route(from, to) {
  const lat1 = radians(from.latitude), lat2 = radians(to.latitude);
  const dLat = lat2 - lat1, dLon = radians(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const bearing = Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon));
  return { metres: 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)), bearing: ((bearing * 180) / Math.PI + 360) % 360 };
}

const POINTS = [["north", "↑"], ["north-east", "↗"], ["east", "→"], ["south-east", "↘"], ["south", "↓"], ["south-west", "↙"], ["west", "←"], ["north-west", "↖"]];
const compass = (bearing) => POINTS[Math.round(bearing / 45) % 8];

function pretty(metres) {
  if (miles()) {
    const mi = metres / 1609.344;
    return mi < 0.1 ? `${Math.round(metres * 3.28084)} ft` : `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
  }
  return metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km`;
}

async function measure() {
  if (!home()) return null;
  const here = await Location.current({ accuracy: "hundredMeters" });
  const { metres, bearing } = route(here, home());
  const [direction, arrow] = compass(bearing);
  return { metres, direction, arrow, atHome: metres < 150 };
}

Script.action("setHome", async () => {
  const { latitude, longitude } = await Location.current({ accuracy: "best" });
  Storage.set("home", { latitude, longitude });
});
Script.action("units", () => Storage.set("miles", !miles()));
Script.action("maps", () => UI.openURL(`https://maps.apple.com/?daddr=${home().latitude},${home().longitude}`));
Script.action("refresh", () => {});

Script.widget(async ({ family }) => {
  const m = await measure();
  if (!m) return Widget.text("Set home in Scriptwell", { font: "caption", color: "secondary", align: "center" });
  const refreshAfter = 15 * 60;

  if (family === "inline") return { content: Widget.text(m.atHome ? "🏠 Home" : `🏠 ${pretty(m.metres)} ${m.arrow}`), refreshAfter };
  if (family === "circular") {
    return { content: Widget.vstack([Widget.text(m.atHome ? "🏠" : m.arrow, { font: "title3" }), Widget.text(m.atHome ? "Home" : pretty(m.metres), { font: "caption2", minimumScale: 0.6, lineLimit: 1 })], { spacing: 0 }), refreshAfter };
  }

  const main = Widget.vstack([
    Widget.symbol("house.fill", { size: 22, color: "teal", fallback: "🏠" }),
    Widget.text(m.atHome ? "Home" : pretty(m.metres), { font: 34, weight: "bold", design: "rounded", lineLimit: 1, minimumScale: 0.6 }),
    Widget.text(m.atHome ? "You are here" : `${m.arrow} to the ${m.direction}`, { font: "caption", color: "secondary" }),
  ], { spacing: 4 });

  return {
    content: family === "small" ? main : Widget.hstack([
      main,
      Widget.vstack([
        Widget.text("Updated", { font: "caption2", color: "secondary" }),
        Widget.date(new Date(), { style: "time", font: "subheadline" }),
        Widget.text("Straight line", { font: "caption2", color: "secondary" }),
      ], { spacing: 3 }),
    ], { spacing: 28 }),
    refreshAfter,
  };
});

Script.ui(async () => {
  const m = await measure();
  return {
    title: "Distance Home",
    content: Widget.vstack(m ? [
      Widget.text(m.atHome ? "🏠" : m.arrow, { font: 72 }),
      Widget.text(m.atHome ? "You are home" : pretty(m.metres), { font: 48, weight: "bold", design: "rounded" }),
      m.atHome ? null : Widget.text(`Home is to the ${m.direction}, in a straight line`, { color: "secondary" }),
      Widget.hstack([
        Widget.button("Directions", "maps", null, { style: "prominent", color: "teal" }),
        Widget.button("Update", "refresh", null, { style: "bordered" }),
      ], { spacing: 10 }),
      Widget.divider(),
      Widget.button(miles() ? "Show kilometres" : "Show miles", "units", null, { color: "secondary" }),
      Widget.button("Set home to where I am now", "setHome", null, { color: "secondary" }),
    ] : [
      Widget.symbol("house.fill", { size: 56, color: "teal", fallback: "🏠" }),
      Widget.text("Where is home?", { font: "title2", weight: "bold" }),
      Widget.text("Tap the button while you are at home. The place is saved on this device only.", { color: "secondary", align: "center" }),
      Widget.button("I am home now", "setHome", null, { style: "prominent", color: "teal" }),
    ], { spacing: 14, padding: 24 }),
  };
});

Script.run(async () => {
  const m = await measure();
  if (!m) return "Home is not set yet. Open Distance Home in Scriptwell first.";
  return m.atHome ? "You are home." : `${pretty(m.metres)} from home, to the ${m.direction}.`;
});
