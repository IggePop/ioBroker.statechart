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
var chart_analysis_exports = {};
__export(chart_analysis_exports, {
  analyzeChart: () => analyzeChart
});
module.exports = __toCommonJS(chart_analysis_exports);
var acorn = __toESM(require("acorn"));
var walk = __toESM(require("acorn-walk"));
var import_chart_helpers = require("./chart-helpers");
var import_chart_model = require("./chart-model");
var import_chart_structure = require("./chart-structure");
function evaluateConstant(node) {
  switch (node.type) {
    case "Literal":
      return { value: node.value };
    case "Identifier":
      if (node.name === "undefined") {
        return { value: void 0 };
      }
      return node.name === "NaN" || node.name === "Infinity" ? { value: Number(node.name) } : void 0;
    case "TemplateLiteral":
      return node.expressions.length ? void 0 : { value: node.quasis[0]?.value.cooked };
    case "UnaryExpression": {
      const arg = evaluateConstant(node.argument);
      if (!arg) {
        return void 0;
      }
      const value = arg.value;
      const results = {
        "!": () => !value,
        "-": () => -value,
        "+": () => +value
      };
      return node.operator in results ? { value: results[node.operator]() } : void 0;
    }
    case "LogicalExpression": {
      const left = evaluateConstant(node.left);
      if (!left) {
        return void 0;
      }
      if (node.operator === "&&" && !left.value) {
        return left;
      }
      if (node.operator === "||" && left.value) {
        return left;
      }
      if (node.operator === "??" && left.value != null) {
        return left;
      }
      return evaluateConstant(node.right);
    }
    case "BinaryExpression": {
      const left = node.left.type === "PrivateIdentifier" ? void 0 : evaluateConstant(node.left);
      const right = left && evaluateConstant(node.right);
      if (!left || !right) {
        return void 0;
      }
      const [a, b] = [left.value, right.value];
      const results = {
        "==": () => a == b,
        "!=": () => a != b,
        "===": () => a === b,
        "!==": () => a !== b,
        "<": () => a < b,
        "<=": () => a <= b,
        ">": () => a > b,
        ">=": () => a >= b,
        "+": () => a + b,
        "-": () => a - b,
        "*": () => a * b,
        "/": () => a / b,
        "%": () => a % b
      };
      return node.operator in results ? { value: results[node.operator]() } : void 0;
    }
    case "ConditionalExpression": {
      const test = evaluateConstant(node.test);
      if (!test) {
        return void 0;
      }
      return evaluateConstant(test.value ? node.consequent : node.alternate);
    }
    default:
      return void 0;
  }
}
function evaluateCondition(code) {
  try {
    const ast = acorn.parseExpressionAt(code, 0, { ecmaVersion: "latest" });
    return code.substring(ast.end).trim() ? void 0 : evaluateConstant(ast);
  } catch {
    return void 0;
  }
}
class Usage {
  read = /* @__PURE__ */ new Set();
  written = /* @__PURE__ */ new Set();
  /**
   * Adds the variables used by a condition or action
   *
   * @param code The code, ignored if it has syntax errors
   * @param kind Condition (expression) or action (statements)
   */
  add(code, kind) {
    if (!code?.trim()) {
      return;
    }
    let ast;
    try {
      ast = kind === "statements" ? acorn.parse(code, { ecmaVersion: "latest", sourceType: "script" }) : acorn.parseExpressionAt(code, 0, { ecmaVersion: "latest" });
    } catch {
      return;
    }
    const declared = /* @__PURE__ */ new Set();
    const references = [];
    walk.fullAncestor(ast, (node, _state, ancestors, type) => {
      if (node.type !== "Identifier") {
        return;
      }
      const parent = ancestors[ancestors.length - 2];
      if (type === "VariablePattern") {
        if (parent?.type === "AssignmentExpression" && parent.left === node) {
          references.push({ name: node.name, write: true });
        } else {
          declared.add(node.name);
        }
      } else {
        references.push({ name: node.name, write: parent?.type === "UpdateExpression" });
      }
    });
    walk.simple(ast, {
      CallExpression: (node) => {
        const arg = node.arguments[0];
        if (node.callee.type === "Identifier" && import_chart_helpers.CHANGE_HELPERS.has(node.callee.name) && arg?.type === "Literal" && typeof arg.value === "string") {
          this.read.add(arg.value);
        }
      }
    });
    for (const { name, write } of references) {
      if (!declared.has(name)) {
        (write ? this.written : this.read).add(name);
      }
    }
  }
}
function analyzeChart(chart) {
  const structure = new import_chart_structure.ChartStructure(chart);
  const findings = [];
  const add = (kind, id, severity, key, args = []) => {
    findings.push({ kind, id, severity, key, args });
  };
  const stateName = (id) => structure.statesById.get(id)?.name ?? id;
  const usage = new Usage();
  const validBySource = /* @__PURE__ */ new Map();
  for (const state of chart.states) {
    for (const transition of structure.getTransitions(state.id)) {
      let label;
      try {
        label = (0, import_chart_model.parseTransitionLabel)(transition.label);
      } catch {
        continue;
      }
      usage.add(label.condition, "expression");
      usage.add(label.temporal?.condition, "expression");
      usage.add(label.action, "statements");
      for (const event of [label.event, label.temporal?.event]) {
        if (event) {
          usage.read.add(event);
        }
      }
      if (!structure.statesById.has(transition.target) || structure.getCrossedParallel(transition) !== void 0) {
        continue;
      }
      const condition = label.condition ? evaluateCondition(label.condition) : { value: true };
      const temporalCondition = label.temporal?.condition && evaluateCondition(label.temporal.condition);
      if (condition && !condition.value) {
        add(
          "transition",
          transition.id,
          "warning",
          "The condition is never true, the transition is never taken"
        );
        continue;
      }
      if (temporalCondition && !temporalCondition.value) {
        add(
          "transition",
          transition.id,
          "warning",
          "The condition is never true, the transition is never taken"
        );
        continue;
      }
      if (label.condition && condition) {
        add("transition", transition.id, "info", "The condition is always true");
      }
      const valid = { transition, label, alwaysTrue: !!condition };
      validBySource.set(state.id, [...validBySource.get(state.id) || [], valid]);
    }
  }
  findUnreachable(structure, validBySource, add);
  findShadowed(structure, validBySource, add, stateName);
  for (const state of chart.states) {
    if (structure.getChildren(state.id).length || state.during?.trim()) {
      continue;
    }
    if (structure.getPath(state.id).every((id) => !validBySource.get(id)?.length)) {
      add(
        "state",
        state.id,
        "info",
        "The chart stays in this state: neither it nor a state containing it has an outgoing transition"
      );
    }
  }
  for (const state of chart.states) {
    usage.add(state.entry, "statements");
    usage.add(state.during, "statements");
    usage.add(state.exit, "statements");
  }
  for (const fn of chart.functions || []) {
    usage.add(fn.code, "statements");
  }
  for (const symbol of chart.symbols) {
    const { read, written } = { read: usage.read.has(symbol.name), written: usage.written.has(symbol.name) };
    if (symbol.scope === "input" && !read && !written) {
      add("symbol", symbol.name, "info", "The input is not used, it only wakes up the chart");
    } else if (symbol.scope === "output" && !written) {
      add("symbol", symbol.name, "warning", "The output is never written");
    } else if (symbol.scope === "local" && !read) {
      add(
        "symbol",
        symbol.name,
        "info",
        written ? "The variable is written but never read" : "The variable is not used"
      );
    }
  }
  return findings;
}
function findUnreachable(structure, validBySource, add) {
  const reachable = /* @__PURE__ */ new Set();
  const enterDefault = (id) => {
    if (reachable.has(id)) {
      return;
    }
    reachable.add(id);
    const children = structure.getChildren(id);
    const initial2 = structure.getInitialChild(id);
    for (const child of structure.isParallel(id) ? children : children.filter((c) => c.id === initial2)) {
      enterDefault(child.id);
    }
  };
  const enter = (target) => {
    for (const id of structure.getPath(target)) {
      reachable.add(id);
      const parent = structure.statesById.get(id)?.parent || null;
      if (structure.isParallel(parent)) {
        for (const sibling of structure.getChildren(parent)) {
          if (sibling.id !== id) {
            enterDefault(sibling.id);
          }
        }
      }
    }
    reachable.delete(target);
    enterDefault(target);
  };
  const topLevel = structure.getChildren(null);
  const initial = structure.getInitialChild(null);
  for (const state of structure.isParallel(null) ? topLevel : topLevel.filter((s) => s.id === initial)) {
    enterDefault(state.id);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const [source, transitions] of validBySource) {
      if (!reachable.has(source)) {
        continue;
      }
      for (const { transition } of transitions) {
        const before = reachable.size;
        enter(transition.target);
        changed ||= reachable.size !== before;
      }
    }
  }
  for (const state of structure.chart.states) {
    const parent = state.parent && structure.statesById.has(state.parent) ? state.parent : null;
    if (!reachable.has(state.id) && (!parent || reachable.has(parent))) {
      add("state", state.id, "warning", "The state never becomes active: no transition leads to it");
    }
  }
}
function findShadowed(structure, validBySource, add, stateName) {
  for (const transitions of validBySource.values()) {
    let always;
    const byEvent = /* @__PURE__ */ new Map();
    const byTrigger = /* @__PURE__ */ new Map();
    const outer = transitions.filter((t) => !structure.getTransitionKind(t.transition).inner);
    const inner = transitions.filter((t) => structure.getTransitionKind(t.transition).inner);
    for (const { transition, label, alwaysTrue } of [...outer, ...inner]) {
      const trigger = JSON.stringify([label.event, label.temporal, label.condition?.replace(/\s+/g, "")]);
      const before = always ?? (label.event ? byEvent.get(label.event) : void 0);
      if (before) {
        add(
          "transition",
          transition.id,
          "warning",
          'Never taken: the transition to "%s" before it is always valid',
          [stateName(before.target)]
        );
        continue;
      }
      const same = byTrigger.get(trigger);
      if (same) {
        add(
          "transition",
          transition.id,
          "warning",
          'Never taken: the transition to "%s" before it has the same event and condition',
          [stateName(same.target)]
        );
        continue;
      }
      byTrigger.set(trigger, transition);
      if (alwaysTrue && !label.temporal) {
        if (label.event) {
          byEvent.set(label.event, transition);
        } else {
          always = transition;
        }
      }
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  analyzeChart
});
//# sourceMappingURL=chart-analysis.js.map
