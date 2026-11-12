// @name        Share My Location
// @description Turn where you are into a Maps link you can send to anyone
// @permissions location
// @icon        location.fill
// @color       #2563EB
// @version     1.0.0
// @author      scriptwell
// @category    navigation

// In Shortcuts, this returns a short message with a Maps link, ready to pass
// to "Send Message". Your location goes nowhere unless you share it yourself.

const link = ({ latitude, longitude }) => `https://maps.apple.com/?ll=${latitude.toFixed(5)},${longitude.toFixed(5)}&q=${encodeURIComponent("I am here")}`;

// 51.5007 → 51°30′02.5″N
function dms(value, positive, negative) {
  const abs = Math.abs(value);
  const degrees = Math.floor(abs), minutes = Math.floor((abs - degrees) * 60);
  const seconds = ((abs - degrees) * 60 - minutes) * 60;
  return `${degrees}°${String(minutes).padStart(2, "0")}′${seconds.toFixed(1).padStart(4, "0")}″${value >= 0 ? positive : negative}`;
}

const message = (here) => `I am here: ${link(here)} (accurate to about ${Math.max(5, Math.round(here.accuracy))} m at ${new Date(here.timestamp).toLocaleTimeString(undefined, { timeStyle: "short" })})`;

let here = null;

Script.action("refresh", async () => { here = await Location.current({ accuracy: "best" }); });
Script.action("share", () => UI.share(message(here)));
Script.action("maps", () => UI.openURL(link(here)));

Script.ui(async () => {
  here ??= await Location.current({ accuracy: "best" });
  const row = (label, value) => Widget.hstack([Widget.text(label, { color: "secondary" }), Widget.spacer(), Widget.text(value, { design: "monospaced", font: "subheadline" })]);
  return {
    title: "My Location",
    content: Widget.vstack([
      Widget.symbol("location.fill", { size: 48, color: "blue", fallback: "📍" }),
      Widget.text(`${here.latitude.toFixed(5)}, ${here.longitude.toFixed(5)}`, { font: "title2", weight: "semibold", design: "rounded" }),
      Widget.vstack([
        row("Latitude", dms(here.latitude, "N", "S")),
        row("Longitude", dms(here.longitude, "E", "W")),
        row("Accuracy", `± ${Math.round(here.accuracy)} m`),
        row("Altitude", `${Math.round(here.altitude)} m`),
      ], { spacing: 10, padding: 14, background: { light: "#FFFFFF", dark: "#1C1C1E" }, cornerRadius: 12 }),
      Widget.button("Share a Maps link", "share", null, { style: "prominent", color: "blue" }),
      Widget.hstack([
        Widget.button("Open in Maps", "maps", null, { style: "bordered" }),
        Widget.button("Update", "refresh", null, { style: "bordered" }),
      ], { spacing: 10 }),
    ], { spacing: 14, padding: 20 }),
  };
});

Script.run(async () => message(await Location.current({ accuracy: "best" })));
