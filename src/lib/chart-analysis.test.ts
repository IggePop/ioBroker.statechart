import { expect } from "chai";
import { analyzeChart } from "./chart-analysis";
import type { Chart, ChartState, ChartTransition } from "./chart-model";

/**
 * A chart with an input, an output and a local which are all used
 *
 * @param states The states, without position
 * @param transitions The transitions, their ID is their index
 * @param extra Other fields of the chart
 */
function createChart(
    states: Omit<ChartState, "x" | "y">[],
    transitions: Omit<ChartTransition, "id">[],
    extra: Partial<Chart> = {},
): Chart {
    return {
        version: 1,
        name: "Test",
        enabled: true,
        symbols: [
            { name: "motion", scope: "input", stateId: "test.0.motion" },
            { name: "light", scope: "output", stateId: "test.0.light" },
            { name: "count", scope: "local", initial: 0 },
        ],
        states: states.map(s => ({ x: 0, y: 0, ...s })),
        transitions: transitions.map((t, i) => ({ id: `t${i}`, ...t })),
        functions: [{ id: "f1", code: "function use() { light = motion; return count; }", x: 0, y: 0 }],
        ...extra,
    };
}

/**
 * @param chart The chart
 * @returns the findings as "id: message"
 */
function analyze(chart: Chart): string[] {
    return analyzeChart(chart).map(f => `${f.id}: ${f.key.replace(/%s/g, () => f.args.shift() ?? "")}`);
}

describe("chart-analysis => analyzeChart", () => {
    it("finds nothing in a correct chart", () => {
        const chart = createChart(
            [
                { id: "off", name: "Off" },
                { id: "on", name: "On" },
            ],
            [
                { source: "off", target: "on", label: "motion[motion]" },
                { source: "on", target: "off", label: "after(5, min)" },
            ],
        );
        expect(analyze(chart)).to.deep.equal([]);
    });

    it("finds states which never become active, only the topmost ones", () => {
        const chart = createChart(
            [
                { id: "off", name: "Off" },
                { id: "on", name: "On" },
                { id: "lost", name: "Lost" },
                { id: "lost1", name: "Lost1", parent: "lost" },
                { id: "away", name: "Away" },
                { id: "away1", name: "Away1", parent: "away" },
                { id: "away2", name: "Away2", parent: "away" },
            ],
            [
                { source: "off", target: "on", label: "[motion]" },
                { source: "on", target: "off", label: "[!motion]" },
                // only from an unreachable state
                { source: "lost", target: "away", label: "" },
                // the transitions from a never active state do not count
                { source: "lost1", target: "on", label: "" },
            ],
        );
        expect(analyze(chart).filter(f => f.includes("never becomes active"))).to.deep.equal([
            "lost: The state never becomes active: no transition leads to it",
            "away: The state never becomes active: no transition leads to it",
        ]);
    });

    it("follows the initial states, parallel states and transitions to sub states", () => {
        const chart = createChart(
            [
                { id: "home", name: "Home", parallel: true },
                { id: "heat", name: "Heat", parent: "home" },
                { id: "hOff", name: "HOff", parent: "heat" },
                { id: "hOn", name: "HOn", parent: "heat" },
                { id: "win", name: "Window", parent: "home" },
                { id: "wClosed", name: "Closed", parent: "win" },
                { id: "wOpen", name: "Open", parent: "win" },
                { id: "away", name: "Away" },
                { id: "away1", name: "Away1", parent: "away" },
                { id: "away2", name: "Away2", parent: "away" },
            ],
            [
                { source: "hOff", target: "hOn", label: "[motion]" },
                { source: "hOn", target: "away2", label: "[!motion]" },
                { source: "away", target: "wOpen", label: "[motion]" },
                { source: "wOpen", target: "wClosed", label: "[!motion]" },
            ],
            { initial: "home" },
        );
        // Away1 is never entered: Away is only entered through Away2
        expect(analyze(chart).filter(f => f.includes("never becomes active"))).to.deep.equal([
            "away1: The state never becomes active: no transition leads to it",
        ]);
    });

    it("ignores transitions whose condition is never true, and reports them", () => {
        const chart = createChart(
            [
                { id: "off", name: "Off" },
                { id: "on", name: "On" },
            ],
            [
                { source: "off", target: "on", label: "[1 > 2 && motion]" },
                { source: "on", target: "off", label: "after(1, min, false)" },
                { source: "on", target: "off", label: '[`a` == "a"]' },
            ],
        );
        expect(analyze(chart)).to.deep.equal([
            "t0: The condition is never true, the transition is never taken",
            "t1: The condition is never true, the transition is never taken",
            "t2: The condition is always true",
            "on: The state never becomes active: no transition leads to it",
            "off: The chart stays in this state: neither it nor a state containing it has an outgoing transition",
        ]);
    });

    it("finds transitions which are never taken because one before them is always valid", () => {
        const chart = createChart(
            [
                { id: "a", name: "A" },
                { id: "a1", name: "A1", parent: "a" },
                { id: "b", name: "B" },
                { id: "c", name: "C" },
            ],
            [
                { source: "a", target: "b", label: "motion", priority: 1 },
                { source: "a", target: "c", label: "motion[count > 1]", priority: 2 },
                // another event or temporal logic is not affected
                { source: "a", target: "c", label: "after(2, motion)", priority: 3 },
                { source: "a", target: "c", label: "[count > 1]", priority: 4 },
                { source: "a", target: "b", label: "[ count>1 ]", priority: 5 },
                { source: "b", target: "a", label: "[true]", priority: 1 },
                { source: "b", target: "c", label: "after(1, sec)", priority: 2 },
                // the inner transitions are checked after the outer ones
                { source: "a", target: "a1", label: "motion{count++;}", priority: 6 },
                { source: "c", target: "a", label: "" },
            ],
        );
        expect(analyze(chart).filter(f => f.includes("Never taken"))).to.deep.equal([
            't1: Never taken: the transition to "B" before it is always valid',
            't4: Never taken: the transition to "C" before it has the same event and condition',
            't7: Never taken: the transition to "B" before it is always valid',
            't6: Never taken: the transition to "A" before it is always valid',
        ]);
    });

    it("finds states which are never left, except those with a during action", () => {
        const chart = createChart(
            [
                { id: "a", name: "A" },
                { id: "a1", name: "A1", parent: "a" },
                { id: "b", name: "B" },
                { id: "b1", name: "B1", parent: "b" },
                { id: "c", name: "C", during: "count++;" },
            ],
            [
                { source: "a", target: "b", label: "[motion]" },
                { source: "b1", target: "c", label: "[motion]" },
            ],
        );
        expect(analyze(chart).filter(f => f.includes("stays"))).to.deep.equal([]);
        chart.transitions.pop();
        expect(analyze(chart).filter(f => f.includes("stays"))).to.deep.equal([
            "b1: The chart stays in this state: neither it nor a state containing it has an outgoing transition",
        ]);
    });

    it("finds variables which are not used", () => {
        const chart = createChart(
            [{ id: "a", name: "A", entry: "count = 1; let light = 2; local++;" }],
            [{ source: "a", target: "a", label: "after(2, button)[hasChanged(temp)]" }],
            {
                symbols: [
                    { name: "motion", scope: "input", stateId: "test.0.motion" },
                    { name: "button", scope: "input", stateId: "test.0.button" },
                    { name: "temp", scope: "input", stateId: "test.0.temp" },
                    { name: "light", scope: "output", stateId: "test.0.light" },
                    { name: "count", scope: "local", initial: 0 },
                    { name: "local", scope: "local", initial: 0 },
                    { name: "unused", scope: "local", initial: 0 },
                    { name: "limit", scope: "local", initial: 5 },
                ],
                functions: [{ id: "f1", code: "function f(motion) { return motion + limit; }", x: 0, y: 0 }],
            },
        );
        expect(analyze(chart)).to.deep.equal([
            "motion: The input is not used, it only wakes up the chart",
            "light: The output is never written",
            "count: The variable is written but never read",
            "local: The variable is written but never read",
            "unused: The variable is not used",
        ]);
    });
});
