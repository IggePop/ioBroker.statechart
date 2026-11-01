"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var chart_validation_exports = {};
__export(chart_validation_exports, {
  GLOBALS: () => GLOBALS,
  getDeclarations: () => getDeclarations,
  getFunctionNames: () => getFunctionNames,
  quoteChangeArguments: () => quoteChangeArguments,
  validateChart: () => validateChart,
  validateCode: () => validateCode,
  validateTransitionLabel: () => validateTransitionLabel
});
module.exports = __toCommonJS(chart_validation_exports);
var acorn = __toESM(require("acorn"));
var walk = __toESM(require("acorn-walk"));
var import_chart_helpers = require("./chart-helpers");
var import_chart_model = require("./chart-model");
const GLOBALS = /* @__PURE__ */ new Set([
  // the helper functions, e.g. log() and setState()
  ...Object.keys(import_chart_helpers.HELPERS),
  "undefined",
  "NaN",
  "Infinity",
  "Math",
  "Date",
  "JSON",
  "Number",
  "String",
  "Boolean",
  "Array",
  "Object",
  "RegExp",
  "Map",
  "Set",
  "Error",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "decodeURIComponent"
]);
const STATE_ACTIONS = ["entry", "during", "exit"];
function createDiagnostic(from, to, severity, key, args = []) {
  return { from, to, severity, key, args, message: (0, import_chart_model.formatMessage)(key, args) };
}
function parseCode(code, kind) {
  try {
    if (kind === "statements") {
      return { ast: acorn.parse(code, { ecmaVersion: "latest", sourceType: "script" }) };
    }
    const ast = acorn.parseExpressionAt(code, 0, { ecmaVersion: "latest" });
    const rest = code.substring(ast.end);
    if (rest.trim()) {
      const from = ast.end + rest.length - rest.trimStart().length;
      return { diagnostic: createDiagnostic(from, code.length, "error", 'Unexpected "%s"', [rest.trim()]) };
    }
    return { ast };
  } catch (err) {
    const pos = typeof err.pos === "number" ? Math.min(err.pos, code.length) : 0;
    const message = String(err.message).replace(/\s*\(\d+:\d+\)$/, "");
    const from = pos < code.length ? pos : Math.max(0, code.length - 1);
    const token = /^(\w+|\S)/.exec(code.substring(from));
    const to = Math.min(code.length, from + (token ? token[0].length : 1));
    return { diagnostic: createDiagnostic(from, to, "error", "Syntax error: %s", [message]) };
  }
}
function validateCode(code, kind, symbols, offset = 0, functionNames = []) {
  if (!code?.trim()) {
    return [];
  }
  const parsed = parseCode(code, kind);
  if ("diagnostic" in parsed) {
    const d = parsed.diagnostic;
    return [{ ...d, from: d.from + offset, to: d.to + offset }];
  }
  const declared = /* @__PURE__ */ new Set();
  const references = [];
  walk.fullAncestor(parsed.ast, (node, _state, ancestors, type) => {
    if (node.type !== "Identifier") {
      return;
    }
    const parent = ancestors[ancestors.length - 2];
    if (type === "VariablePattern") {
      if (parent?.type === "AssignmentExpression" && parent.left === node) {
        references.push({ node, write: true });
      } else {
        declared.add(node.name);
      }
    } else {
      references.push({ node, write: parent?.type === "UpdateExpression" });
    }
  });
  const inputs = new Set(symbols.filter((s) => s.scope === "input").map((s) => s.name));
  const symbolNames = new Set(symbols.map((s) => s.name));
  const known = /* @__PURE__ */ new Set([...symbolNames, ...functionNames]);
  const diagnostics = [];
  walk.simple(parsed.ast, {
    CallExpression(node) {
      if (node.callee.type !== "Identifier" || !import_chart_helpers.CHANGE_HELPERS.has(node.callee.name)) {
        return;
      }
      const arg = node.arguments[0];
      let valid;
      if (arg?.type === "Identifier") {
        valid = symbolNames.has(arg.name) || !(known.has(arg.name) || declared.has(arg.name) || GLOBALS.has(arg.name));
      } else {
        valid = arg?.type === "Literal" && typeof arg.value === "string" && symbolNames.has(arg.value);
      }
      if (!valid) {
        const { start, end } = arg ?? node;
        diagnostics.push(
          createDiagnostic(
            start + offset,
            end + offset,
            "error",
            "%s() needs a variable of the chart as first argument",
            [node.callee.name]
          )
        );
      }
    }
  });
  for (const { node, write } of references) {
    const from = node.start + offset;
    const to = node.end + offset;
    if (!known.has(node.name) && !declared.has(node.name) && !GLOBALS.has(node.name)) {
      diagnostics.push(createDiagnostic(from, to, "error", 'Unknown variable "%s"', [node.name]));
    } else if (write && inputs.has(node.name) && !declared.has(node.name)) {
      diagnostics.push(
        createDiagnostic(from, to, "warning", 'Input "%s" is overwritten on its next change', [node.name])
      );
    }
  }
  return diagnostics;
}
function validateTransitionLabel(label, symbols, functionNames = []) {
  let parsed;
  try {
    parsed = (0, import_chart_model.parseTransitionLabelWithRanges)(label);
  } catch (err) {
    if (err instanceof import_chart_model.LabelSyntaxError) {
      return [createDiagnostic(err.from, err.to, "error", err.key, err.args)];
    }
    throw err;
  }
  const { label: parts, ranges } = parsed;
  const diagnostics = [];
  if (parts.event && ranges.event && !symbols.some((s) => s.scope === "input" && s.name === parts.event)) {
    diagnostics.push(
      createDiagnostic(
        ranges.event.from,
        ranges.event.to,
        "error",
        'Unknown event "%s", use the name of an input',
        [parts.event]
      )
    );
  }
  if (parts.condition && ranges.condition) {
    diagnostics.push(...validateCode(parts.condition, "expression", symbols, ranges.condition.from, functionNames));
  }
  if (parts.action && ranges.action) {
    diagnostics.push(...validateCode(parts.action, "statements", symbols, ranges.action.from, functionNames));
  }
  return diagnostics;
}
function getDeclarations(code) {
  if (!code?.trim()) {
    return [];
  }
  const parsed = parseCode(code, "statements");
  if ("diagnostic" in parsed) {
    return [];
  }
  const signature = (fn, name) => `${name}(${fn.params.map((p) => code.substring(p.start, p.end)).join(", ")})`;
  const declarations = [];
  for (const node of parsed.ast.body) {
    if (node.type === "FunctionDeclaration" && node.id) {
      const { name, start, end } = node.id;
      declarations.push({ name, signature: signature(node, name), from: start, to: end });
    } else if (node.type === "VariableDeclaration") {
      for (const declarator of node.declarations) {
        if (declarator.id.type !== "Identifier") {
          continue;
        }
        const { name, start, end } = declarator.id;
        const init = declarator.init;
        const isFunction = init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression";
        declarations.push({ name, signature: isFunction ? signature(init, name) : null, from: start, to: end });
      }
    }
  }
  return declarations;
}
function getFunctionNames(chart) {
  return (chart.functions || []).flatMap((fn) => getDeclarations(fn.code).map((d) => d.name));
}
function quoteChangeArguments(code, kind) {
  const parsed = code.trim() ? parseCode(code, kind) : null;
  if (!parsed || "diagnostic" in parsed) {
    return { code, names: [] };
  }
  const names = /* @__PURE__ */ new Set();
  const replacements = [];
  walk.simple(parsed.ast, {
    CallExpression(node) {
      const arg = node.arguments[0];
      if (node.callee.type !== "Identifier" || !import_chart_helpers.CHANGE_HELPERS.has(node.callee.name)) {
        return;
      }
      if (arg?.type === "Identifier") {
        replacements.push(arg);
        names.add(arg.name);
      } else if (arg?.type === "Literal" && typeof arg.value === "string") {
        names.add(arg.value);
      }
    }
  });
  let result = code;
  for (const { start, end, name } of replacements.sort((a, b) => b.start - a.start)) {
    result = result.substring(0, start) + JSON.stringify(name) + result.substring(end);
  }
  return { code: result, names: [...names] };
}
function validateChart(chart) {
  const functionNames = getFunctionNames(chart);
  const problems = [];
  for (const state of chart.states) {
    for (const field of STATE_ACTIONS) {
      for (const diagnostic of validateCode(state[field], "statements", chart.symbols, 0, functionNames)) {
        problems.push({ kind: "state", id: state.id, field, diagnostic });
      }
    }
  }
  for (const transition of chart.transitions) {
    for (const diagnostic of validateTransitionLabel(transition.label, chart.symbols, functionNames)) {
      problems.push({ kind: "transition", id: transition.id, field: "label", diagnostic });
    }
  }
  const symbolNames = new Set(chart.symbols.map((s) => s.name));
  const seen = /* @__PURE__ */ new Set();
  for (const fn of chart.functions || []) {
    for (const diagnostic of validateCode(fn.code, "statements", chart.symbols, 0, functionNames)) {
      problems.push({ kind: "function", id: fn.id, field: "code", diagnostic });
    }
    for (const { name, from, to } of getDeclarations(fn.code)) {
      let key = null;
      if (seen.has(name)) {
        key = '"%s" is declared in more than one function block';
      } else if (symbolNames.has(name) || GLOBALS.has(name)) {
        key = '"%s" is already the name of a variable';
      }
      if (key) {
        problems.push({
          kind: "function",
          id: fn.id,
          field: "code",
          diagnostic: createDiagnostic(from, to, "error", key, [name])
        });
      }
      seen.add(name);
    }
  }
  return problems;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GLOBALS,
  getDeclarations,
  getFunctionNames,
  quoteChangeArguments,
  validateChart,
  validateCode,
  validateTransitionLabel
});
//# sourceMappingURL=chart-validation.js.map
