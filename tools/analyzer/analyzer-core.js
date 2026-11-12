/*
 * Scriptwell static analyzer core.
 *
 * Dependency-free on purpose: this exact file runs in Node (gallery CI) and in a
 * bridge-less JavaScriptCore context inside the app (import check, loop guard).
 * Rules live in rules.json; this file only knows rule *kinds*.
 *
 * Exports: tokenize, parseManifest, analyze, checkText
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ScriptwellAnalyzer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PUNCTUATORS = [
    ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
    "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=",
    "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>", "**",
  ];
  // After these keywords a "/" starts a regex literal, not a division.
  const REGEX_KEYWORDS = new Set([
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "throw", "case", "do", "else", "yield", "await",
  ]);
  const NUMBER = /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/y;
  const ID_START = /[A-Za-z_$# -￿]/;
  const ID_PART = /[A-Za-z0-9_$ -￿]/;
  const HEX = /[0-9a-fA-F]/;

  /**
   * Tokenize JavaScript source. Tolerant: never throws, so it can be used on
   * broken code (the editor) as well as on valid code.
   *
   * Token: { t: "id"|"num"|"str"|"tpl"|"regex"|"punct", v, s, e, line, col }
   *   str/tpl tokens also carry `len` (content length) and `esc` (count of
   *   \x / \u escapes); id tokens carry `escaped: true` if written with \u.
   */
  function tokenize(src) {
    const n = src.length;
    const tokens = [];
    const comments = [];
    const lineStarts = [0];
    for (let k = 0; k < n; k++) if (src.charCodeAt(k) === 10) lineStarts.push(k + 1);

    function locate(pos) {
      let lo = 0, hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1;
      }
      return { line: lo + 1, col: pos - lineStarts[lo] + 1 };
    }

    let prev = null;
    function push(t, s, e, extra) {
      const loc = locate(s);
      const tok = { t, v: src.slice(s, e), s, e, line: loc.line, col: loc.col };
      if (extra) Object.assign(tok, extra);
      tokens.push(tok);
      prev = tok;
      return tok;
    }

    // Scans one escape starting at the backslash; returns [nextIndex, isCodeEscape].
    function scanEscape(k) {
      const c = src[k + 1];
      if (c === "x") return [Math.min(n, k + 4), true];
      if (c === "u") {
        if (src[k + 2] === "{") {
          const close = src.indexOf("}", k + 3);
          return [close < 0 ? n : close + 1, true];
        }
        return [Math.min(n, k + 6), true];
      }
      return [Math.min(n, k + 2), false];
    }

    let braceDepth = 0;
    const tplStack = []; // braceDepth values at which a `${` was opened

    // Scans template text from `start` (just after ` or after an expression's }).
    function scanTemplate(start) {
      let k = start, esc = 0;
      while (k < n) {
        const c = src[k];
        if (c === "\\") { const r = scanEscape(k); k = r[0]; if (r[1]) esc++; continue; }
        if (c === "`") { push("tpl", start, k, { len: k - start, esc }); return k + 1; }
        if (c === "$" && src[k + 1] === "{") {
          push("tpl", start, k, { len: k - start, esc });
          push("punct", k, k + 2);
          braceDepth++;
          tplStack.push(braceDepth);
          return k + 2;
        }
        k++;
      }
      push("tpl", start, n, { len: n - start, esc });
      return n;
    }

    function regexAllowed() {
      if (!prev) return true;
      if (prev.t === "punct") return prev.v !== ")" && prev.v !== "]" && prev.v !== "}";
      if (prev.t === "id") return REGEX_KEYWORDS.has(prev.v);
      return false;
    }

    let i = 0;
    while (i < n) {
      const c = src[i];
      const code = src.charCodeAt(i);

      if (code === 32 || code === 9 || code === 10 || code === 13 || code === 0xfeff || code === 0xa0 || code === 0x2028 || code === 0x2029) { i++; continue; }

      if (c === "/" && src[i + 1] === "/") {
        let k = src.indexOf("\n", i);
        if (k < 0) k = n;
        comments.push({ s: i, e: k, line: locate(i).line, text: src.slice(i + 2, k) });
        i = k;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        let k = src.indexOf("*/", i + 2);
        k = k < 0 ? n : k + 2;
        comments.push({ s: i, e: k, line: locate(i).line, text: src.slice(i + 2, k - 2) });
        i = k;
        continue;
      }

      if (c === "`") { i = scanTemplate(i + 1); continue; }

      if (c === '"' || c === "'") {
        let k = i + 1, esc = 0;
        while (k < n && src[k] !== c && src[k] !== "\n") {
          if (src[k] === "\\") { const r = scanEscape(k); k = r[0]; if (r[1]) esc++; }
          else k++;
        }
        const end = k < n && src[k] === c ? k + 1 : k;
        push("str", i, end, { len: Math.max(0, k - i - 1), esc });
        i = end;
        continue;
      }

      if (ID_START.test(c) || (c === "\\" && src[i + 1] === "u")) {
        let k = i, value = "", escaped = false;
        while (k < n) {
          const ch = src[k];
          if (ch === "\\" && src[k + 1] === "u") {
            // \uXXXX or \u{X...} inside an identifier: decode so `eval` reads as `eval`.
            let hex, next;
            if (src[k + 2] === "{") {
              const close = src.indexOf("}", k + 3);
              if (close < 0) break;
              hex = src.slice(k + 3, close); next = close + 1;
            } else { hex = src.slice(k + 2, k + 6); next = k + 6; }
            if (!hex || ![...hex].every((h) => HEX.test(h))) break;
            value += String.fromCodePoint(parseInt(hex, 16));
            escaped = true;
            k = next;
          } else if (k === i ? ID_START.test(ch) : ID_PART.test(ch)) { value += ch; k++; }
          else break;
        }
        if (k === i) { push("punct", i, i + 1); i++; continue; }
        const tok = push("id", i, k);
        if (escaped) { tok.v = value; tok.escaped = true; }
        i = k;
        continue;
      }

      if ((code >= 48 && code <= 57) || (c === "." && /\d/.test(src[i + 1] || ""))) {
        NUMBER.lastIndex = i;
        const m = NUMBER.exec(src);
        const end = m && m[0].length ? i + m[0].length : i + 1;
        push("num", i, end);
        i = end;
        continue;
      }

      if (c === "/" && regexAllowed()) {
        let k = i + 1, inClass = false, ok = false;
        while (k < n && src[k] !== "\n") {
          const ch = src[k];
          if (ch === "\\") { k += 2; continue; }
          if (ch === "[") inClass = true;
          else if (ch === "]") inClass = false;
          else if (ch === "/" && !inClass) { ok = true; break; }
          k++;
        }
        if (ok) {
          k++;
          while (k < n && /[a-z]/i.test(src[k])) k++;
          push("regex", i, k);
          i = k;
          continue;
        }
      }

      if (c === "{") { braceDepth++; push("punct", i, i + 1); i++; continue; }
      if (c === "}") {
        const closesTemplate = tplStack.length && tplStack[tplStack.length - 1] === braceDepth;
        braceDepth = Math.max(0, braceDepth - 1);
        push("punct", i, i + 1);
        if (closesTemplate) { tplStack.pop(); i = scanTemplate(i + 1); }
        else i++;
        continue;
      }

      let matched = null;
      for (const p of PUNCTUATORS) if (src.startsWith(p, i)) { matched = p; break; }
      const len = matched ? matched.length : 1;
      push("punct", i, i + len);
      i += len;
    }

    return { tokens, comments, lineStarts };
  }

  /**
   * Parse the manifest header: leading `// @key value` comment lines.
   * Stops at the first line that is neither blank nor a `//` comment.
   */
  function parseManifest(source) {
    const manifest = { permissions: [], widget: [], raw: {} };
    const lines = source.split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === "") continue;
      if (!line.startsWith("//")) break;
      const m = /^\/\/\s*@([A-Za-z][\w-]*)\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      manifest.raw[key] = value;
      if (key === "permissions" || key === "widget") {
        manifest[key] = value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      } else {
        manifest[key] = value;
      }
    }
    return manifest;
  }

  function isCodeToken(tok) { return tok.t === "id" || tok.t === "punct"; }

  function matchesElement(tok, el) {
    if (!tok) return false;
    if (typeof el === "string") return isCodeToken(tok) && tok.v === el;
    if (el.anyStr) return tok.t === "str" || tok.t === "tpl";
    if (typeof el.str === "string") {
      if (tok.t !== "str") return false;
      return tok.v.slice(1, -1) === el.str;
    }
    return false;
  }

  function computeMetrics(source, tokens, comments) {
    // Line lengths are measured on code only, so a long comment or URL in a
    // comment does not look like minified code.
    // String contents are excluded too: long literals have their own rules.
    const chars = source.split("");
    for (const c of comments) for (let k = c.s; k < c.e; k++) if (chars[k] !== "\n") chars[k] = "";
    for (const t of tokens) {
      if (t.t !== "str" && t.t !== "tpl") continue;
      for (let k = t.s + 1; k < t.e - 1; k++) if (chars[k] !== "\n") chars[k] = "";
    }
    const codeLines = chars.join("").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    let maxLine = 0, totalLine = 0;
    for (const l of codeLines) { if (l.length > maxLine) maxLine = l.length; totalLine += l.length; }

    let maxString = 0, escapeCount = 0, stringChars = 0, longestBase64 = 0, hexIds = 0, escapedIds = 0;
    for (const tok of tokens) {
      if (tok.t === "str" || tok.t === "tpl") {
        if (tok.len > maxString) maxString = tok.len;
        escapeCount += tok.esc;
        stringChars += tok.len;
        const body = tok.t === "str" ? tok.v.slice(1, -1) : tok.v;
        if (body.length > longestBase64 && /^[A-Za-z0-9+/=_-]+$/.test(body) && !/^[a-z]+$/i.test(body)) longestBase64 = body.length;
      } else if (tok.t === "id") {
        if (/^_0x[0-9a-f]+$/i.test(tok.v)) hexIds++;
        if (tok.escaped) escapedIds++;
      }
    }
    return {
      sourceBytes: source.length,
      lineCount: source.split("\n").length,
      maxCodeLineLength: maxLine,
      avgCodeLineLength: codeLines.length ? Math.round(totalLine / codeLines.length) : 0,
      maxStringLiteralLength: maxString,
      longestBase64Literal: longestBase64,
      escapeCount,
      // Each \xHH / \uHHHH escape spends roughly 5 source characters.
      escapeRatio: stringChars ? Math.min(1, Math.round(((escapeCount * 5) / stringChars) * 100) / 100) : 0,
      hexIdentifierCount: hexIds,
      escapedIdentifierCount: escapedIds,
    };
  }

  /**
   * Analyze a script.
   * @param source  script text
   * @param rules   parsed rules.json
   * @param options { declaredPermissions?: string[] }  overrides the header (gallery meta.json)
   * @returns { ok, findings[], metrics, manifest, declaredPermissions[], usedPermissions[] }
   *   finding: { ruleId, severity: "hard"|"soft", message, line, column }
   */
  function analyze(source, rules, options) {
    options = options || {};
    const { tokens, comments } = tokenize(source);
    const manifest = parseManifest(source);
    const metrics = computeMetrics(source, tokens, comments);
    const findings = [];
    const add = (rule, message, tok) => findings.push({
      ruleId: rule.id,
      severity: rule.severity,
      message,
      line: tok ? tok.line : 0,
      column: tok ? tok.col : 0,
    });

    const knownPermissions = Object.keys(rules.permissions || {});
    const declared = (options.declaredPermissions || manifest.permissions).map((p) => String(p).toLowerCase());
    const used = new Map(); // permission -> first token

    for (const api of rules.apis || []) {
      for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok.t !== "id" || tok.v !== api.global) continue;
        const before = tokens[i - 1];
        if (before && before.t === "punct" && (before.v === "." || before.v === "?.")) {
          // `globalThis.fetch` still counts; `response.fetch` does not.
          const owner = tokens[i - 2];
          if (!owner || !["globalThis", "window", "self"].includes(owner.v)) continue;
        }
        if (!used.has(api.permission)) used.set(api.permission, tok);
      }
    }

    for (const rule of rules.rules || []) {
      if (rule.kind === "sequence") {
        const seq = rule.tokens;
        for (let i = 0; i + seq.length <= tokens.length; i++) {
          let ok = true;
          for (let j = 0; j < seq.length && ok; j++) ok = matchesElement(tokens[i + j], seq[j]);
          if (!ok) continue;
          const before = tokens[i - 1];
          if (rule.notAfter && before && isCodeToken(before) && rule.notAfter.includes(before.v)) {
            // `obj.eval(...)` is someone's own method; `globalThis.eval(...)` is still eval.
            const owner = tokens[i - 2];
            const onGlobal = (before.v === "." || before.v === "?.") && owner && ["globalThis", "window", "self"].includes(owner.v);
            if (!onGlobal) continue;
          }
          add(rule, rule.message, tokens[i]);
        }
      } else if (rule.kind === "identifier") {
        const re = new RegExp(rule.pattern);
        const seen = new Set();
        for (const tok of tokens) {
          if (tok.t === "id" && re.test(tok.v) && !seen.has(tok.v)) { seen.add(tok.v); add(rule, rule.message + " (" + tok.v + ")", tok); }
        }
      } else if (rule.kind === "metric") {
        const conds = rule.when || [];
        const hit = conds.length > 0 && conds.every((c) => {
          const v = metrics[c.metric];
          if (typeof v !== "number") return false;
          if (typeof c.gt === "number") return v > c.gt;
          if (typeof c.lt === "number") return v < c.lt;
          return false;
        });
        if (hit) add(rule, rule.message.replace("{value}", String(metrics[conds[0].metric])), null);
      } else if (rule.kind === "permissions") {
        for (const p of declared) {
          if (!knownPermissions.includes(p)) {
            findings.push({ ruleId: "unknown-permission", severity: "hard", message: "Unknown permission \"" + p + "\". Known permissions: " + knownPermissions.join(", ") + ".", line: 1, column: 1 });
          }
        }
        for (const [permission, tok] of used) {
          if (!declared.includes(permission)) {
            add(rule, "Uses " + tok.v + " but does not declare the \"" + permission + "\" permission. Add it to the // @permissions line.", tok);
          }
        }
        for (const p of declared) {
          if (knownPermissions.includes(p) && !used.has(p)) {
            findings.push({ ruleId: "unused-permission", severity: "soft", message: "Declares the \"" + p + "\" permission but never uses it.", line: 1, column: 1 });
          }
        }
      }
    }

    // A hard metric rule and its soft sibling can both fire; keep the hard one.
    const hardRuleFamilies = new Set(findings.filter((f) => f.severity === "hard").map((f) => f.ruleId));
    const filtered = findings.filter((f) => !(
      (f.ruleId === "long-string-literal" && hardRuleFamilies.has("huge-string-literal")) ||
      (f.ruleId === "some-escapes" && hardRuleFamilies.has("heavy-escapes")) ||
      (f.ruleId === "dense-code" && hardRuleFamilies.has("minified-line"))
    ));
    filtered.sort((a, b) => (a.severity === b.severity ? a.line - b.line : a.severity === "hard" ? -1 : 1));

    return {
      ok: !filtered.some((f) => f.severity === "hard"),
      findings: filtered,
      metrics,
      manifest,
      declaredPermissions: declared,
      usedPermissions: [...used.keys()],
    };
  }

  const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

  /** Returns the filter words found in `text` (empty array means clean). */
  function checkText(text, rules) {
    const words = new Set(((rules.textFilter || {}).words || []).map((w) => w.toLowerCase()));
    const folded = String(text || "").toLowerCase().replace(/[013457@$!]/g, (c) => LEET[c] || c);
    const hits = new Set();
    for (const candidate of [String(text || "").toLowerCase(), folded]) {
      for (const word of candidate.split(/[^a-z]+/)) if (words.has(word)) hits.add(word);
    }
    return [...hits];
  }

  return { tokenize, parseManifest, analyze, checkText };
});
