"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var utils = __toESM(require("@iobroker/adapter-core"));
var import_chart_runtime = require("./lib/chart-runtime");
const HISTORY_LENGTH = 200;
const SIMULATION_TIMEOUT_MS = 2 * 60 * 1e3;
const CONTROLS = ["enabled", "reset", "event"];
class Statechart extends utils.Adapter {
  /** running charts by chart ID */
  runtimes = /* @__PURE__ */ new Map();
  /** foreign states we are subscribed to */
  subscribedInputs = /* @__PURE__ */ new Set();
  /** chart (re)starts are executed one after another */
  chartQueue = Promise.resolve();
  /** for the astro helper functions */
  location = null;
  /** the last events of each chart by chart ID, newest last, also stored in charts.<chart>.history */
  histories = /* @__PURE__ */ new Map();
  /** charts which run as simulation (their runtime is in runtimes), with the timer which ends the simulation */
  simulations = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    super({
      ...options,
      name: "statechart"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("objectChange", this.onObjectChange.bind(this));
    this.on("message", this.onMessage.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    await this.setObjectNotExistsAsync("charts", {
      type: "folder",
      common: { name: "Charts" },
      native: {}
    });
    await this.loadLocation();
    const objects = await this.getForeignObjectsAsync(`${this.namespace}.charts.*`, "channel");
    for (const [id, obj] of Object.entries(objects)) {
      const chartId = this.getChartId(id);
      if (chartId) {
        await this.startChart(chartId, obj, true);
      }
    }
    this.subscribeObjects("charts.*");
    this.subscribeStates("charts.*.history");
    for (const control of CONTROLS) {
      this.subscribeStates(`charts.*.${control}`);
    }
  }
  /**
   * Reads the location of the ioBroker system settings, used by isDaytime() and astroTime()
   */
  async loadLocation() {
    const config = await this.getForeignObjectAsync("system.config");
    const latitude = parseFloat(String(config?.common?.latitude ?? ""));
    const longitude = parseFloat(String(config?.common?.longitude ?? ""));
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      this.location = { latitude, longitude };
    } else {
      this.log.info("No location configured in the system settings, isDaytime() and astroTime() do not work");
    }
  }
  /**
   * Extracts the chart ID from the ID of a chart object
   *
   * @param id Object ID
   * @returns undefined if the ID is no chart object
   */
  getChartId(id) {
    const prefix = `${this.namespace}.charts.`;
    if (!id.startsWith(prefix)) {
      return void 0;
    }
    const chartId = id.substring(prefix.length);
    return chartId.includes(".") ? void 0 : chartId;
  }
  /**
   * @param id State ID
   * @returns the chart ID and the name of the state if it is a state of a chart, e.g. "history"
   */
  parseChartStateId(id) {
    const match = /^charts\.([^.]+)\.([^.]+)$/.exec(id.substring(this.namespace.length + 1));
    return id.startsWith(`${this.namespace}.`) && match ? { chartId: match[1], name: match[2] } : void 0;
  }
  /**
   * @param chartId Chart ID
   * @param obj Chart object
   * @param restore Continue with the persisted state instead of the initial state
   */
  async startChart(chartId, obj, restore = false) {
    const chart = obj?.type === "channel" ? obj.native?.chart : void 0;
    if (!chart) {
      this.histories.delete(chartId);
      return;
    }
    await this.createChartStates(chartId);
    await this.loadHistory(chartId);
    await this.setState(`charts.${chartId}.enabled`, chart.enabled !== false, true);
    await this.setState(`charts.${chartId}.simulation`, false, true);
    await this.setState(`charts.${chartId}.simulationStatus`, "", true);
    const empty = !chart.states?.length;
    if (!chart.enabled || empty) {
      if (empty) {
        this.log.warn(`Chart "${chart.name}" has no states, it is not started`);
      } else {
        this.log.info(`Chart "${chart.name}" is paused`);
      }
      await this.setState(`charts.${chartId}.activeState`, "", true);
      await this.setState(`charts.${chartId}.activeStateIds`, "[]", true);
      await this.setState(`charts.${chartId}.values`, "{}", true);
      return;
    }
    const runtime = this.createRuntime(chartId, chart);
    try {
      await runtime.start({ restore });
    } catch (err) {
      this.log.error(`Cannot start chart "${chart.name}": ${err.message}`);
      return;
    }
    this.runtimes.set(chartId, runtime);
    this.updateSubscriptions();
    this.log.info(`Chart "${chart.name}" started`);
  }
  /**
   * @param chartId Chart ID
   * @param chart The chart
   * @param simulated Run it as simulation, see ChartRuntime
   */
  createRuntime(chartId, chart, simulated = false) {
    return new import_chart_runtime.ChartRuntime(
      chartId,
      chart,
      {
        readState: async (id) => (await this.getForeignStateAsync(id))?.val ?? null,
        getState: (id) => this.getForeignStateAsync(id),
        writeState: async (id, val, ack = false) => {
          await this.setForeignStateAsync(id, val, ack);
        },
        sendTo: (instance, command, message) => this.sendTo(instance, command, message),
        getLocation: () => this.location,
        onActiveChange: ({ names, ids }) => {
          void this.setState(`charts.${chartId}.activeState`, names, true);
          void this.setState(`charts.${chartId}.activeStateIds`, JSON.stringify(ids), true);
        },
        persist: (data) => {
          void this.setState(`charts.${chartId}.snapshot`, JSON.stringify(data), true);
        },
        onValues: (values) => {
          void this.setState(`charts.${chartId}.values`, JSON.stringify(values), true);
        },
        onHistory: (entries) => this.addHistory(chartId, entries),
        onSimulationStatus: (status) => {
          void this.setState(`charts.${chartId}.simulationStatus`, JSON.stringify(status), true);
        },
        loadPersisted: async () => {
          const state = await this.getStateAsync(`charts.${chartId}.snapshot`);
          return typeof state?.val === "string" && state.val ? JSON.parse(state.val) : null;
        },
        log: this.log
      },
      simulated
    );
  }
  /**
   * Stops the chart and runs the given version of it as simulation, see ChartRuntime
   *
   * @param chartId Chart ID
   * @param chart The chart as shown in the editor, may have unsaved changes
   * @param breakpoints IDs of the states and transitions with a breakpoint
   */
  async startSimulation(chartId, chart, breakpoints = []) {
    if (!chart?.states?.length) {
      throw new Error("The chart has no states");
    }
    this.stopChart(chartId);
    this.endSimulationTimer(chartId);
    const runtime = this.createRuntime(chartId, chart, true);
    runtime.breakpoints = new Set(breakpoints);
    this.simulations.set(
      chartId,
      setTimeout(() => this.onSimulationTimeout(chartId), SIMULATION_TIMEOUT_MS)
    );
    try {
      await runtime.start();
    } catch (err) {
      this.endSimulationTimer(chartId);
      await this.restartChart(chartId);
      throw err;
    }
    this.runtimes.set(chartId, runtime);
    this.updateSubscriptions();
    await this.setState(`charts.${chartId}.simulation`, true, true);
    this.log.info(`Chart "${chart.name}" runs as simulation, its outputs are not written`);
  }
  /**
   * Ends the simulation of a chart, the real chart continues where it was before
   *
   * @param chartId Chart ID
   */
  async stopSimulation(chartId) {
    if (!this.simulations.has(chartId)) {
      return;
    }
    this.endSimulationTimer(chartId);
    this.stopChart(chartId);
    this.log.info(`Simulation of chart ${chartId} ended`);
    await this.restartChart(chartId, true);
  }
  /**
   * @param chartId Chart ID
   */
  endSimulationTimer(chartId) {
    clearTimeout(this.simulations.get(chartId));
    this.simulations.delete(chartId);
  }
  /**
   * @param chartId Chart ID
   */
  onSimulationTimeout(chartId) {
    this.log.info(`Simulation of chart ${chartId} ended, the editor did not answer anymore`);
    this.chartQueue = this.chartQueue.then(() => this.stopSimulation(chartId)).catch((err) => this.log.error(`Cannot end the simulation of chart ${chartId}: ${err.message}`));
  }
  /**
   * Starts a chart with the stored version
   *
   * @param chartId Chart ID
   * @param restore Continue with the persisted state instead of the initial state
   */
  async restartChart(chartId, restore = false) {
    await this.startChart(chartId, await this.getObjectAsync(`charts.${chartId}`), restore);
  }
  /**
   * Messages of the editor, for the simulation
   *
   * @param obj The message
   */
  onMessage(obj) {
    if (typeof obj !== "object" || !obj.command) {
      return;
    }
    const message = obj.message || {};
    const chartId = String(message.chartId || "");
    const reply = (response) => {
      if (obj.callback) {
        this.sendTo(obj.from, obj.command, response, obj.callback);
      }
    };
    const simulating = this.simulations.has(chartId);
    if (simulating) {
      clearTimeout(this.simulations.get(chartId));
      this.simulations.set(
        chartId,
        setTimeout(() => this.onSimulationTimeout(chartId), SIMULATION_TIMEOUT_MS)
      );
    }
    const runtime = this.runtimes.get(chartId);
    switch (obj.command) {
      case "simulationStart":
        this.chartQueue = this.chartQueue.then(() => this.startSimulation(chartId, message.chart, message.breakpoints)).then(() => reply({ ok: true })).catch((err) => reply({ error: err.message }));
        return;
      case "simulationStop":
        this.chartQueue = this.chartQueue.then(() => this.stopSimulation(chartId)).then(() => reply({ ok: true })).catch((err) => reply({ error: err.message }));
        return;
      case "simulationInput":
        if (!simulating || !runtime) {
          reply({ error: "No simulation is running" });
        } else if (!runtime.simulateInput(String(message.name), message.value)) {
          reply({ error: `Unknown input "${message.name}"` });
        } else {
          reply({ ok: true });
        }
        return;
      case "simulationEvent":
        if (!simulating || !runtime) {
          reply({ error: "No simulation is running" });
        } else if (!runtime.handleEvent(String(message.name))) {
          reply({ error: `Unknown input "${message.name}"` });
        } else {
          reply({ ok: true });
        }
        return;
      case "simulationPing":
        reply({ ok: simulating });
        return;
      case "simulationBreakpoints":
      case "simulationPause":
      case "simulationResume":
      case "simulationStep":
      case "simulationAdvance":
        if (!simulating || !runtime) {
          reply({ error: "No simulation is running" });
          return;
        }
        if (obj.command === "simulationBreakpoints") {
          runtime.breakpoints = new Set(Array.isArray(message.breakpoints) ? message.breakpoints : []);
        } else if (obj.command === "simulationPause") {
          runtime.pauseSimulation();
        } else if (obj.command === "simulationResume") {
          runtime.resumeSimulation();
        } else if (obj.command === "simulationStep") {
          runtime.stepSimulation();
        } else if (typeof message.ms === "number" && message.ms > 0) {
          runtime.advanceTime(message.ms);
        } else {
          runtime.advanceToNextTimer();
        }
        reply({ ok: true });
        return;
      default:
        reply({ error: `Unknown command "${obj.command}"` });
    }
  }
  /**
   * Reads the stored history of a chart, if it is not known yet
   *
   * @param chartId Chart ID
   */
  async loadHistory(chartId) {
    if (this.histories.has(chartId)) {
      return;
    }
    let history = [];
    try {
      const state = await this.getStateAsync(`charts.${chartId}.history`);
      const parsed = typeof state?.val === "string" && state.val ? JSON.parse(state.val) : [];
      history = Array.isArray(parsed) ? parsed : [];
    } catch {
    }
    this.histories.set(chartId, history);
  }
  /**
   * Appends events to the history of a chart and stores it
   *
   * @param chartId Chart ID
   * @param entries The new events
   */
  addHistory(chartId, entries) {
    const history = [...this.histories.get(chartId) || [], ...entries].slice(-HISTORY_LENGTH);
    this.histories.set(chartId, history);
    void this.setState(`charts.${chartId}.history`, JSON.stringify(history), true);
  }
  /**
   * @param chartId Chart ID
   */
  stopChart(chartId) {
    const runtime = this.runtimes.get(chartId);
    if (runtime) {
      runtime.stop();
      this.runtimes.delete(chartId);
      this.updateSubscriptions();
    }
  }
  /**
   * Creates the states which show the current status of a chart
   *
   * @param chartId Chart ID
   */
  async createChartStates(chartId) {
    await this.setObjectNotExistsAsync(`charts.${chartId}.activeState`, {
      type: "state",
      common: {
        name: "Active state",
        type: "string",
        role: "text",
        read: true,
        write: false
      },
      native: {}
    });
    await this.setObjectNotExistsAsync(`charts.${chartId}.snapshot`, {
      type: "state",
      common: {
        name: "Stored state of the chart, restored after a restart of the adapter",
        type: "string",
        role: "json",
        read: true,
        write: false
      },
      native: {}
    });
    await this.setObjectNotExistsAsync(`charts.${chartId}.activeStateIds`, {
      type: "state",
      common: {
        name: "IDs of all active states",
        type: "string",
        role: "json",
        read: true,
        write: false
      },
      native: {}
    });
    await this.setObjectNotExistsAsync(`charts.${chartId}.values`, {
      type: "state",
      common: {
        name: "Current values of all variables",
        type: "string",
        role: "json",
        read: true,
        write: false
      },
      native: {}
    });
    await this.setObjectNotExistsAsync(`charts.${chartId}.history`, {
      type: "state",
      common: {
        name: `Last ${HISTORY_LENGTH} events: starts and transitions taken, write anything to clear it`,
        type: "string",
        role: "json",
        read: true,
        write: true
      },
      native: {}
    });
    await this.setObjectNotExistsAsync(`charts.${chartId}.enabled`, {
      type: "state",
      common: {
        name: "Chart runs: false pauses it, true starts it in its initial state",
        type: "boolean",
        role: "switch.enable",
        read: true,
        write: true
      },
      native: {}
    });
    await this.setObjectNotExistsAsync(`charts.${chartId}.reset`, {
      type: "state",
      common: {
        name: "Restart the running chart in its initial state",
        type: "boolean",
        role: "button",
        read: false,
        write: true
      },
      native: {}
    });
    await this.setObjectNotExistsAsync(`charts.${chartId}.simulation`, {
      type: "state",
      common: {
        name: "The chart runs as simulation from the editor, its outputs are not written",
        type: "boolean",
        role: "indicator",
        read: true,
        write: false
      },
      native: {}
    });
    await this.setObjectNotExistsAsync(`charts.${chartId}.simulationStatus`, {
      type: "state",
      common: {
        name: "Status of the simulation as JSON: paused, time offset, queued wakeups, next timer, breakpoint",
        type: "string",
        role: "json",
        read: true,
        write: false
      },
      native: {}
    });
    await this.setObjectNotExistsAsync(`charts.${chartId}.event`, {
      type: "state",
      common: {
        name: "Name of an input: wakes up the chart with this event, without changing the value of the input",
        type: "string",
        role: "text",
        read: true,
        write: true
      },
      native: {}
    });
  }
  /**
   * Executes a command written to a control state of a chart
   *
   * @param chartId Chart ID
   * @param control Name of the state
   * @param val The written value
   */
  async handleControl(chartId, control, val) {
    const id = `charts.${chartId}.${control}`;
    const obj = await this.getObjectAsync(`charts.${chartId}`);
    const chart = obj?.type === "channel" ? obj.native?.chart : void 0;
    if (!chart) {
      return;
    }
    if (control === "enabled") {
      const enabled = val === true || val === "true" || val === 1;
      if (enabled === (chart.enabled !== false)) {
        await this.setState(id, enabled, true);
        return;
      }
      await this.extendObjectAsync(`charts.${chartId}`, { native: { chart: { enabled } } });
      return;
    }
    const runtime = this.runtimes.get(chartId);
    if (control === "reset") {
      if (this.simulations.has(chartId)) {
        this.log.info(`Chart "${chart.name}" is not reset, it runs as simulation`);
      } else if (runtime) {
        this.log.info(`Chart "${chart.name}" is reset`);
        this.chartQueue = this.chartQueue.then(async () => {
          this.stopChart(chartId);
          await this.startChart(chartId, obj);
        }).catch((err) => this.log.error(`Cannot reset chart ${chartId}: ${err.message}`));
        await this.chartQueue;
      } else {
        this.log.info(`Chart "${chart.name}" is not reset, it does not run`);
      }
      await this.setState(id, false, true);
      return;
    }
    const name = String(val ?? "").trim();
    if (!runtime) {
      this.log.info(`Event "${name}" ignored, chart "${chart.name}" does not run`);
    } else if (!runtime.handleEvent(name)) {
      this.log.warn(`Chart "${chart.name}": unknown event "${name}", use the name of an input`);
    }
    await this.setState(id, name, true);
  }
  /**
   * Subscribes to all inputs of the running charts and unsubscribes from the ones no longer used
   */
  updateSubscriptions() {
    const needed = new Set([...this.runtimes.values()].flatMap((runtime) => runtime.subscribedStateIds));
    for (const id of needed) {
      if (!this.subscribedInputs.has(id)) {
        this.subscribeForeignStates(id);
      }
    }
    for (const id of this.subscribedInputs) {
      if (!needed.has(id)) {
        this.unsubscribeForeignStates(id);
      }
    }
    this.subscribedInputs = needed;
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback Callback function
   */
  onUnload(callback) {
    try {
      for (const timer of this.simulations.values()) {
        clearTimeout(timer);
      }
      this.simulations.clear();
      for (const runtime of this.runtimes.values()) {
        runtime.stop();
      }
      this.runtimes.clear();
      callback();
    } catch (error) {
      this.log.error(`Error during unloading: ${error.message}`);
      callback();
    }
  }
  /**
   * Is called if a subscribed object changes
   *
   * @param id Object ID
   * @param obj Object
   */
  onObjectChange(id, obj) {
    const chartId = this.getChartId(id);
    if (!chartId) {
      return;
    }
    this.chartQueue = this.chartQueue.then(async () => {
      this.endSimulationTimer(chartId);
      this.stopChart(chartId);
      await this.startChart(chartId, obj);
    }).catch((err) => this.log.error(`Cannot restart chart ${chartId}: ${err.message}`));
  }
  /**
   * Is called if a subscribed state changes
   *
   * @param id State ID
   * @param state State object
   */
  onStateChange(id, state) {
    if (!state) {
      return;
    }
    const own = this.parseChartStateId(id);
    if (own?.name === "history") {
      if (!state.ack) {
        this.histories.set(own.chartId, []);
        void this.setState(`charts.${own.chartId}.history`, "[]", true);
      }
      return;
    }
    if (own && CONTROLS.includes(own.name)) {
      if (!state.ack) {
        this.handleControl(own.chartId, own.name, state.val).catch(
          (err) => this.log.error(`Cannot execute ${id}: ${err.message}`)
        );
      }
      return;
    }
    for (const runtime of this.runtimes.values()) {
      runtime.handleStateChange(id, state);
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new Statechart(options);
} else {
  (() => new Statechart())();
}
//# sourceMappingURL=main.js.map
