"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var chart_codegen_exports = {};
__export(chart_codegen_exports, {
  generateChartCode: () => generateChartCode
});
module.exports = __toCommonJS(chart_codegen_exports);
var import_chart_helpers = require("./chart-helpers");
var import_chart_model = require("./chart-model");
var import_chart_structure = require("./chart-structure");
const INDENT = "    ";
function indent(text, level) {
  const prefix = INDENT.repeat(level);
  return text.split("\n").map((line) => line.trim() ? prefix + line : "").join("\n");
}
function oneLine(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}
function commentLines(text, prefix = "", indentation = "") {
  if (!text?.trim()) {
    return [];
  }
  return text.trim().split("\n").map((line, i) => `${indentation}// ${i ? " ".repeat(prefix.length) : prefix}${line.trimEnd()}`.trimEnd());
}
function identifier(id) {
  const name = id.replace(/[^\w$]/g, "_");
  return /^\d/.test(name) ? `_${name}` : name;
}
function propertyKey(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}
function dedent(code) {
  const lines = code.replace(/\s+$/, "").replace(/^\s*\n/, "").split("\n");
  const common = Math.min(...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)?.[0].length ?? 0));
  return lines.map((l) => l.substring(Number.isFinite(common) ? common : 0)).join("\n");
}
function actionFunction(code, level) {
  if (!code?.trim()) {
    return null;
  }
  return `() => {
${indent(dedent(code), level + 1)}
${INDENT.repeat(level)}}`;
}
function generateChartCode(chart, chartId) {
  const structure = new import_chart_structure.ChartStructure(chart);
  const stateName = (id) => structure.statesById.get(id)?.name ?? id;
  const parse = (transition) => {
    if (!structure.statesById.has(transition.target)) {
      return { error: "unknown target" };
    }
    try {
      return { label: (0, import_chart_model.parseTransitionLabel)(transition.label) };
    } catch (err) {
      return { error: err.message };
    }
  };
  const describe = (transition) => `${stateName(transition.source)} -> ${stateName(transition.target)}${transition.label?.trim() ? `: ${oneLine(transition.label)}` : ""}`;
  const lines = [
    `// Code generated from the chart "${oneLine(chart.name)}" by the statechart adapter.`,
    "// It shows how the adapter executes the chart. It is not executed itself, changes here have no effect.",
    "",
    ...chart.comment?.trim() ? [...commentLines(chart.comment), ""] : [],
    ...(chart.notes || []).flatMap((note) => [...commentLines(note.text, "Note: "), ""]),
    'const { createActor, createMachine } = require("xstate");',
    ""
  ];
  lines.push("// ---------- Variables ----------", "");
  const outputs = chart.symbols.filter((s) => s.scope === "output" && s.stateId);
  if (!chart.symbols.length) {
    lines.push("// no variables");
  }
  for (const symbol of chart.symbols) {
    if (symbol.scope === "local") {
      lines.push(`let ${symbol.name} = ${JSON.stringify(symbol.initial) ?? "undefined"}; // local`);
    } else if (!symbol.stateId) {
      lines.push(`let ${symbol.name}; // ${symbol.scope} without state`);
    } else if (symbol.scope === "input") {
      const trigger = [
        symbol.trigger === "change" ? "on value changes" : "on every update",
        symbol.ack === "ack" ? "only confirmed values (ack = true)" : "",
        symbol.ack === "command" ? "only commands (ack = false)" : "",
        symbol.debounceMs ? `after ${symbol.debounceMs} ms without updates` : ""
      ].filter(Boolean).join(", ");
      lines.push(
        `let ${symbol.name} = getState(${JSON.stringify(symbol.stateId)})?.val; // input, wakes up the chart ${trigger}`
      );
    } else {
      lines.push(
        `let ${symbol.name} = getState(${JSON.stringify(symbol.stateId)})?.val; // output, see writeChangedOutputs()`
      );
    }
  }
  if (outputs.length) {
    lines.push("", "// the last written value of each output");
    lines.push(`const written = { ${outputs.map((s) => s.name).join(", ")} };`);
  }
  lines.push("");
  for (const fn of chart.functions || []) {
    if (fn.code.trim()) {
      lines.push("// ---------- Function block ----------", "", ...commentLines(fn.comment), dedent(fn.code), "");
    }
  }
  lines.push(
    "// ---------- State machine ----------",
    "",
    "// The transitions are selected by the process functions below (Stateflow order),",
    "// XState only executes them: exit actions, transition action, entry actions.",
    "const machine = createMachine({",
    `${INDENT}id: ${JSON.stringify(`chart_${chartId}`)},`
  );
  const transitionConfig = (transition, kind, label, level) => {
    const parts = [`target: ${JSON.stringify(`#${transition.target}`)}`];
    if (kind.reenter) {
      parts.push("reenter: true");
    }
    const action = actionFunction(label.action, level);
    if (action) {
      parts.push(`actions: ${action}`);
    }
    return `{ ${parts.join(", ")} }`;
  };
  const buildState = (state, level) => {
    const i1 = INDENT.repeat(level);
    const i2 = INDENT.repeat(level + 1);
    const i3 = INDENT.repeat(level + 2);
    lines.push(
      `${i1}// ${oneLine(state.name)}`,
      ...commentLines(state.comment, "", i1),
      `${i1}${propertyKey(state.id)}: {`
    );
    lines.push(`${i2}id: ${JSON.stringify(state.id)},`);
    for (const field of ["entry", "exit"]) {
      const action = actionFunction(state[field], level + 1);
      if (action) {
        lines.push(`${i2}${field}: ${action},`);
      }
    }
    const on = [];
    for (const transition of structure.getTransitions(state.id)) {
      const parsed = parse(transition);
      if ("error" in parsed) {
        on.push(`${i3}// ${describe(transition)}: ignored, ${parsed.error}`);
        continue;
      }
      const config = transitionConfig(
        transition,
        structure.getTransitionKind(transition),
        parsed.label,
        level + 2
      );
      on.push(
        `${i3}// ${describe(transition)}`,
        ...commentLines(transition.comment, "", i3),
        `${i3}${JSON.stringify(`T.${transition.id}`)}: ${config},`
      );
    }
    if (on.length) {
      lines.push(`${i2}on: {`, ...on, `${i2}},`);
    }
    const children = structure.getChildren(state.id);
    if (children.length) {
      lines.push(
        structure.isParallel(state.id) ? `${i2}type: "parallel", // all sub states are active, entered in their execution order` : `${i2}initial: ${JSON.stringify(structure.getInitialChild(state.id))},`,
        `${i2}states: {`
      );
      for (const child of children) {
        buildState(child, level + 2);
      }
      lines.push(`${i2}},`);
    }
    lines.push(`${i1}},`);
  };
  const topLevel = structure.getChildren(null);
  if (topLevel.length) {
    lines.push(
      structure.isParallel(null) ? `${INDENT}type: "parallel", // all top level states are active, entered in their execution order` : `${INDENT}initial: ${JSON.stringify(structure.getInitialChild(null))},`,
      `${INDENT}states: {`
    );
    for (const state of topLevel) {
      buildState(state, 2);
    }
    lines.push(`${INDENT}},`);
  }
  lines.push(
    "});",
    "",
    "const actor = createActor(machine);",
    "actor.start();",
    "// once right after the start, so transitions without event are taken without waiting for an input",
    "wakeup(null);",
    ""
  );
  const callActive = (states, level, prefix) => states.map(
    (s) => `${INDENT.repeat(level)}if (isActive(${JSON.stringify(s.id)})) {
${INDENT.repeat(level + 1)}${prefix}process_${identifier(s.id)}(input);
${INDENT.repeat(level)}}`
  );
  const processChildren = (parent, children) => {
    if (!structure.isParallel(parent)) {
      return [...callActive(children, 1, "return "), `${INDENT}return false;`];
    }
    const lines2 = [
      `${INDENT}// all sub states are active (parallel), they are processed in their execution order.`,
      `${INDENT}// A transition in one of them does not stop the others, unless it left this state.`,
      ...parent ? [`${INDENT}const entries = entryCount(${JSON.stringify(parent)});`] : [],
      `${INDENT}let taken = false;`
    ];
    children.forEach((child, i) => {
      if (i && parent) {
        lines2.push(
          `${INDENT}if (!isActive(${JSON.stringify(parent)}) || entryCount(${JSON.stringify(parent)}) !== entries) {`,
          `${INDENT}${INDENT}return true; // left (and maybe entered again) by the transition`,
          `${INDENT}}`
        );
      }
      lines2.push(`${INDENT}taken = process_${identifier(child.id)}(input) || taken;`);
    });
    lines2.push(`${INDENT}return taken;`);
    return lines2;
  };
  lines.push(
    "// ---------- Wakeup ----------",
    "",
    "/**",
    " * Called once for every change of an input, after its variable got the new value,",
    " * when the time of an after(...) of an active state has come, and once after the start",
    " * (input is null for the last two).",
    " * Starting with the outermost active state, each active state is processed, see process_...().",
    " *",
    " * @param {string | null} input name of the changed input",
    " */",
    "function wakeup(input) {",
    ...chart.superStep ? [
      `${INDENT}// super step: take transitions until none is valid anymore, at most ${import_chart_model.MAX_SUPER_STEPS}.`,
      `${INDENT}// The event of the input is only present in the first step.`,
      `${INDENT}for (let steps = 0; steps < ${import_chart_model.MAX_SUPER_STEPS} && step(input); steps++) {`,
      `${INDENT}${INDENT}input = null;`,
      `${INDENT}}`
    ] : [`${INDENT}step(input);`],
    `${INDENT}writeChangedOutputs();`,
    "}",
    "",
    "/**",
    " * Processes the active states once",
    " *",
    " * @param {string | null} input name of the changed input, null if the step has no event",
    " * @returns {boolean} true if a transition was taken",
    " */",
    "function step(input) {",
    ...processChildren(null, topLevel),
    "}",
    ""
  );
  const temporalCheck = (transition, temporal) => {
    const id = JSON.stringify(transition.id);
    const source = JSON.stringify(transition.source);
    if (temporal.event !== void 0) {
      const event = JSON.stringify(temporal.event);
      const count = `inputCount(${source}, ${event})`;
      const checks = {
        after: `${count} >= ${temporal.count}`,
        before: `${count} < ${temporal.count}`,
        at: `${count} === ${temporal.count}`,
        every: `${count} % ${temporal.count} === 0`
      };
      return `input === ${event} && ${checks[temporal.operator]}`;
    }
    if (temporal.condition !== void 0) {
      return `trueFor(${id}) >= ${temporal.ms}`;
    }
    switch (temporal.operator) {
      case "after":
        return `timeInState(${source}) >= ${temporal.ms}`;
      case "before":
        return `timeInState(${source}) < ${temporal.ms}`;
      default:
        return `timerFired(${id})`;
    }
  };
  const check = (transition, label) => {
    const conditions = [];
    if (label.event) {
      conditions.push(`input === ${JSON.stringify(label.event)}`);
    }
    if (label.temporal) {
      conditions.push(temporalCheck(transition, label.temporal));
    }
    if (label.condition) {
      conditions.push(`(${label.condition})`);
    }
    return [
      `${INDENT}// ${describe(transition)}`,
      ...commentLines(transition.comment, "", INDENT),
      `${INDENT}if (${conditions.join(" && ") || "true"}) {`,
      `${INDENT}${INDENT}actor.send({ type: ${JSON.stringify(`T.${transition.id}`)} });`,
      `${INDENT}${INDENT}return true;`,
      `${INDENT}}`
    ];
  };
  for (const state of chart.states) {
    const outer = [];
    const inner = [];
    for (const transition of structure.getTransitions(state.id)) {
      const parsed = parse(transition);
      if ("error" in parsed) {
        continue;
      }
      (structure.getTransitionKind(transition).inner ? inner : outer).push(...check(transition, parsed.label));
    }
    const children = structure.getChildren(state.id);
    lines.push(
      "/**",
      ` * ${oneLine(state.name)}`,
      ...state.comment?.trim() ? [
        " *",
        // "*/" would end the comment
        ...state.comment.trim().split("\n").map((line) => ` * ${line.trimEnd().replace(/\*\//g, "* /")}`.trimEnd())
      ] : [],
      " *",
      " * @param {string | null} input name of the changed input, null for timers",
      " * @returns {boolean} true if a transition was taken",
      " */",
      `function process_${identifier(state.id)}(input) {`,
      `${INDENT}// 1. transitions leaving the state`,
      ...outer.length ? outer : [`${INDENT}// none`],
      `${INDENT}// 2. during action`,
      state.during?.trim() ? `${INDENT}{
${indent(dedent(state.during), 2)}
${INDENT}}` : `${INDENT}// none`,
      `${INDENT}// 3. inner transitions (to own sub states, the state stays active)`,
      ...inner.length ? inner : [`${INDENT}// none`],
      `${INDENT}// 4. ${structure.isParallel(state.id) && children.length ? "all sub states" : "active sub state"}`,
      ...children.length ? processChildren(state.id, children) : [`${INDENT}// none`, `${INDENT}return false;`],
      "}",
      ""
    );
  }
  lines.push(
    "// ---------- Helpers ----------",
    "",
    "/** Writes every output whose value was changed by an action */",
    "function writeChangedOutputs() {",
    ...outputs.map(
      (s) => `${INDENT}if (${s.name} !== written.${s.name}) {
${INDENT}${INDENT}written.${s.name} = ${s.name};
${INDENT}${INDENT}setState(${JSON.stringify(s.stateId)}, ${s.name});
${INDENT}}`
    ),
    "}",
    "",
    "// Provided by the adapter:",
    "// isActive(stateId)   true if the state of the chart is active",
    "// entryCount(stateId) how often the state was entered",
    "// timeInState(stateId) milliseconds since the state was entered; when it reaches the delay of an",
    "//                     after(n, unit) or at(n, unit) of the state, a timer calls wakeup(null)",
    '// timerFired(id)      true in the wakeup(null) of the timer of at(n, unit), every(n, unit) or at("sunset")',
    '//                     of the transition; at("sunset", offset) and at("22:30") have a timer for every day',
    "// inputCount(stateId, input)",
    "//                     the wakeups by the input since the state was entered, for e.g. after(3, button)",
    "// trueFor(id)         milliseconds the condition of after(n, unit, condition) of the transition has been true,",
    "//                     checked at the start and at the end of every wakeup; a timer calls wakeup(null) when",
    "//                     it reaches the delay",
    "// At the start of each wakeup, the adapter stores the values of the variables used in hasChanged(),",
    "// hasChangedFrom() and hasChangedTo(), these compare them with the values of the previous wakeup.",
    "//",
    "// Helper functions for conditions, actions and function blocks:",
    ...Object.values(import_chart_helpers.HELPERS).map((helper) => `// ${helper.signature}
//     ${helper.description}`),
    "//",
    "// The adapter stores the active states, the times they were entered and the locals in the state",
    "// charts.<chart>.snapshot. After a restart of the adapter it continues with them, without executing the",
    "// entry actions again, if the chart was not changed meanwhile. Then it wakes up once, like after a start.",
    ""
  );
  return lines.join("\n");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  generateChartCode
});
//# sourceMappingURL=chart-codegen.js.map
