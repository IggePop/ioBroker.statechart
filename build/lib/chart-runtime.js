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
var chart_runtime_exports = {};
__export(chart_runtime_exports, {
  ChartRuntime: () => ChartRuntime,
  getChartHash: () => getChartHash
});
module.exports = __toCommonJS(chart_runtime_exports);
var import_node_crypto = __toESM(require("node:crypto"));
var import_node_vm = __toESM(require("node:vm"));
var import_suncalc = __toESM(require("suncalc"));
var import_xstate = require("xstate");
var import_chart_helpers = require("./chart-helpers");
var import_chart_model = require("./chart-model");
var import_chart_structure = require("./chart-structure");
var import_chart_validation = require("./chart-validation");
const SCRIPT_TIMEOUT_MS = 1e3;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const PERSISTED_VERSION = 1;
function getChartHash(chart) {
  const logic = {
    initial: chart.initial,
    symbols: chart.symbols,
    // comments and notes are only documentation
    states: chart.states.map(({ x: _x, y: _y, width: _w, height: _h, comment: _c, ...state }) => state),
    transitions: chart.transitions.map(
      ({
        sourceHandle: _s,
        targetHandle: _t,
        sourceAnchor: _sa,
        targetAnchor: _ta,
        comment: _c,
        ...transition
      }) => transition
    ),
    functions: (chart.functions || []).map((fn) => fn.code)
  };
  return import_node_crypto.default.createHash("sha1").update(JSON.stringify(logic)).digest("hex");
}
class ChartRuntime {
  constructor(chartId, chart, host) {
    this.chartId = chartId;
    this.chart = chart;
    this.host = host;
    this.structure = new import_chart_structure.ChartStructure(chart);
    this.statesById = this.structure.statesById;
    this.sandbox = import_node_vm.default.createContext(this.createHelpers());
    this.hash = getChartHash(chart);
  }
  structure;
  statesById;
  /** timers of setStateDelayed() */
  delayedWrites = /* @__PURE__ */ new Set();
  /** values of all symbols, this is also the global scope of conditions and actions */
  sandbox;
  /** last value written to (or read from) each output */
  outputValues = /* @__PURE__ */ new Map();
  /** transitions which leave the source state, by source, sorted */
  outerTransitions = /* @__PURE__ */ new Map();
  /** transitions to children of the source state, by source, sorted */
  innerTransitions = /* @__PURE__ */ new Map();
  /** temporal transitions by source */
  temporalTransitions = /* @__PURE__ */ new Map();
  /** all active states, parents before children */
  activeIds = [];
  /** time each active state was entered */
  enteredAt = /* @__PURE__ */ new Map();
  /** timers of the temporal transitions by state */
  timers = /* @__PURE__ */ new Map();
  /** temporal transitions whose time has come */
  expired = /* @__PURE__ */ new Set();
  /** timers of inputs with debounce, by variable name */
  debounceTimers = /* @__PURE__ */ new Map();
  /** JSON of the last persisted data, to persist only changes */
  lastPersisted = "";
  /** name paths of the active leaf states, like the "activeState" state */
  activeNames = "";
  /** events which are not yet passed to host.onHistory() */
  pendingHistory = [];
  /** JSON of the last values passed to host.onValues(), to pass only changes */
  lastValues = "";
  /** what caused the current wakeup, for the history */
  wakeupCause = "input";
  /** name of the input which caused the current wakeup, for the history */
  wakeupInput = null;
  hash;
  actor = null;
  /** the current time, can be replaced in tests */
  now = () => Date.now();
  /**
   * IDs of all states this chart reads
   */
  get inputStateIds() {
    return this.chart.symbols.filter((s) => s.scope === "input" && s.stateId).map((s) => s.stateId);
  }
  /**
   * @param options Start options
   * @param options.restore Continue with the persisted state, if the chart was not changed since
   */
  async start(options = {}) {
    this.logProblems();
    for (const symbol of this.chart.symbols) {
      if (symbol.scope === "local") {
        this.sandbox[symbol.name] = structuredClone(symbol.initial);
      } else if (symbol.stateId) {
        const val = await this.host.readState(symbol.stateId);
        this.sandbox[symbol.name] = val;
        if (symbol.scope === "output") {
          this.outputValues.set(symbol.name, val);
        }
      }
    }
    for (const fn of this.chart.functions || []) {
      const where = `function block ${(0, import_chart_validation.getDeclarations)(fn.code).map((d) => d.name).join(", ")}`;
      this.run(this.compile(fn.code, where), where);
    }
    this.writeChangedOutputs();
    const machine = (0, import_xstate.createMachine)(this.buildMachineConfig());
    const persisted = options.restore && this.chart.restoreState !== false ? await this.loadPersisted() : null;
    let restored = false;
    if (persisted) {
      try {
        this.restore(machine, persisted);
        restored = true;
        this.host.log.info(`[${this.chart.name}] Restored the state from before the restart`);
      } catch (err) {
        this.host.log.warn(`[${this.chart.name}] Cannot restore the state, starting anew: ${err.message}`);
        this.stop();
        this.startActor(machine);
      }
    } else {
      this.startActor(machine);
    }
    this.pendingHistory.push({ ts: this.now(), kind: "start", restored, active: this.activeNames });
    this.wakeup(null, "start");
  }
  /**
   * Starts the chart in its initial state, the entry actions are executed
   *
   * @param machine The XState machine of the chart
   */
  startActor(machine) {
    this.activeIds = [];
    this.enteredAt.clear();
    this.actor = (0, import_xstate.createActor)(machine);
    this.subscribe();
    this.actor.start();
  }
  /**
   * Continues with a persisted state: the entry actions are not executed again,
   * the timers of the temporal transitions continue with their remaining time
   *
   * @param machine The XState machine of the chart
   * @param persisted The stored state
   */
  restore(machine, persisted) {
    for (const symbol of this.chart.symbols) {
      if (symbol.scope === "local" && symbol.name in persisted.locals) {
        this.sandbox[symbol.name] = persisted.locals[symbol.name];
      }
    }
    this.actor = (0, import_xstate.createActor)(machine, { snapshot: persisted.machine });
    this.subscribe();
    this.actor.start();
    this.publishActiveStates(this.actor.getSnapshot().value);
    for (const id of this.activeIds) {
      this.enteredAt.set(id, persisted.entered[id] ?? this.now());
      this.startTimers(id);
    }
  }
  subscribe() {
    this.actor?.subscribe({
      next: (snapshot) => this.publishActiveStates(snapshot.value),
      error: (err) => this.host.log.error(`[${this.chart.name}] ${String(err)}`)
    });
  }
  /**
   * @returns the persisted data, if it fits to this chart
   */
  async loadPersisted() {
    let persisted;
    try {
      persisted = await this.host.loadPersisted?.();
    } catch (err) {
      this.host.log.warn(`[${this.chart.name}] Cannot load the stored state: ${err.message}`);
      return null;
    }
    if (!persisted?.machine || persisted.version !== PERSISTED_VERSION) {
      return null;
    }
    if (persisted.hash !== this.hash) {
      this.host.log.info(`[${this.chart.name}] The chart was changed, starting in the initial state`);
      return null;
    }
    return { ...persisted, entered: persisted.entered || {}, locals: persisted.locals || {} };
  }
  /**
   * Stores the current state of the chart, if it changed since the last time
   */
  persist() {
    if (!this.actor || !this.host.persist) {
      return;
    }
    const data = {
      version: PERSISTED_VERSION,
      hash: this.hash,
      machine: this.actor.getPersistedSnapshot(),
      entered: Object.fromEntries(this.enteredAt),
      locals: Object.fromEntries(
        this.chart.symbols.filter((s) => s.scope === "local").map((s) => [s.name, this.sandbox[s.name]])
      )
    };
    let json;
    try {
      json = JSON.stringify(data);
    } catch (err) {
      this.host.log.warn(`[${this.chart.name}] Cannot store the state: ${err.message}`);
      return;
    }
    if (json !== this.lastPersisted) {
      this.lastPersisted = json;
      this.host.persist(data);
    }
  }
  /**
   * Called by XState before the entry action of a state
   *
   * @param id ID of the state
   */
  onEnter(id) {
    this.enteredAt.set(id, this.now());
    this.startTimers(id);
  }
  /**
   * Called by XState after the exit action of a state
   *
   * @param id ID of the state
   */
  onExit(id) {
    this.enteredAt.delete(id);
    for (const timer of this.timers.get(id) || []) {
      clearTimeout(timer.handle);
    }
    this.timers.delete(id);
    for (const transition of this.temporalTransitions.get(id) || []) {
      this.expired.delete(transition.id);
    }
  }
  /**
   * Starts a timer for every temporal transition of a state, which wakes up the chart when its time has come
   *
   * @param id ID of the state
   */
  startTimers(id) {
    const entered = this.enteredAt.get(id) ?? this.now();
    const timers = [];
    for (const transition of this.temporalTransitions.get(id) || []) {
      const timer = {};
      const due = entered + transition.afterMs;
      const wait = () => {
        const remaining = due - this.now();
        timer.handle = setTimeout(
          () => {
            if (due - this.now() > 0 && remaining > MAX_TIMEOUT_MS) {
              wait();
              return;
            }
            this.expired.add(transition.id);
            this.wakeup(null);
          },
          Math.min(Math.max(remaining, 0), MAX_TIMEOUT_MS)
        );
      };
      wait();
      timers.push(timer);
    }
    this.timers.set(id, timers);
  }
  /**
   * Logs the problems found by the validation, the chart is started anyway
   */
  logProblems() {
    for (const { kind, id, field, diagnostic } of (0, import_chart_validation.validateChart)(this.chart)) {
      let where;
      if (kind === "state") {
        where = `${this.statesById.get(id)?.name ?? id}/${field}`;
      } else if (kind === "function") {
        const fn = this.chart.functions?.find((f) => f.id === id);
        where = `Function block ${(0, import_chart_validation.getDeclarations)(fn?.code).map((d) => d.name).join(", ")}`;
      } else {
        const transition = this.chart.transitions.find((t) => t.id === id);
        const source = this.statesById.get(transition?.source ?? "")?.name;
        const target = this.statesById.get(transition?.target ?? "")?.name;
        where = `Transition ${source} -> ${target}`;
      }
      const log = diagnostic.severity === "error" ? this.host.log.error : this.host.log.warn;
      log(`[${this.chart.name}] ${where}: ${diagnostic.message}`);
    }
  }
  stop() {
    this.actor?.stop();
    this.actor = null;
    for (const timers of this.timers.values()) {
      for (const timer of timers) {
        clearTimeout(timer.handle);
      }
    }
    this.timers.clear();
    this.expired.clear();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const timer of this.delayedWrites) {
      clearTimeout(timer);
    }
    this.delayedWrites.clear();
  }
  /**
   * The helper functions which can be used in conditions and actions, see chart-helpers.ts
   */
  createHelpers() {
    const prefix = `[${this.chart.name}]`;
    const write = (id, value, ack) => this.host.writeState(String(id), value, !!ack).catch((err) => this.host.log.warn(`${prefix} Cannot write ${id}: ${err}`));
    return {
      log: (message, level = "info") => {
        const method = ["debug", "info", "warn", "error"].includes(level) ? level : "info";
        this.host.log[method](`${prefix} ${message}`);
      },
      setState: (id, value, ack = false) => {
        void write(id, value, ack);
      },
      setStateDelayed: (id, value, delayMs, ack = false) => {
        const timer = setTimeout(
          () => {
            this.delayedWrites.delete(timer);
            void write(id, value, ack);
          },
          Math.min(Math.max(Number(delayMs) || 0, 0), MAX_TIMEOUT_MS)
        );
        this.delayedWrites.add(timer);
      },
      sendTo: (instance, command, message) => {
        if (!this.host.sendTo) {
          throw new Error("sendTo() is not available");
        }
        this.host.sendTo(String(instance), String(command), message);
      },
      isTimeBetween: (start, end) => (0, import_chart_helpers.isTimeBetween)(start, end, new Date(this.now())),
      isDaytime: () => {
        const now = new Date(this.now());
        const { sunrise, sunset, alwaysUp } = this.getSunTimes(now);
        if (!sunrise || !sunset) {
          return !!alwaysUp;
        }
        return now >= sunrise && now < sunset;
      },
      astroTime: (name, offsetMinutes = 0) => {
        const times = this.getSunTimes(new Date(this.now()));
        const time = times[name];
        if (!(time instanceof Date)) {
          const known = name in times && name !== "alwaysUp" && name !== "alwaysDown";
          throw new Error(
            known ? `There is no "${name}" today at the location of the system settings` : `Unknown astro event "${name}"`
          );
        }
        return new Date(time.getTime() + (Number(offsetMinutes) || 0) * 6e4);
      }
    };
  }
  /**
   * @param date The day
   * @returns the astro events of the day, null for events which do not happen on that day (polar regions)
   * @throws {Error} if no location is configured
   */
  getSunTimes(date) {
    const location = this.host.getLocation?.();
    if (!location) {
      throw new Error("No location (latitude/longitude) configured in the ioBroker system settings");
    }
    return import_suncalc.default.getTimes(date, location.latitude, location.longitude);
  }
  /**
   * Must be called when an input state is updated
   *
   * @param stateId ID of the updated state
   * @param val The new value
   * @param options The ack flag of the update
   * @param options.ack The ack flag of the update
   */
  handleInput(stateId, val, options = {}) {
    if (!this.actor) {
      return;
    }
    for (const symbol of this.chart.symbols) {
      if (symbol.scope !== "input" || symbol.stateId !== stateId) {
        continue;
      }
      if (symbol.ack === "ack" && options.ack !== true || symbol.ack === "command" && options.ack !== false) {
        continue;
      }
      const debounceMs = symbol.debounceMs || 0;
      if (debounceMs > 0) {
        clearTimeout(this.debounceTimers.get(symbol.name));
        this.debounceTimers.set(
          symbol.name,
          setTimeout(() => {
            this.debounceTimers.delete(symbol.name);
            this.applyInput(symbol, val);
          }, debounceMs)
        );
      } else {
        this.applyInput(symbol, val);
      }
    }
  }
  /**
   * Sets the variable of an input and wakes up the chart
   *
   * @param symbol The input
   * @param val The new value
   */
  applyInput(symbol, val) {
    if (symbol.trigger === "change" && val === this.sandbox[symbol.name]) {
      return;
    }
    this.sandbox[symbol.name] = val;
    this.wakeup(symbol.name);
  }
  /**
   * @param input Name of the input which caused the wakeup, null for timers and the start
   * @param cause What caused the wakeup
   */
  wakeup(input, cause = input === null ? "timer" : "input") {
    if (!this.actor) {
      return;
    }
    this.wakeupCause = cause;
    this.wakeupInput = input;
    if (!this.chart.superStep) {
      this.step(input);
    } else {
      let steps = 0;
      let stepInput = input;
      while (steps < import_chart_model.MAX_SUPER_STEPS && this.step(stepInput)) {
        steps++;
        stepInput = null;
      }
      if (steps >= import_chart_model.MAX_SUPER_STEPS) {
        this.host.log.warn(
          `[${this.chart.name}] Stopped after ${import_chart_model.MAX_SUPER_STEPS} transitions in one wakeup, the transitions probably form a loop. The chart continues on the next wakeup.`
        );
      }
    }
    this.writeChangedOutputs();
    this.persist();
    this.publishLive();
  }
  /**
   * Processes the active states once, see the class description
   *
   * @param input Name of the input which caused the wakeup, null if the step has no event
   * @returns true if a transition was taken
   */
  step(input) {
    for (const id of this.getActiveChildren(null)) {
      if (this.processState(id, input)) {
        return true;
      }
    }
    return false;
  }
  /**
   * Passes the events since the last call and the changed values of the variables to the host
   */
  publishLive() {
    if (this.pendingHistory.length) {
      const entries = this.pendingHistory;
      this.pendingHistory = [];
      this.host.onHistory?.(entries);
    }
    if (!this.host.onValues) {
      return;
    }
    const values = Object.fromEntries(this.chart.symbols.map((s) => [s.name, this.sandbox[s.name]]));
    let json;
    try {
      json = JSON.stringify(values);
    } catch {
      for (const [name, value] of Object.entries(values)) {
        try {
          JSON.stringify(value);
        } catch {
          values[name] = String(value);
        }
      }
      json = JSON.stringify(values);
    }
    if (json !== this.lastValues) {
      this.lastValues = json;
      this.host.onValues(values);
    }
  }
  /**
   * Processes an active state and its active children, see the class description
   *
   * @param id ID of the state
   * @param input Name of the input which caused the wakeup, null for timers
   * @returns true if a transition was taken
   */
  processState(id, input) {
    if (this.takeFirstValid(this.outerTransitions.get(id), input)) {
      return true;
    }
    const state = this.statesById.get(id);
    if (state?.during) {
      this.runAction(state.during, `${state.name}/during`);
    }
    if (this.takeFirstValid(this.innerTransitions.get(id), input)) {
      return true;
    }
    for (const child of this.getActiveChildren(id)) {
      if (this.processState(child, input)) {
        return true;
      }
    }
    return false;
  }
  /**
   * @param parent null for the top level
   */
  getActiveChildren(parent) {
    const children = new Set(this.structure.getChildren(parent).map((s) => s.id));
    return this.activeIds.filter((id) => children.has(id));
  }
  /**
   * Takes the first transition whose event and condition match
   *
   * @param transitions The transitions to check, sorted
   * @param input Name of the input which caused the wakeup, null for timers
   * @returns true if a transition was taken
   */
  takeFirstValid(transitions, input) {
    for (const transition of transitions || []) {
      if (transition.event && transition.event !== input) {
        continue;
      }
      if (transition.afterMs !== void 0 && !this.isExpired(transition)) {
        continue;
      }
      if (transition.condition && !this.run(transition.condition, `${transition.where}/condition`)) {
        continue;
      }
      this.actor?.send({ type: `T.${transition.id}` });
      this.pendingHistory.push({
        ts: this.now(),
        kind: "transition",
        transition: transition.id,
        from: transition.from,
        to: transition.to,
        // in a super step, all transitions of the wakeup were caused by its input
        trigger: this.wakeupInput,
        cause: this.wakeupCause,
        active: this.activeNames
      });
      return true;
    }
    return false;
  }
  /**
   * @param transition A temporal transition
   * @returns true if its source state is active for at least its delay
   */
  isExpired(transition) {
    if (this.expired.has(transition.id)) {
      return true;
    }
    const entered = this.enteredAt.get(transition.source);
    return entered !== void 0 && this.now() - entered >= transition.afterMs;
  }
  buildMachineConfig() {
    const structure = this.structure;
    const buildState = (state) => {
      const node = {
        id: state.id,
        entry: [
          () => this.onEnter(state.id),
          ...state.entry ? [() => this.runAction(state.entry, `${state.name}/entry`)] : []
        ],
        exit: [
          ...state.exit ? [() => this.runAction(state.exit, `${state.name}/exit`)] : [],
          () => this.onExit(state.id)
        ],
        on: {}
      };
      const outer = [];
      const inner = [];
      for (const transition of structure.getTransitions(state.id)) {
        const built = this.buildTransition(transition, state);
        if (!built) {
          continue;
        }
        node.on[`T.${transition.id}`] = built.config;
        (built.inner ? inner : outer).push(built.checked);
      }
      this.outerTransitions.set(state.id, outer);
      this.innerTransitions.set(state.id, inner);
      this.temporalTransitions.set(
        state.id,
        [...outer, ...inner].filter((t) => t.afterMs !== void 0)
      );
      const subStates = structure.getChildren(state.id);
      if (subStates.length) {
        node.initial = structure.getInitialChild(state.id);
        node.states = Object.fromEntries(subStates.map((s) => [s.id, buildState(s)]));
      }
      return node;
    };
    const topLevel = structure.getChildren(null);
    if (!topLevel.length) {
      throw new Error("The chart has no states");
    }
    return {
      id: `chart_${this.chartId}`,
      initial: structure.getInitialChild(null),
      states: Object.fromEntries(topLevel.map((s) => [s.id, buildState(s)]))
    };
  }
  /**
   * @param transition The transition
   * @param source Its source state
   */
  buildTransition(transition, source) {
    const target = this.statesById.get(transition.target);
    const where = `${source.name} -> ${target?.name ?? transition.target}`;
    if (!target) {
      this.host.log.warn(`[${this.chart.name}] Transition ${where}: unknown target, ignored`);
      return null;
    }
    let label;
    try {
      label = (0, import_chart_model.parseTransitionLabel)(transition.label);
    } catch (err) {
      this.host.log.error(`[${this.chart.name}] Transition ${where}: ${err.message}, ignored`);
      return null;
    }
    const condition = label.condition ? this.compile(`(${label.condition})`, `${where}/condition`) : null;
    const { inner, reenter } = this.structure.getTransitionKind(transition);
    const config = {
      target: `#${target.id}`,
      reenter,
      actions: label.action ? [() => this.runAction(label.action, `${where}/action`)] : []
    };
    return {
      inner,
      config,
      checked: {
        id: transition.id,
        source: source.id,
        where,
        from: source.name,
        to: target.name,
        event: label.event,
        afterMs: label.afterMs,
        condition
      }
    };
  }
  /**
   * @param code The code
   * @param where Used in error messages
   */
  compile(code, where) {
    try {
      return new import_node_vm.default.Script(code, { filename: `${this.chart.name}/${where}` });
    } catch (err) {
      this.host.log.error(`[${this.chart.name}] ${where}: ${err.message}`);
      return null;
    }
  }
  /**
   * @param script The compiled code
   * @param where Used in error messages
   */
  run(script, where) {
    if (!script) {
      return void 0;
    }
    try {
      return script.runInContext(this.sandbox, { timeout: SCRIPT_TIMEOUT_MS });
    } catch (err) {
      this.host.log.warn(`[${this.chart.name}] ${where}: ${err.message}`);
      return void 0;
    }
  }
  /**
   * Executes an action and writes all changed outputs
   *
   * @param code The action
   * @param where Used in error messages
   */
  runAction(code, where) {
    this.run(this.compile(`{
${code}
}`, where), where);
    this.writeChangedOutputs();
  }
  writeChangedOutputs() {
    for (const symbol of this.chart.symbols) {
      if (symbol.scope !== "output" || !symbol.stateId) {
        continue;
      }
      const val = this.sandbox[symbol.name];
      if (val !== this.outputValues.get(symbol.name)) {
        this.outputValues.set(symbol.name, val);
        this.host.writeState(symbol.stateId, val).catch((err) => this.host.log.warn(`[${this.chart.name}] Cannot write ${symbol.stateId}: ${err}`));
      }
    }
  }
  /**
   * @param value XState state value
   */
  publishActiveStates(value) {
    const ids = [];
    const names = [];
    const walk = (val, path) => {
      const keys = typeof val === "string" ? [val] : Object.keys(val || {});
      for (const key of keys) {
        const name = [...path, this.statesById.get(key)?.name ?? key];
        ids.push(key);
        if (typeof val === "string" || !val[key] || !Object.keys(val[key]).length) {
          names.push(name.join("."));
        } else {
          walk(val[key], name);
        }
      }
    };
    walk(value, []);
    if (ids.join() !== this.activeIds.join()) {
      this.activeIds = ids;
      this.activeNames = names.join(", ");
      this.host.onActiveChange({ names: this.activeNames, ids });
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ChartRuntime,
  getChartHash
});
//# sourceMappingURL=chart-runtime.js.map
