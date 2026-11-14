/*
 * The chart model shared by the editor (admin tab) and the runtime (adapter).
 *
 * A chart is stored as object "statechart.<instance>.charts.<chartId>" (type "channel"),
 * the model itself lives in `native.chart` of that object.
 */

/** Current version of the chart model, increase on incompatible changes */
export const CHART_MODEL_VERSION = 1;

/** Maximum number of transitions in one wakeup with super step semantics, protects against loops */
export const MAX_SUPER_STEPS = 100;

export type SymbolScope = "input" | "output" | "local";

export type InputTrigger = "update" | "change";

/** "ack": only confirmed values, "command": only commands (ack=false) */
export type AckFilter = "any" | "ack" | "command";

/**
 * A variable which can be used in conditions and actions.
 * Inputs and outputs are mapped to ioBroker states, locals only live inside the chart.
 */
export interface ChartSymbol {
    /** Name used in conditions and actions, must be a valid JavaScript identifier */
    name: string;
    /** Input (read from state), output (written to state) or local */
    scope: SymbolScope;
    /** ioBroker state ID for inputs and outputs */
    stateId?: string;
    /** Initial value for locals */
    initial?: any;
    /** Inputs only: wake up the chart on every update (default) or only on changes */
    trigger?: InputTrigger;
    /** Inputs only: which updates are used, depending on their ack flag, default "any" */
    ack?: AckFilter;
    /** Inputs only: wake up the chart only after the input had no update for this time */
    debounceMs?: number;
}

/** A state of the chart, also a superstate with sub states */
export interface ChartState {
    /** Unique and stable ID inside the chart */
    id: string;
    /** Display name, also used for the "activeState" state */
    name: string;
    /** ID of the parent state, null/undefined for top level states */
    parent?: string | null;
    /** ID of the initial child state (only for states with exclusive children) */
    initial?: string;
    /**
     * Decomposition of the children: parallel (AND), all children are active at the same time.
     * Default is exclusive (OR), exactly one child is active.
     */
    parallel?: boolean;
    /** Children of a parallel state only: execution order among the siblings, lower is first */
    order?: number;
    /**
     * History junction, only for states with exclusive children: entering the state returns to the child which was
     * active when the state was left last. The initial state is only used when the state is entered the first time.
     */
    history?: boolean;
    /** Action executed when the state is entered */
    entry?: string;
    /** Action executed on every wakeup while the state is active and no transition is taken */
    during?: string;
    /** Action executed when the state is left */
    exit?: string;
    /**
     * Not executed, like commented out: the state, its sub states and the transitions from and to them are ignored
     */
    disabled?: boolean;
    /** Free text for the documentation, no influence on the execution */
    comment?: string;
    /** Background color in the editor as "#rrggbb", the default color (light yellow) if missing (editor only) */
    color?: string;
    /** Position in the editor, relative to the parent state */
    x: number;
    /** Position in the editor, relative to the parent state */
    y: number;
    /** Size in the editor */
    width?: number;
    /** Size in the editor */
    height?: number;
}

/** Format of ChartState.color */
export const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** A transition between two states, or from a state to itself */
export interface ChartTransition {
    /** Unique and stable ID inside the chart */
    id: string;
    /** ID of the source state */
    source: string;
    /** ID of the target state */
    target: string;
    /** Transition label in Stateflow syntax: event[condition]{action} */
    label?: string;
    /** Evaluation order of transitions with the same source, lower is first */
    priority?: number;
    /** Not executed, like commented out: the transition is never taken */
    disabled?: boolean;
    /**
     * Only for transitions from a state to one of its own children: leave and enter the source state again.
     * Default is an inner transition, which keeps the source state active.
     */
    reenterParent?: boolean;
    /** Free text for the documentation, no influence on the execution */
    comment?: string;
    /** Side of the source state where the arrow starts (editor only) */
    sourceHandle?: string;
    /** Side of the target state where the arrow ends (editor only) */
    targetHandle?: string;
    /** Where the arrow starts on the border of the source state, automatic if missing (editor only) */
    sourceAnchor?: EdgeAnchor;
    /** Where the arrow ends on the border of the target state, automatic if missing (editor only) */
    targetAnchor?: EdgeAnchor;
    /** Moves the label away from the middle of the arrow, set by dragging it (editor only) */
    labelOffset?: {
        /** Horizontal distance */
        x: number;
        /** Vertical distance, pointing down */
        y: number;
    };
}

/** A point on the border of a state, set by dragging an end of a transition in the editor */
export interface EdgeAnchor {
    /** The side of the state */
    side: "top" | "right" | "bottom" | "left";
    /** Position along the side: 0 = left/top end, 1 = right/bottom end */
    pos: number;
}

/**
 * A block with JavaScript code, executed once when the chart starts.
 * The functions declared in it can be used in all conditions and actions of the chart.
 */
export interface ChartFunction {
    /** Unique and stable ID inside the chart */
    id: string;
    /** JavaScript, usually one or more function declarations */
    code: string;
    /** Free text for the documentation, no influence on the execution */
    comment?: string;
    /** Position in the editor */
    x: number;
    /** Position in the editor */
    y: number;
    /** Size in the editor */
    width?: number;
    /** Size in the editor */
    height?: number;
}

/**
 * A note on the canvas of the editor, like an annotation in Stateflow. No influence on the execution.
 */
export interface ChartNote {
    /** Unique and stable ID inside the chart */
    id: string;
    /** The text of the note */
    text: string;
    /** ID of the state the note is placed in, it moves together with it */
    parent?: string | null;
    /** Position in the editor, relative to the parent state */
    x: number;
    /** Position in the editor, relative to the parent state */
    y: number;
    /** Size in the editor */
    width?: number;
    /** Size in the editor */
    height?: number;
}

/** A chart, stored in native.chart of its object, see the top of this file */
export interface Chart {
    /** Model version, see CHART_MODEL_VERSION */
    version: number;
    /** Display name */
    name: string;
    /** If the chart is executed by the adapter */
    enabled: boolean;
    /** Continue with the state from before a restart of the adapter, default true */
    restoreState?: boolean;
    /**
     * Super step semantics: after a transition, the chart is checked again right away, until no transition is valid
     * anymore (at most MAX_SUPER_STEPS transitions per wakeup). Default false: one transition per wakeup.
     */
    superStep?: boolean;
    /** ID of the initial top level state (default transition) */
    initial?: string;
    /** The top level states are parallel (AND), see ChartState.parallel */
    parallel?: boolean;
    /** Transitions are drawn with horizontal and vertical lines and right angles instead of curves (editor only) */
    orthogonalTransitions?: boolean;
    /** The variables: inputs, outputs and locals */
    symbols: ChartSymbol[];
    /** All states, nested ones refer to their parent */
    states: ChartState[];
    /** All transitions */
    transitions: ChartTransition[];
    /** Missing in charts created before function blocks existed */
    functions?: ChartFunction[];
    /** Missing in charts created before notes existed */
    notes?: ChartNote[];
    /** Free text for the documentation, no influence on the execution */
    comment?: string;
}

/** Temporal logic operators, like in Stateflow */
export type TemporalOperator = "after" | "before" | "at" | "every";

export const TEMPORAL_OPERATORS: TemporalOperator[] = ["after", "before", "at", "every"];

/**
 * A temporal expression in the trigger part of a transition label, measured from entering the source state:
 * - after(n, unit): from n units on
 * - before(n, unit): only during the first n units
 * - at(n, unit): exactly once, after n units
 * - every(n, unit): every n units
 * - op(n, input): the same, counting the wakeups by the input instead of the time
 * - after(n, unit, condition): as soon as the condition is true for n units without interruption
 * - at("sunset", offsetMinutes) or at("22:30"): every day at an astro event or a time of day, not measured from
 *   entering the state
 */
export interface TemporalExpression {
    /** after, before, at or every */
    operator: TemporalOperator;
    /** at(...) every day: name of an astro event (see ASTRO_EVENTS) or a time of day "HH:mm" */
    time?: string;
    /** at(...) every day: minutes added to the time, may be negative */
    offsetMinutes?: number;
    /** Time based: the time in milliseconds */
    ms?: number;
    /** Counting: the number of wakeups by the input */
    count?: number;
    /** Counting: name of the input whose wakeups are counted */
    event?: string;
    /** after(n, unit, condition): the JavaScript expression which must be true for the time */
    condition?: string;
}

/** The parts of a transition label event[condition]{action}, see parseTransitionLabel() */
export interface TransitionLabel {
    /** Name of the triggering event (an input symbol), undefined = any wakeup */
    event?: string;
    /** Temporal transition, e.g. after(5, sec) */
    temporal?: TemporalExpression;
    /** Guard expression */
    condition?: string;
    /** Transition action */
    action?: string;
}

/** Milliseconds of the time units, they can also be used in conditions and actions, e.g. elapsed(min) */
export const TIME_UNITS: Record<string, number> = {
    msec: 1,
    sec: 1000,
    min: 60_000,
};

/**
 * Creates a new, empty chart. It is paused, the user starts it when it is ready.
 *
 * @param name Display name
 */
export function createChart(name: string): Chart {
    return {
        version: CHART_MODEL_VERSION,
        name,
        enabled: false,
        symbols: [],
        states: [],
        transitions: [],
        functions: [],
        notes: [],
    };
}

/**
 * Converts a display name to an ID which can be used in ioBroker object IDs
 *
 * @param name Display name
 */
export function nameToId(name: string): string {
    return (
        name
            .trim()
            .toLowerCase()
            .replace(/ä/g, "ae")
            .replace(/ö/g, "oe")
            .replace(/ü/g, "ue")
            .replace(/ß/g, "ss")
            .replace(/[^a-z0-9_-]+/g, "_")
            .replace(/^_+|_+$/g, "") || "chart"
    );
}

/** A part of a text, used e.g. to underline an error */
export interface TextRange {
    /** Index of the first character */
    from: number;
    /** Index after the last character */
    to: number;
}

/** Positions of the parts in the label text */
export interface TransitionLabelRanges {
    /** The name of the event, missing for a temporal expression */
    event?: TextRange;
    /** The whole temporal expression, e.g. after(...) */
    temporal?: TextRange;
    /** The input of a counting temporal expression, e.g. button in after(3, button) */
    temporalEvent?: TextRange;
    /** The condition of after(n, unit, condition) */
    temporalCondition?: TextRange;
    /** Content of [...] without the brackets */
    condition?: TextRange;
    /** Content of {...} without the brackets */
    action?: TextRange;
}

/**
 * Fills the %s placeholders of a message
 *
 * @param key Message with %s placeholders
 * @param args Values for the placeholders
 */
export function formatMessage(key: string, args: string[]): string {
    let i = 0;
    return key.replace(/%s/g, () => args[i++] ?? "");
}

/**
 * Error in the structure of a transition label, knows where in the label the problem is
 */
export class LabelSyntaxError extends Error {
    /**
     * @param key Message with %s placeholders, used to translate the message
     * @param args Values for the placeholders
     * @param from Start of the problem in the label
     * @param to End of the problem in the label
     */
    constructor(
        public readonly key: string,
        public readonly args: string[],
        public readonly from: number,
        public readonly to: number,
    ) {
        super(formatMessage(key, args));
    }
}

/**
 * Reads a part enclosed in brackets, nested brackets of the same type are allowed
 *
 * @param text The label
 * @param start Index of the opening bracket
 * @param open Opening bracket
 * @param close Closing bracket
 * @returns from is the index of the (trimmed) content, end is the index after the closing bracket
 */
function readEnclosed(
    text: string,
    start: number,
    open: string,
    close: string,
): { content: string; from: number; end: number } {
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

/** Astro events which can be used in at("sunset") and astroTime("sunset"), as calculated by suncalc */
export const ASTRO_EVENTS = [
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
    "dawn",
];

/** A time of day, "HH:mm" or "HH:mm:ss" */
export const TIME_OF_DAY = /^([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

/** Message for invalid temporal expressions */
const INVALID_TEMPORAL =
    'Invalid temporal expression "%s", expected e.g. after(5, sec), every(10, min), after(3, button), after(5, min, condition) or at("sunset", -30)';

/**
 * Splits the arguments of a call at the commas outside of brackets and strings
 *
 * @param text The label
 * @param from Index after the opening bracket
 * @param to Index of the closing bracket
 * @returns the arguments with their position, trimmed
 */
function splitArguments(text: string, from: number, to: number): { text: string; from: number }[] {
    const args: { text: string; from: number }[] = [];
    let depth = 0;
    let quote: string | null = null;
    let start = from;
    const push = (end: number): void => {
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

/**
 * Parses the arguments of a temporal expression
 *
 * @param text The label
 * @param operator The operator
 * @param from Start of the expression (the operator)
 * @param open Index of the opening bracket
 * @param end Index after the closing bracket
 * @returns the expression and the positions of its input and condition
 * @throws {LabelSyntaxError}
 */
function parseTemporal(
    text: string,
    operator: TemporalOperator,
    from: number,
    open: number,
    end: number,
): { temporal: TemporalExpression; event?: TextRange; condition?: TextRange } {
    const fail = (): never => {
        throw new LabelSyntaxError(INVALID_TEMPORAL, [text.substring(from, end)], from, end);
    };
    const args = splitArguments(text, open + 1, end - 1);
    const quoted = /^(["'])(.*)\1$/.exec(args[0]?.text ?? "");
    if (quoted) {
        // every day at an astro event or a time of day: at("sunset", -30)
        const time = quoted[2].trim();
        if (operator !== "at" || args.length > 2) {
            fail();
        }
        if (!ASTRO_EVENTS.includes(time) && !TIME_OF_DAY.test(time)) {
            throw new LabelSyntaxError(
                'Unknown time "%s", use a time like "22:30" or one of: %s',
                [time, ASTRO_EVENTS.join(", ")],
                args[0].from,
                args[0].from + args[0].text.length,
            );
        }
        const temporal: TemporalExpression = { operator, time };
        if (args.length === 2) {
            temporal.offsetMinutes = /^[-+]?\d+(?:\.\d+)?$/.test(args[1].text) ? parseFloat(args[1].text) : fail();
        }
        return { temporal };
    }
    const number = /^\d+(?:\.\d+)?$/.test(args[0]?.text) ? parseFloat(args[0].text) : fail();
    const unit = args[1]?.text ?? "";
    // every(0, sec) would never end
    if (operator === "every" && number === 0) {
        fail();
    }
    if (Object.hasOwn(TIME_UNITS, unit)) {
        const temporal: TemporalExpression = { operator, ms: number * TIME_UNITS[unit] };
        if (args.length === 3 && operator === "after" && args[2].text) {
            temporal.condition = args[2].text;
            return { temporal, condition: { from: args[2].from, to: args[2].from + args[2].text.length } };
        }
        return args.length === 2 ? { temporal } : fail();
    }
    // counting the wakeups by an input
    if (args.length !== 2 || !/^[A-Za-z_$][\w$]*$/.test(unit) || !Number.isInteger(number) || number < 1) {
        fail();
    }
    return {
        temporal: { operator, count: number, event: unit },
        event: { from: args[1].from, to: args[1].from + unit.length },
    };
}

/**
 * Parses a transition label and returns where its parts are, see parseTransitionLabel
 *
 * @param label The label text
 * @throws {LabelSyntaxError}
 */
export function parseTransitionLabelWithRanges(label: string | undefined): {
    label: TransitionLabel;
    ranges: TransitionLabelRanges;
} {
    const result: TransitionLabel = {};
    const ranges: TransitionLabelRanges = {};
    const text = label || "";
    let pos = 0;

    const skipSpace = (): void => {
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
        if (TEMPORAL_OPERATORS.includes(event[0] as TemporalOperator) && text[pos] === "(") {
            const { end } = readEnclosed(text, pos, "(", ")");
            const parsed = parseTemporal(text, event[0] as TemporalOperator, from, pos, end);
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
            text.length,
        );
    }
    return { label: result, ranges };
}

/**
 * Parses a transition label in Stateflow syntax: event[condition]{action}
 * All parts are optional. Instead of an event, a temporal expression like after(n, sec|msec|min) creates a
 * temporal transition, see TemporalExpression.
 *
 * @param label The label text
 * @throws {LabelSyntaxError}
 */
export function parseTransitionLabel(label: string | undefined): TransitionLabel {
    return parseTransitionLabelWithRanges(label).label;
}

/** Identifies files with exported charts */
export const EXPORT_FORMAT = "iobroker.statechart";

/** Files exported before the adapter was renamed from "state-machine" to "statechart" */
const LEGACY_EXPORT_FORMATS = ["iobroker.state-machine"];

/** The content of an export file */
export interface ChartExport {
    /** Identifies the file as export of this adapter, see EXPORT_FORMAT */
    format: string;
    /** Version of the chart model, see CHART_MODEL_VERSION */
    version: number;
    /** Time of the export as ISO string */
    exported: string;
    /** The exported charts */
    charts: Chart[];
}

/**
 * The content of an export file
 *
 * @param charts The exported charts
 */
export function createExport(charts: Chart[]): ChartExport {
    return { format: EXPORT_FORMAT, version: CHART_MODEL_VERSION, exported: new Date().toISOString(), charts };
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const SCOPES = ["input", "output", "local"];

function isObject(value: any): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks a chart of an export file and fills in defaults for missing optional values
 *
 * @param data The chart as read from the file
 * @param where Prefix of error messages, e.g. "Chart 1"
 * @throws {Error} if the chart is invalid
 */
function normalizeChart(data: any, where: string): Chart {
    const fail = (message: string): never => {
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
        if (data[list] !== undefined && !Array.isArray(data[list])) {
            fail(`"${list}" is no list`);
        }
    }
    const functions: any[] = data.functions || [];
    const notes: any[] = data.notes || [];

    // states, function blocks and notes are all nodes in the editor, so their IDs must be unique together
    const nodeIds = new Set<string>();
    const checkId = (item: any, kind: string, index: number): string => {
        if (!isObject(item) || typeof item.id !== "string" || !item.id) {
            fail(`${kind} ${index + 1} has no ID`);
        }
        if (nodeIds.has(item.id)) {
            fail(`${kind} ${item.id}: the ID is used more than once`);
        }
        nodeIds.add(item.id);
        return item.id;
    };
    const optionalString = (value: any, message: string): void => {
        if (value !== undefined && value !== null && typeof value !== "string") {
            fail(message);
        }
    };

    data.states.forEach((state: any, i: number) => checkId(state, "state", i));
    functions.forEach((fn, i) => checkId(fn, "function block", i));
    notes.forEach((note, i) => checkId(note, "note", i));
    const stateIds = new Set(data.states.map((s: any) => s.id));
    optionalString(data.comment, '"comment" is no text');

    const states: ChartState[] = data.states.map((state: any) => {
        const at = `state ${state.id}`;
        if (state.parent && !stateIds.has(state.parent)) {
            fail(`${at}: unknown parent state "${state.parent}"`);
        }
        for (const field of ["entry", "during", "exit", "initial", "comment"]) {
            optionalString(state[field], `${at}: "${field}" is no text`);
        }
        if (state.order !== undefined && !Number.isFinite(state.order)) {
            fail(`${at}: "order" is no number`);
        }
        if (state.color !== undefined && !(typeof state.color === "string" && COLOR_PATTERN.test(state.color))) {
            fail(`${at}: "color" is no color like "#d6eaf8"`);
        }
        const { parallel, history, disabled, ...rest } = state;
        return {
            ...rest,
            // the defaults (exclusive, no history, enabled) are not stored, like in the editor
            ...(parallel === true ? { parallel } : {}),
            ...(history === true ? { history } : {}),
            ...(disabled === true ? { disabled } : {}),
            name: typeof state.name === "string" && state.name ? state.name : state.id,
            parent: state.parent || null,
            x: Number.isFinite(state.x) ? state.x : 0,
            y: Number.isFinite(state.y) ? state.y : 0,
        };
    });

    // a parent must not be its own (indirect) child
    const parentOf = new Map(states.map(s => [s.id, s.parent]));
    for (const state of states) {
        let parent = state.parent;
        for (let i = 0; parent; i++) {
            if (parent === state.id || i > states.length) {
                fail(`state ${state.id}: the parent states form a cycle`);
            }
            parent = parentOf.get(parent) ?? null;
        }
    }

    const transitionIds = new Set<string>();
    const transitions: ChartTransition[] = data.transitions.map((transition: any, i: number) => {
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
        if (transition.priority !== undefined && !Number.isFinite(transition.priority)) {
            fail(`${at}: "priority" is no number`);
        }
        const { labelOffset, disabled, ...rest } = transition;
        // only the position of the label, an invalid one is dropped instead of rejecting the chart
        const validOffset = isObject(labelOffset) && Number.isFinite(labelOffset.x) && Number.isFinite(labelOffset.y);
        return {
            ...rest,
            ...(validOffset ? { labelOffset: { x: labelOffset.x, y: labelOffset.y } } : {}),
            // the default (enabled) is not stored
            ...(disabled === true ? { disabled } : {}),
        };
    });

    const symbolNames = new Set<string>();
    const symbols: ChartSymbol[] = data.symbols.map((symbol: any, i: number) => {
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
        if (symbol.trigger !== undefined && !["update", "change"].includes(symbol.trigger)) {
            fail(`variable ${symbol.name}: invalid trigger "${symbol.trigger}"`);
        }
        if (symbol.ack !== undefined && !["any", "ack", "command"].includes(symbol.ack)) {
            fail(`variable ${symbol.name}: invalid ack filter "${symbol.ack}"`);
        }
        if (symbol.debounceMs !== undefined && !(Number.isFinite(symbol.debounceMs) && symbol.debounceMs >= 0)) {
            fail(`variable ${symbol.name}: "debounceMs" is no number of 0 or more`);
        }
        return { ...symbol };
    });

    const normalizedFunctions: ChartFunction[] = functions.map(fn => {
        if (typeof fn.code !== "string") {
            fail(`function block ${fn.id}: "code" is no text`);
        }
        optionalString(fn.comment, `function block ${fn.id}: "comment" is no text`);
        return { ...fn, x: Number.isFinite(fn.x) ? fn.x : 0, y: Number.isFinite(fn.y) ? fn.y : 0 };
    });

    const normalizedNotes: ChartNote[] = notes.map(note => {
        optionalString(note.text, `note ${note.id}: "text" is no text`);
        if (note.parent && !stateIds.has(note.parent)) {
            fail(`note ${note.id}: unknown parent state "${note.parent}"`);
        }
        return {
            ...note,
            text: note.text || "",
            parent: note.parent || null,
            x: Number.isFinite(note.x) ? note.x : 0,
            y: Number.isFinite(note.y) ? note.y : 0,
        };
    });

    const chart: Chart = {
        ...data,
        version: CHART_MODEL_VERSION,
        name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : where,
        initial: typeof data.initial === "string" && stateIds.has(data.initial) ? data.initial : undefined,
        enabled: data.enabled !== false,
        symbols,
        states,
        transitions,
        functions: normalizedFunctions,
        notes: normalizedNotes,
    };
    // the default (off) is not stored, like in the editor
    if (chart.superStep !== true) {
        delete chart.superStep;
    }
    if (chart.parallel !== true) {
        delete chart.parallel;
    }
    if (chart.orthogonalTransitions !== true) {
        delete chart.orthogonalTransitions;
    }
    return chart;
}

/**
 * Reads the charts of an export file. A single chart (without the export wrapper) is accepted as well.
 *
 * @param text Content of the file
 * @throws {Error} if the file is invalid
 */
export function parseExport(text: string): Chart[] {
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
        return data.charts.map((chart: any, i: number) => normalizeChart(chart, `Chart ${i + 1}`));
    }
    if (isObject(data) && Array.isArray(data.states)) {
        return [normalizeChart(data, "Chart")];
    }
    throw new Error("The file contains no charts of the statechart adapter");
}

/**
 * @param chart The chart
 * @returns the IDs of the disabled states, including the sub states of disabled states, which are disabled as well
 */
export function getDisabledStateIds(chart: Chart): Set<string> {
    const byId = new Map(chart.states.map(s => [s.id, s]));
    const disabled = new Set<string>();
    for (const state of chart.states) {
        // the state itself or one of its parents is disabled; the limit protects against cycles in broken charts
        let current: ChartState | undefined = state;
        for (let depth = 0; current && depth <= chart.states.length; depth++) {
            if (current.disabled) {
                disabled.add(state.id);
                break;
            }
            current = current.parent ? byId.get(current.parent) : undefined;
        }
    }
    return disabled;
}

/**
 * The chart as it is executed: without disabled states (with their sub states), disabled transitions and the
 * transitions from or to disabled states. Disabled elements are like commented out.
 *
 * @param chart The chart
 * @returns the same chart if nothing is disabled, otherwise a copy without the disabled elements
 */
export function getExecutedChart(chart: Chart): Chart {
    const disabledStates = getDisabledStateIds(chart);
    if (!disabledStates.size && !chart.transitions.some(t => t.disabled)) {
        return chart;
    }
    return {
        ...chart,
        states: chart.states.filter(s => !disabledStates.has(s.id)),
        transitions: chart.transitions.filter(
            t => !t.disabled && !disabledStates.has(t.source) && !disabledStates.has(t.target),
        ),
        // notes in disabled states are kept with the chart, they have no influence on the execution
        notes: chart.notes?.filter(n => !n.parent || !disabledStates.has(n.parent)),
    };
}
