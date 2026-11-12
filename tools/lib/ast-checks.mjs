/*
 * AST checks that a token scan cannot do reliably.
 *
 * Pure module (no imports) so it can be unit-tested anywhere. Input is an
 * ESTree AST as produced by acorn with `locations: true`.
 *
 * Rule ids match rules.json where a token rule covers the same thing, so the
 * caller can dedupe by (ruleId, line).
 */

const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self"]);

export const DEFAULT_MESSAGES = {
  "no-eval": "eval() is not allowed. Scripts must not build code from strings.",
  "no-eval-reference": "Indirect eval, such as (0, eval)(...), is not allowed.",
  "no-new-function": "new Function(...) is not allowed. Scripts must not build code from strings.",
  "no-function-call": "Function(...) is not allowed. Scripts must not build code from strings.",
  "no-dynamic-import": "Dynamic import() is not allowed. Scripts are single files.",
  "no-modules": "import/export are not supported. A script is a single classic script file.",
};

const SKIP_KEYS = new Set(["loc", "range", "start", "end", "type"]);

/** Visit every node. Iterative, so a deeply nested AST cannot overflow the stack. */
export function walk(root, visit) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node.type !== "string") continue;
    visit(node);
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) {
          if (value[i] && typeof value[i].type === "string") stack.push(value[i]);
        }
      } else if (value && typeof value.type === "string") {
        stack.push(value);
      }
    }
  }
}

function unwrap(node) {
  while (node && (node.type === "ParenthesizedExpression" || node.type === "ChainExpression")) {
    node = node.expression;
  }
  return node;
}

/** "eval" | "Function" | "indirect-eval" | null for the thing being called. */
function calleeKind(rawCallee) {
  const callee = unwrap(rawCallee);
  if (!callee) return null;
  if (callee.type === "Identifier") {
    return callee.name === "eval" || callee.name === "Function" ? callee.name : null;
  }
  if (callee.type === "SequenceExpression") {
    const last = unwrap(callee.expressions[callee.expressions.length - 1]);
    return last && last.type === "Identifier" && last.name === "eval" ? "indirect-eval" : null;
  }
  if (callee.type === "MemberExpression" && !callee.computed) {
    const object = unwrap(callee.object);
    const property = callee.property;
    if (
      object && object.type === "Identifier" && GLOBAL_OBJECTS.has(object.name) &&
      property && property.type === "Identifier" &&
      (property.name === "eval" || property.name === "Function")
    ) {
      return property.name; // globalThis.eval(...), window.Function(...)
    }
  }
  return null;
}

/**
 * @param ast       ESTree Program
 * @param messages  optional { ruleId: message } overrides (from rules.json)
 * @returns findings: { ruleId, severity: "hard", message, line, column }
 */
export function astFindings(ast, messages = {}) {
  const findings = [];
  const seen = new Set();
  const add = (ruleId, node) => {
    const line = node.loc ? node.loc.start.line : 0;
    const column = node.loc ? node.loc.start.column + 1 : 0;
    const key = ruleId + ":" + line;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      ruleId,
      severity: "hard",
      message: messages[ruleId] || DEFAULT_MESSAGES[ruleId] || ruleId,
      line,
      column,
    });
  };

  walk(ast, (node) => {
    switch (node.type) {
      case "CallExpression": {
        const kind = calleeKind(node.callee);
        if (kind === "eval") add("no-eval", node);
        else if (kind === "indirect-eval") add("no-eval-reference", node);
        else if (kind === "Function") add("no-function-call", node);
        break;
      }
      case "NewExpression":
        if (calleeKind(node.callee) === "Function") add("no-new-function", node);
        break;
      case "ImportExpression":
        add("no-dynamic-import", node);
        break;
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
      case "ExportAllDeclaration":
        add("no-modules", node);
        break;
      case "MetaProperty":
        if (node.meta && node.meta.name === "import") add("no-modules", node);
        break;
      default:
        break;
    }
  });

  findings.sort((a, b) => a.line - b.line);
  return findings;
}
