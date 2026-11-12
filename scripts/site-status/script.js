// @name        Site Status
// @description Check whether a website is up and how quickly it answers
// @permissions network
// @widget      small, medium
// @icon        waveform.path.ecg
// @color       #059669
// @version     1.0.0
// @author      va4w
// @category    developer-tools

// Put the address in the widget's Parameter field, for example https://example.com
const DEFAULT_SITE = "https://www.apple.com";

async function check(address) {
  const url = address.startsWith("https://") ? address : `https://${address}`;
  const started = Date.now();
  let result;
  try {
    const response = await fetch(url, { timeout: 6000 });
    result = { up: response.status < 500, status: response.status, ms: Date.now() - started };
  } catch (error) {
    result = { up: false, status: error.name === "TimeoutError" ? "timeout" : "unreachable", ms: Date.now() - started };
  }
  result.time = Date.now();

  // Remember the last 12 checks to draw a small history.
  const key = `history:${url}`;
  const history = [...Storage.get(key, []), result].slice(-12);
  Storage.set(key, history);
  return { url, host: new URL(url).hostname, result, history };
}

Script.widget(async ({ family, parameter }) => {
  const { host, result, history } = await check((parameter ?? DEFAULT_SITE).trim());
  const color = result.up ? "green" : "red";

  const dots = Widget.hstack(history.map((h) => ({
    type: "stack", direction: "vertical", children: [], cornerRadius: 3,
    background: h.up ? "green" : "red", frame: { width: 6, height: 14 },
  })), { spacing: 3 });

  return {
    content: Widget.vstack([
      Widget.hstack([
        Widget.symbol(result.up ? "checkmark.circle.fill" : "xmark.octagon.fill", { size: 18, color, fallback: result.up ? "✅" : "⛔️" }),
        Widget.text(result.up ? "Up" : "Down", { font: "headline", color }),
        Widget.spacer(),
      ], { spacing: 6 }),
      Widget.text(host, { font: "caption", color: "secondary", lineLimit: 1 }),
      Widget.spacer(),
      Widget.text(result.up ? `${result.ms} ms` : String(result.status), { font: "title3", weight: "semibold", design: "rounded" }),
      family === "medium" ? dots : null,
      Widget.date(result.time, { style: "time", font: "caption2", color: "secondary" }),
    ], { alignment: "leading", spacing: 3, frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" } }),
    refreshAfter: 15 * 60,
  };
});

Script.run(async (input) => {
  const { host, result } = await check((input ?? DEFAULT_SITE).trim());
  return result.up ? `${host} is up (${result.status}) in ${result.ms} ms` : `${host} is down: ${result.status}`;
});
