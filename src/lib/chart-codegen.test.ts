import { expect } from "chai";
import * as acorn from "acorn";
import { generateChartCode } from "./chart-codegen";
import type { Chart } from "./chart-model";

function createChart(): Chart {
    return {
        version: 1,
        name: "Heating",
        enabled: true,
        initial: "auto",
        symbols: [
            { name: "temp", scope: "input", stateId: "test.0.temp" },
            { name: "manual", scope: "input", stateId: "test.0.manual" },
            { name: "heating", scope: "output", stateId: "test.0.heating" },
            { name: "count", scope: "local", initial: 0 },
        ],
        states: [
            { id: "auto", name: "Auto", initial: "heat", during: "count++;", x: 0, y: 0 },
            { id: "idle", name: "Idle", parent: "auto", entry: "heating = false;", x: 0, y: 0 },
            { id: "heat", name: "Heat", parent: "auto", entry: "heating = true;\nlog('heating');", x: 0, y: 0 },
            { id: "manualState", name: "Manual", x: 0, y: 0 },
        ],
        transitions: [
            { id: "toManual", source: "auto", target: "manualState", label: "manual[manual]", priority: 1 },
            { id: "toAuto", source: "manualState", target: "auto", label: "after(5, min)[!manual]" },
            { id: "start", source: "idle", target: "heat", label: "[temp < 20]{count = 0;}" },
            { id: "restart", source: "auto", target: "idle", label: "[temp > 30]" },
            { id: "broken", source: "heat", target: "idle", label: "[temp > 22" },
        ],
        functions: [{ id: "f1", code: "function tooWarm(t) {\n    return t > 22;\n}", x: 0, y: 0 }],
    };
}

describe("chart-codegen => generateChartCode", () => {
    it("generates valid JavaScript", () => {
        const code = generateChartCode(createChart(), "heating");
        expect(() => acorn.parse(code, { ecmaVersion: "latest", sourceType: "script" })).not.to.throw();
    });

    it("contains variables, function blocks and the machine", () => {
        const code = generateChartCode(createChart(), "heating");
        expect(code).to.include(
            'let temp = getState("test.0.temp")?.val; // input, wakes up the chart on every update',
        );
        expect(code).to.include("let count = 0; // local");
        expect(code).to.include("const written = { heating };");
        expect(code).to.include("function tooWarm(t) {\n    return t > 22;\n}");
        expect(code).to.include('id: "chart_heating"');
        expect(code).to.include('initial: "heat"');
        // temporal transitions are checked like the others, valid from the moment their time has come
        expect(code).to.include('if (timeInState("manualState") >= 300000 && (!manual)) {');
        expect(code).to.include('"T.toAuto": { target: "#auto" }');
        expect(code).not.to.include("after: {");
    });

    it("selects the transitions in Stateflow order", () => {
        const code = generateChartCode(createChart(), "heating");
        const auto = code.substring(code.indexOf("function process_auto("), code.indexOf("function process_idle("));
        const order = [
            'input === "manual" && (manual)',
            "count++;",
            "(temp > 30)",
            'isActive("idle")',
            'isActive("heat")',
        ].map(part => auto.indexOf(part));
        expect(order.every(i => i >= 0)).to.equal(true, auto);
        expect([...order].sort((a, b) => a - b)).to.deep.equal(order);
    });

    it("marks inner transitions as not re-entering and ignores invalid transitions like the runtime", () => {
        const code = generateChartCode(createChart(), "heating");
        expect(code).to.include('"T.restart": { target: "#idle" }');
        expect(code).to.include('// Heat -> Idle: [temp > 22: ignored, Missing "]"');
        expect(code).not.to.include('"T.broken"');
    });

    it("processes only the state which was active when the chart woke up", () => {
        const code = generateChartCode(createChart(), "heating");
        // "return": a state entered by a transition is not processed in the same step
        expect(code).to.include(
            '    if (isActive("auto")) {\n        return process_auto(input);\n    }\n    if (isActive("manualState")) {\n',
        );
        expect(code).to.include("function wakeup(input) {\n    step(input);\n");
    });

    it("shows the super step", () => {
        const chart = createChart();
        chart.superStep = true;
        const code = generateChartCode(chart, "heating");
        expect(code).to.include("for (let steps = 0; steps < 100 && step(input); steps++) {\n        input = null;\n");
        // the generated code is valid JavaScript
        acorn.parse(code, { ecmaVersion: "latest" });
    });

    it("shows the temporal logic", () => {
        const chart = createChart();
        chart.transitions = [
            { id: "a", source: "idle", target: "heat", label: "before(5, sec)" },
            { id: "b", source: "idle", target: "heat", label: "at(5, sec)" },
            { id: "c", source: "idle", target: "heat", label: "every(1, min)[temp < 20]" },
            { id: "d", source: "idle", target: "heat", label: "after(3, manual)" },
            { id: "e", source: "idle", target: "heat", label: "every(2, manual)" },
            { id: "f", source: "heat", target: "idle", label: "after(5, min, temp > 22)" },
        ];
        const code = generateChartCode(chart, "heating");
        acorn.parse(code, { ecmaVersion: "latest" });
        expect(code).to.include('if (timeInState("idle") < 5000) {');
        expect(code).to.include('if (timerFired("b")) {');
        expect(code).to.include('if (timerFired("c") && (temp < 20)) {');
        expect(code).to.include('if (input === "manual" && inputCount("idle", "manual") >= 3) {');
        expect(code).to.include('if (input === "manual" && inputCount("idle", "manual") % 2 === 0) {');
        expect(code).to.include('if (trueFor("f") >= 300000) {');
    });

    it("shows parallel states", () => {
        const chart = createChart();
        chart.parallel = true;
        chart.states[0].parallel = true;
        chart.states[1].order = 2;
        chart.states[2].order = 1;
        chart.transitions = chart.transitions.filter(t => t.id !== "start" && t.id !== "broken");
        const code = generateChartCode(chart, "heating");
        acorn.parse(code, { ecmaVersion: "latest" });
        expect(code).to.include('type: "parallel", // all top level states are active');
        expect(code).to.include('type: "parallel", // all sub states are active');
        expect(code).not.to.include('initial: "heat"');
        // the sub states of Auto in their execution order, stopping when Auto was left
        expect(code).to.match(
            /function process_auto[\s\S]*const entries = entryCount\("auto"\);[\s\S]*taken = process_heat\(input\) \|\| taken;\s+if \(!isActive\("auto"\) \|\| entryCount\("auto"\) !== entries\) \{[\s\S]*taken = process_idle\(input\) \|\| taken;\s+return taken;/,
        );
        // the top level cannot be left
        expect(code).to.match(
            /function step\(input\) \{[\s\S]*?taken = process_auto\(input\) \|\| taken;\s+taken = process_manualState/,
        );
    });

    it("indents multi line actions", () => {
        const code = generateChartCode(createChart(), "heating");
        expect(code).to.include(
            "entry: () => {\n                        heating = true;\n                        log('heating');\n",
        );
    });

    it("includes comments and notes as comments", () => {
        const chart = createChart();
        chart.comment = "Heating of the\nliving room";
        chart.notes = [{ id: "n1", text: "Check the\nthermostat", x: 0, y: 0 }];
        chart.states[0].comment = "Automatic mode */ with tricky text";
        chart.transitions[0].comment = "Manual has priority";
        (chart.functions as any[])[0].comment = "Helper";
        const code = generateChartCode(chart, "heating");
        expect(() => acorn.parse(code, { ecmaVersion: "latest" })).not.to.throw();
        expect(code).to.include("// Heating of the\n// living room\n");
        expect(code).to.include("// Note: Check the\n//       thermostat\n");
        expect(code).to.include("// Helper\nfunction tooWarm(t)");
        expect(code).to.include("        // Auto\n        // Automatic mode */ with tricky text\n        auto: {");
        expect(code).to.include(" * Automatic mode * / with tricky text");
        // in the machine and in the process function
        expect(code).to.include(
            "                // Auto -> Manual: manual[manual]\n                // Manual has priority\n",
        );
        expect(code).to.include("\n    // Auto -> Manual: manual[manual]\n    // Manual has priority\n");
    });

    it("describes the triggers of inputs", () => {
        const chart = createChart();
        Object.assign(chart.symbols[0], { trigger: "change", ack: "ack", debounceMs: 500 });
        Object.assign(chart.symbols[1], { ack: "command" });
        const code = generateChartCode(chart, "heating");
        expect(code).to.include(
            "// input, wakes up the chart on value changes, only confirmed values (ack = true), after 500 ms without updates",
        );
        expect(code).to.include("// input, wakes up the chart on every update, only commands (ack = false)");
    });

    it("handles empty charts", () => {
        const code = generateChartCode(
            { version: 1, name: "Empty", enabled: true, symbols: [], states: [], transitions: [] },
            "empty",
        );
        expect(() => acorn.parse(code, { ecmaVersion: "latest" })).not.to.throw();
        expect(code).to.include("// no variables");
    });
});
