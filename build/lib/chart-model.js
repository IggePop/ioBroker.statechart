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
var chart_model_exports = {};
__export(chart_model_exports, {
  ASTRO_EVENTS: () => ASTRO_EVENTS,
  CHART_MODEL_VERSION: () => CHART_MODEL_VERSION,
  EXPORT_FORMAT: () => EXPORT_FORMAT,
  LabelSyntaxError: () => LabelSyntaxError,
  MAX_SUPER_STEPS: () => MAX_SUPER_STEPS,
  TEMPORAL_OPERATORS: () => TEMPORAL_OPERATORS,
  TIME_OF_DAY: () => TIME_OF_DAY,
  TIME_UNITS: () => TIME_UNITS,
  createChart: () => createChart,
  createExport: () => createExport,
  formatMessage: () => formatMessage,
  nameToId: () => nameToId,
  parseExport: () => parseExport,
  parseTransitionLabel: () => parseTransitionLabel,
  parseTransitionLabelWithRanges: () => parseTransitionLabelWithRanges
});
module.exports = __toCommonJS(chart_model_exports);
const CHART_MODEL_VERSION = 1;
const MAX_SUPER_STEPS = 100;
const TEMPORAL_OPERATORS = ["after", "before", "at", "every"];
const TIME_UNITS = {
  msec: 1,
  sec: 1e3,
  min: 6e4
};
function createChart(name) {
  return {
    version: CHART_MODEL_VERSION,
    name,
    enabled: false,
    symbols: [],
    states: [],
    transitions: [],
    functions: [],
    notes: []
  };
}
function nameToId(name) {
  return name.trim().toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "chart";
}
function formatMessage(key, args) {
  let i = 0;
  return key.replace(/%s/g, () => args[i++] ?? "");
}
class LabelSyntaxError extends Error {
  /**
   * @param key Message with %s placeholders, used to translate the message
   * @param args Values for the placeholders
   * @param from Start of the problem in the label
   * @param to End of the problem in the label
   */
  constructor(key, args, from, to) {
    super(formatMessage(key, args));
    this.key = key;
    this.args = args;
    this.from = from;
    this.to = to;
  }
}
function readEnclosed(text, start, open, close) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) {
      depth++;
    } else if (text[i] === close) {
      depth--;
      if (depth === 0) {
        const raw = text.substring(start + 1, i);
        const content = raw.trim();
        return { content, from: start + 1 + raw.indexOf(content), end: i + 1 };
      }
    }
  }
  throw new LabelSyntaxError('Missing "%s"', [close], start, text.length);
}
const ASTRO_EVENTS = [
  "sunrise",
  "sunriseEnd",
  "goldenHourEnd",
  "solarNoon",
  "goldenHour",
  "sunsetStart",
  "sunset",
  "dusk",
  "nauticalDusk",
  "night",
  "nadir",
  "nightEnd",
  "nauticalDawn",
  "dawn"
];
const TIME_OF_DAY = /^([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const INVALID_TEMPORAL = 'Invalid temporal expression "%s", expected e.g. after(5, sec), every(10, min), after(3, button), after(5, min, condition) or at("sunset", -30)';
function splitArguments(text, from, to) {
  const args = [];
  let depth = 0;
  let quote = null;
  let start = from;
  const push = (end) => {
    const raw = text.substring(start, end);
    const trimmed = raw.trim();
    args.push({ text: trimmed, from: start + raw.indexOf(trimmed) });
  };
  for (let i = from; i < to; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") {
        i++;
      } else if (c === quote) {
        quote = null;
      }
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
    } else if ("([{".includes(c)) {
      depth++;
    } else if (")]}".includes(c)) {
      depth--;
    } else if (c === "," && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(to);
  return args;
}
function parseTemporal(text, operator, from, open, end) {
  const fail = () => {
    throw new LabelSyntaxError(INVALID_TEMPORAL, [text.substring(from, end)], from, end);
  };
  const args = splitArguments(text, open + 1, end - 1);
  const quoted = /^(["'])(.*)\1$/.exec(args[0]?.text ?? "");
  if (quoted) {
    const time = quoted[2].trim();
    if (operator !== "at" || args.length > 2) {
      fail();
    }
    if (!ASTRO_EVENTS.includes(time) && !TIME_OF_DAY.test(time)) {
      throw new LabelSyntaxError(
        'Unknown time "%s", use a time like "22:30" or one of: %s',
        [time, ASTRO_EVENTS.join(", ")],
        args[0].from,
        args[0].from + args[0].text.length
      );
    }
    const temporal = { operator, time };
    if (args.length === 2) {
      temporal.offsetMinutes = /^[-+]?\d+(?:\.\d+)?$/.test(args[1].text) ? parseFloat(args[1].text) : fail();
    }
    return { temporal };
  }
  const number = /^\d+(?:\.\d+)?$/.test(args[0]?.text) ? parseFloat(args[0].text) : fail();
  const unit = args[1]?.text ?? "";
  if (operator === "every" && number === 0) {
    fail();
  }
  if (Object.hasOwn(TIME_UNITS, unit)) {
    const temporal = { operator, ms: number * TIME_UNITS[unit] };
    if (args.length === 3 && operator === "after" && args[2].text) {
      temporal.condition = args[2].text;
      return { temporal, condition: { from: args[2].from, to: args[2].from + args[2].text.length } };
    }
    return args.length === 2 ? { temporal } : fail();
  }
  if (args.length !== 2 || !/^[A-Za-z_$][\w$]*$/.test(unit) || !Number.isInteger(number) || number < 1) {
    fail();
  }
  return {
    temporal: { operator, count: number, event: unit },
    event: { from: args[1].from, to: args[1].from + unit.length }
  };
}
function parseTransitionLabelWithRanges(label) {
  const result = {};
  const ranges = {};
  const text = label || "";
  let pos = 0;
  const skipSpace = () => {
    while (pos < text.length && /\s/.test(text[pos])) {
      pos++;
    }
  };
  skipSpace();
  const eventMatch = /[A-Za-z_$][\w$]*/y;
  eventMatch.lastIndex = pos;
  const event = eventMatch.exec(text);
  if (event) {
    const from = pos;
    pos += event[0].length;
    skipSpace();
    if (TEMPORAL_OPERATORS.includes(event[0]) && text[pos] === "(") {
      const { end } = readEnclosed(text, pos, "(", ")");
      const parsed = parseTemporal(text, event[0], from, pos, end);
      result.temporal = parsed.temporal;
      ranges.temporal = { from, to: end };
      if (parsed.event) {
        ranges.temporalEvent = parsed.event;
      }
      if (parsed.condition) {
        ranges.temporalCondition = parsed.condition;
      }
      pos = end;
    } else {
      result.event = event[0];
      ranges.event = { from, to: from + event[0].length };
    }
  }
  skipSpace();
  if (text[pos] === "[") {
    const { content, from, end } = readEnclosed(text, pos, "[", "]");
    result.condition = content;
    ranges.condition = { from, to: from + content.length };
    pos = end;
  }
  skipSpace();
  if (text[pos] === "{") {
    const { content, from, end } = readEnclosed(text, pos, "{", "}");
    result.action = content;
    ranges.action = { from, to: from + content.length };
    pos = end;
  }
  skipSpace();
  if (pos < text.length) {
    throw new LabelSyntaxError(
      'Unexpected "%s", expected event[condition]{action}',
      [text.substring(pos).trim()],
      pos,
      text.length
    );
  }
  return { label: result, ranges };
}
function parseTransitionLabel(label) {
  return parseTransitionLabelWithRanges(label).label;
}
const EXPORT_FORMAT = "iobroker.statechart";
const LEGACY_EXPORT_FORMATS = ["iobroker.state-machine"];
function createExport(charts) {
  return { format: EXPORT_FORMAT, version: CHART_MODEL_VERSION, exported: (/* @__PURE__ */ new Date()).toISOString(), charts };
}
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const SCOPES = ["input", "output", "local"];
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeChart(data, where) {
  const fail = (message) => {
    throw new Error(`${where}: ${message}`);
  };
  if (!isObject(data)) {
    fail("not an object");
  }
  if (typeof data.version === "number" && data.version > CHART_MODEL_VERSION) {
    fail(`created with a newer version of the adapter (chart version ${data.version})`);
  }
  for (const list of ["states", "transitions", "symbols"]) {
    if (!Array.isArray(data[list])) {
      fail(`"${list}" is missing or no list`);
    }
  }
  for (const list of ["functions", "notes"]) {
    if (data[list] !== void 0 && !Array.isArray(data[list])) {
      fail(`"${list}" is no list`);
    }
  }
  const functions = data.functions || [];
  const notes = data.notes || [];
  const nodeIds = /* @__PURE__ */ new Set();
  const checkId = (item, kind, index) => {
    if (!isObject(item) || typeof item.id !== "string" || !item.id) {
      fail(`${kind} ${index + 1} has no ID`);
    }
    if (nodeIds.has(item.id)) {
      fail(`${kind} ${item.id}: the ID is used more than once`);
    }
    nodeIds.add(item.id);
    return item.id;
  };
  const optionalString = (value, message) => {
    if (value !== void 0 && value !== null && typeof value !== "string") {
      fail(message);
    }
  };
  data.states.forEach((state, i) => checkId(state, "state", i));
  functions.forEach((fn, i) => checkId(fn, "function block", i));
  notes.forEach((note, i) => checkId(note, "note", i));
  const stateIds = new Set(data.states.map((s) => s.id));
  optionalString(data.comment, '"comment" is no text');
  const states = data.states.map((state) => {
    const at = `state ${state.id}`;
    if (state.parent && !stateIds.has(state.parent)) {
      fail(`${at}: unknown parent state "${state.parent}"`);
    }
    for (const field of ["entry", "during", "exit", "initial", "comment"]) {
      optionalString(state[field], `${at}: "${field}" is no text`);
    }
    if (state.order !== void 0 && !Number.isFinite(state.order)) {
      fail(`${at}: "order" is no number`);
    }
    const { parallel, history, ...rest } = state;
    return {
      ...rest,
      // the defaults (exclusive, no history) are not stored, like in the editor
      ...parallel === true ? { parallel } : {},
      ...history === true ? { history } : {},
      name: typeof state.name === "string" && state.name ? state.name : state.id,
      parent: state.parent || null,
      x: Number.isFinite(state.x) ? state.x : 0,
      y: Number.isFinite(state.y) ? state.y : 0
    };
  });
  const parentOf = new Map(states.map((s) => [s.id, s.parent]));
  for (const state of states) {
    let parent = state.parent;
    for (let i = 0; parent; i++) {
      if (parent === state.id || i > states.length) {
        fail(`state ${state.id}: the parent states form a cycle`);
      }
      parent = parentOf.get(parent) ?? null;
    }
  }
  const transitionIds = /* @__PURE__ */ new Set();
  const transitions = data.transitions.map((transition, i) => {
    if (!isObject(transition) || typeof transition.id !== "string" || !transition.id) {
      fail(`transition ${i + 1} has no ID`);
    }
    const at = `transition ${transition.id}`;
    if (transitionIds.has(transition.id)) {
      fail(`${at}: the ID is used more than once`);
    }
    transitionIds.add(transition.id);
    for (const end of ["source", "target"]) {
      if (!stateIds.has(transition[end])) {
        fail(`${at}: unknown ${end} state "${transition[end]}"`);
      }
    }
    optionalString(transition.label, `${at}: "label" is no text`);
    optionalString(transition.comment, `${at}: "comment" is no text`);
    if (transition.priority !== void 0 && !Number.isFinite(transition.priority)) {
      fail(`${at}: "priority" is no number`);
    }
    return { ...transition };
  });
  const symbolNames = /* @__PURE__ */ new Set();
  const symbols = data.symbols.map((symbol, i) => {
    if (!isObject(symbol) || typeof symbol.name !== "string" || !IDENTIFIER.test(symbol.name)) {
      fail(`variable ${i + 1}: invalid name`);
    }
    if (symbolNames.has(symbol.name)) {
      fail(`variable ${symbol.name}: the name is used more than once`);
    }
    symbolNames.add(symbol.name);
    if (!SCOPES.includes(symbol.scope)) {
      fail(`variable ${symbol.name}: invalid kind "${symbol.scope}"`);
    }
    optionalString(symbol.stateId, `variable ${symbol.name}: "stateId" is no text`);
    if (symbol.trigger !== void 0 && !["update", "change"].includes(symbol.trigger)) {
      fail(`variable ${symbol.name}: invalid trigger "${symbol.trigger}"`);
    }
    if (symbol.ack !== void 0 && !["any", "ack", "command"].includes(symbol.ack)) {
      fail(`variable ${symbol.name}: invalid ack filter "${symbol.ack}"`);
    }
    if (symbol.debounceMs !== void 0 && !(Number.isFinite(symbol.debounceMs) && symbol.debounceMs >= 0)) {
      fail(`variable ${symbol.name}: "debounceMs" is no number of 0 or more`);
    }
    return { ...symbol };
  });
  const normalizedFunctions = functions.map((fn) => {
    if (typeof fn.code !== "string") {
      fail(`function block ${fn.id}: "code" is no text`);
    }
    optionalString(fn.comment, `function block ${fn.id}: "comment" is no text`);
    return { ...fn, x: Number.isFinite(fn.x) ? fn.x : 0, y: Number.isFinite(fn.y) ? fn.y : 0 };
  });
  const normalizedNotes = notes.map((note) => {
    optionalString(note.text, `note ${note.id}: "text" is no text`);
    if (note.parent && !stateIds.has(note.parent)) {
      fail(`note ${note.id}: unknown parent state "${note.parent}"`);
    }
    return {
      ...note,
      text: note.text || "",
      parent: note.parent || null,
      x: Number.isFinite(note.x) ? note.x : 0,
      y: Number.isFinite(note.y) ? note.y : 0
    };
  });
  const chart = {
    ...data,
    version: CHART_MODEL_VERSION,
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : where,
    initial: typeof data.initial === "string" && stateIds.has(data.initial) ? data.initial : void 0,
    enabled: data.enabled !== false,
    symbols,
    states,
    transitions,
    functions: normalizedFunctions,
    notes: normalizedNotes
  };
  if (chart.superStep !== true) {
    delete chart.superStep;
  }
  if (chart.parallel !== true) {
    delete chart.parallel;
  }
  return chart;
}
function parseExport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`No valid JSON: ${err.message}`);
  }
  if (isObject(data) && (data.format === EXPORT_FORMAT || LEGACY_EXPORT_FORMATS.includes(data.format))) {
    if (typeof data.version === "number" && data.version > CHART_MODEL_VERSION) {
      throw new Error(`The file was created with a newer version of the adapter (version ${data.version})`);
    }
    if (!Array.isArray(data.charts) || !data.charts.length) {
      throw new Error("The file contains no charts");
    }
    return data.charts.map((chart, i) => normalizeChart(chart, `Chart ${i + 1}`));
  }
  if (isObject(data) && Array.isArray(data.states)) {
    return [normalizeChart(data, "Chart")];
  }
  throw new Error("The file contains no charts of the statechart adapter");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ASTRO_EVENTS,
  CHART_MODEL_VERSION,
  EXPORT_FORMAT,
  LabelSyntaxError,
  MAX_SUPER_STEPS,
  TEMPORAL_OPERATORS,
  TIME_OF_DAY,
  TIME_UNITS,
  createChart,
  createExport,
  formatMessage,
  nameToId,
  parseExport,
  parseTransitionLabel,
  parseTransitionLabelWithRanges
});
//# sourceMappingURL=chart-model.js.map
