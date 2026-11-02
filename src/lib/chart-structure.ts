/*
 * The structure of a chart (hierarchy, transition order, kind of transitions) as the runtime executes it.
 * Shared by the runtime and the code generator, so the generated code always shows what is executed.
 */

import type { Chart, ChartState, ChartTransition } from "./chart-model";

/**
 * Sorts parallel sibling states by their execution order. The sort is stable: states without order keep their
 * order, after the others.
 *
 * @param states The siblings
 */
export function sortByOrder<T extends { order?: number }>(states: T[]): T[] {
    return [...states].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
}

export interface TransitionKind {
    /** checked after the during action of the source, the source stays active */
    inner: boolean;
    /** the source state is left and entered again (XState "reenter") */
    reenter: boolean;
}

export class ChartStructure {
    readonly statesById: Map<string, ChartState>;
    /** children by parent ID, "" for the top level */
    readonly childrenByParent = new Map<string, ChartState[]>();
    /** transitions by source, sorted by priority */
    readonly transitionsBySource = new Map<string, ChartTransition[]>();

    constructor(readonly chart: Chart) {
        this.statesById = new Map(chart.states.map(s => [s.id, s]));
        for (const state of chart.states) {
            // states with an unknown parent are treated like top level states
            const parent = state.parent && this.statesById.has(state.parent) ? state.parent : "";
            this.childrenByParent.set(parent, [...(this.childrenByParent.get(parent) || []), state]);
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
            // the sort is stable: transitions without priority keep their order, after the others
            list.sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER));
        }
    }

    /**
     * @param parentId null for the top level
     * @returns true if the children of the state (or the top level states) are parallel
     */
    isParallel(parentId: string | null): boolean {
        return !!(parentId ? this.statesById.get(parentId)?.parallel : this.chart.parallel);
    }

    /**
     * @param parentId null for the top level
     * @returns the children, those of a parallel state in their execution order
     */
    getChildren(parentId: string | null): ChartState[] {
        return this.childrenByParent.get(parentId || "") || [];
    }

    /**
     * The initial state of a level: the configured one if it is a child of this level, otherwise the first child
     *
     * @param parentId null for the top level
     * @returns undefined if the level has no states
     */
    getInitialChild(parentId: string | null): string | undefined {
        const children = this.getChildren(parentId);
        const configured = parentId ? this.statesById.get(parentId)?.initial : this.chart.initial;
        return children.some(s => s.id === configured) ? configured : children[0]?.id;
    }

    /**
     * @param stateId ID of the source state
     * @returns the transitions starting at the state, sorted by priority
     */
    getTransitions(stateId: string): ChartTransition[] {
        return this.transitionsBySource.get(stateId) || [];
    }

    /**
     * @param ancestorId ID of the possible ancestor
     * @param id ID of the possible descendant
     * @returns true if the state "id" is a (direct or indirect) child of "ancestorId"
     */
    isDescendant(ancestorId: string, id: string): boolean {
        let parent = this.statesById.get(id)?.parent;
        // the counter protects against cycles in invalid charts
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
    getPath(id: string): string[] {
        const path: string[] = [];
        // the counter protects against cycles in invalid charts
        for (let current: string | null | undefined = id; current && path.length <= this.statesById.size;) {
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
    getCrossedParallel(transition: ChartTransition): string | null | undefined {
        const source = this.getPath(transition.source);
        const target = this.getPath(transition.target);
        for (let i = 0; i < Math.min(source.length, target.length); i++) {
            if (source[i] !== target[i]) {
                const parent = i ? source[i - 1] : null;
                return this.isParallel(parent) ? parent : undefined;
            }
        }
        // the same state, or one is an ancestor of the other
        return undefined;
    }

    /**
     * How a transition is executed
     *
     * @param transition The transition
     */
    getTransitionKind(transition: ChartTransition): TransitionKind {
        const { source, target } = transition;
        const toChild = this.isDescendant(source, target);
        // an inner transition stays in the source state, only its active child is left
        const inner = toChild && !transition.reenterParent;
        // Like Stateflow, the source state is left and entered again by self transitions, by transitions
        // to an own child which should re-enter the parent, and by transitions from a child to its parent.
        // Without "reenter", XState does not leave the source state if the target is a child of it.
        const reenter = source === target || (toChild && !inner) || this.isDescendant(target, source);
        return { inner, reenter };
    }
}
