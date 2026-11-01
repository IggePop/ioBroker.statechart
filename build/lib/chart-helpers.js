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
var chart_helpers_exports = {};
__export(chart_helpers_exports, {
  CHANGE_HELPERS: () => CHANGE_HELPERS,
  HELPERS: () => HELPERS,
  isTimeBetween: () => isTimeBetween,
  parseTime: () => parseTime
});
module.exports = __toCommonJS(chart_helpers_exports);
const HELPERS = {
  log: {
    signature: 'log(message, level = "info")',
    description: 'Writes a message to the ioBroker log, level "debug", "info", "warn" or "error"'
  },
  setState: {
    signature: "setState(id, value, ack = false)",
    description: "Writes a value to any ioBroker state"
  },
  setStateDelayed: {
    signature: "setStateDelayed(id, value, delayMs, ack = false)",
    description: "Writes a value after a delay, cancelled when the chart stops"
  },
  sendTo: {
    signature: "sendTo(instance, command, message)",
    description: 'Sends a message to an adapter, e.g. sendTo("telegram.0", "send", { text: "Hello" })'
  },
  isTimeBetween: {
    signature: 'isTimeBetween("22:00", "06:00")',
    description: "true if the current time is in the range, also over midnight"
  },
  isDaytime: {
    signature: "isDaytime()",
    description: "true between sunrise and sunset, at the location of the ioBroker system settings"
  },
  astroTime: {
    signature: 'astroTime("sunset", offsetMinutes = 0)',
    description: "Time of an astro event today: sunrise, sunset, dawn, dusk, solarNoon, nauticalDawn, nauticalDusk, goldenHour, goldenHourEnd, night, nightEnd"
  },
  hasChanged: {
    signature: "hasChanged(variable)",
    description: "true if the value of the variable at the start of this wakeup differs from the value at the start of the previous wakeup"
  },
  hasChangedFrom: {
    signature: "hasChangedFrom(variable, value)",
    description: "true if the variable has changed (see hasChanged) and its previous value was the given value"
  },
  hasChangedTo: {
    signature: "hasChangedTo(variable, value)",
    description: "true if the variable has changed (see hasChanged) to the given value, e.g. hasChangedTo(button, true)"
  }
};
const CHANGE_HELPERS = /* @__PURE__ */ new Set(["hasChanged", "hasChangedFrom", "hasChangedTo"]);
function parseTime(time) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(time).trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] ?? 0) > 59) {
    throw new Error(`Invalid time "${time}", expected e.g. "22:30"`);
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
}
function isTimeBetween(start, end, now = /* @__PURE__ */ new Date()) {
  const from = parseTime(start);
  const to = parseTime(end);
  const current = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  return from <= to ? current >= from && current < to : current >= from || current < to;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CHANGE_HELPERS,
  HELPERS,
  isTimeBetween,
  parseTime
});
//# sourceMappingURL=chart-helpers.js.map
