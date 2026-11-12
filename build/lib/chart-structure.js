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
var chart_structure_exports = {};
__export(chart_structure_exports, {
  ChartStructure: () => ChartStructure,
  HISTORY_SUFFIX: () => HISTORY_SUFFIX,
  sortByOrder: () => sortByOrder
});
module.exports = __toCommonJS(chart_structure_exports);
function sortByOrder(states) {
  return [...states].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
}
const HISTORY_SUFFIX = "$history";
class ChartStructure {
  /**
   * @param chart The chart whose structure is prepared
   */
  constructor(chart) {
    this.chart = chart;
    this.statesById = new Map(chart.states.map((s) => [s.id, s]));
    for (const state of chart.states) {
      const parent = state.parent && this.statesById.has(state.parent) ? state.parent : "";
      this.childrenByParent.set(parent, [...this.childrenByParent.get(parent) || [], state]);
    }
    for (const transition of chart.transitions) {
      const list = this.transitionsBySource.get(transition.source) || [];
      this.transitionsBySource.set(transition.source, [...list, transition]);
    }
    for (const [parent, children] of this.childrenByParent) {
      if (this.isParallel(parent || null)) {
        this.childrenByParent.set(parent, sortByOrder(children));
      }
    }
    for (const list of this.transitionsBySource.values()) {
      list.sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER));
    }
  }
  /** All states by their ID */
  statesById;
  /** children by parent ID, "" for the top level */
  childrenByParent = /* @__PURE__ */ new Map();
  /** transitions by source, sorted by priority */
  transitionsBySource = /* @__PURE__ */ new Map();
  /**
   * @param parentId null for the top level
   * @returns true if the children of the state (or the top level states) are parallel
   */
  isParallel(parentId) {
    return !!(parentId ? this.statesById.get(parentId)?.parallel : this.chart.parallel);
  }
  /**
   * @param parentId null for the top level
   * @returns the children, those of a parallel state in their execution order
   */
  getChildren(parentId) {
    return this.childrenByParent.get(parentId || "") || [];
  }
  /**
   * The initial state of a level: the configured one if it is a child of this level, otherwise the first child
   *
   * @param parentId null for the top level
   * @returns undefined if the level has no states
   */
  getInitialChild(parentId) {
    const children = this.getChildren(parentId);
    const configured = parentId ? this.statesById.get(parentId)?.initial : this.chart.initial;
    return children.some((s) => s.id === configured) ? configured : children[0]?.id;
  }
  /**
   * @param stateId ID of the state
   * @returns true if the state has a history junction which is used: it has exclusive children
   */
  hasHistory(stateId) {
    return !!this.statesById.get(stateId)?.history && this.getChildren(stateId).length > 0 && !this.isParallel(stateId);
  }
  /**
   * The XState target of a transition. Like in Stateflow, all transitions ending at a state with history junction
   * enter it through the history junction, also its self transitions and those from its children.
   *
   * @param transition The transition
   * @returns the ID of the target state or of its history node
   */
  getTargetId(transition) {
    return this.hasHistory(transition.target) ? `${transition.target}${HISTORY_SUFFIX}` : transition.target;
  }
  /**
   * @param stateId ID of the source state
   * @returns the transitions starting at the state, sorted by priority
   */
  getTransitions(stateId) {
    return this.transitionsBySource.get(stateId) || [];
  }
  /**
   * @param ancestorId ID of the possible ancestor
   * @param id ID of the possible descendant
   * @returns true if the state "id" is a (direct or indirect) child of "ancestorId"
   */
  isDescendant(ancestorId, id) {
    let parent = this.statesById.get(id)?.parent;
    for (let i = 0; parent && i < this.statesById.size; i++) {
      if (parent === ancestorId) {
        return true;
      }
      parent = this.statesById.get(parent)?.parent;
    }
    return false;
  }
  /**
   * @param id ID of the state
   * @returns the state and its ancestors, the top level state first
   */
  getPath(id) {
    const path = [];
    for (let current = id; current && path.length <= this.statesById.size; ) {
      path.unshift(current);
      current = this.statesById.get(current)?.parent;
    }
    return path;
  }
  /**
   * Transitions between parallel states are not possible, also not between their children: both are active
   *
   * @param transition The transition
   * @returns the parallel state (null for the top level) whose children the transition connects, undefined if none
   */
  getCrossedParallel(transition) {
    const source = this.getPath(transition.source);
    const target = this.getPath(transition.target);
    for (let i = 0; i < Math.min(source.length, target.length); i++) {
      if (source[i] !== target[i]) {
        const parent = i ? source[i - 1] : null;
        return this.isParallel(parent) ? parent : void 0;
      }
    }
    return void 0;
  }
  /**
   * How a transition is executed
   *
   * @param transition The transition
   */
  getTransitionKind(transition) {
    const { source, target } = transition;
    const toChild = this.isDescendant(source, target);
    const inner = toChild && !transition.reenterParent;
    const reenter = source === target || toChild && !inner || this.isDescendant(target, source);
    return { inner, reenter };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ChartStructure,
  HISTORY_SUFFIX,
  sortByOrder
});
//# sourceMappingURL=chart-structure.js.map
