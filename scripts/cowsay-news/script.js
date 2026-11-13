// @name        Cowsay News
// @description A cow that tells you how hot or cold the current news is, or says your widget Parameter
// @icon        text.bubble.fill
// @color       #A16207
// @permissions network
// @widget      small, medium, large
// @version     1.0.0
// @author      scriptwell
// @category    news

// Headlines come from the BBC News front page feed.
const FEED = "https://feeds.bbci.co.uk/news/rss.xml";
const FRESH_FOR = 30 * 60 * 1000;

// Optional prefixes in the parameter change the eyes, like cowsay's flags:
// "-d text" dead, "-b" borg, "-p" paranoid, "-s" stoned, "-t" tired, "-w" wired, "-y" young, "-g" greedy.
// Any text after the flag replaces the news reading.
const EYES = { d: "xx", b: "==", p: "@@", s: "**", t: "--", w: "OO", y: "..", g: "$$" };

// Words that make a headline run hot, and words that cool it down.
const HOT = new Set([
  "war", "wars", "attack", "attacks", "attacked", "kill", "kills", "killed", "killing", "dead", "death", "deaths", "dies", "died",
  "crisis", "crash", "crashes", "fire", "fires", "blaze", "bomb", "bombing", "strike", "strikes", "protest", "protests", "riot", "riots",
  "clash", "clashes", "row", "fury", "anger", "angry", "outrage", "scandal", "warns", "warning", "fear", "fears", "threat", "threatens",
  "shooting", "shot", "stabbing", "murder", "missile", "missiles", "invasion", "chaos", "collapse", "collapses", "storm", "flood", "floods",
  "emergency", "violence", "violent", "arrested", "charged", "accused", "jailed", "hostage", "hostages", "terror", "disaster", "slams",
  "condemns", "tariff", "tariffs", "sanctions", "explosion", "injured", "victims", "abuse", "fraud", "plunge", "plunges", "turmoil",
]);
const COOL = new Set([
  "calm", "peace", "ceasefire", "deal", "agreement", "agree", "agrees", "wins", "win", "won", "celebrate", "celebrates", "celebration",
  "rescued", "rescue", "recovery", "recovers", "hope", "hopes", "joy", "happy", "record", "breakthrough", "cure", "saved", "reunited",
  "festival", "award", "awards", "gold", "champion", "champions", "wedding", "birth", "born", "discovery", "discovered", "relief",
  "eases", "rise", "boost", "boosts", "love", "kindness", "volunteers", "charity", "restored", "reopens", "success", "honoured",
]);

function decode(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function heat(headline) {
  const words = headline.toLowerCase().match(/[a-z']+/g) ?? [];
  let score = 0;
  for (const word of words) {
    if (HOT.has(word)) score += 1;
    else if (COOL.has(word)) score -= 1;
  }
  return score;
}

function measure(headlines) {
  const scores = headlines.map(heat);
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const celsius = Math.round(Math.max(-10, Math.min(45, 16 + average * 14)));
  return { celsius, count: scores.length, time: Date.now() };
}

async function news() {
  const cached = Storage.get("news");
  if (cached && Date.now() - cached.time < FRESH_FOR) return cached;

  try {
    const response = await fetch(FEED, { timeout: 6000 });
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const xml = await response.text();
    const headlines = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)]
      .map((match) => decode(match[1]).trim())
      .filter(Boolean)
      .slice(0, 30);
    if (headlines.length === 0) throw new Error("No headlines in the feed");
    const reading = measure(headlines);
    Storage.set("news", reading);
    return reading;
  } catch (error) {
    console.warn("Could not load the news:", error.message);
    return cached ?? null; // offline: use the last reading if there is one
  }
}

// What each temperature means, in plain words: hot news is bad news, cold news is good news.
function describe(celsius) {
  if (celsius <= 0) return { word: "freezing", meaning: "almost all good news" };
  if (celsius <= 10) return { word: "chilly", meaning: "mostly good news" };
  if (celsius <= 18) return { word: "mild", meaning: "a normal mix of good and bad" };
  if (celsius <= 25) return { word: "warm", meaning: "a bit more bad news than good" };
  if (celsius <= 33) return { word: "hot", meaning: "lots of bad news" };
  return { word: "boiling", meaning: "nearly all bad news" };
}

function newsLine(reading) {
  if (!reading) return "I can't hear the news right now. Moo.";
  const fahrenheit = /-US$/.test(Script.env.locale);
  const degrees = fahrenheit ? `${Math.round((reading.celsius * 9) / 5 + 32)}°F` : `${reading.celsius}°C`;
  const { word, meaning } = describe(reading.celsius);
  return `The news is ${word} today (${degrees}): ${meaning}.`;
}

function newsEyes(reading) {
  if (!reading) return "oo";
  if (reading.celsius >= 34) return "OO";
  if (reading.celsius <= 0) return "--";
  return "oo";
}

function parse(parameter) {
  let text = (parameter ?? "").trim();
  let eyes = null;
  const flag = /^-([a-z])(\s+|$)/i.exec(text);
  if (flag && EYES[flag[1].toLowerCase()]) {
    eyes = EYES[flag[1].toLowerCase()];
    text = text.slice(flag[0].length).trim();
  }
  return { text, eyes };
}

// Text from the parameter wins; otherwise the cow reads the news.
async function speech(parameter) {
  const { text, eyes } = parse(parameter);
  if (text) return { text, eyes: eyes ?? "oo" };
  const reading = await news();
  return { text: newsLine(reading), eyes: eyes ?? newsEyes(reading) };
}

function wrap(text, width) {
  const lines = [];
  for (const paragraph of text.split(/\n/)) {
    let line = "";
    for (let word of paragraph.split(/\s+/).filter(Boolean)) {
      while (word.length > width) {
        if (line) { lines.push(line); line = ""; }
        lines.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (!word) continue;
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += " " + word;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

function cowsay(text, eyes = "oo", width = 30) {
  const lines = wrap(text, width);
  const longest = Math.max(...lines.map((l) => l.length));
  const pad = (l) => l + " ".repeat(longest - l.length);

  const bubble = [" " + "_".repeat(longest + 2)];
  if (lines.length === 1) {
    bubble.push(`< ${pad(lines[0])} >`);
  } else {
    lines.forEach((l, i) => {
      const [left, right] = i === 0 ? ["/", "\\"] : i === lines.length - 1 ? ["\\", "/"] : ["|", "|"];
      bubble.push(`${left} ${pad(l)} ${right}`);
    });
  }
  bubble.push(" " + "-".repeat(longest + 2));

  const cow = [
    "        \\   ^__^",
    `         \\  (${eyes})\\_______`,
    "            (__)\\       )\\/\\",
    "                ||----w |",
    "                ||     ||",
  ];
  return [...bubble, ...cow].join("\n");
}

const LAYOUT = {
  small: { width: 16, font: 9, maxLines: 4 },
  medium: { width: 34, font: 10, maxLines: 4 },
  large: { width: 30, font: 13, maxLines: 12 },
};

Script.widget(async ({ family, parameter }) => {
  const layout = LAYOUT[family] ?? LAYOUT.medium;
  const { text, eyes } = await speech(parameter);

  // Keep the bubble from growing past what fits.
  let lines = wrap(text, layout.width);
  let shown = text;
  if (lines.length > layout.maxLines) {
    lines = lines.slice(0, layout.maxLines);
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = (last.length >= layout.width ? last.slice(0, layout.width - 1) : last) + "…";
    shown = lines.join("\n");
  }

  const art = cowsay(shown, eyes, layout.width);

  return {
    content: Widget.vstack([
      Widget.text(art, {
        font: layout.font,
        design: "monospaced",
        align: "leading",
        minimumScale: 0.3,
        lineLimit: art.split("\n").length,
        color: "primary",
      }),
    ], {
      alignment: "leading",
      frame: { maxWidth: "infinity", maxHeight: "infinity", alignment: "center" },
    }),
    // The news changes through the day.
    refreshAfter: 30 * 60,
  };
});

// Keep the reading fresh while the app is closed.
Script.background(async () => {
  await news();
});

// From Shortcuts or Siri: returns the cow as text.
Script.run(async (input) => {
  const { text, eyes } = await speech(input);
  return cowsay(text, eyes, 40);
});
