/*
 * Static analysis of a chart: finds logical problems without running it, e.g. states which can never become
 * active, transitions which are never taken or variables which are not used. Syntax errors and unknown names are
 * found by the validation, the analysis ignores the code and labels with errors.
 */

import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { CHANGE_HELPERS } from "./chart-helpers";
import { parseTransitionLabel } from "./chart-model";
import type { Chart, ChartTransition, TransitionLabel } from "./chart-model";
import { ChartStructure } from "./chart-structure";

export type Severity = "error" | "warning" | "info";

/** A problem of the chart as a whole, not at a position in a text */
export interface Finding {
    /** What the problem is about */
    kind: "state" | "transition" | "symbol";
    /** ID of the state or transition, name of the variable */
    id: string;
    /** How severe the problem is */
    severity: Severity;
    /** English message with %s placeholders, used to translate it */
    key: string;
    /** Values for the %s placeholders of the message */
    args: string[];
}

/** A transition the runtime executes, with its parsed label */
interface ValidTransition {
    transition: ChartTransition;
    label: TransitionLabel;
    /** The condition is always true or there is none */
    alwaysTrue: boolean;
}

type Constant = { value: unknown } | undefined;

/**
 * Evaluates an expression which only consists of literals and operators, e.g. `true` or `1 > 2`
 *
 * @param node The expression
 * @returns undefined if the value depends on variables or function calls
 */
function evaluateConstant(node: acorn.AnyNode): Constant {
    switch (node.type) {
        case "Literal":
            return { value: node.value };
        case "Identifier":
            if (node.name === "undefined") {
                return { value: undefined };
            }
            return node.name === "NaN" || node.name === "Infinity" ? { value: Number(node.name) } : undefined;
        case "TemplateLiteral":
            return node.expressions.length ? undefined : { value: node.quasis[0]?.value.cooked };
        case "UnaryExpression": {
            const arg = evaluateConstant(node.argument);
            if (!arg) {
                return undefined;
            }
            const value = arg.value as any;
            const results: Record<string, () => unknown> = {
                "!": () => !value,
                "-": () => -value,
                "+": () => +value,
            };
            return node.operator in results ? { value: results[node.operator]() } : undefined;
        }
        case "LogicalExpression": {
            const left = evaluateConstant(node.left);
            if (!left) {
                return undefined;
            }
            // a constant left side may decide the result on its own
            if (node.operator === "&&" && !left.value) {
                return left;
            }
            if (node.operator === "||" && left.value) {
                return left;
            }
            if (node.operator === "??" && left.value != null) {
                return left;
            }
            return evaluateConstant(node.right);
        }
        case "BinaryExpression": {
            const left = node.left.type === "PrivateIdentifier" ? undefined : evaluateConstant(node.left);
            const right = left && evaluateConstant(node.right);
            if (!left || !right) {
                return undefined;
            }
            const [a, b] = [left.value as any, right.value as any];
            const results: Record<string, () => unknown> = {
                "==": () => a == b,
                "!=": () => a != b,
                "===": () => a === b,
                "!==": () => a !== b,
                "<": () => a < b,
                "<=": () => a <= b,
                ">": () => a > b,
                ">=": () => a >= b,
                "+": () => a + b,
                "-": () => a - b,
                "*": () => a * b,
                "/": () => a / b,
                "%": () => a % b,
            };
            return node.operator in results ? { value: results[node.operator]() } : undefined;
        }
        case "ConditionalExpression": {
            const test = evaluateConstant(node.test);
            if (!test) {
                return undefined;
            }
            return evaluateConstant(test.value ? node.consequent : node.alternate);
        }
        default:
            return undefined;
    }
}

/**
 * @param code A condition
 * @returns its value if it does not depend on anything, undefined otherwise or if it has syntax errors
 */
function evaluateCondition(code: string): Constant {
    try {
        const ast = acorn.parseExpressionAt(code, 0, { ecmaVersion: "latest" });
        return code.substring(ast.end).trim() ? undefined : evaluateConstant(ast);
    } catch {
        return undefined;
    }
}

/** Which variables are read and written */
class Usage {
    readonly read = new Set<string>();
    readonly written = new Set<string>();

    /**
     * Adds the variables used by a condition or action
     *
     * @param code The code, ignored if it has syntax errors
     * @param kind Condition (expression) or action (statements)
     */
    add(code: string | undefined, kind: "expression" | "statements"): void {
        if (!code?.trim()) {
            return;
        }
        let ast;
        try {
            ast =
                kind === "statements"
                    ? acorn.parse(code, { ecmaVersion: "latest", sourceType: "script" })
                    : acorn.parseExpressionAt(code, 0, { ecmaVersion: "latest" });
        } catch {
            return;
        }
        // names declared in the code itself (let, const, function parameters, ...) hide the variables
        const declared = new Set<string>();
        const references: { name: string; write: boolean }[] = [];
        walk.fullAncestor(ast, (node, _state, ancestors, type) => {
            if (node.type !== "Identifier") {
                return;
            }
            const parent = ancestors[ancestors.length - 2] as acorn.AnyNode | undefined;
            if (type === "VariablePattern") {
                // acorn-walk uses "VariablePattern" for declarations and for assignment targets
                if (parent?.type === "AssignmentExpression" && parent.left === node) {
                    references.push({ name: node.name, write: true });
                } else {
                    declared.add(node.name);
                }
            } else {
                // count++ only changes the variable, its value is not used
                references.push({ name: node.name, write: parent?.type === "UpdateExpression" });
            }
        });
        walk.simple(ast, {
            CallExpression: node => {
                const arg = node.arguments[0];
                // the variable of hasChanged("name")
                if (
                    node.callee.type === "Identifier" &&
                    CHANGE_HELPERS.has(node.callee.name) &&
                    arg?.type === "Literal" &&
                    typeof arg.value === "string"
                ) {
                    this.read.add(arg.value);
                }
            },
        });
        for (const { name, write } of references) {
            if (!declared.has(name)) {
                (write ? this.written : this.read).add(name);
            }
        }
    }
}

/**
 * Finds the logical problems of a chart
 *
 * @param chart The chart
 */
export function analyzeChart(chart: Chart): Finding[] {
    const structure = new ChartStructure(chart);
    const findings: Finding[] = [];
    const add = (kind: Finding["kind"], id: string, severity: Severity, key: string, args: string[] = []): void => {
        findings.push({ kind, id, severity, key, args });
    };
    const stateName = (id: string): string => structure.statesById.get(id)?.name ?? id;

    // the transitions the runtime executes, by source
    const usage = new Usage();
    const validBySource = new Map<string, ValidTransition[]>();
    for (const state of chart.states) {
        for (const transition of structure.getTransitions(state.id)) {
            let label;
            try {
                label = parseTransitionLabel(transition.label);
            } catch {
                continue;
            }
            usage.add(label.condition, "expression");
            usage.add(label.temporal?.condition, "expression");
            usage.add(label.action, "statements");
            for (const event of [label.event, label.temporal?.event]) {
                if (event) {
                    usage.read.add(event);
                }
            }
            if (
                !structure.statesById.has(transition.target) ||
                structure.getCrossedParallel(transition) !== undefined
            ) {
                continue;
            }
            const condition = label.condition ? evaluateCondition(label.condition) : { value: true };
            const temporalCondition = label.temporal?.condition && evaluateCondition(label.temporal.condition);
            if (condition && !condition.value) {
                add(
                    "transition",
                    transition.id,
                    "warning",
                    "The condition is never true, the transition is never taken",
                );
                continue;
            }
            if (temporalCondition && !temporalCondition.value) {
                add(
                    "transition",
                    transition.id,
                    "warning",
                    "The condition is never true, the transition is never taken",
                );
                continue;
            }
            if (label.condition && condition) {
                add("transition", transition.id, "info", "The condition is always true");
            }
            const valid = { transition, label, alwaysTrue: !!condition };
            validBySource.set(state.id, [...(validBySource.get(state.id) || []), valid]);
        }
    }

    findUnreachable(structure, validBySource, add);
    findShadowed(structure, validBySource, add, stateName);

    // leaf states which are never left
    for (const state of chart.states) {
        if (structure.getChildren(state.id).length || state.during?.trim()) {
            // a state with a during action may do its work as long as it is active
            continue;
        }
        if (structure.getPath(state.id).every(id => !validBySource.get(id)?.length)) {
            add(
                "state",
                state.id,
                "info",
                "The chart stays in this state: neither it nor a state containing it has an outgoing transition",
            );
        }
    }

    // variables which are not used
    for (const state of chart.states) {
        usage.add(state.entry, "statements");
        usage.add(state.during, "statements");
        usage.add(state.exit, "statements");
    }
    for (const fn of chart.functions || []) {
        usage.add(fn.code, "statements");
    }
    for (const symbol of chart.symbols) {
        const { read, written } = { read: usage.read.has(symbol.name), written: usage.written.has(symbol.name) };
        if (symbol.scope === "input" && !read && !written) {
            add("symbol", symbol.name, "info", "The input is not used, it only wakes up the chart");
        } else if (symbol.scope === "output" && !written) {
            add("symbol", symbol.name, "warning", "The output is never written");
        } else if (symbol.scope === "local" && !read) {
            add(
                "symbol",
                symbol.name,
                "info",
                written ? "The variable is written but never read" : "The variable is not used",
            );
        }
    }
    return findings;
}

/**
 * Finds the states which can never become active: the topmost ones, their sub states are not reported
 *
 * @param structure The structure of the chart
 * @param validBySource The transitions the runtime executes, by source
 * @param add Adds a finding
 */
function findUnreachable(
    structure: ChartStructure,
    validBySource: Map<string, ValidTransition[]>,
    add: (kind: Finding["kind"], id: string, severity: Severity, key: string) => void,
): void {
    const reachable = new Set<string>();
    // enters a state like the runtime: with its initial sub state, or all of them if they are parallel
    const enterDefault = (id: string): void => {
        if (reachable.has(id)) {
            return;
        }
        reachable.add(id);
        const children = structure.getChildren(id);
        const initial = structure.getInitialChild(id);
        for (const child of structure.isParallel(id) ? children : children.filter(c => c.id === initial)) {
            enterDefault(child.id);
        }
    };
    // enters the target of a transition with its parents, and their parallel siblings
    const enter = (target: string): void => {
        for (const id of structure.getPath(target)) {
            reachable.add(id);
            const parent = structure.statesById.get(id)?.parent || null;
            if (structure.isParallel(parent)) {
                for (const sibling of structure.getChildren(parent)) {
                    if (sibling.id !== id) {
                        enterDefault(sibling.id);
                    }
                }
            }
        }
        // the history is only set by sub states which were active before, so they are reachable anyway
        reachable.delete(target);
        enterDefault(target);
    };

    const topLevel = structure.getChildren(null);
    const initial = structure.getInitialChild(null);
    for (const state of structure.isParallel(null) ? topLevel : topLevel.filter(s => s.id === initial)) {
        enterDefault(state.id);
    }
    for (let changed = true; changed;) {
        changed = false;
        for (const [source, transitions] of validBySource) {
            if (!reachable.has(source)) {
                continue;
            }
            for (const { transition } of transitions) {
                const before = reachable.size;
                enter(transition.target);
                changed ||= reachable.size !== before;
            }
        }
    }

    for (const state of structure.chart.states) {
        const parent = state.parent && structure.statesById.has(state.parent) ? state.parent : null;
        if (!reachable.has(state.id) && (!parent || reachable.has(parent))) {
            add("state", state.id, "warning", "The state never becomes active: no transition leads to it");
        }
    }
}

/**
 * Finds the transitions which are never taken because one before them is always valid: it has no condition (or one
 * which is always true) and no temporal logic, and no event or the same event. Like in the runtime, the transitions
 * leaving a state are checked before its inner transitions.
 *
 * @param structure The structure of the chart
 * @param validBySource The transitions the runtime executes, by source
 * @param add Adds a finding
 * @param stateName Returns the name of a state
 */
function findShadowed(
    structure: ChartStructure,
    validBySource: Map<string, ValidTransition[]>,
    add: (kind: Finding["kind"], id: string, severity: Severity, key: string, args: string[]) => void,
    stateName: (id: string) => string,
): void {
    for (const transitions of validBySource.values()) {
        /** the transition which is always valid, for all wakeups */
        let always: ChartTransition | undefined;
        /** the transitions which are always valid, by event */
        const byEvent = new Map<string, ChartTransition>();
        /** the transitions by event, temporal logic and condition */
        const byTrigger = new Map<string, ChartTransition>();
        const outer = transitions.filter(t => !structure.getTransitionKind(t.transition).inner);
        const inner = transitions.filter(t => structure.getTransitionKind(t.transition).inner);
        for (const { transition, label, alwaysTrue } of [...outer, ...inner]) {
            const trigger = JSON.stringify([label.event, label.temporal, label.condition?.replace(/\s+/g, "")]);
            const before = always ?? (label.event ? byEvent.get(label.event) : undefined);
            if (before) {
                add(
                    "transition",
                    transition.id,
                    "warning",
                    'Never taken: the transition to "%s" before it is always valid',
                    [stateName(before.target)],
                );
                continue;
            }
            const same = byTrigger.get(trigger);
            if (same) {
                add(
                    "transition",
                    transition.id,
                    "warning",
                    'Never taken: the transition to "%s" before it has the same event and condition',
                    [stateName(same.target)],
                );
                continue;
            }
            byTrigger.set(trigger, transition);
            if (alwaysTrue && !label.temporal) {
                if (label.event) {
                    byEvent.set(label.event, transition);
                } else {
                    always = transition;
                }
            }
        }
    }
}
