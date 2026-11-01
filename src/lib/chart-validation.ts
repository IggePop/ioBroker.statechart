/*
 * Checks conditions and actions of a chart: JavaScript syntax, unknown variables and events.
 * Used by the editor (to underline errors) and by the runtime (to log them when a chart starts).
 */

import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { CHANGE_HELPERS, HELPERS } from "./chart-helpers";
import { LabelSyntaxError, formatMessage, parseTransitionLabelWithRanges } from "./chart-model";
import type { Chart, ChartSymbol } from "./chart-model";

/** Names which can be used in conditions and actions besides the chart variables */
export const GLOBALS = new Set([
    // the helper functions, e.g. log() and setState()
    ...Object.keys(HELPERS),
    "undefined",
    "NaN",
    "Infinity",
    "Math",
    "Date",
    "JSON",
    "Number",
    "String",
    "Boolean",
    "Array",
    "Object",
    "RegExp",
    "Map",
    "Set",
    "Error",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "encodeURIComponent",
    "decodeURIComponent",
]);

/** Fields of a state which contain actions */
const STATE_ACTIONS = ["entry", "during", "exit"] as const;

export type CodeKind = "expression" | "statements";

export interface Diagnostic {
    /** Position in the checked text */
    from: number;
    to: number;
    severity: "error" | "warning";
    /** English message */
    message: string;
    /** Message with %s placeholders, used to translate it */
    key: string;
    args: string[];
}

function createDiagnostic(
    from: number,
    to: number,
    severity: "error" | "warning",
    key: string,
    args: string[] = [],
): Diagnostic {
    return { from, to, severity, key, args, message: formatMessage(key, args) };
}

/**
 * Parses JavaScript and converts syntax errors to diagnostics
 *
 * @param code The code to parse
 * @param kind Expression or statements
 */
function parseCode(code: string, kind: CodeKind): { ast: acorn.Node } | { diagnostic: Diagnostic } {
    try {
        if (kind === "statements") {
            return { ast: acorn.parse(code, { ecmaVersion: "latest", sourceType: "script" }) };
        }
        const ast = acorn.parseExpressionAt(code, 0, { ecmaVersion: "latest" });
        const rest = code.substring(ast.end);
        if (rest.trim()) {
            const from = ast.end + rest.length - rest.trimStart().length;
            return { diagnostic: createDiagnostic(from, code.length, "error", 'Unexpected "%s"', [rest.trim()]) };
        }
        return { ast };
    } catch (err) {
        const pos = typeof err.pos === "number" ? Math.min(err.pos, code.length) : 0;
        // acorn adds the position "(line:column)" to its messages, it is shown by the underline anyway
        const message = String(err.message).replace(/\s*\(\d+:\d+\)$/, "");
        // underline the token at the error position, or the last character if the code ends unexpectedly
        const from = pos < code.length ? pos : Math.max(0, code.length - 1);
        const token = /^(\w+|\S)/.exec(code.substring(from));
        const to = Math.min(code.length, from + (token ? token[0].length : 1));
        return { diagnostic: createDiagnostic(from, to, "error", "Syntax error: %s", [message]) };
    }
}

/**
 * Checks a condition or action
 *
 * @param code The code to check
 * @param kind Condition (expression) or action (statements)
 * @param symbols The variables of the chart
 * @param offset Position of the code in the text, added to all positions
 * @param functionNames Names declared in the function blocks of the chart
 */
export function validateCode(
    code: string | undefined,
    kind: CodeKind,
    symbols: ChartSymbol[],
    offset = 0,
    functionNames: string[] = [],
): Diagnostic[] {
    if (!code?.trim()) {
        return [];
    }
    const parsed = parseCode(code, kind);
    if ("diagnostic" in parsed) {
        const d = parsed.diagnostic;
        return [{ ...d, from: d.from + offset, to: d.to + offset }];
    }

    /** names declared in the code itself (let, const, function parameters, ...) */
    const declared = new Set<string>();
    const references: { node: acorn.Identifier; write: boolean }[] = [];
    walk.fullAncestor(parsed.ast, (node, _state, ancestors, type) => {
        if (node.type !== "Identifier") {
            return;
        }
        const parent = ancestors[ancestors.length - 2] as acorn.AnyNode | undefined;
        if (type === "VariablePattern") {
            // acorn-walk uses "VariablePattern" for declarations and for assignment targets
            if (parent?.type === "AssignmentExpression" && parent.left === node) {
                references.push({ node, write: true });
            } else {
                declared.add(node.name);
            }
        } else {
            references.push({ node, write: parent?.type === "UpdateExpression" });
        }
    });

    const inputs = new Set(symbols.filter(s => s.scope === "input").map(s => s.name));
    const symbolNames = new Set(symbols.map(s => s.name));
    const known = new Set([...symbolNames, ...functionNames]);
    const diagnostics: Diagnostic[] = [];

    // the change detection needs a variable of the chart, not any value
    walk.simple(parsed.ast, {
        CallExpression(node) {
            if (node.callee.type !== "Identifier" || !CHANGE_HELPERS.has(node.callee.name)) {
                return;
            }
            const arg = node.arguments[0];
            let valid;
            if (arg?.type === "Identifier") {
                // an unknown name is already reported as unknown variable
                valid =
                    symbolNames.has(arg.name) ||
                    !(known.has(arg.name) || declared.has(arg.name) || GLOBALS.has(arg.name));
            } else {
                valid = arg?.type === "Literal" && typeof arg.value === "string" && symbolNames.has(arg.value);
            }
            if (!valid) {
                const { start, end } = arg ?? node;
                diagnostics.push(
                    createDiagnostic(
                        start + offset,
                        end + offset,
                        "error",
                        "%s() needs a variable of the chart as first argument",
                        [node.callee.name],
                    ),
                );
            }
        },
    });
    for (const { node, write } of references) {
        const from = node.start + offset;
        const to = node.end + offset;
        if (!known.has(node.name) && !declared.has(node.name) && !GLOBALS.has(node.name)) {
            diagnostics.push(createDiagnostic(from, to, "error", 'Unknown variable "%s"', [node.name]));
        } else if (write && inputs.has(node.name) && !declared.has(node.name)) {
            diagnostics.push(
                createDiagnostic(from, to, "warning", 'Input "%s" is overwritten on its next change', [node.name]),
            );
        }
    }
    return diagnostics;
}

/**
 * Checks a transition label: its structure, the event and the JavaScript of condition and action
 *
 * @param label The label text
 * @param symbols The variables of the chart
 * @param functionNames Names declared in the function blocks of the chart
 */
export function validateTransitionLabel(
    label: string | undefined,
    symbols: ChartSymbol[],
    functionNames: string[] = [],
): Diagnostic[] {
    let parsed;
    try {
        parsed = parseTransitionLabelWithRanges(label);
    } catch (err) {
        if (err instanceof LabelSyntaxError) {
            return [createDiagnostic(err.from, err.to, "error", err.key, err.args)];
        }
        throw err;
    }
    const { label: parts, ranges } = parsed;

    const diagnostics: Diagnostic[] = [];
    if (parts.event && ranges.event && !symbols.some(s => s.scope === "input" && s.name === parts.event)) {
        diagnostics.push(
            createDiagnostic(
                ranges.event.from,
                ranges.event.to,
                "error",
                'Unknown event "%s", use the name of an input',
                [parts.event],
            ),
        );
    }
    if (parts.condition && ranges.condition) {
        diagnostics.push(...validateCode(parts.condition, "expression", symbols, ranges.condition.from, functionNames));
    }
    if (parts.action && ranges.action) {
        diagnostics.push(...validateCode(parts.action, "statements", symbols, ranges.action.from, functionNames));
    }
    return diagnostics;
}

/** A name declared at the top level of a function block */
export interface Declaration {
    name: string;
    /** e.g. "clamp(x, lo, hi)", null if it is no function */
    signature: string | null;
    /** Position of the name in the code */
    from: number;
    to: number;
}

/**
 * Finds the names declared at the top level of a function block: functions, but also constants etc.
 *
 * @param code The code of the function block
 * @returns empty if the code has syntax errors
 */
export function getDeclarations(code: string | undefined): Declaration[] {
    if (!code?.trim()) {
        return [];
    }
    const parsed = parseCode(code, "statements");
    if ("diagnostic" in parsed) {
        return [];
    }
    const signature = (fn: acorn.Function, name: string): string =>
        `${name}(${fn.params.map(p => code.substring(p.start, p.end)).join(", ")})`;

    const declarations: Declaration[] = [];
    for (const node of (parsed.ast as acorn.Program).body) {
        if (node.type === "FunctionDeclaration" && node.id) {
            const { name, start, end } = node.id;
            declarations.push({ name, signature: signature(node, name), from: start, to: end });
        } else if (node.type === "VariableDeclaration") {
            for (const declarator of node.declarations) {
                if (declarator.id.type !== "Identifier") {
                    continue;
                }
                const { name, start, end } = declarator.id;
                const init = declarator.init;
                const isFunction = init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression";
                declarations.push({ name, signature: isFunction ? signature(init, name) : null, from: start, to: end });
            }
        }
    }
    return declarations;
}

/**
 * Names declared in all function blocks of a chart
 *
 * @param chart The chart
 */
export function getFunctionNames(chart: Chart): string[] {
    return (chart.functions || []).flatMap(fn => getDeclarations(fn.code).map(d => d.name));
}

/**
 * Replaces the variable in the first argument of hasChanged(), hasChangedFrom() and hasChangedTo() by its name
 * in quotes: these helpers need the name of the variable, not its value
 *
 * @param code The code
 * @param kind Expression or statements
 * @returns the changed code and the names of the variables, the unchanged code if it has syntax errors
 */
export function quoteChangeArguments(code: string, kind: CodeKind): { code: string; names: string[] } {
    const parsed = code.trim() ? parseCode(code, kind) : null;
    if (!parsed || "diagnostic" in parsed) {
        return { code, names: [] };
    }
    const names = new Set<string>();
    const replacements: acorn.Identifier[] = [];
    walk.simple(parsed.ast, {
        CallExpression(node) {
            const arg = node.arguments[0];
            if (node.callee.type !== "Identifier" || !CHANGE_HELPERS.has(node.callee.name)) {
                return;
            }
            if (arg?.type === "Identifier") {
                replacements.push(arg);
                names.add(arg.name);
            } else if (arg?.type === "Literal" && typeof arg.value === "string") {
                names.add(arg.value);
            }
        },
    });
    let result = code;
    for (const { start, end, name } of replacements.sort((a, b) => b.start - a.start)) {
        result = result.substring(0, start) + JSON.stringify(name) + result.substring(end);
    }
    return { code: result, names: [...names] };
}

export interface ChartProblem {
    kind: "state" | "transition" | "function";
    /** ID of the state, transition or function block */
    id: string;
    /** "entry", "during", "exit", "label" or "code" */
    field: string;
    diagnostic: Diagnostic;
}

/**
 * Checks all actions, transition labels and function blocks of a chart
 *
 * @param chart The chart
 */
export function validateChart(chart: Chart): ChartProblem[] {
    const functionNames = getFunctionNames(chart);
    const problems: ChartProblem[] = [];
    for (const state of chart.states) {
        for (const field of STATE_ACTIONS) {
            for (const diagnostic of validateCode(state[field], "statements", chart.symbols, 0, functionNames)) {
                problems.push({ kind: "state", id: state.id, field, diagnostic });
            }
        }
    }
    for (const transition of chart.transitions) {
        for (const diagnostic of validateTransitionLabel(transition.label, chart.symbols, functionNames)) {
            problems.push({ kind: "transition", id: transition.id, field: "label", diagnostic });
        }
    }

    // a name may only be declared once in all function blocks, and not hide a variable
    const symbolNames = new Set(chart.symbols.map(s => s.name));
    const seen = new Set<string>();
    for (const fn of chart.functions || []) {
        for (const diagnostic of validateCode(fn.code, "statements", chart.symbols, 0, functionNames)) {
            problems.push({ kind: "function", id: fn.id, field: "code", diagnostic });
        }
        for (const { name, from, to } of getDeclarations(fn.code)) {
            let key = null;
            if (seen.has(name)) {
                key = '"%s" is declared in more than one function block';
            } else if (symbolNames.has(name) || GLOBALS.has(name)) {
                key = '"%s" is already the name of a variable';
            }
            if (key) {
                problems.push({
                    kind: "function",
                    id: fn.id,
                    field: "code",
                    diagnostic: createDiagnostic(from, to, "error", key, [name]),
                });
            }
            seen.add(name);
        }
    }
    return problems;
}
