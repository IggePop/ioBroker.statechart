import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import vm from "node:vm";
import SunCalc from "suncalc";
import type { SunTimes } from "suncalc";
import { createActor, createMachine } from "xstate";
import type { AnyActor, AnyStateMachine } from "xstate";
import { isTimeBetween } from "./chart-helpers";
import { MAX_SUPER_STEPS, TIME_OF_DAY, TIME_UNITS, parseTransitionLabel } from "./chart-model";
import type { Chart, ChartState, ChartSymbol, ChartTransition, TemporalExpression } from "./chart-model";
import { ChartStructure } from "./chart-structure";
import { getDeclarations, prepareHelperCalls, validateChart } from "./chart-validation";
import type { CodeKind } from "./chart-validation";

/** Maximum run time of a single condition or action */
const SCRIPT_TIMEOUT_MS = 1000;

/** Longer delays are not supported by setTimeout() */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Version of the persisted data, increase on incompatible changes */
const PERSISTED_VERSION = 1;

/**
 * The persisted state of a running chart, restored when the adapter starts again
 */
export interface PersistedChart {
    /** See PERSISTED_VERSION */
    version: number;
    /** Of the chart logic, the data is only restored for an unchanged chart */
    hash: string;
    /** Persisted XState snapshot (active states) */
    machine: any;
    /** Time each active state was entered (ms since 1970) */
    entered: Record<string, number>;
    /** Values of the local variables */
    locals: Record<string, any>;
    /** Wakeups by each input since each active state was entered, by state (missing in older versions) */
    counts?: Record<string, Record<string, number>>;
    /** Since when the condition of each after(n, unit, condition) is true, by transition (missing in older versions) */
    trueSince?: Record<string, number>;
}

/**
 * A hash over everything which influences the execution, but not e.g. the positions in the editor
 *
 * @param chart The chart
 */
export function getChartHash(chart: Chart): string {
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
            }) => transition,
        ),
        functions: (chart.functions || []).map(fn => fn.code),
    };
    return crypto.createHash("sha1").update(JSON.stringify(logic)).digest("hex");
}

export interface Location {
    latitude: number;
    longitude: number;
}

/**
 * What woke up the chart: a change of an input, a timer of after(...), or the start of the chart
 */
export type WakeupCause = "input" | "timer" | "start";

/**
 * An event of a running chart, shown in the history of the editor
 */
export interface HistoryEntry {
    /** Time of the event (ms since 1970) */
    ts: number;
    /**
     * "start": the chart was started, "transition": a transition was taken,
     * "effect": a simulation did not write an output or did not execute setState() etc.
     */
    kind: "start" | "transition" | "effect";
    /** The chart runs as simulation */
    simulated?: boolean;
    /** Effect only: what was not executed, e.g. 'light = true' or 'setState("x", 1)' */
    text?: string;
    /** Start only: the chart continued with the state from before the restart of the adapter */
    restored?: boolean;
    /** Transition only: ID of the transition */
    transition?: string;
    /** Transition only: name of the source state */
    from?: string;
    /** Transition only: name of the target state */
    to?: string;
    /** Transition only: name of the input which woke up the chart, null for the other causes */
    trigger?: string | null;
    /** Transition only: what woke up the chart (missing in entries of older versions: input if trigger is set) */
    cause?: WakeupCause;
    /** Name paths of the active states after the event, e.g. "Auto.Heat" */
    active: string;
}

/**
 * The connection of a chart to the outside world, provided by the adapter
 */
export interface RuntimeHost {
    /** Reads the current value of a state */
    readState: (stateId: string) => Promise<any>;
    /** Reads a state with its ack flag and time stamps, for getState(), falls back to readState() */
    getState?: (stateId: string) => Promise<ioBroker.State | null | undefined>;
    /** Writes the value of a state */
    writeState: (stateId: string, val: any, ack?: boolean) => Promise<void>;
    /** Sends a message to an adapter */
    sendTo?: (instance: string, command: string, message: any) => void;
    /** Of the ioBroker system settings */
    getLocation?: () => Location | null;
    /** Called when the active states change */
    onActiveChange: (active: { names: string; ids: string[] }) => void;
    /** Stores the state of the chart, called when it changes */
    persist?: (data: PersistedChart) => void;
    /** Loads the stored state of the chart */
    loadPersisted?: () => Promise<PersistedChart | null>;
    /** Called with the values of all variables when one of them changed, after the chart processed a wakeup */
    onValues?: (values: Record<string, any>) => void;
    /** Called with the events of a start or a wakeup, in the order they happened */
    onHistory?: (entries: HistoryEntry[]) => void;
    log: Pick<ioBroker.Logger, LogLevel>;
}

type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * A transition which is checked on wakeups
 */
interface CheckedTransition {
    id: string;
    /** ID of the source state */
    source: string;
    /** Used in error messages */
    where: string;
    /** Name of the source state */
    from: string;
    /** Name of the target state */
    to: string;
    /** Name of the input which must have caused the wakeup */
    event?: string;
    /** Temporal transition, e.g. after(5, sec) */
    temporal?: TemporalExpression;
    /** The condition of after(n, unit, condition) */
    temporalCondition: vm.Script | null;
    condition: vm.Script | null;
}

/** What getState() returns, like the JavaScript adapter */
export interface StateSnapshot {
    val: any;
    ack: boolean;
    /** Time of the last update (ms since 1970) */
    ts: number;
    /** Time of the last change (ms since 1970) */
    lc: number;
}

/**
 * @param state A state of ioBroker
 * @returns the part of it which getState() returns, null if the state does not exist
 */
function toSnapshot(state: ioBroker.State | null | undefined): StateSnapshot | null {
    return state ? { val: state.val, ack: !!state.ack, ts: state.ts, lc: state.lc } : null;
}

/** A timer which may be re-armed, see ChartRuntime.scheduleAt() */
interface Timer {
    handle?: NodeJS.Timeout;
}

/**
 * Executes a single chart with XState.
 *
 * Wakeup semantics like Stateflow: every change of an input wakes up the chart once, as well as the timers of
 * the temporal transitions of the active states. Transitions with event are only checked when that input changed,
 * all others on every wakeup. Temporal transitions, measured from entering their source state:
 * - after(n, unit) is valid from n units on, so its condition is checked again on every following wakeup
 * - before(n, unit) is valid during the first n units, it has no timer
 * - at(n, unit) and every(n, unit) are only valid in the wakeup of their timer
 * - op(n, input) counts the wakeups by the input instead of the time, and is only valid in those wakeups
 * - after(n, unit, condition) is valid when the condition is true for n units, measured on the wakeups
 *
 * Starting with the active top level state, each active state is processed like this:
 * 1. its outer transitions, 2. its "during" action, 3. its inner transitions (to its own children),
 * 4. its active child. Processing stops as soon as a transition is taken.
 * The children of a parallel state (or the top level of a parallel chart) are all active: in step 4, each of them
 * is processed in its execution order. A transition in one of them does not stop the others, unless it left
 * the parallel state.
 *
 * The runtime selects the transition itself and sends an event for exactly this transition to XState,
 * which executes the exit, transition and entry actions in the right order.
 */
export class ChartRuntime {
    readonly structure: ChartStructure;
    readonly statesById: Map<string, ChartState>;
    /** timers of setStateDelayed() */
    readonly delayedWrites = new Set<NodeJS.Timeout>();
    /** values of all symbols, this is also the global scope of conditions and actions */
    readonly sandbox: vm.Context;
    /** last value written to (or read from) each output */
    readonly outputValues = new Map<string, any>();
    /** transitions which leave the source state, by source, sorted */
    readonly outerTransitions = new Map<string, CheckedTransition[]>();
    /** transitions to children of the source state, by source, sorted */
    readonly innerTransitions = new Map<string, CheckedTransition[]>();
    /** temporal transitions by source */
    readonly temporalTransitions = new Map<string, CheckedTransition[]>();
    /** all active states, parents before children */
    activeIds: string[] = [];
    /** time each active state was entered */
    readonly enteredAt = new Map<string, number>();
    /** how often each state was entered, to notice that a parallel state was left and entered again */
    readonly entryCount = new Map<string, number>();
    /** timers of the temporal transitions by state */
    readonly timers = new Map<string, Timer[]>();
    /** after(n, unit) transitions whose time has come */
    readonly expired = new Set<string>();
    /** at() and every() transitions whose timer caused the current wakeup */
    readonly firedTimers = new Set<string>();
    /** wakeups by each input since each active state was entered, by state */
    readonly inputCounts = new Map<string, Map<string, number>>();
    /** since when the condition of each after(n, unit, condition) of the active states is true, by transition */
    readonly trueSince = new Map<string, number>();
    /** timers of after(n, unit, condition), by transition */
    readonly durationTimers = new Map<string, Timer>();
    /** for duration(): since when the value of each call is true, by call and state */
    readonly durationCalls = new Map<string, { since: number; state: string | null }>();
    /** number of duration() calls found in the code, to give each of them an ID */
    durationCallCount = 0;
    /** the state whose condition or action is executed, used by elapsed() and duration() */
    context: string | null = null;
    /** timers of inputs with debounce, by variable name */
    readonly debounceTimers = new Map<string, NodeJS.Timeout>();
    /** JSON of the last persisted data, to persist only changes */
    lastPersisted = "";
    /** name paths of the active leaf states, like the "activeState" state */
    activeNames = "";
    /** events which are not yet passed to host.onHistory() */
    pendingHistory: HistoryEntry[] = [];
    /** JSON of the last values passed to host.onValues(), to pass only changes */
    lastValues = "";
    /** what caused the current wakeup, for the history */
    wakeupCause: WakeupCause = "input";
    /** name of the input which caused the current wakeup, for the history */
    wakeupInput: string | null = null;
    /** the code of conditions, actions and function blocks prepared for the change detection, by kind and code */
    readonly preparedCode = new Map<string, string>();
    /** the variables used by hasChanged() etc. */
    readonly changeVariables = new Set<string>();
    /** the IDs of the states read by getState(), they are read at the start and then kept up to date */
    readonly readStateIds = new Set<string>();
    /** the states read by getState(), null if a state does not exist */
    readonly stateCache = new Map<string, StateSnapshot | null>();
    /** their values at the start of the previous wakeup, null before the second wakeup */
    previousValues: Map<string, any> | null = null;
    /** their values at the start of the current wakeup, null before the first one */
    currentValues: Map<string, any> | null = null;
    readonly hash: string;
    actor: AnyActor | null = null;
    /** true while a wakeup is processed, effects outside of wakeups are published right away */
    wakingUp = false;
    /** the current time, can be replaced in tests */
    now = (): number => Date.now();

    /**
     * @param chartId ID of the chart object
     * @param chart The chart
     * @param host The connection to the outside world
     * @param simulated Simulation: the inputs are only changed by simulateInput(), outputs, setState() etc. are not
     * written but recorded in the history, nothing is persisted
     */
    constructor(
        readonly chartId: string,
        readonly chart: Chart,
        readonly host: RuntimeHost,
        readonly simulated = false,
    ) {
        this.structure = new ChartStructure(chart);
        this.statesById = this.structure.statesById;
        // the time units can be used in the helpers, e.g. elapsed(min)
        this.sandbox = vm.createContext({ ...this.createHelpers(), ...TIME_UNITS });
        this.hash = getChartHash(chart);
        this.prepareAllCode();
    }

    /**
     * Prepares all code of the chart for the change detection, so its variables are known from the first wakeup on
     */
    prepareAllCode(): void {
        for (const state of this.chart.states) {
            for (const code of [state.entry, state.during, state.exit]) {
                this.prepareCode(code, "statements");
            }
        }
        for (const transition of this.chart.transitions) {
            try {
                const label = parseTransitionLabel(transition.label);
                this.prepareCode(label.temporal?.condition, "expression");
                this.prepareCode(label.condition, "expression");
                this.prepareCode(label.action, "statements");
            } catch {
                // the transition is ignored, see buildTransition()
            }
        }
        for (const fn of this.chart.functions || []) {
            this.prepareCode(fn.code, "statements");
        }
    }

    /**
     * @param code A condition, action or function block
     * @param kind Expression or statements
     * @returns the code with the names of the variables in hasChanged() etc. and the IDs of the duration() calls,
     * see prepareHelperCalls()
     */
    prepareCode(code: string | undefined, kind: CodeKind): string {
        if (!code) {
            return "";
        }
        const key = `${kind}:${code}`;
        let prepared = this.preparedCode.get(key);
        if (prepared === undefined) {
            const quoted = prepareHelperCalls(code, kind, () => `d${++this.durationCallCount}`);
            prepared = quoted.code;
            for (const name of quoted.names) {
                this.changeVariables.add(name);
            }
            for (const id of quoted.stateIds) {
                this.readStateIds.add(id);
            }
            this.preparedCode.set(key, prepared);
        }
        return prepared;
    }

    /**
     * IDs of all states this chart reads
     */
    get inputStateIds(): string[] {
        return this.chart.symbols.filter(s => s.scope === "input" && s.stateId).map(s => s.stateId as string);
    }

    /**
     * IDs of all states whose changes must be passed to handleStateChange(): the inputs and the states read by
     * getState()
     */
    get subscribedStateIds(): string[] {
        // a simulation does not react on the real inputs
        return [...new Set([...(this.simulated ? [] : this.inputStateIds), ...this.readStateIds])];
    }

    /**
     * @param options Start options
     * @param options.restore Continue with the persisted state, if the chart was not changed since
     */
    async start(options: { restore?: boolean } = {}): Promise<void> {
        this.logProblems();
        for (const id of this.readStateIds) {
            try {
                let state;
                if (this.host.getState) {
                    state = await this.host.getState(id);
                } else {
                    const val = await this.host.readState(id);
                    // without ack and time stamps, undefined: the state does not exist
                    state =
                        val === undefined
                            ? null
                            : ({ val, ack: true, ts: this.now(), lc: this.now() } as ioBroker.State);
                }
                this.stateCache.set(id, toSnapshot(state));
            } catch (err) {
                this.host.log.warn(`[${this.chart.name}] Cannot read ${id}: ${err.message}`);
                this.stateCache.set(id, null);
            }
        }
        for (const symbol of this.chart.symbols) {
            if (symbol.scope === "local") {
                // a copy, so actions changing an object or array do not change the chart model
                this.sandbox[symbol.name] = structuredClone(symbol.initial);
            } else if (symbol.stateId) {
                const val = await this.host.readState(symbol.stateId);
                this.sandbox[symbol.name] = val;
                if (symbol.scope === "output") {
                    this.outputValues.set(symbol.name, val);
                }
            }
        }

        // defines the functions, without block around the code so they become globals of the sandbox
        for (const fn of this.chart.functions || []) {
            const where = `function block ${getDeclarations(fn.code)
                .map(d => d.name)
                .join(", ")}`;
            this.run(this.compile(this.prepareCode(fn.code, "statements"), where), where);
        }
        this.writeChangedOutputs();

        // effects of the entry actions are published together with the start, see recordEffect()
        this.wakingUp = true;
        const machine = createMachine(this.buildMachineConfig());
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
        // before the effects of the entry actions
        this.pendingHistory.unshift({ ts: this.now(), kind: "start", restored, active: this.activeNames });
        this.wakingUp = false;
        // like the first time step in Stateflow: transitions without event, whose condition is already true,
        // are taken right away instead of on the next change of an input
        this.wakeup(null, "start");
    }

    /**
     * Starts the chart in its initial state, the entry actions are executed
     *
     * @param machine The XState machine of the chart
     */
    startActor(machine: AnyStateMachine): void {
        this.activeIds = [];
        this.enteredAt.clear();
        this.actor = createActor(machine);
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
    restore(machine: AnyStateMachine, persisted: PersistedChart): void {
        for (const symbol of this.chart.symbols) {
            if (symbol.scope === "local" && symbol.name in persisted.locals) {
                this.sandbox[symbol.name] = persisted.locals[symbol.name];
            }
        }
        this.actor = createActor(machine, { snapshot: persisted.machine });
        this.subscribe();
        this.actor.start();
        this.publishActiveStates(this.actor.getSnapshot().value);
        for (const id of this.activeIds) {
            this.enteredAt.set(id, persisted.entered[id] ?? this.now());
            this.inputCounts.set(id, new Map(Object.entries(persisted.counts?.[id] ?? {})));
            for (const transition of this.temporalTransitions.get(id) || []) {
                const since = persisted.trueSince?.[transition.id];
                if (since !== undefined) {
                    // the timer is started when the condition is checked on the wakeup after the start
                    this.trueSince.set(transition.id, since);
                }
            }
            this.startTimers(id);
        }
    }

    subscribe(): void {
        this.actor?.subscribe({
            next: snapshot => this.publishActiveStates(snapshot.value),
            error: err => this.host.log.error(`[${this.chart.name}] ${String(err)}`),
        });
    }

    /**
     * @returns the persisted data, if it fits to this chart
     */
    async loadPersisted(): Promise<PersistedChart | null> {
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
        return {
            ...persisted,
            entered: persisted.entered || {},
            locals: persisted.locals || {},
            counts: persisted.counts || {},
            trueSince: persisted.trueSince || {},
        };
    }

    /**
     * Stores the current state of the chart, if it changed since the last time
     */
    persist(): void {
        // a simulation does not change the stored state of the real chart
        if (!this.actor || !this.host.persist || this.simulated) {
            return;
        }
        const data: PersistedChart = {
            version: PERSISTED_VERSION,
            hash: this.hash,
            machine: this.actor.getPersistedSnapshot(),
            entered: Object.fromEntries(this.enteredAt),
            locals: Object.fromEntries(
                this.chart.symbols.filter(s => s.scope === "local").map(s => [s.name, this.sandbox[s.name]]),
            ),
            counts: Object.fromEntries(
                [...this.inputCounts]
                    .filter(([, counts]) => counts.size)
                    .map(([id, counts]) => [id, Object.fromEntries(counts)]),
            ),
            trueSince: Object.fromEntries(this.trueSince),
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
    onEnter(id: string): void {
        this.enteredAt.set(id, this.now());
        this.entryCount.set(id, (this.entryCount.get(id) ?? 0) + 1);
        this.inputCounts.set(id, new Map());
        this.startTimers(id);
    }

    /**
     * Called by XState after the exit action of a state
     *
     * @param id ID of the state
     */
    onExit(id: string): void {
        this.enteredAt.delete(id);
        for (const timer of this.timers.get(id) || []) {
            clearTimeout(timer.handle);
        }
        this.timers.delete(id);
        this.inputCounts.delete(id);
        for (const transition of this.temporalTransitions.get(id) || []) {
            this.expired.delete(transition.id);
            this.stopDuration(transition.id);
        }
        // duration() starts again when the state is entered again
        for (const [key, call] of this.durationCalls) {
            if (call.state === id) {
                this.durationCalls.delete(key);
            }
        }
    }

    /**
     * Stops measuring how long the condition of an after(n, unit, condition) is true
     *
     * @param id ID of the transition
     */
    stopDuration(id: string): void {
        this.trueSince.delete(id);
        clearTimeout(this.durationTimers.get(id)?.handle);
        this.durationTimers.delete(id);
    }

    /**
     * Calls the callback at the given time, also after delays which are too long for setTimeout()
     *
     * @param due The time (ms since 1970), the callback is called right away if it has passed
     * @param timer Gets the handle of the timeout, to clear it
     * @param callback Called at the time
     */
    scheduleAt(due: number, timer: Timer, callback: () => void): void {
        const remaining = due - this.now();
        timer.handle = setTimeout(
            () => {
                if (remaining > MAX_TIMEOUT_MS && due - this.now() > 0) {
                    this.scheduleAt(due, timer, callback);
                } else {
                    callback();
                }
            },
            Math.min(Math.max(remaining, 0), MAX_TIMEOUT_MS),
        );
    }

    /**
     * Starts a timer for every temporal transition of a state, which wakes up the chart when its time has come
     *
     * @param id ID of the state
     */
    startTimers(id: string): void {
        const entered = this.enteredAt.get(id) ?? this.now();
        const timers: Timer[] = [];
        this.timers.set(id, timers);
        for (const transition of this.temporalTransitions.get(id) || []) {
            const { operator, ms, condition, time } = transition.temporal as TemporalExpression;
            if (time !== undefined) {
                const timer: Timer = {};
                timers.push(timer);
                this.scheduleDaily(id, transition, timer, this.now());
                continue;
            }
            // before() needs no timer, counting expressions wait for their input, and the timer of
            // after(n, unit, condition) starts when the condition is true
            if (ms === undefined || operator === "before" || condition !== undefined) {
                continue;
            }
            const timer: Timer = {};
            timers.push(timer);
            const fire = (due: number): void => {
                if (operator === "after") {
                    this.expired.add(transition.id);
                    this.wakeup(null);
                    return;
                }
                this.firedTimers.add(transition.id);
                try {
                    this.wakeup(null);
                } finally {
                    this.firedTimers.delete(transition.id);
                }
                // unless the wakeup left the state
                if (operator === "every" && this.timers.get(id)?.includes(timer)) {
                    this.scheduleAt(due + ms, timer, () => fire(due + ms));
                }
            };
            let due = entered + ms;
            if (operator === "every" && due < this.now()) {
                // after a restart: the next time in the rhythm, the times missed while the adapter was stopped are skipped
                due = entered + Math.ceil((this.now() - entered) / ms) * ms;
            }
            this.scheduleAt(due, timer, () => fire(due));
        }
    }

    /**
     * Starts the timer of at("sunset", offset) or at("22:30") for the next time, which wakes up the chart
     *
     * @param stateId ID of the source state
     * @param transition The transition
     * @param timer Gets the handle of the timeout
     * @param after The timer is started for the next time after this one (ms since 1970)
     */
    scheduleDaily(stateId: string, transition: CheckedTransition, timer: Timer, after: number): void {
        let due;
        try {
            due = this.getNextDailyTime(transition.temporal as TemporalExpression, after);
        } catch (err) {
            this.host.log.warn(`[${this.chart.name}] ${transition.where}: ${err.message}`);
            return;
        }
        if (due === null) {
            // e.g. no sunset for a week in polar regions: checked again tomorrow
            this.scheduleAt(after + DAY_MS, timer, () =>
                this.scheduleDaily(stateId, transition, timer, after + DAY_MS),
            );
            return;
        }
        this.scheduleAt(due, timer, () => {
            this.firedTimers.add(transition.id);
            try {
                this.wakeup(null);
            } finally {
                this.firedTimers.delete(transition.id);
            }
            // the next day, unless the wakeup left the state
            if (this.timers.get(stateId)?.includes(timer)) {
                this.scheduleDaily(stateId, transition, timer, Math.max(due, this.now()));
            }
        });
    }

    /**
     * @param temporal at("sunset", offset) or at("22:30")
     * @param after The time is searched after this one (ms since 1970)
     * @returns the next time (ms since 1970), null if there is none in the next week (astro events in polar regions)
     * @throws {Error} for astro events if no location is configured
     */
    getNextDailyTime(temporal: TemporalExpression, after: number): number | null {
        const time = temporal.time as string;
        const offset = (temporal.offsetMinutes ?? 0) * 60_000;
        const day = new Date(after);
        // yesterday as well: with a positive offset, the time of yesterday may still come
        day.setDate(day.getDate() - 1);
        for (let i = 0; i < 9; i++) {
            let at: number | null;
            if (TIME_OF_DAY.test(time)) {
                const [hours, minutes, seconds = 0] = time.split(":").map(Number);
                at = new Date(day).setHours(hours, minutes, seconds, 0);
            } else {
                // noon, so the astro events are those of this day
                const event = this.getSunTimes(new Date(new Date(day).setHours(12, 0, 0, 0)))[time];
                at = event instanceof Date ? event.getTime() : null;
            }
            if (at !== null && at + offset > after) {
                return at + offset;
            }
            day.setDate(day.getDate() + 1);
        }
        return null;
    }

    /**
     * Logs the problems found by the validation, the chart is started anyway
     */
    logProblems(): void {
        for (const { kind, id, field, diagnostic } of validateChart(this.chart)) {
            let where;
            if (kind === "state") {
                where = `${this.statesById.get(id)?.name ?? id}/${field}`;
            } else if (kind === "function") {
                const fn = this.chart.functions?.find(f => f.id === id);
                where = `Function block ${getDeclarations(fn?.code)
                    .map(d => d.name)
                    .join(", ")}`;
            } else {
                const transition = this.chart.transitions.find(t => t.id === id);
                const source = this.statesById.get(transition?.source ?? "")?.name;
                const target = this.statesById.get(transition?.target ?? "")?.name;
                where = `Transition ${source} -> ${target}`;
            }
            const log = diagnostic.severity === "error" ? this.host.log.error : this.host.log.warn;
            log(`[${this.chart.name}] ${where}: ${diagnostic.message}`);
        }
    }

    stop(): void {
        this.actor?.stop();
        this.actor = null;
        for (const timers of this.timers.values()) {
            for (const timer of timers) {
                clearTimeout(timer.handle);
            }
        }
        this.timers.clear();
        this.expired.clear();
        for (const timer of this.durationTimers.values()) {
            clearTimeout(timer.handle);
        }
        this.durationTimers.clear();
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
    createHelpers(): Record<string, (...args: any[]) => any> {
        const prefix = `[${this.chart.name}]`;
        const write = (id: string, value: any, ack: boolean): Promise<void> =>
            this.host
                .writeState(String(id), value, !!ack)
                .catch(err => this.host.log.warn(`${prefix} Cannot write ${id}: ${err}`));
        const describe = (name: string, args: any[]): string =>
            `${name}(${args.map(arg => (arg === undefined ? "undefined" : JSON.stringify(arg))).join(", ")})`;
        return {
            log: (message: string, level = "info") => {
                const method: LogLevel = ["debug", "info", "warn", "error"].includes(level)
                    ? (level as LogLevel)
                    : "info";
                this.host.log[method](`${prefix} ${message}`);
            },
            setState: (id: string, value: any, ack = false) => {
                if (this.simulated) {
                    this.recordEffect(describe("setState", [id, value, ...(ack ? [true] : [])]));
                    return;
                }
                void write(id, value, ack);
            },
            setStateDelayed: (id: string, value: any, delayMs: number, ack = false) => {
                const timer = setTimeout(
                    () => {
                        this.delayedWrites.delete(timer);
                        if (this.simulated) {
                            this.recordEffect(describe("setState", [id, value, ...(ack ? [true] : [])]));
                            return;
                        }
                        void write(id, value, ack);
                    },
                    Math.min(Math.max(Number(delayMs) || 0, 0), MAX_TIMEOUT_MS),
                );
                this.delayedWrites.add(timer);
            },
            sendTo: (instance: string, command: string, message: any) => {
                if (this.simulated) {
                    this.recordEffect(describe("sendTo", [instance, command, message]));
                    return;
                }
                if (!this.host.sendTo) {
                    throw new Error("sendTo() is not available");
                }
                this.host.sendTo(String(instance), String(command), message);
            },
            isTimeBetween: (start: string, end: string) => isTimeBetween(start, end, new Date(this.now())),
            isDaytime: () => {
                const now = new Date(this.now());
                const { sunrise, sunset, alwaysUp } = this.getSunTimes(now);
                // in polar regions there may be no sunrise or sunset: the sun is up or down all day
                if (!sunrise || !sunset) {
                    return !!alwaysUp;
                }
                return now >= sunrise && now < sunset;
            },
            astroTime: (name: string, offsetMinutes = 0) => {
                const times = this.getSunTimes(new Date(this.now()));
                const time = times[name];
                if (!(time instanceof Date)) {
                    // the events are null if they do not happen on that day, the flags are no events
                    const known = name in times && name !== "alwaysUp" && name !== "alwaysDown";
                    throw new Error(
                        known
                            ? `There is no "${name}" today at the location of the system settings`
                            : `Unknown astro event "${name}"`,
                    );
                }
                return new Date(time.getTime() + (Number(offsetMinutes) || 0) * 60_000);
            },
            getState: (id: string) => {
                if (!this.stateCache.has(id)) {
                    throw new Error(
                        `getState() can only read states whose ID is written as text, e.g. getState("${id}")`,
                    );
                }
                const state = this.stateCache.get(id);
                // a copy, so the code cannot change the cache
                return state ? { ...state } : null;
            },
            elapsed: (unit = TIME_UNITS.sec) => {
                const entered = this.context === null ? undefined : this.enteredAt.get(this.context);
                if (entered === undefined) {
                    throw new Error("elapsed() can only be used in conditions and in the actions of states");
                }
                return (this.now() - entered) / unit;
            },
            // the ID of the call is added by prepareHelperCalls()
            duration: (call: string, value: any, unit = TIME_UNITS.sec) => {
                const key = `${call}@${this.context}`;
                if (!value) {
                    this.durationCalls.delete(key);
                    return 0;
                }
                const since = this.durationCalls.get(key)?.since ?? this.now();
                this.durationCalls.set(key, { since, state: this.context });
                return (this.now() - since) / unit;
            },
            hasChanged: (name: string) => this.getChange(name, "hasChanged").changed,
            hasChangedFrom: (name: string, value: any) => {
                const { changed, previous } = this.getChange(name, "hasChangedFrom");
                return changed && isDeepStrictEqual(previous, value);
            },
            hasChangedTo: (name: string, value: any) => {
                const { changed, current } = this.getChange(name, "hasChangedTo");
                return changed && isDeepStrictEqual(current, value);
            },
        };
    }

    /**
     * @param date The day
     * @returns the astro events of the day, null for events which do not happen on that day (polar regions)
     * @throws {Error} if no location is configured
     */
    getSunTimes(date: Date): SunTimes {
        const location = this.host.getLocation?.();
        if (!location) {
            throw new Error("No location (latitude/longitude) configured in the ioBroker system settings");
        }
        return SunCalc.getTimes(date, location.latitude, location.longitude);
    }

    /**
     * Must be called when one of the subscribedStateIds is updated
     *
     * @param stateId ID of the updated state
     * @param state The new state
     */
    handleStateChange(stateId: string, state: ioBroker.State): void {
        if (this.readStateIds.has(stateId)) {
            this.stateCache.set(stateId, toSnapshot(state));
        }
        if (!this.simulated) {
            this.handleInput(stateId, state.val, { ack: state.ack });
        }
    }

    /**
     * Simulation: sets the value of an input and wakes up the chart, like a change of the input
     *
     * @param name Name of the input
     * @param val The new value
     * @returns false if the chart has no input with this name
     */
    simulateInput(name: string, val: any): boolean {
        const symbol = this.chart.symbols.find(s => s.scope === "input" && s.name === name);
        if (!symbol || !this.actor) {
            return false;
        }
        // the filters by ack and the debounce do not apply to values set by hand
        this.applyInput(symbol, val);
        return true;
    }

    /**
     * Simulation: records something which was not executed, shown in the history
     *
     * @param text What was not executed
     */
    recordEffect(text: string): void {
        this.pendingHistory.push({ ts: this.now(), kind: "effect", text, active: this.activeNames });
        // e.g. setStateDelayed(): its time came without a wakeup
        if (!this.wakingUp) {
            this.publishLive();
        }
    }

    /**
     * Must be called when an input state is updated
     *
     * @param stateId ID of the updated state
     * @param val The new value
     * @param options The ack flag of the update
     * @param options.ack The ack flag of the update
     */
    handleInput(stateId: string, val: any, options: { ack?: boolean } = {}): void {
        if (!this.actor) {
            return;
        }
        for (const symbol of this.chart.symbols) {
            if (symbol.scope !== "input" || symbol.stateId !== stateId) {
                continue;
            }
            // an update which is filtered out does not change the variable either
            if ((symbol.ack === "ack" && options.ack !== true) || (symbol.ack === "command" && options.ack !== false)) {
                continue;
            }
            const debounceMs = symbol.debounceMs || 0;
            if (debounceMs > 0) {
                // wake up only after the input was quiet for the debounce time, with its last value
                clearTimeout(this.debounceTimers.get(symbol.name));
                this.debounceTimers.set(
                    symbol.name,
                    setTimeout(() => {
                        this.debounceTimers.delete(symbol.name);
                        this.applyInput(symbol, val);
                    }, debounceMs),
                );
            } else {
                this.applyInput(symbol, val);
            }
        }
    }

    /**
     * Wakes up the chart with the event of an input, without changing the value of the input
     * (state charts.<chart>.event)
     *
     * @param name Name of the input
     * @returns false if the chart has no input with this name
     */
    handleEvent(name: string): boolean {
        if (!this.chart.symbols.some(s => s.scope === "input" && s.name === name)) {
            return false;
        }
        this.wakeup(name);
        return true;
    }

    /**
     * Sets the variable of an input and wakes up the chart
     *
     * @param symbol The input
     * @param val The new value
     */
    applyInput(symbol: ChartSymbol, val: any): void {
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
    wakeup(input: string | null, cause: WakeupCause = input === null ? "timer" : "input"): void {
        if (!this.actor) {
            return;
        }
        this.wakeupCause = cause;
        this.wakeupInput = input;
        this.wakingUp = true;
        try {
            this.processWakeup(input);
            // functions called in conditions may have changed outputs as well
            this.writeChangedOutputs();
        } finally {
            this.wakingUp = false;
        }
        this.persist();
        this.publishLive();
    }

    /**
     * @param input Name of the input which caused the wakeup, null for timers and the start
     */
    processWakeup(input: string | null): void {
        this.rememberValues();
        if (input !== null) {
            for (const [id, counts] of this.inputCounts) {
                // only the inputs counted by the state, so other wakeups do not change the persisted data
                if (this.temporalTransitions.get(id)?.some(t => t.temporal?.event === input)) {
                    counts.set(input, (counts.get(input) ?? 0) + 1);
                }
            }
        }
        this.updateDurations();
        if (!this.chart.superStep) {
            this.step(input);
        } else {
            // super step: take transitions until none is valid anymore. Like in Stateflow, the event of the input
            // is only present in the first step, the following steps check the transitions without event.
            let steps = 0;
            let stepInput = input;
            while (steps < MAX_SUPER_STEPS && this.step(stepInput)) {
                steps++;
                stepInput = null;
            }
            if (steps >= MAX_SUPER_STEPS) {
                this.host.log.warn(
                    `[${this.chart.name}] Stopped after ${MAX_SUPER_STEPS} transitions in one wakeup, the transitions probably form a loop. The chart continues on the next wakeup.`,
                );
            }
        }
        // the states entered by this wakeup start measuring their after(n, unit, condition)
        this.updateDurations();
    }

    /**
     * Checks the conditions of after(n, unit, condition) of the active states, and starts a timer which wakes up the
     * chart when a condition has been true for the time
     */
    updateDurations(): void {
        for (const id of this.activeIds) {
            for (const transition of this.temporalTransitions.get(id) || []) {
                const temporal = transition.temporal as TemporalExpression;
                if (temporal.condition === undefined) {
                    continue;
                }
                if (!this.run(transition.temporalCondition, `${transition.where}/after condition`, id)) {
                    this.stopDuration(transition.id);
                    continue;
                }
                const since = this.trueSince.get(transition.id) ?? this.now();
                this.trueSince.set(transition.id, since);
                if (!this.durationTimers.has(transition.id)) {
                    const timer: Timer = {};
                    this.durationTimers.set(transition.id, timer);
                    this.scheduleAt(since + (temporal.ms as number), timer, () => {
                        this.durationTimers.delete(transition.id);
                        this.wakeup(null);
                    });
                }
            }
        }
    }

    /**
     * Stores the values of the variables used by the change detection at the start of a wakeup
     */
    rememberValues(): void {
        if (!this.changeVariables.size) {
            return;
        }
        this.previousValues = this.currentValues;
        this.currentValues = new Map();
        for (const name of this.changeVariables) {
            const value = this.sandbox[name];
            let copy;
            try {
                // a copy, so a change of an object or array by an action is detected as well
                copy = structuredClone(value);
            } catch {
                copy = value;
            }
            this.currentValues.set(name, copy);
        }
    }

    /**
     * @param name Name of the variable
     * @param helper Name of the helper, for the error message
     * @returns whether the variable has changed between the start of the previous and of the current wakeup
     * @throws {Error} if the variable is unknown
     */
    getChange(name: string, helper: string): { changed: boolean; previous?: any; current?: any } {
        if (!this.changeVariables.has(name) || !this.chart.symbols.some(s => s.name === name)) {
            throw new Error(`${helper}() needs a variable of the chart as first argument`);
        }
        // nothing has changed before the second wakeup, as in Stateflow
        if (!this.previousValues || !this.currentValues) {
            return { changed: false };
        }
        const previous = this.previousValues.get(name);
        const current = this.currentValues.get(name);
        return { changed: !isDeepStrictEqual(previous, current), previous, current };
    }

    /**
     * Processes the active states once, see the class description
     *
     * @param input Name of the input which caused the wakeup, null if the step has no event
     * @returns true if a transition was taken
     */
    step(input: string | null): boolean {
        return this.processChildren(null, input);
    }

    /**
     * Passes the events since the last call and the changed values of the variables to the host
     */
    publishLive(): void {
        if (this.pendingHistory.length) {
            const entries = this.simulated
                ? this.pendingHistory.map(entry => ({ ...entry, simulated: true }))
                : this.pendingHistory;
            this.pendingHistory = [];
            this.host.onHistory?.(entries);
        }
        if (!this.host.onValues) {
            return;
        }
        const values = Object.fromEntries(this.chart.symbols.map(s => [s.name, this.sandbox[s.name]]));
        let json;
        try {
            json = JSON.stringify(values);
        } catch {
            // e.g. a circular object in a local: the values are shown as text then
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
    processState(id: string, input: string | null): boolean {
        if (this.takeFirstValid(this.outerTransitions.get(id), input)) {
            return true;
        }
        const state = this.statesById.get(id);
        if (state?.during) {
            this.runAction(state.during, `${state.name}/during`, id);
        }
        if (this.takeFirstValid(this.innerTransitions.get(id), input)) {
            return true;
        }
        return this.processChildren(id, input);
    }

    /**
     * Processes the active child of a state, or all children of a parallel state, see the class description
     *
     * @param parent ID of the state, null for the top level
     * @param input Name of the input which caused the wakeup, null for timers
     * @returns true if a transition was taken
     */
    processChildren(parent: string | null, input: string | null): boolean {
        if (!this.structure.isParallel(parent)) {
            for (const child of this.getActiveChildren(parent)) {
                if (this.processState(child, input)) {
                    return true;
                }
            }
            return false;
        }
        const entries = parent && this.entryCount.get(parent);
        let taken = false;
        for (const child of this.structure.getChildren(parent)) {
            // a transition of a previous child left the parallel state (and maybe entered it again)
            if (parent && (!this.activeIds.includes(parent) || this.entryCount.get(parent) !== entries)) {
                break;
            }
            if (this.activeIds.includes(child.id) && this.processState(child.id, input)) {
                taken = true;
            }
        }
        return taken;
    }

    /**
     * @param parent null for the top level
     */
    getActiveChildren(parent: string | null): string[] {
        const children = new Set(this.structure.getChildren(parent).map(s => s.id));
        return this.activeIds.filter(id => children.has(id));
    }

    /**
     * Takes the first transition whose event and condition match
     *
     * @param transitions The transitions to check, sorted
     * @param input Name of the input which caused the wakeup, null for timers
     * @returns true if a transition was taken
     */
    takeFirstValid(transitions: CheckedTransition[] | undefined, input: string | null): boolean {
        for (const transition of transitions || []) {
            if (!this.isTriggered(transition, input)) {
                continue;
            }
            if (
                transition.condition &&
                !this.run(transition.condition, `${transition.where}/condition`, transition.source)
            ) {
                continue;
            }
            // the transition is listed before the effects of its actions
            const at = this.pendingHistory.length;
            this.actor?.send({ type: `T.${transition.id}` });
            // XState has executed the transition synchronously, so the active states are the new ones
            this.pendingHistory.splice(at, 0, {
                ts: this.now(),
                kind: "transition",
                transition: transition.id,
                from: transition.from,
                to: transition.to,
                // in a super step, all transitions of the wakeup were caused by its input
                trigger: this.wakeupInput,
                cause: this.wakeupCause,
                active: this.activeNames,
            });
            return true;
        }
        return false;
    }

    /**
     * @param transition The transition
     * @param input Name of the input which caused the wakeup, null for timers
     * @returns true if its event and its temporal expression allow it in this wakeup (the condition is not checked)
     */
    isTriggered(transition: CheckedTransition, input: string | null): boolean {
        if (transition.event && transition.event !== input) {
            return false;
        }
        const temporal = transition.temporal;
        if (!temporal) {
            return true;
        }
        if (temporal.event !== undefined) {
            if (temporal.event !== input) {
                return false;
            }
            const count = this.inputCounts.get(transition.source)?.get(temporal.event) ?? 0;
            const n = temporal.count as number;
            switch (temporal.operator) {
                case "after":
                    return count >= n;
                case "before":
                    return count < n;
                case "at":
                    return count === n;
                case "every":
                    return count % n === 0;
            }
        }
        const ms = temporal.ms as number;
        if (temporal.condition !== undefined) {
            const since = this.trueSince.get(transition.id);
            return since !== undefined && this.now() - since >= ms;
        }
        const entered = this.enteredAt.get(transition.source);
        switch (temporal.operator) {
            case "after":
                // the timer may fire a bit early, or not at all while the adapter was stopped
                return this.expired.has(transition.id) || (entered !== undefined && this.now() - entered >= ms);
            case "before":
                return entered !== undefined && this.now() - entered < ms;
            default:
                // at() and every()
                return this.firedTimers.has(transition.id);
        }
    }

    buildMachineConfig(): any {
        const structure = this.structure;

        const buildState = (state: ChartState): any => {
            const node: any = {
                id: state.id,
                entry: [
                    () => this.onEnter(state.id),
                    ...(state.entry ? [() => this.runAction(state.entry, `${state.name}/entry`, state.id)] : []),
                ],
                exit: [
                    ...(state.exit ? [() => this.runAction(state.exit, `${state.name}/exit`, state.id)] : []),
                    () => this.onExit(state.id),
                ],
                on: {},
            };

            const outer: CheckedTransition[] = [];
            const inner: CheckedTransition[] = [];
            for (const transition of structure.getTransitions(state.id)) {
                const built = this.buildTransition(transition, state);
                if (!built) {
                    continue;
                }
                // all transitions are selected by processState(), XState only executes them
                node.on[`T.${transition.id}`] = built.config;
                (built.inner ? inner : outer).push(built.checked);
            }
            this.outerTransitions.set(state.id, outer);
            this.innerTransitions.set(state.id, inner);
            this.temporalTransitions.set(
                state.id,
                [...outer, ...inner].filter(t => t.temporal !== undefined),
            );

            const subStates = structure.getChildren(state.id);
            if (subStates.length) {
                if (structure.isParallel(state.id)) {
                    // all children are active, XState enters them in their execution order
                    node.type = "parallel";
                } else {
                    node.initial = structure.getInitialChild(state.id);
                }
                node.states = Object.fromEntries(subStates.map(s => [s.id, buildState(s)]));
            }
            return node;
        };

        const topLevel = structure.getChildren(null);
        if (!topLevel.length) {
            throw new Error("The chart has no states");
        }
        return {
            id: `chart_${this.chartId}`,
            ...(structure.isParallel(null) ? { type: "parallel" } : { initial: structure.getInitialChild(null) }),
            states: Object.fromEntries(topLevel.map(s => [s.id, buildState(s)])),
        };
    }

    /**
     * @param transition The transition
     * @param source Its source state
     */
    buildTransition(
        transition: ChartTransition,
        source: ChartState,
    ): { inner: boolean; config: any; checked: CheckedTransition } | null {
        const target = this.statesById.get(transition.target);
        const where = `${source.name} -> ${target?.name ?? transition.target}`;
        if (!target) {
            this.host.log.warn(`[${this.chart.name}] Transition ${where}: unknown target, ignored`);
            return null;
        }
        if (this.structure.getCrossedParallel(transition) !== undefined) {
            // already logged as problem of the chart
            return null;
        }

        let label;
        try {
            label = parseTransitionLabel(transition.label);
        } catch (err) {
            this.host.log.error(`[${this.chart.name}] Transition ${where}: ${err.message}, ignored`);
            return null;
        }

        const condition = label.condition
            ? this.compile(`(${this.prepareCode(label.condition, "expression")})`, `${where}/condition`)
            : null;
        const temporalCondition = label.temporal?.condition
            ? this.compile(`(${this.prepareCode(label.temporal.condition, "expression")})`, `${where}/after condition`)
            : null;
        const { inner, reenter } = this.structure.getTransitionKind(transition);
        const config = {
            target: `#${target.id}`,
            reenter,
            actions: label.action ? [() => this.runAction(label.action, `${where}/action`, source.id)] : [],
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
                temporal: label.temporal,
                temporalCondition,
                condition,
            },
        };
    }

    /**
     * @param code The code
     * @param where Used in error messages
     */
    compile(code: string, where: string): vm.Script | null {
        try {
            return new vm.Script(code, { filename: `${this.chart.name}/${where}` });
        } catch (err) {
            this.host.log.error(`[${this.chart.name}] ${where}: ${err.message}`);
            return null;
        }
    }

    /**
     * @param script The compiled code
     * @param where Used in error messages
     * @param context The state whose condition or action it is, for elapsed() and duration()
     */
    run(script: vm.Script | null, where: string, context: string | null = this.context): any {
        if (!script) {
            return undefined;
        }
        const previous = this.context;
        this.context = context;
        try {
            return script.runInContext(this.sandbox, { timeout: SCRIPT_TIMEOUT_MS });
        } catch (err) {
            this.host.log.warn(`[${this.chart.name}] ${where}: ${err.message}`);
            return undefined;
        } finally {
            this.context = previous;
        }
    }

    /**
     * Executes an action and writes all changed outputs
     *
     * @param code The action
     * @param where Used in error messages
     * @param context The state whose action it is (the source state for transition actions)
     */
    runAction(code: string | undefined, where: string, context: string): void {
        // the block keeps "let" and "const" declarations local to this action
        this.run(this.compile(`{\n${this.prepareCode(code, "statements")}\n}`, where), where, context);
        this.writeChangedOutputs();
    }

    writeChangedOutputs(): void {
        for (const symbol of this.chart.symbols) {
            if (symbol.scope !== "output" || !symbol.stateId) {
                continue;
            }
            const val = this.sandbox[symbol.name];
            if (val !== this.outputValues.get(symbol.name)) {
                this.outputValues.set(symbol.name, val);
                if (this.simulated) {
                    this.recordEffect(`${symbol.name} = ${val === undefined ? "undefined" : JSON.stringify(val)}`);
                    continue;
                }
                this.host
                    .writeState(symbol.stateId, val)
                    .catch(err => this.host.log.warn(`[${this.chart.name}] Cannot write ${symbol.stateId}: ${err}`));
            }
        }
    }

    /**
     * @param value XState state value
     */
    publishActiveStates(value: any): void {
        /** all active states, parents before children */
        const ids: string[] = [];
        /** name paths of the active leaf states */
        const names: string[] = [];

        const walk = (val: any, path: string[]): void => {
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
