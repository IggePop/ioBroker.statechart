import { expect } from "chai";
import {
    createChart,
    createExport,
    nameToId,
    parseExport,
    parseTransitionLabel,
    parseTransitionLabelWithRanges,
} from "./chart-model";
import type { Chart } from "./chart-model";

function createTestChart(): Chart {
    return {
        version: 1,
        name: "Light",
        enabled: true,
        initial: "off",
        symbols: [
            { name: "motion", scope: "input", stateId: "hm-rpc.0.ABC.MOTION" },
            { name: "count", scope: "local", initial: 0 },
        ],
        states: [
            { id: "off", name: "Off", x: 0, y: 0 },
            { id: "on", name: "On", entry: "count++;", x: 200, y: 0 },
            { id: "dim", name: "Dim", parent: "on", x: 10, y: 40 },
        ],
        transitions: [{ id: "t1", source: "off", target: "on", label: "motion[motion]", priority: 1 }],
        functions: [{ id: "f1", code: "function f() {}", x: 0, y: 200 }],
    };
}

describe("chart-model => export and import", () => {
    it("imports what was exported", () => {
        const chart = createTestChart();
        const [imported] = parseExport(JSON.stringify(createExport([chart])));
        expect(imported).to.deep.equal({
            ...chart,
            states: chart.states.map(s => ({ parent: null, ...s })),
            // charts without notes get an empty list
            notes: [],
        });
    });

    it("imports files exported before the adapter was renamed", () => {
        const old = { ...createExport([createTestChart()]), format: "iobroker.state-machine" };
        expect(parseExport(JSON.stringify(old)).map(c => c.name)).to.deep.equal(["Light"]);
    });

    it("accepts a single chart without the export wrapper", () => {
        const charts = parseExport(JSON.stringify(createTestChart()));
        expect(charts.map(c => c.name)).to.deep.equal(["Light"]);
    });

    it("fills in defaults of old or hand written charts", () => {
        const [chart] = parseExport(
            JSON.stringify({ states: [{ id: "a" }], transitions: [], symbols: [], initial: "unknown" }),
        );
        expect(chart).to.deep.include({ name: "Chart", initial: undefined, functions: [], version: 1 });
        expect(chart.states).to.deep.equal([{ id: "a", name: "a", parent: null, x: 0, y: 0 }]);
    });

    /**
     * @param modify Changes the exported chart
     * @returns the error message
     */
    const importError = (modify: (chart: any) => void): string => {
        const chart = createTestChart();
        modify(chart);
        try {
            parseExport(JSON.stringify(createExport([chart])));
        } catch (err) {
            return err.message;
        }
        return "no error";
    };

    it("rejects invalid files", () => {
        expect(() => parseExport("{ no json")).to.throw(/No valid JSON/);
        expect(() => parseExport('{"format": "something else"}')).to.throw(/contains no charts/);
        expect(() => parseExport(JSON.stringify({ ...createExport([]), version: 99 }))).to.throw(/newer version/);
        expect(() => parseExport(JSON.stringify(createExport([])))).to.throw(/contains no charts/);
    });

    it("rejects invalid charts and tells where the problem is", () => {
        expect(importError(c => (c.version = 2))).to.match(/^Chart 1: created with a newer version/);
        expect(importError(c => delete c.states)).to.equal('Chart 1: "states" is missing or no list');
        expect(importError(c => c.states.push({ id: "on" }))).to.equal(
            "Chart 1: state on: the ID is used more than once",
        );
        expect(importError(c => (c.functions[0].id = "off"))).to.match(
            /function block off: the ID is used more than once/,
        );
        expect(importError(c => (c.transitions[0].target = "gone"))).to.equal(
            'Chart 1: transition t1: unknown target state "gone"',
        );
        expect(importError(c => (c.states[2].parent = "gone"))).to.equal(
            'Chart 1: state dim: unknown parent state "gone"',
        );
        expect(importError(c => (c.states[1].parent = "dim"))).to.match(/the parent states form a cycle/);
        expect(importError(c => (c.symbols[1].name = "motion"))).to.match(
            /variable motion: the name is used more than once/,
        );
        expect(importError(c => (c.symbols[0].name = "1x"))).to.match(/variable 1: invalid name/);
        expect(importError(c => (c.symbols[0].scope = "magic"))).to.match(/invalid kind "magic"/);
        expect(importError(c => (c.states[1].entry = 5))).to.match(/state on: "entry" is no text/);
        expect(importError(c => (c.notes = [{ id: "on", text: "x" }]))).to.match(
            /note on: the ID is used more than once/,
        );
        expect(importError(c => (c.notes = [{ id: "n1", text: "x", parent: "gone" }]))).to.match(
            /note n1: unknown parent state "gone"/,
        );
        expect(importError(c => (c.transitions[0].comment = 3))).to.match(/transition t1: "comment" is no text/);
        expect(importError(c => (c.symbols[0].trigger = "sometimes"))).to.match(/invalid trigger "sometimes"/);
        expect(importError(c => (c.symbols[0].ack = "maybe"))).to.match(/invalid ack filter "maybe"/);
        expect(importError(c => (c.symbols[0].debounceMs = -5))).to.match(/"debounceMs" is no number of 0 or more/);
        expect(importError(c => (c.states[1].order = "first"))).to.match(/state on: "order" is no number/);
    });

    it("keeps a valid label offset of a transition and drops an invalid one", () => {
        const [chart] = parseExport(
            JSON.stringify({
                states: [{ id: "a" }],
                transitions: [
                    { id: "t1", source: "a", target: "a", labelOffset: { x: 10, y: -5, z: 1 } },
                    { id: "t2", source: "a", target: "a", labelOffset: { x: "10", y: 0 } },
                ],
                symbols: [],
            }),
        );
        expect(chart.transitions[0].labelOffset).to.deep.equal({ x: 10, y: -5 });
        expect(chart.transitions[1]).to.not.have.property("labelOffset");
    });

    it("keeps parallel states and history junctions and does not store the defaults", () => {
        const [chart] = parseExport(
            JSON.stringify({
                parallel: true,
                states: [
                    { id: "a", parallel: true, history: "yes" },
                    { id: "b", parent: "a", order: 2, parallel: false, history: true },
                ],
                transitions: [],
                symbols: [],
            }),
        );
        expect(chart.parallel).to.equal(true);
        expect(chart.states.map(s => [s.parallel, s.order])).to.deep.equal([
            [true, undefined],
            [undefined, 2],
        ]);
        expect(chart.states[1]).to.not.have.property("parallel");
        expect(chart.states.map(s => s.history)).to.deep.equal([undefined, true]);
        expect(chart.states[0]).to.not.have.property("history");
        const [exclusive] = parseExport(JSON.stringify({ parallel: false, states: [], transitions: [], symbols: [] }));
        expect(exclusive).to.not.have.property("parallel");
    });

    it("imports notes and comments", () => {
        const chart = createTestChart();
        chart.comment = "About the chart";
        chart.states[0].comment = "Light is off";
        chart.notes = [{ id: "n1", text: "Remember", parent: "on", x: 5, y: 5 }];
        const [imported] = parseExport(JSON.stringify(createExport([chart])));
        expect(imported.comment).to.equal("About the chart");
        expect(imported.states[0].comment).to.equal("Light is off");
        expect(imported.notes).to.deep.equal([{ id: "n1", text: "Remember", parent: "on", x: 5, y: 5 }]);
    });
});

describe("chart-model => parseTransitionLabel", () => {
    it("returns an empty result for an empty label", () => {
        expect(parseTransitionLabel("")).to.deep.equal({});
        expect(parseTransitionLabel(undefined)).to.deep.equal({});
    });

    it("parses event, condition and action", () => {
        expect(parseTransitionLabel("motion[motion == true]{light = true;}")).to.deep.equal({
            event: "motion",
            condition: "motion == true",
            action: "light = true;",
        });
    });

    it("parses a condition only", () => {
        expect(parseTransitionLabel("[temp > 20 && window]")).to.deep.equal({ condition: "temp > 20 && window" });
    });

    it("allows nested brackets", () => {
        expect(parseTransitionLabel("[[1, 2].includes(mode)]{ if (x) { y = 1; } }")).to.deep.equal({
            condition: "[1, 2].includes(mode)",
            action: "if (x) { y = 1; }",
        });
    });

    it("parses labels spanning multiple lines", () => {
        expect(
            parseTransitionLabel("motion\n[motion &&\n  !blocked]\n{\n  light = true;\n  count++;\n}"),
        ).to.deep.equal({
            event: "motion",
            condition: "motion &&\n  !blocked",
            action: "light = true;\n  count++;",
        });
    });

    it("parses temporal transitions", () => {
        expect(parseTransitionLabel("after(5, sec)")).to.deep.equal({ temporal: { operator: "after", ms: 5000 } });
        expect(parseTransitionLabel("after(1.5,min)[!motion]")).to.deep.equal({
            temporal: { operator: "after", ms: 90_000 },
            condition: "!motion",
        });
        expect(parseTransitionLabel("before(200, msec)")).to.deep.equal({ temporal: { operator: "before", ms: 200 } });
        expect(parseTransitionLabel("at(2, sec)")).to.deep.equal({ temporal: { operator: "at", ms: 2000 } });
        expect(parseTransitionLabel("every(10, min){count++;}")).to.deep.equal({
            temporal: { operator: "every", ms: 600_000 },
            action: "count++;",
        });
    });

    it("parses temporal transitions counting the wakeups by an input", () => {
        expect(parseTransitionLabel("after(3, button)")).to.deep.equal({
            temporal: { operator: "after", count: 3, event: "button" },
        });
        const { ranges } = parseTransitionLabelWithRanges("every( 2 , button )[x]");
        expect(ranges.temporal).to.deep.equal({ from: 0, to: 19 });
        expect(ranges.temporalEvent).to.deep.equal({ from: 11, to: 17 });
    });

    it("parses after(n, unit, condition)", () => {
        const label = 'after(5, min, !motion && isTimeBetween("22:00", "06:00"))[light]';
        const { label: parsed, ranges } = parseTransitionLabelWithRanges(label);
        expect(parsed).to.deep.equal({
            temporal: { operator: "after", ms: 300_000, condition: '!motion && isTimeBetween("22:00", "06:00")' },
            condition: "light",
        });
        const { from, to } = ranges.temporalCondition as { from: number; to: number };
        expect(label.substring(from, to)).to.equal('!motion && isTimeBetween("22:00", "06:00")');
    });

    it("parses at() with an astro event or a time of day", () => {
        expect(parseTransitionLabel('at("sunset", -30)[light]')).to.deep.equal({
            temporal: { operator: "at", time: "sunset", offsetMinutes: -30 },
            condition: "light",
        });
        expect(parseTransitionLabel("at('22:30')")).to.deep.equal({ temporal: { operator: "at", time: "22:30" } });
        expect(() => parseTransitionLabel('at("sundown")')).to.throw(/Unknown time "sundown", use a time like "22:30"/);
        expect(() => parseTransitionLabel('at("25:00")')).to.throw(/Unknown time "25:00"/);
        expect(() => parseTransitionLabel('after("sunset")')).to.throw(/Invalid temporal expression/);
        expect(() => parseTransitionLabel('at("sunset", soon)')).to.throw(/Invalid temporal expression/);
    });

    it("rejects invalid labels", () => {
        for (const invalid of [
            "after(5)",
            "after(x, sec)",
            "after(0, button)",
            "after(2.5, button)",
            "every(0, sec)",
            "before(5, sec, motion)",
            "after(3, button, motion)",
            "after(5, sec, )",
        ]) {
            expect(() => parseTransitionLabel(invalid), invalid).to.throw(/Invalid temporal expression/);
        }
        expect(() => parseTransitionLabel("[a > 1")).to.throw(/Missing/);
        expect(() => parseTransitionLabel("a b")).to.throw(/Unexpected/);
    });
});

describe("chart-model => createChart", () => {
    it("creates an empty, paused chart", () => {
        expect(createChart("New")).to.include({ name: "New", enabled: false });
        expect(createChart("New").states).to.deep.equal([]);
    });
});

describe("chart-model => nameToId", () => {
    it("creates valid object IDs", () => {
        expect(nameToId("Licht Flur")).to.equal("licht_flur");
        expect(nameToId("Größe/Höhe")).to.equal("groesse_hoehe");
        expect(nameToId("...")).to.equal("chart");
    });
});
