/*
 * Generates readable JavaScript from a chart. It shows how the runtime executes the chart:
 * the XState machine, and the functions which select the transitions in Stateflow order.
 * The code is only shown to the user, the runtime does not execute it.
 */

import { HELPERS } from "./chart-helpers";
import { MAX_SUPER_STEPS, parseTransitionLabel } from "./chart-model";
import type { Chart, ChartState, ChartTransition, TemporalExpression, TransitionLabel } from "./chart-model";
import { ChartStructure, HISTORY_SUFFIX } from "./chart-structure";
import type { TransitionKind } from "./chart-structure";

const INDENT = "    ";

function indent(text: string, level: number): string {
    const prefix = INDENT.repeat(level);
    return text
        .split("\n")
        .map(line => (line.trim() ? prefix + line : ""))
        .join("\n");
}

/**
 * Text for a // comment, on one line
 *
 * @param text The text, may have several lines
 */
function oneLine(text: string | undefined): string {
    return (text || "").replace(/\s+/g, " ").trim();
}

/**
 * A comment or note as // lines
 *
 * @param text The comment
 * @param prefix Indentation and optional text before the first line, e.g. "Note: "
 * @param indentation Added before each line
 * @returns no lines for an empty text
 */
function commentLines(text: string | undefined, prefix = "", indentation = ""): string[] {
    if (!text?.trim()) {
        return [];
    }
    return text
        .trim()
        .split("\n")
        .map((line, i) => `${indentation}// ${i ? " ".repeat(prefix.length) : prefix}${line.trimEnd()}`.trimEnd());
}

/**
 * Converts a state ID to a valid identifier for the names of the generated functions
 *
 * @param id ID of the state
 */
function identifier(id: string): string {
    const name = id.replace(/[^\w$]/g, "_");
    return /^\d/.test(name) ? `_${name}` : name;
}

/**
 * @param key The property name
 * @returns the key for an object literal, in quotes only if necessary
 */
function propertyKey(key: string): string {
    return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

/**
 * Removes the indentation all lines have in common, so the code can be indented again
 *
 * @param code The code
 */
function dedent(code: string): string {
    const lines = code
        .replace(/\s+$/, "")
        .replace(/^\s*\n/, "")
        .split("\n");
    const common = Math.min(...lines.filter(l => l.trim()).map(l => /^\s*/.exec(l)?.[0].length ?? 0));
    return lines.map(l => l.substring(Number.isFinite(common) ? common : 0)).join("\n");
}

/**
 * An arrow function executing an action, or null if there is no action
 *
 * @param code The action
 * @param level Indentation level of the line the function starts in
 */
function actionFunction(code: string | undefined, level: number): string | null {
    if (!code?.trim()) {
        return null;
    }
    return `() => {\n${indent(dedent(code), level + 1)}\n${INDENT.repeat(level)}}`;
}

/**
 * Generates the code of a chart
 *
 * @param chart The chart
 * @param chartId ID of the chart object, used for the machine ID like in the runtime
 */
export function generateChartCode(chart: Chart, chartId: string): string {
    const structure = new ChartStructure(chart);
    const stateName = (id: string): string => structure.statesById.get(id)?.name ?? id;

    /**
     * Parses a label, null if it is invalid or the target is unknown (the runtime ignores these transitions)
     *
     * @param transition The transition
     */
    const parse = (transition: ChartTransition): { label: TransitionLabel } | { error: string } => {
        if (!structure.statesById.has(transition.target)) {
            return { error: "unknown target" };
        }
        try {
            return { label: parseTransitionLabel(transition.label) };
        } catch (err) {
            return { error: err.message };
        }
    };

    /**
     * @param transition The transition
     * @returns e.g. "Off -> On: motion[motion]"
     */
    const describe = (transition: ChartTransition): string =>
        `${stateName(transition.source)} -> ${stateName(transition.target)}${
            transition.label?.trim() ? `: ${oneLine(transition.label)}` : ""
        }`;

    const lines = [
        `// Code generated from the chart "${oneLine(chart.name)}" by the statechart adapter.`,
        "// It shows how the adapter executes the chart. It is not executed itself, changes here have no effect.",
        "",
        ...(chart.comment?.trim() ? [...commentLines(chart.comment), ""] : []),
        ...(chart.notes || []).flatMap(note => [...commentLines(note.text, "Note: "), ""]),
        'const { createActor, createMachine } = require("xstate");',
        "",
    ];

    // variables
    lines.push("// ---------- Variables ----------", "");
    const outputs = chart.symbols.filter(s => s.scope === "output" && s.stateId);
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
                symbol.debounceMs ? `after ${symbol.debounceMs} ms without updates` : "",
            ]
                .filter(Boolean)
                .join(", ");
            lines.push(
                `let ${symbol.name} = getState(${JSON.stringify(symbol.stateId)})?.val; // input, wakes up the chart ${trigger}`,
            );
        } else {
            lines.push(
                `let ${symbol.name} = getState(${JSON.stringify(symbol.stateId)})?.val; // output, see writeChangedOutputs()`,
            );
        }
    }
    if (outputs.length) {
        lines.push("", "// the last written value of each output");
        lines.push(`const written = { ${outputs.map(s => s.name).join(", ")} };`);
    }
    lines.push("");

    // function blocks
    for (const fn of chart.functions || []) {
        if (fn.code.trim()) {
            lines.push("// ---------- Function block ----------", "", ...commentLines(fn.comment), dedent(fn.code), "");
        }
    }

    // machine
    lines.push(
        "// ---------- State machine ----------",
        "",
        "// The transitions are selected by the process functions below (Stateflow order),",
        "// XState only executes them: exit actions, transition action, entry actions.",
        "const machine = createMachine({",
        `${INDENT}id: ${JSON.stringify(`chart_${chartId}`)},`,
    );

    const transitionConfig = (
        transition: ChartTransition,
        kind: TransitionKind,
        label: TransitionLabel,
        level: number,
    ): string => {
        const parts = [`target: ${JSON.stringify(`#${structure.getTargetId(transition)}`)}`];
        if (kind.reenter) {
            parts.push("reenter: true");
        }
        const action = actionFunction(label.action, level);
        if (action) {
            parts.push(`actions: ${action}`);
        }
        return `{ ${parts.join(", ")} }`;
    };

    const buildState = (state: ChartState, level: number): void => {
        const i1 = INDENT.repeat(level);
        const i2 = INDENT.repeat(level + 1);
        const i3 = INDENT.repeat(level + 2);
        lines.push(
            `${i1}// ${oneLine(state.name)}`,
            ...commentLines(state.comment, "", i1),
            `${i1}${propertyKey(state.id)}: {`,
        );
        lines.push(`${i2}id: ${JSON.stringify(state.id)},`);
        for (const field of ["entry", "exit"] as const) {
            const action = actionFunction(state[field], level + 1);
            if (action) {
                lines.push(`${i2}${field}: ${action},`);
            }
        }

        const on: string[] = [];
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
                level + 2,
            );
            on.push(
                `${i3}// ${describe(transition)}`,
                ...commentLines(transition.comment, "", i3),
                `${i3}${JSON.stringify(`T.${transition.id}`)}: ${config},`,
            );
        }
        if (on.length) {
            lines.push(`${i2}on: {`, ...on, `${i2}},`);
        }

        const children = structure.getChildren(state.id);
        if (children.length) {
            lines.push(
                structure.isParallel(state.id)
                    ? `${i2}type: "parallel", // all sub states are active, entered in their execution order`
                    : `${i2}initial: ${JSON.stringify(structure.getInitialChild(state.id))},`,
                `${i2}states: {`,
            );
            for (const child of children) {
                buildState(child, level + 2);
            }
            if (structure.hasHistory(state.id)) {
                const id = `${state.id}${HISTORY_SUFFIX}`;
                lines.push(
                    `${i3}// history junction: returns to the last active sub state, the first time to the initial one`,
                    `${i3}${JSON.stringify(HISTORY_SUFFIX)}: { id: ${JSON.stringify(id)}, type: "history" },`,
                );
            }
            lines.push(`${i2}},`);
        }
        lines.push(`${i1}},`);
    };

    const topLevel = structure.getChildren(null);
    if (topLevel.length) {
        lines.push(
            structure.isParallel(null)
                ? `${INDENT}type: "parallel", // all top level states are active, entered in their execution order`
                : `${INDENT}initial: ${JSON.stringify(structure.getInitialChild(null))},`,
            `${INDENT}states: {`,
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
        "",
    );

    // wakeup and process functions
    /**
     * @param states The states which may be active
     * @param level Indentation level
     * @param prefix "return " inside process functions
     */
    const callActive = (states: ChartState[], level: number, prefix: string): string[] =>
        states.map(
            s =>
                `${INDENT.repeat(level)}if (isActive(${JSON.stringify(s.id)})) {\n` +
                `${INDENT.repeat(level + 1)}${prefix}process_${identifier(s.id)}(input);\n` +
                `${INDENT.repeat(level)}}`,
        );

    /**
     * Processes the active child of a state, or all children of a parallel state
     *
     * @param parent ID of the state, null for the top level
     * @param children The children
     * @returns lines of a process function, with indentation level 1
     */
    const processChildren = (parent: string | null, children: ChartState[]): string[] => {
        if (!structure.isParallel(parent)) {
            return [...callActive(children, 1, "return "), `${INDENT}return false;`];
        }
        const lines = [
            `${INDENT}// all sub states are active (parallel), they are processed in their execution order.`,
            `${INDENT}// A transition in one of them does not stop the others, unless it left this state.`,
            ...(parent ? [`${INDENT}const entries = entryCount(${JSON.stringify(parent)});`] : []),
            `${INDENT}let taken = false;`,
        ];
        children.forEach((child, i) => {
            if (i && parent) {
                lines.push(
                    `${INDENT}if (!isActive(${JSON.stringify(parent)}) || entryCount(${JSON.stringify(parent)}) !== entries) {`,
                    `${INDENT}${INDENT}return true; // left (and maybe entered again) by the transition`,
                    `${INDENT}}`,
                );
            }
            lines.push(`${INDENT}taken = process_${identifier(child.id)}(input) || taken;`);
        });
        lines.push(`${INDENT}return taken;`);
        return lines;
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
        ...(chart.superStep
            ? [
                  `${INDENT}// super step: take transitions until none is valid anymore, at most ${MAX_SUPER_STEPS}.`,
                  `${INDENT}// The event of the input is only present in the first step.`,
                  `${INDENT}for (let steps = 0; steps < ${MAX_SUPER_STEPS} && step(input); steps++) {`,
                  `${INDENT}${INDENT}input = null;`,
                  `${INDENT}}`,
              ]
            : [`${INDENT}step(input);`]),
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
        "",
    );

    /**
     * The check of a temporal expression, see the helpers provided by the adapter at the end of the code
     *
     * @param transition The transition
     * @param temporal Its temporal expression
     */
    const temporalCheck = (transition: ChartTransition, temporal: TemporalExpression): string => {
        const id = JSON.stringify(transition.id);
        const source = JSON.stringify(transition.source);
        if (temporal.event !== undefined) {
            const event = JSON.stringify(temporal.event);
            const count = `inputCount(${source}, ${event})`;
            const checks = {
                after: `${count} >= ${temporal.count}`,
                before: `${count} < ${temporal.count}`,
                at: `${count} === ${temporal.count}`,
                every: `${count} % ${temporal.count} === 0`,
            };
            return `input === ${event} && ${checks[temporal.operator]}`;
        }
        if (temporal.condition !== undefined) {
            return `trueFor(${id}) >= ${temporal.ms}`;
        }
        switch (temporal.operator) {
            case "after":
                // valid from the moment on, not only when the timer expires
                return `timeInState(${source}) >= ${temporal.ms}`;
            case "before":
                return `timeInState(${source}) < ${temporal.ms}`;
            default:
                return `timerFired(${id})`;
        }
    };

    /**
     * A check of a transition in a process function
     *
     * @param transition The transition
     * @param label Its parsed label
     */
    const check = (transition: ChartTransition, label: TransitionLabel): string[] => {
        const conditions: string[] = [];
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
            `${INDENT}}`,
        ];
    };

    for (const state of chart.states) {
        const outer: string[] = [];
        const inner: string[] = [];
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
            ...(state.comment?.trim()
                ? [
                      " *",
                      // "*/" would end the comment
                      ...state.comment
                          .trim()
                          .split("\n")
                          .map(line => ` * ${line.trimEnd().replace(/\*\//g, "* /")}`.trimEnd()),
                  ]
                : []),
            " *",
            " * @param {string | null} input name of the changed input, null for timers",
            " * @returns {boolean} true if a transition was taken",
            " */",
            `function process_${identifier(state.id)}(input) {`,
            `${INDENT}// 1. transitions leaving the state`,
            ...(outer.length ? outer : [`${INDENT}// none`]),
            `${INDENT}// 2. during action`,
            state.during?.trim() ? `${INDENT}{\n${indent(dedent(state.during), 2)}\n${INDENT}}` : `${INDENT}// none`,
            `${INDENT}// 3. inner transitions (to own sub states, the state stays active)`,
            ...(inner.length ? inner : [`${INDENT}// none`]),
            `${INDENT}// 4. ${structure.isParallel(state.id) && children.length ? "all sub states" : "active sub state"}`,
            ...(children.length ? processChildren(state.id, children) : [`${INDENT}// none`, `${INDENT}return false;`]),
            "}",
            "",
        );
    }

    // helpers
    lines.push(
        "// ---------- Helpers ----------",
        "",
        "/** Writes every output whose value was changed by an action */",
        "function writeChangedOutputs() {",
        ...outputs.map(
            s =>
                `${INDENT}if (${s.name} !== written.${s.name}) {\n` +
                `${INDENT}${INDENT}written.${s.name} = ${s.name};\n` +
                `${INDENT}${INDENT}setState(${JSON.stringify(s.stateId)}, ${s.name});\n` +
                `${INDENT}}`,
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
        ...Object.values(HELPERS).map(helper => `// ${helper.signature}\n//     ${helper.description}`),
        "//",
        "// The adapter stores the active states, the times they were entered and the locals in the state",
        "// charts.<chart>.snapshot. After a restart of the adapter it continues with them, without executing the",
        "// entry actions again, if the chart was not changed meanwhile. Then it wakes up once, like after a start.",
        "",
    );
    return lines.join("\n");
}
