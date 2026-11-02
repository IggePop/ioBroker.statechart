import { expect } from "chai";
import { ChartRuntime, getChartHash } from "./chart-runtime";
import { MAX_SUPER_STEPS } from "./chart-model";
import type { HistoryEntry, PersistedChart } from "./chart-runtime";
import type { Chart, ChartState, ChartSymbol } from "./chart-model";
import { validateCode } from "./chart-validation";

/**
 * Creates a host which keeps the states in memory
 *
 * @param states The initial values of the states
 */
function createHost(states: Record<string, any> = {}) {
    const host = {
        states: { ...states },
        active: [] as string[],
        warnings: [] as string[],
        readState: async (id: string) => host.states[id],
        /** all writes */
        writes: [] as { id: string; val: any; ack: boolean | undefined }[],
        writeState: async (id: string, val: any, ack: boolean | undefined) => {
            host.states[id] = val;
            host.writes.push({ id, val, ack });
        },
        messages: [] as any[][],
        sendTo: (...args: any[]) => host.messages.push(args),
        location: null as { latitude: number; longitude: number } | null,
        getLocation: () => host.location,
        /** reads a state with ack and time stamps, see RuntimeHost.getState */
        getState: undefined as ((id: string) => Promise<ioBroker.State | null>) | undefined,
        /** info and debug messages */
        infos: [] as string[],
        onActiveChange: (active: { names: string }) => host.active.push(active.names),
        /** the last persisted data */
        persisted: null as PersistedChart | null,
        persistCount: 0,
        persist: (data: PersistedChart) => {
            // a copy like a round trip through a state, so later changes do not change the stored data
            host.persisted = JSON.parse(JSON.stringify(data));
            host.persistCount++;
        },
        loadPersisted: async () => host.persisted,
        /** all values passed to onValues */
        values: [] as Record<string, any>[],
        onValues: (values: Record<string, any>) => host.values.push(values),
        /** all history entries, in the order they were passed to onHistory */
        history: [] as HistoryEntry[],
        /** how often onHistory was called */
        historyCalls: 0,
        onHistory: (entries: HistoryEntry[]) => {
            host.history.push(...entries);
            host.historyCalls++;
        },
        log: {
            debug: (msg: string) => host.infos.push(`debug: ${msg}`),
            info: (msg: string) => host.infos.push(`info: ${msg}`),
            warn: (msg: string) => host.warnings.push(msg),
            error: (msg: string) => host.warnings.push(msg),
        },
    };
    return host;
}

/**
 * A simple light switch: off -> on on motion, back to off after 50 ms without motion
 *
 */
function createLightChart(): Chart {
    return {
        version: 1,
        name: "Light",
        enabled: true,
        initial: "off",
        symbols: [
            { name: "motion", scope: "input", stateId: "test.0.motion" },
            { name: "light", scope: "output", stateId: "test.0.light" },
            { name: "count", scope: "local", initial: 0 },
        ],
        states: [
            { id: "off", name: "Off", entry: "light = false;", x: 0, y: 0 },
            { id: "on", name: "On", entry: "light = true; count++;", x: 0, y: 0 },
        ],
        transitions: [
            { id: "t1", source: "off", target: "on", label: "motion[motion == true]" },
            { id: "t2", source: "on", target: "off", label: "after(50, msec)[!motion]" },
        ],
    };
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("chart-runtime => ChartRuntime", () => {
    let runtime: ChartRuntime | undefined;
    afterEach(() => runtime?.stop());

    it("enters the initial state and executes its entry action", async () => {
        const host = createHost({ "test.0.light": true });
        runtime = new ChartRuntime("light", createLightChart(), host);
        await runtime.start();
        expect(host.active).to.deep.equal(["Off"]);
        expect(host.states["test.0.light"]).to.equal(false);
    });

    it("takes transitions on input changes and writes outputs", async () => {
        const host = createHost({ "test.0.motion": false, "test.0.light": false });
        runtime = new ChartRuntime("light", createLightChart(), host);
        await runtime.start();
        runtime.handleInput("test.0.motion", true);
        expect(host.active).to.deep.equal(["Off", "On"]);
        expect(host.states["test.0.light"]).to.equal(true);
        expect(runtime.sandbox.count).to.equal(1);
    });

    it("executes temporal transitions", async () => {
        const host = createHost({ "test.0.motion": false });
        runtime = new ChartRuntime("light", createLightChart(), host);
        await runtime.start();
        runtime.handleInput("test.0.motion", true);
        runtime.handleInput("test.0.motion", false);
        await wait(100);
        expect(host.active).to.deep.equal(["Off", "On", "Off"]);
        expect(host.states["test.0.light"]).to.equal(false);
    });

    it("executes during actions if no transition is taken", async () => {
        const chart = createLightChart();
        chart.states[0].during = "count += 10;";
        const host = createHost({ "test.0.motion": false });
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        // the wakeup after the start
        expect(runtime.sandbox.count).to.equal(10);
        runtime.handleInput("test.0.motion", false);
        expect(runtime.sandbox.count).to.equal(20);
        // a transition is taken: no during action, but the entry action of "On"
        runtime.handleInput("test.0.motion", true);
        expect(runtime.sandbox.count).to.equal(1 + 20);
    });

    it("wakes up once after the start, so transitions without event are taken right away", async () => {
        const chart = createLightChart();
        chart.states.push({ id: "end", name: "End", x: 0, y: 0 });
        chart.transitions = [
            { id: "t1", source: "off", target: "on" },
            { id: "t2", source: "on", target: "end", label: "" },
        ];
        const host = createHost({ "test.0.motion": false });
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        // only one transition per wakeup, the next one waits for the next wakeup
        expect(host.active).to.deep.equal(["Off", "On"]);
        expect(host.history.map(e => e.cause ?? e.kind)).to.deep.equal(["start", "start"]);
        runtime.handleInput("test.0.motion", true);
        expect(host.active.at(-1)).to.equal("End");
    });

    it("wakes up after restoring as well", async () => {
        const chart = createLightChart();
        chart.transitions[0].label = "[motion]";
        const host = createHost({ "test.0.motion": false });
        const first = new ChartRuntime("light", chart, host);
        await first.start();
        first.stop();
        // the input changed while the adapter was stopped
        host.states["test.0.motion"] = true;
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start({ restore: true });
        expect(host.active.at(-1)).to.equal("On");
        expect(host.history.at(-1)).to.include({ transition: "t1", cause: "start", trigger: null });
    });

    it("re-enters the state on self transitions", async () => {
        const chart = createLightChart();
        chart.transitions.push({ id: "t3", source: "on", target: "on", label: "motion[motion]" });
        const host = createHost({ "test.0.motion": false });
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        runtime.handleInput("test.0.motion", true);
        runtime.handleInput("test.0.motion", true);
        expect(runtime.sandbox.count).to.equal(2);
    });

    it("supports nested states", async () => {
        const chart = createLightChart();
        chart.states[1].initial = "dim";
        chart.states.push(
            { id: "dim", name: "Dim", parent: "on", x: 0, y: 0 },
            { id: "bright", name: "Bright", parent: "on", x: 0, y: 0 },
        );
        chart.transitions.push({ id: "t3", source: "dim", target: "bright", label: "after(10, msec)" });
        const host = createHost({ "test.0.motion": false });
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        runtime.handleInput("test.0.motion", true);
        expect(host.active.at(-1)).to.equal("On.Dim");
        await wait(30);
        expect(host.active.at(-1)).to.equal("On.Bright");
    });

    it("logs errors in conditions instead of crashing", async () => {
        const chart = createLightChart();
        chart.transitions[0].label = "[unknownVariable > 1]";
        const host = createHost();
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        runtime.handleInput("test.0.motion", true);
        expect(host.active).to.deep.equal(["Off"]);
        expect(host.warnings.join()).to.match(/unknownVariable is not defined/);
    });

    it("keeps let declarations local to each action", async () => {
        const chart = createLightChart();
        chart.states[0].entry = "let x = 1; light = x == 1;";
        chart.states[1].entry = "let x = 2; light = x == 2;";
        const host = createHost();
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        runtime.handleInput("test.0.motion", true);
        expect(host.warnings).to.deep.equal([]);
        expect(host.states["test.0.light"]).to.equal(true);
    });

    it("provides the functions of function blocks to conditions and actions", async () => {
        const chart = createLightChart();
        chart.functions = [
            {
                id: "f1",
                code: "const LIMIT = 2;\nfunction allowed() { return count < LIMIT; }\nfunction switchOn() { light = true; count++; }",
                x: 0,
                y: 0,
            },
        ];
        chart.states[1].entry = "switchOn();";
        chart.transitions[0].label = "motion[motion && allowed()]";
        chart.transitions[1].label = "motion[!motion]";
        const host = createHost({ "test.0.motion": false });
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        for (let i = 0; i < 3; i++) {
            runtime.handleInput("test.0.motion", true);
            runtime.handleInput("test.0.motion", false);
        }
        expect(host.warnings).to.deep.equal([]);
        // the third switch on is not allowed anymore
        expect(runtime.sandbox.count).to.equal(2);
        expect(host.active).to.deep.equal(["Off", "On", "Off", "On", "Off"]);
    });
});

describe("chart-runtime => live values and history", () => {
    let runtime: ChartRuntime | undefined;
    afterEach(() => runtime?.stop());

    it("publishes the values of all variables when the chart starts and when they change", async () => {
        const host = createHost({ "test.0.motion": false, "test.0.light": true });
        runtime = new ChartRuntime("light", createLightChart(), host);
        await runtime.start();
        expect(host.values).to.deep.equal([{ motion: false, light: false, count: 0 }]);

        runtime.handleInput("test.0.motion", true);
        expect(host.values.at(-1)).to.deep.equal({ motion: true, light: true, count: 1 });
        // the same value again changes nothing, so nothing is published
        runtime.handleInput("test.0.motion", true);
        expect(host.values).to.have.length(2);
    });

    it("publishes values which are no JSON as text", async () => {
        const chart = createLightChart();
        chart.states[0].entry = "count = {}; count.self = count;";
        const host = createHost();
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        expect(host.values[0].count).to.equal("[object Object]");
    });

    it("records the start and every transition with its trigger and the active states", async () => {
        const host = createHost({ "test.0.motion": false });
        runtime = new ChartRuntime("light", createLightChart(), host);
        const now = Date.now();
        runtime.now = () => now;
        await runtime.start();
        expect(host.history).to.deep.equal([{ ts: now, kind: "start", restored: false, active: "Off" }]);

        runtime.handleInput("test.0.motion", true);
        expect(host.history[1]).to.deep.equal({
            ts: now,
            kind: "transition",
            transition: "t1",
            from: "Off",
            to: "On",
            trigger: "motion",
            cause: "input",
            active: "On",
        });
        runtime.handleInput("test.0.motion", false);
        // the temporal transition is valid only after 50 ms, so nothing happened
        expect(host.history).to.have.length(2);
        runtime.now = () => now + 60;
        runtime.wakeup(null);
        expect(host.history[2]).to.include({ transition: "t2", trigger: null, cause: "timer", active: "Off" });
        expect(host.historyCalls).to.equal(3);
    });

    it("marks a restored start", async () => {
        const host = createHost({ "test.0.motion": false });
        const first = new ChartRuntime("light", createLightChart(), host);
        await first.start();
        first.handleInput("test.0.motion", true);
        first.stop();
        runtime = new ChartRuntime("light", createLightChart(), host);
        await runtime.start({ restore: true });
        expect(host.history.at(-1)).to.include({ kind: "start", restored: true, active: "On" });
    });
});

describe("chart-runtime => super step", () => {
    let runtime: ChartRuntime | undefined;
    afterEach(() => runtime?.stop());

    /**
     * A chain Off -> On -> End, the transitions have the given labels
     *
     * @param labels Labels of the transitions Off -> On and On -> End
     * @param superStep If super step semantics are used
     */
    function createChain(labels: [string, string], superStep: boolean): Chart {
        const chart = createLightChart();
        chart.superStep = superStep;
        chart.states.push({ id: "end", name: "End", x: 0, y: 0, entry: "count += 10;" });
        chart.transitions = [
            { id: "t1", source: "off", target: "on", label: labels[0] },
            { id: "t2", source: "on", target: "end", label: labels[1] },
        ];
        return chart;
    }

    it("takes transitions until none is valid anymore", async () => {
        const host = createHost({ "test.0.motion": false });
        runtime = new ChartRuntime("light", createChain(["", ""], true), host);
        await runtime.start();
        expect(host.active).to.deep.equal(["Off", "On", "End"]);
        expect(host.history.filter(e => e.kind === "transition").map(e => e.cause)).to.deep.equal(["start", "start"]);
        // all entry actions were executed
        expect(runtime.sandbox.count).to.equal(11);
    });

    it("takes only one transition per wakeup without super step", async () => {
        const host = createHost({ "test.0.motion": false });
        runtime = new ChartRuntime("light", createChain(["", ""], false), host);
        await runtime.start();
        expect(host.active).to.deep.equal(["Off", "On"]);
    });

    it("uses the event of the input only in the first step", async () => {
        const host = createHost({ "test.0.motion": false });
        runtime = new ChartRuntime("light", createChain(["motion", "motion"], true), host);
        await runtime.start();
        runtime.handleInput("test.0.motion", true);
        expect(host.active).to.deep.equal(["Off", "On"]);
        runtime.handleInput("test.0.motion", true);
        expect(host.active).to.deep.equal(["Off", "On", "End"]);
    });

    it("records the input of the wakeup for all transitions of the chain", async () => {
        const host = createHost({ "test.0.motion": false });
        runtime = new ChartRuntime("light", createChain(["motion[motion]", "[motion]"], true), host);
        await runtime.start();
        runtime.handleInput("test.0.motion", true);
        expect(host.active.at(-1)).to.equal("End");
        expect(host.history.filter(e => e.kind === "transition").map(e => [e.trigger, e.cause])).to.deep.equal([
            ["motion", "input"],
            ["motion", "input"],
        ]);
    });

    it("executes the during actions of the reached state, and stops a loop of transitions", async () => {
        const chart = createLightChart();
        chart.superStep = true;
        chart.states[0].entry = "";
        chart.states[1].entry = "";
        chart.states[1].during = "count++;";
        // Off and On switch back and forth as long as motion is true
        chart.transitions = [
            { id: "t1", source: "off", target: "on", label: "" },
            { id: "t2", source: "on", target: "off", label: "[motion]" },
        ];
        const host = createHost({ "test.0.motion": false });
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        // On is reached, no transition is valid: its during action is executed in the last step
        expect(host.active.at(-1)).to.equal("On");
        expect(runtime.sandbox.count).to.equal(1);

        runtime.handleInput("test.0.motion", true);
        expect(host.warnings.join()).to.match(/Stopped after 100 transitions in one wakeup/);
        expect(host.history.filter(e => e.kind === "transition")).to.have.length(1 + MAX_SUPER_STEPS);
        // the chart still works
        runtime.handleInput("test.0.motion", false);
        expect(host.active.at(-1)).to.equal("On");
    });
});

describe("chart-runtime => temporal transitions and restoring after a restart", () => {
    const runtimes: ChartRuntime[] = [];
    afterEach(() => runtimes.splice(0).forEach(r => r.stop()));

    async function start(chart: Chart, host: ReturnType<typeof createHost>, restore = false): Promise<ChartRuntime> {
        const runtime = new ChartRuntime("light", chart, host);
        runtimes.push(runtime);
        await runtime.start({ restore });
        return runtime;
    }

    it("keeps an expired temporal transition valid until its condition is true", async () => {
        const host = createHost({ "test.0.motion": false });
        const runtime = await start(createLightChart(), host);
        runtime.handleInput("test.0.motion", true);
        // after 50 ms there is still motion, so the light stays on ...
        await wait(80);
        expect(host.active.at(-1)).to.equal("On");
        // ... and goes off as soon as the motion stops
        runtime.handleInput("test.0.motion", false);
        expect(host.active.at(-1)).to.equal("Off");
    });

    it("restores the active state and the locals without executing the entry actions again", async () => {
        const host = createHost({ "test.0.motion": false });
        const first = await start(createLightChart(), host);
        first.handleInput("test.0.motion", true);
        expect(first.sandbox.count).to.equal(1);
        first.stop();

        // the adapter was restarted, meanwhile someone switched the light off by hand
        host.states["test.0.light"] = false;
        host.active = [];
        const second = await start(createLightChart(), host, true);
        expect(host.active).to.deep.equal(["On"]);
        expect(second.sandbox.count).to.equal(1, "locals restored, entry not executed again");
        expect(host.states["test.0.light"]).to.equal(false, "outputs are not written again");
    });

    it("continues the timers with their remaining time", async () => {
        const host = createHost({ "test.0.motion": false });
        const first = await start(createLightChart(), host);
        first.handleInput("test.0.motion", true);
        first.handleInput("test.0.motion", false);
        first.stop();

        // "On" was entered 40 ms before the restart, so after(50, msec) expires 10 ms after it
        (host.persisted as any).entered.on = Date.now() - 40;
        await start(createLightChart(), host, true);
        expect(host.active.at(-1)).to.equal("On");
        await wait(30);
        expect(host.active.at(-1)).to.equal("Off");
    });

    it("takes transitions whose time expired while the adapter was stopped", async () => {
        const host = createHost({ "test.0.motion": false });
        const first = await start(createLightChart(), host);
        first.handleInput("test.0.motion", true);
        first.handleInput("test.0.motion", false);
        first.stop();

        (host.persisted as any).entered.on = Date.now() - 60_000;
        await start(createLightChart(), host, true);
        await wait(5);
        expect(host.active.at(-1)).to.equal("Off");
    });

    it("starts in the initial state if the chart was changed", async () => {
        const host = createHost({ "test.0.motion": false });
        const first = await start(createLightChart(), host);
        first.handleInput("test.0.motion", true);
        first.stop();

        const changed = createLightChart();
        changed.states[1].entry = "light = true; count += 2;";
        host.active = [];
        const second = await start(changed, host, true);
        expect(host.active).to.deep.equal(["Off"]);
        expect(second.sandbox.count).to.equal(0);
    });

    it("ignores changed positions and ends of transitions in the editor", async () => {
        const host = createHost({ "test.0.motion": false });
        const first = await start(createLightChart(), host);
        first.handleInput("test.0.motion", true);
        first.stop();

        const moved = createLightChart();
        moved.states[1].x = 500;
        moved.transitions[0].sourceAnchor = { side: "bottom", pos: 0.3 };
        moved.transitions[0].targetAnchor = { side: "top", pos: 0.7 };
        host.active = [];
        await start(moved, host, true);
        expect(host.active).to.deep.equal(["On"]);
    });

    it("ignores comments and notes for the hash, but not the logic", () => {
        const chart = createLightChart();
        const hash = getChartHash(chart);
        const documented = createLightChart();
        documented.comment = "About the chart";
        documented.states[0].comment = "Light is off";
        documented.transitions[0].comment = "Motion switches it on";
        documented.notes = [{ id: "n1", text: "A note", x: 0, y: 0 }];
        expect(getChartHash(documented)).to.equal(hash);
        documented.transitions[0].label = "motion";
        expect(getChartHash(documented)).not.to.equal(hash);
    });

    it("does not restore if it is not requested or switched off for the chart", async () => {
        const host = createHost({ "test.0.motion": false });
        const first = await start(createLightChart(), host);
        first.handleInput("test.0.motion", true);
        first.stop();
        const persisted = host.persisted;

        host.active = [];
        (await start(createLightChart(), host, false)).stop();
        expect(host.active).to.deep.equal(["Off"]);

        host.persisted = persisted;
        host.active = [];
        const chart = createLightChart();
        chart.restoreState = false;
        await start(chart, host, true);
        expect(host.active).to.deep.equal(["Off"]);
    });

    it("persists only changes", async () => {
        const host = createHost({ "test.0.motion": false });
        const runtime = await start(createLightChart(), host);
        const count = host.persistCount;
        // a wakeup without any change
        runtime.handleInput("test.0.motion", false);
        expect(host.persistCount).to.equal(count);
        runtime.handleInput("test.0.motion", true);
        expect(host.persistCount).to.equal(count + 1);
    });
});

describe("chart-runtime => temporal logic", () => {
    let runtime: ChartRuntime | undefined;
    afterEach(() => runtime?.stop());

    /**
     * The light chart with other transitions Off -> On and On -> Off, and a second input "other"
     *
     * @param labels Labels of the transitions Off -> On and On -> Off
     * @param prepare Changes the chart before the start
     */
    async function start(
        labels: [string, string],
        prepare?: (chart: Chart) => void,
    ): Promise<ReturnType<typeof createHost>> {
        const chart = createLightChart();
        chart.symbols.push({ name: "other", scope: "input", stateId: "test.0.other" });
        chart.transitions = [
            { id: "t1", source: "off", target: "on", label: labels[0] },
            { id: "t2", source: "on", target: "off", label: labels[1] },
        ];
        prepare?.(chart);
        const host = createHost({ "test.0.motion": false, "test.0.other": 0 });
        // some tests start a second chart
        runtime?.stop();
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        return host;
    }

    it("before(n, unit) is only valid during the first n units", async () => {
        const host = await start(["before(40, msec)[motion]", ""]);
        runtime?.handleInput("test.0.motion", true);
        expect(host.active.at(-1)).to.equal("On");

        const late = await start(["before(40, msec)[motion]", ""]);
        await wait(60);
        runtime?.handleInput("test.0.motion", true);
        expect(late.active.at(-1)).to.equal("Off");
    });

    it("at(n, unit) is only valid in the wakeup of its timer", async () => {
        const host = await start(["at(30, msec)[motion]", ""]);
        runtime?.handleInput("test.0.motion", true);
        // before the time
        expect(host.active.at(-1)).to.equal("Off");
        await wait(60);
        expect(host.active.at(-1)).to.equal("On");

        const missed = await start(["at(30, msec)[motion]", ""]);
        await wait(60);
        // after the time, unlike after(...)
        runtime?.handleInput("test.0.motion", true);
        expect(missed.active.at(-1)).to.equal("Off");
    });

    it("every(n, unit) is valid in the wakeup of each period", async () => {
        const host = await start(["every(30, msec)[count >= 2]", ""], chart => {
            chart.states[0].during = "count++;";
        });
        // the during action counts the wakeups: after the start, then on every period
        await wait(45);
        expect(runtime?.sandbox.count).to.equal(2);
        expect(host.active.at(-1)).to.equal("Off");
        await wait(60);
        expect(host.active.at(-1)).to.equal("On");
    });

    it("counts the wakeups by an input since entering the state", async () => {
        const host = await start(["after(3, motion)", "at(2, motion)"]);
        runtime?.handleInput("test.0.motion", true);
        runtime?.handleInput("test.0.other", 1);
        runtime?.handleInput("test.0.motion", false);
        expect(host.active.at(-1)).to.equal("Off");
        runtime?.handleInput("test.0.motion", true);
        expect(host.active.at(-1)).to.equal("On");
        // counting starts again in On, the wakeup which entered it does not count
        runtime?.handleInput("test.0.motion", true);
        expect(host.active.at(-1)).to.equal("On");
        runtime?.handleInput("test.0.motion", true);
        expect(host.active.at(-1)).to.equal("Off");
    });

    it("every(n, input) and before(n, input)", async () => {
        const host = await start(["every(2, motion)", "before(2, other)"]);
        runtime?.handleInput("test.0.motion", true);
        expect(host.active.at(-1)).to.equal("Off");
        runtime?.handleInput("test.0.motion", true);
        expect(host.active.at(-1)).to.equal("On");
        runtime?.handleInput("test.0.other", 1);
        expect(host.active.at(-1)).to.equal("Off");
    });

    it("after(n, unit, condition) waits until the condition is true for the time", async () => {
        const host = await start(["motion", "after(50, msec, !motion)"]);
        runtime?.handleInput("test.0.motion", true);
        expect(host.active.at(-1)).to.equal("On");
        runtime?.handleInput("test.0.motion", false);
        await wait(30);
        // motion again: the time starts again
        runtime?.handleInput("test.0.motion", true);
        runtime?.handleInput("test.0.motion", false);
        await wait(30);
        expect(host.active.at(-1)).to.equal("On");
        // the timer wakes up the chart, without another input
        await wait(50);
        expect(host.active.at(-1)).to.equal("Off");
    });

    it("measures after(n, unit, condition) from entering the state", async () => {
        const host = await start(["motion", "after(40, msec, true)"]);
        runtime?.handleInput("test.0.motion", true);
        expect(host.active.at(-1)).to.equal("On");
        await wait(70);
        expect(host.active.at(-1)).to.equal("Off");
    });

    it("provides elapsed() and duration() in conditions and actions", async () => {
        const host = await start(["other[elapsed(msec) >= 40]", ""], chart => {
            chart.symbols.push({ name: "measured", scope: "local", initial: 0 });
            chart.states[0].during = "measured = duration(motion, msec);";
        });
        runtime?.handleInput("test.0.other", 1);
        expect(host.active.at(-1)).to.equal("Off");
        runtime?.handleInput("test.0.motion", true);
        expect(runtime?.sandbox.measured).to.equal(0);
        await wait(50);
        runtime?.handleInput("test.0.motion", true);
        expect(runtime?.sandbox.measured).to.be.at.least(40);
        runtime?.handleInput("test.0.other", 2);
        expect(host.active.at(-1)).to.equal("On");
    });

    it("uses min as unit in elapsed() and reports elapsed() outside of states", async () => {
        const host = await start(["other[elapsed(min) < 1]", ""], chart => {
            chart.functions = [{ id: "f", x: 0, y: 0, code: "const startedAt = elapsed();" }];
        });
        expect(host.warnings.join(" ")).to.include("elapsed() can only be used in conditions and in the actions");
        runtime?.handleInput("test.0.other", 1);
        expect(host.active.at(-1)).to.equal("On");
    });

    it("restores the counts and the time of after(n, unit, condition) after a restart", async () => {
        const host = createHost({ "test.0.motion": false, "test.0.other": 0 });
        const chart = createLightChart();
        chart.symbols.push({ name: "other", scope: "input", stateId: "test.0.other" });
        chart.transitions = [
            { id: "t1", source: "off", target: "on", label: "after(2, other)" },
            { id: "t2", source: "on", target: "off", label: "after(60, msec, !motion)" },
        ];
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        runtime.handleInput("test.0.other", 1);
        runtime.stop();

        runtime = new ChartRuntime("light", chart, host);
        await runtime.start({ restore: true });
        runtime.handleInput("test.0.other", 2);
        expect(host.active.at(-1)).to.equal("On");
        await wait(30);
        runtime.stop();

        runtime = new ChartRuntime("light", chart, host);
        await runtime.start({ restore: true });
        // the 60 ms started before the restart
        await wait(45);
        expect(host.active.at(-1)).to.equal("Off");
    });
});

describe("chart-runtime => getState() and at() every day", () => {
    let runtime: ChartRuntime | undefined;
    afterEach(() => runtime?.stop());

    it("reads states at the start and keeps them up to date, without waking up the chart", async () => {
        const chart = createLightChart();
        chart.transitions = [
            {
                id: "t1",
                source: "off",
                target: "on",
                label: 'motion[getState("test.0.lux").val < 50 && getState("test.0.none") === null]',
            },
        ];
        chart.states[0].during = "count++;";
        const host = createHost({ "test.0.motion": false, "test.0.lux": 100 });
        runtime = new ChartRuntime("light", chart, host);
        expect(runtime.subscribedStateIds).to.deep.equal(["test.0.motion", "test.0.lux", "test.0.none"]);
        await runtime.start();
        runtime.handleInput("test.0.motion", true);
        expect(host.active.at(-1)).to.equal("Off");
        const wakeups = runtime.sandbox.count;
        runtime.handleStateChange("test.0.lux", { val: 20, ack: true, ts: 1, lc: 1, from: "", q: 0 });
        expect(runtime.sandbox.count).to.equal(wakeups);
        runtime.handleInput("test.0.motion", true);
        expect(host.active.at(-1)).to.equal("On");
    });

    it("returns ack and time stamps, and rejects IDs which are not known at the start", async () => {
        const chart = createLightChart();
        chart.symbols.push({ name: "result", scope: "local", initial: null });
        chart.states[0].entry = 'result = getState("test.0.lux"); const id = "test.0.lux"; getState(id + "x");';
        const host = createHost();
        host.getState = async () => ({ val: 7, ack: true, ts: 5, lc: 3, from: "", q: 0 });
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        expect(runtime.sandbox.result).to.deep.equal({ val: 7, ack: true, ts: 5, lc: 3 });
        expect(host.warnings.join(" ")).to.include("getState() can only read states whose ID is written as text");
    });

    /**
     * @param time A time of today
     * @returns the time in "HH:mm:ss"
     */
    const timeOfDay = (time: number): string => new Date(time).toTimeString().substring(0, 8);

    it("at(time of day) wakes up the chart at that time", async () => {
        // a second after now, unless the day ends: then the test would wait until tomorrow
        const due = Date.now() + 1000;
        if (new Date(due).getDate() !== new Date().getDate()) {
            return;
        }
        const chart = createLightChart();
        // without the way back after 50 ms
        chart.transitions = [{ id: "t1", source: "off", target: "on", label: `at("${timeOfDay(due)}")` }];
        const host = createHost({ "test.0.motion": false });
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        expect(host.active.at(-1)).to.equal("Off");
        await wait(due - Date.now() + 100);
        expect(host.active.at(-1)).to.equal("On");
    });

    it("finds the next astro event and the next time of day", () => {
        const chart = createLightChart();
        const host = createHost();
        host.location = { latitude: 52.52, longitude: 13.4 };
        const r = new ChartRuntime("light", chart, host);
        const noon = new Date(2026, 5, 21, 12, 0, 0).getTime();
        const sunset = r.getNextDailyTime({ operator: "at", time: "sunset" }, noon) as number;
        expect(new Date(sunset).getDate()).to.equal(21);
        expect(new Date(sunset).getHours()).to.be.within(20, 22);
        // 30 minutes before, the day after
        const before = r.getNextDailyTime({ operator: "at", time: "sunset", offsetMinutes: -30 }, sunset) as number;
        expect(new Date(before).getDate()).to.equal(22);
        // a time of day which has passed today is taken from tomorrow
        const morning = r.getNextDailyTime({ operator: "at", time: "06:30" }, noon) as number;
        expect(new Date(morning).toString()).to.include("Jun 22 2026 06:30:00");
        // no sunset in polar summer
        host.location = { latitude: 78.2, longitude: 15.6 };
        expect(r.getNextDailyTime({ operator: "at", time: "sunset" }, noon)).to.equal(null);
    });

    it("reports a missing location for astro events", async () => {
        const chart = createLightChart();
        chart.transitions[0].label = 'at("sunset")';
        const host = createHost();
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        expect(host.warnings.join(" ")).to.include("Off -> On: No location");
    });
});

describe("chart-runtime => helper functions", () => {
    let runtime: ChartRuntime | undefined;
    afterEach(() => runtime?.stop());

    /**
     * Starts a chart whose initial state executes the given entry action
     *
     * @param entry The entry action
     * @param prepare Changes the host before the start
     */
    async function run(entry: string, prepare?: (host: ReturnType<typeof createHost>) => void) {
        const chart = createLightChart();
        chart.symbols.push({ name: "result", scope: "local", initial: null });
        chart.states[0].entry = entry;
        const host = createHost();
        prepare?.(host);
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        return { host, runtime };
    }

    it("logs with a level", async () => {
        const { host } = await run('log("hello"); log("careful", "warn"); log("details", "debug");');
        expect(host.infos).to.include.members(["info: [Light] hello", "debug: [Light] details"]);
        expect(host.warnings).to.deep.equal(["[Light] careful"]);
    });

    it("writes any state, with ack", async () => {
        const { host } = await run('setState("other.0.x", 5); setState("other.0.y", "a", true);');
        expect(host.writes).to.deep.include({ id: "other.0.x", val: 5, ack: false });
        expect(host.writes).to.deep.include({ id: "other.0.y", val: "a", ack: true });
    });

    it("writes delayed and cancels pending writes when the chart stops", async () => {
        const { host, runtime: r } = await run(
            'setStateDelayed("other.0.x", 1, 20); setStateDelayed("other.0.y", 2, 60);',
        );
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(host.states["other.0.x"]).to.equal(1);
        r.stop();
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(host.states).not.to.have.property("other.0.y");
    });

    it("sends messages to adapters", async () => {
        const { host } = await run('sendTo("telegram.0", "send", { text: "Hello" });');
        expect(host.messages).to.deep.equal([["telegram.0", "send", { text: "Hello" }]]);
    });

    it("checks time ranges", async () => {
        const { runtime: r } = await run('result = isTimeBetween("00:00", "23:59:59");');
        expect(r.sandbox.result).to.equal(true);
    });

    it("calculates astro times at the configured location", async () => {
        const { runtime: r } = await run(
            'const sunrise = astroTime("sunrise"); result = [sunrise.getTime(), astroTime("sunrise", 30).getTime(), isDaytime()];',
            host => (host.location = { latitude: 52.52, longitude: 13.4 }),
        );
        const [sunrise, later, daytime] = r.sandbox.result;
        expect(later - sunrise).to.equal(30 * 60_000);
        const sunset = r.getSunTimes(new Date()).sunset!.getTime();
        const now = Date.now();
        expect(daytime).to.equal(now >= sunrise && now < sunset);
    });

    it("reports a missing location and unknown astro events as problem of the action", async () => {
        const { host } = await run("result = isDaytime();");
        expect(host.warnings.join()).to.match(/No location \(latitude\/longitude\) configured/);
        const second = await run(
            'result = astroTime("teatime");',
            h => (h.location = { latitude: 52.52, longitude: 13.4 }),
        );
        expect(second.host.warnings.join()).to.match(/Unknown astro event "teatime"/);
    });

    it("handles days without sunrise in polar regions", async () => {
        const chart = createLightChart();
        chart.symbols.push({ name: "result", scope: "local", initial: null });
        chart.states[0].entry = 'result = isDaytime(); astroTime("sunrise");';
        const host = createHost();
        // Tromsø in the polar night
        host.location = { latitude: 69.65, longitude: 18.96 };
        runtime = new ChartRuntime("light", chart, host);
        runtime.now = () => new Date("2026-12-21T11:00:00Z").getTime();
        await runtime.start();
        expect(runtime.sandbox.result).to.equal(false);
        expect(host.warnings.join()).to.match(/There is no "sunrise" today/);
        runtime.stop();

        // the midnight sun: it is daytime all day
        runtime = new ChartRuntime("light", chart, host);
        runtime.now = () => new Date("2026-06-21T23:00:00Z").getTime();
        await runtime.start();
        expect(runtime.sandbox.result).to.equal(true);
    });

    it("knows the helper functions in the validation", () => {
        expect(
            validateCode('sendTo("a.0", "b", {}); setStateDelayed("x", 1, 100); isDaytime();', "statements", []),
        ).to.deep.equal([]);
    });
});

describe("chart-runtime => change detection", () => {
    let runtime: ChartRuntime | undefined;
    afterEach(() => runtime?.stop());

    /**
     * A chart with a button: Off -> On on the rising edge, On -> Off on the next rising edge
     *
     * @param labels Labels of the transitions Off -> On and On -> Off
     * @param button Initial value of the button
     */
    async function start(labels: [string, string], button: any = false): Promise<ReturnType<typeof createHost>> {
        const chart = createLightChart();
        chart.symbols.push({ name: "button", scope: "input", stateId: "test.0.button" });
        chart.transitions = [
            { id: "t1", source: "off", target: "on", label: labels[0] },
            { id: "t2", source: "on", target: "off", label: labels[1] },
        ];
        const host = createHost({ "test.0.motion": false, "test.0.button": button });
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        return host;
    }

    it("detects edges: a value which stays the same is no change", async () => {
        const host = await start(["[hasChangedTo(button, true)]", "[hasChangedTo(button, true)]"]);
        expect(host.active).to.deep.equal(["Off"]);
        runtime?.handleInput("test.0.button", true);
        expect(host.active).to.deep.equal(["Off", "On"]);
        // the same value again, and a wakeup by another input
        runtime?.handleInput("test.0.button", true);
        runtime?.handleInput("test.0.motion", false);
        expect(host.active).to.deep.equal(["Off", "On"]);
        runtime?.handleInput("test.0.button", false);
        expect(host.active).to.deep.equal(["Off", "On"]);
        runtime?.handleInput("test.0.button", true);
        expect(host.active).to.deep.equal(["Off", "On", "Off"]);
    });

    it("reports no change on the wakeup after the start", async () => {
        const host = await start(["[hasChanged(button)]", ""], true);
        expect(host.active).to.deep.equal(["Off"]);
    });

    it("checks the previous value with hasChangedFrom", async () => {
        const host = await start(['[hasChangedFrom(button, "b")]', ""], "a");
        runtime?.handleInput("test.0.button", "b");
        runtime?.handleInput("test.0.button", "c");
        expect(host.active).to.deep.equal(["Off", "On"]);
    });

    it("compares the values at the start of the wakeups, also changes of locals by actions", async () => {
        const host = await start(["[motion]{count = 5;}", "[hasChanged(count) && count === 6]"]);
        runtime?.handleInput("test.0.motion", true);
        expect(runtime?.sandbox.count).to.equal(6);
        expect(host.active).to.deep.equal(["Off", "On"]);
        // the change by the actions of the previous wakeup is seen now
        runtime?.handleInput("test.0.motion", true);
        expect(host.active).to.deep.equal(["Off", "On", "Off"]);
    });

    it("detects changes inside objects and in function blocks", async () => {
        const chart = createLightChart();
        chart.symbols.push({ name: "list", scope: "local", initial: [] });
        chart.functions = [{ id: "f", x: 0, y: 0, code: "function listChanged() { return hasChanged(list); }" }];
        chart.states[0].during = "list.push(1);";
        chart.transitions = [{ id: "t1", source: "off", target: "on", label: "[listChanged()]" }];
        const host = createHost({ "test.0.motion": false });
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        expect(host.active).to.deep.equal(["Off"]);
        runtime.handleInput("test.0.motion", false);
        expect(host.active).to.deep.equal(["Off", "On"]);
    });

    it("rejects values which are no variables", async () => {
        const chart = createLightChart();
        chart.states[0].entry = "hasChanged(1 + 1);";
        const host = createHost();
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        expect(host.warnings.join(" ")).to.include("Off/entry: hasChanged() needs a variable of the chart");
    });
});

describe("chart-runtime => triggers of inputs", () => {
    let runtime: ChartRuntime | undefined;
    afterEach(() => runtime?.stop());

    /**
     * A chart which counts its wakeups (during action) and stores the last motion value
     *
     * @param options Of the input "motion"
     */
    async function start(options: Partial<ChartSymbol>): Promise<ChartRuntime> {
        const chart = createLightChart();
        Object.assign(chart.symbols[0], options);
        chart.symbols.push({ name: "seen", scope: "local", initial: null });
        chart.states[0].during = "count++; seen = motion;";
        // no transitions, so every wakeup executes the during action
        chart.transitions = [];
        const host = createHost({ "test.0.motion": false });
        runtime = new ChartRuntime("light", chart, host);
        await runtime.start();
        // only the wakeups by the input are counted, not the one after the start
        runtime.sandbox.count = 0;
        return runtime;
    }

    it("wakes up on every update by default, regardless of ack", async () => {
        const r = await start({});
        r.handleInput("test.0.motion", false, { ack: true });
        r.handleInput("test.0.motion", false, { ack: false });
        r.handleInput("test.0.motion", true);
        expect(r.sandbox.count).to.equal(3);
    });

    it("wakes up only on changes", async () => {
        const r = await start({ trigger: "change" });
        r.handleInput("test.0.motion", false);
        r.handleInput("test.0.motion", true);
        r.handleInput("test.0.motion", true);
        r.handleInput("test.0.motion", false);
        expect(r.sandbox.count).to.equal(2);
    });

    it("uses only confirmed values", async () => {
        const r = await start({ ack: "ack" });
        r.handleInput("test.0.motion", true, { ack: false });
        expect(r.sandbox.count).to.equal(0);
        expect(r.sandbox.motion).to.equal(false, "a filtered update does not change the variable");
        r.handleInput("test.0.motion", true, { ack: true });
        expect(r.sandbox.count).to.equal(1);
        expect(r.sandbox.seen).to.equal(true);
    });

    it("uses only commands", async () => {
        const r = await start({ ack: "command" });
        r.handleInput("test.0.motion", true, { ack: true });
        r.handleInput("test.0.motion", true);
        expect(r.sandbox.count).to.equal(0);
        r.handleInput("test.0.motion", true, { ack: false });
        expect(r.sandbox.count).to.equal(1);
    });

    it("debounces: one wakeup with the last value after the input was quiet", async () => {
        const r = await start({ debounceMs: 30 });
        r.handleInput("test.0.motion", true);
        await wait(10);
        r.handleInput("test.0.motion", false);
        await wait(10);
        r.handleInput("test.0.motion", true);
        expect(r.sandbox.count).to.equal(0);
        expect(r.sandbox.motion).to.equal(false, "the variable changes only with the wakeup");
        await wait(50);
        expect(r.sandbox.count).to.equal(1);
        expect(r.sandbox.seen).to.equal(true);
    });

    it("debounces and checks for changes with the last value", async () => {
        const r = await start({ debounceMs: 20, trigger: "change" });
        // bounces back to the old value: no change, no wakeup
        r.handleInput("test.0.motion", true);
        r.handleInput("test.0.motion", false);
        await wait(40);
        expect(r.sandbox.count).to.equal(0);
    });

    it("wakes up with the event of an input without changing its value", async () => {
        const r = await start({});
        r.sandbox.motion = "unchanged";
        expect(r.handleEvent("motion")).to.equal(true);
        expect(r.sandbox.count).to.equal(1);
        expect(r.sandbox.seen).to.equal("unchanged");
        expect(r.handleEvent("light")).to.equal(false);
        expect(r.handleEvent("nothing")).to.equal(false);
        expect(r.sandbox.count).to.equal(1);
    });

    it("cancels pending debounce timers when it stops", async () => {
        const r = await start({ debounceMs: 20 });
        r.handleInput("test.0.motion", true);
        r.stop();
        await wait(40);
        expect(r.sandbox.count).to.equal(0);
    });
});

/**
 * A heating control with a super state: Auto (with the children Idle and Heat) and Manual.
 * All actions write to "trace", so the tests can check the order of execution.
 */
function createHeatingChart(): Chart {
    const state = (id: string, name: string, parent: string | null): ChartState => ({
        id,
        name,
        parent,
        entry: `trace.push("${name}/entry");`,
        during: `trace.push("${name}/during");`,
        exit: `trace.push("${name}/exit");`,
        x: 0,
        y: 0,
    });
    return {
        version: 1,
        name: "Heating",
        enabled: true,
        initial: "auto",
        symbols: [
            { name: "temp", scope: "input", stateId: "test.0.temp" },
            { name: "manual", scope: "input", stateId: "test.0.manual" },
            { name: "reset", scope: "input", stateId: "test.0.reset" },
            { name: "trace", scope: "local", initial: [] },
        ],
        states: [
            { ...state("auto", "Auto", null), initial: "idle" },
            state("idle", "Idle", "auto"),
            state("heat", "Heat", "auto"),
            state("manualState", "Manual", null),
        ],
        transitions: [
            { id: "toManual", source: "auto", target: "manualState", label: "[manual]" },
            { id: "toAuto", source: "manualState", target: "auto", label: "[!manual]" },
            { id: "startHeating", source: "idle", target: "heat", label: "[temp < 20]" },
            { id: "stopHeating", source: "heat", target: "idle", label: "[temp > 22]" },
        ],
    };
}

describe("chart-runtime => parallel states", () => {
    let runtime: ChartRuntime | undefined;
    afterEach(() => runtime?.stop());

    /**
     * Home (parallel) with the regions Heating (Off, On) and Window (Closed, Open), and the state Away.
     * All actions write to the local "trace".
     */
    function createHomeChart(): Chart {
        const traced = (id: string, name: string, parent: string | null, extra: Partial<ChartState> = {}) => ({
            id,
            name,
            parent,
            x: 0,
            y: 0,
            entry: `trace.push("enter ${name}");`,
            exit: `trace.push("exit ${name}");`,
            ...extra,
        });
        return {
            version: 1,
            name: "Home",
            enabled: true,
            initial: "home",
            symbols: [
                { name: "cold", scope: "input", stateId: "test.0.cold" },
                { name: "open", scope: "input", stateId: "test.0.open" },
                { name: "leave", scope: "input", stateId: "test.0.leave" },
                { name: "trace", scope: "local", initial: [] },
            ],
            states: [
                traced("home", "Home", null, { parallel: true }),
                traced("heat", "Heating", "home", { order: 1, during: 'trace.push("during Heating");' }),
                traced("hOff", "HeatOff", "heat"),
                traced("hOn", "HeatOn", "heat"),
                traced("win", "Window", "home", { order: 2, during: 'trace.push("during Window");' }),
                traced("wClosed", "Closed", "win"),
                traced("wOpen", "Open", "win"),
                traced("away", "Away", null),
            ],
            transitions: [
                { id: "t1", source: "hOff", target: "hOn", label: "[cold]" },
                { id: "t2", source: "wClosed", target: "wOpen", label: "[open]" },
                { id: "t3", source: "hOn", target: "away", label: "[leave]" },
                { id: "t4", source: "away", target: "home", label: "[!leave]" },
            ],
        };
    }

    async function start(chart = createHomeChart()): Promise<ReturnType<typeof createHost>> {
        const host = createHost({ "test.0.cold": false, "test.0.open": false, "test.0.leave": false });
        runtime = new ChartRuntime("home", chart, host);
        await runtime.start();
        return host;
    }

    const trace = (): string[] => {
        const result = runtime?.sandbox.trace as string[];
        runtime!.sandbox.trace = [];
        return result;
    };

    it("enters all regions in their execution order", async () => {
        const host = await start();
        expect(host.active.at(-1)).to.equal("Home.Heating.HeatOff, Home.Window.Closed");
        expect(runtime?.activeIds).to.deep.equal(["home", "heat", "hOff", "win", "wClosed"]);
        expect(trace()).to.deep.equal([
            "enter Home",
            "enter Heating",
            "enter HeatOff",
            "enter Window",
            "enter Closed",
            // the wakeup after the start
            "during Heating",
            "during Window",
        ]);
    });

    it("processes all regions on every wakeup, a transition in one does not stop the others", async () => {
        const host = await start();
        trace();
        runtime!.sandbox.open = true;
        runtime!.sandbox.cold = true;
        runtime?.handleInput("test.0.cold", true);
        expect(host.active.at(-1)).to.equal("Home.Heating.HeatOn, Home.Window.Open");
        expect(trace()).to.deep.equal([
            "during Heating",
            "exit HeatOff",
            "enter HeatOn",
            "during Window",
            "exit Closed",
            "enter Open",
        ]);
        expect(host.history.filter(e => e.kind === "transition").map(e => e.transition)).to.deep.equal(["t1", "t2"]);
    });

    it("uses the execution order", async () => {
        const chart = createHomeChart();
        chart.states.find(s => s.id === "win")!.order = 0;
        await start(chart);
        expect(trace().slice(-2)).to.deep.equal(["during Window", "during Heating"]);
        expect(runtime?.activeIds).to.deep.equal(["home", "win", "wClosed", "heat", "hOff"]);
    });

    it("leaves all regions, and does not process the remaining regions after leaving", async () => {
        const host = await start();
        runtime?.handleInput("test.0.cold", true);
        trace();
        runtime?.handleInput("test.0.leave", true);
        expect(host.active.at(-1)).to.equal("Away");
        // the window region is not processed anymore, it is left in reverse order
        expect(trace()).to.deep.equal([
            "during Heating",
            "exit Closed",
            "exit Window",
            "exit HeatOn",
            "exit Heating",
            "exit Home",
            "enter Away",
        ]);
        runtime?.handleInput("test.0.leave", false);
        expect(host.active.at(-1)).to.equal("Home.Heating.HeatOff, Home.Window.Closed");
    });

    it("ignores transitions between parallel states and reports them", async () => {
        const chart = createHomeChart();
        chart.transitions.push({ id: "t5", source: "hOff", target: "wOpen", label: "" });
        const host = await start(chart);
        expect(host.warnings.join(" ")).to.include(
            "HeatOff -> Open: Transitions between parallel states are not possible",
        );
        expect(host.active.at(-1)).to.equal("Home.Heating.HeatOff, Home.Window.Closed");
    });

    it("supports a parallel top level and restores the regions after a restart", async () => {
        const chart: Chart = {
            version: 1,
            name: "Top",
            enabled: true,
            parallel: true,
            symbols: [{ name: "open", scope: "input", stateId: "test.0.open" }],
            states: [
                { id: "a", name: "A", x: 0, y: 0, order: 2 },
                { id: "b", name: "B", x: 0, y: 0, order: 1 },
                { id: "b1", name: "B1", parent: "b", x: 0, y: 0 },
                { id: "b2", name: "B2", parent: "b", x: 0, y: 0 },
            ],
            transitions: [{ id: "t1", source: "b1", target: "b2", label: "[open]" }],
        };
        const host = createHost({ "test.0.open": false });
        runtime = new ChartRuntime("top", chart, host);
        await runtime.start();
        expect(host.active.at(-1)).to.equal("B.B1, A");
        runtime.handleInput("test.0.open", true);
        expect(host.active.at(-1)).to.equal("B.B2, A");
        runtime.stop();

        runtime = new ChartRuntime("top", chart, host);
        await runtime.start({ restore: true });
        expect(runtime.activeIds).to.deep.equal(["b", "b2", "a"]);
    });
});

describe("chart-runtime => nested states (Stateflow semantics)", () => {
    let runtime: ChartRuntime | undefined;
    afterEach(() => runtime?.stop());

    async function start(chart: Chart, states: Record<string, any>) {
        const host = createHost(states);
        runtime = new ChartRuntime("heating", chart, host);
        await runtime.start();
        return host;
    }

    it("enters parents before children and leaves children before parents", async () => {
        // 21: no transition in the wakeup after the start
        const host = await start(createHeatingChart(), { "test.0.temp": 21, "test.0.manual": false });
        expect(runtime?.sandbox.trace).to.deep.equal(["Auto/entry", "Idle/entry", "Auto/during", "Idle/during"]);
        runtime?.sandbox.trace.splice(0);
        runtime?.handleInput("test.0.manual", true);
        expect(runtime?.sandbox.trace).to.deep.equal(["Idle/exit", "Auto/exit", "Manual/entry"]);
        expect(host.active.at(-1)).to.equal("Manual");
    });

    it("checks the transitions of the parent before those of the child", async () => {
        const host = await start(createHeatingChart(), { "test.0.temp": 18, "test.0.manual": true });
        // both transitions are valid now: Auto -> Manual and Idle -> Heat
        runtime?.handleInput("test.0.temp", 18);
        expect(host.active).to.deep.equal(["Auto.Idle", "Manual"]);
    });

    it("executes the during action of the parent before the child is processed", async () => {
        const host = await start(createHeatingChart(), { "test.0.temp": 21, "test.0.manual": false });
        runtime?.sandbox.trace.splice(0);
        // no transition: during of parent and child
        runtime?.handleInput("test.0.temp", 21);
        expect(runtime?.sandbox.trace).to.deep.equal(["Auto/during", "Idle/during"]);
        runtime?.sandbox.trace.splice(0);
        // transition of the child: the parent's during is executed, the child's not
        runtime?.handleInput("test.0.temp", 18);
        expect(runtime?.sandbox.trace).to.deep.equal(["Auto/during", "Idle/exit", "Heat/entry"]);
        expect(host.active.at(-1)).to.equal("Auto.Heat");
    });

    it("keeps the parent active on inner transitions", async () => {
        const chart = createHeatingChart();
        chart.transitions.push({ id: "restart", source: "auto", target: "idle", label: "reset[reset]" });
        const host = await start(chart, { "test.0.temp": 18, "test.0.manual": false, "test.0.reset": false });
        runtime?.handleInput("test.0.temp", 18);
        expect(host.active.at(-1)).to.equal("Auto.Heat");
        runtime?.sandbox.trace.splice(0);
        runtime?.handleInput("test.0.reset", true);
        // inner transitions are checked after the during action of the parent
        expect(runtime?.sandbox.trace).to.deep.equal(["Auto/during", "Heat/exit", "Idle/entry"]);
        expect(host.active.at(-1)).to.equal("Auto.Idle");
    });

    it("leaves and enters the parent again if requested", async () => {
        const chart = createHeatingChart();
        chart.transitions.push({
            id: "restart",
            source: "auto",
            target: "idle",
            label: "reset[reset]",
            reenterParent: true,
        });
        await start(chart, { "test.0.temp": 18, "test.0.manual": false, "test.0.reset": false });
        runtime?.handleInput("test.0.temp", 18);
        runtime?.sandbox.trace.splice(0);
        runtime?.handleInput("test.0.reset", true);
        // an outer transition: checked before the during action, the parent is left
        expect(runtime?.sandbox.trace).to.deep.equal(["Heat/exit", "Auto/exit", "Auto/entry", "Idle/entry"]);
    });

    it("leaves and enters the parent on transitions from a child to the parent", async () => {
        const chart = createHeatingChart();
        chart.transitions.push({ id: "up", source: "heat", target: "auto", label: "reset[reset]" });
        const host = await start(chart, { "test.0.temp": 18, "test.0.manual": false, "test.0.reset": false });
        runtime?.handleInput("test.0.temp", 18);
        runtime?.sandbox.trace.splice(0);
        runtime?.handleInput("test.0.reset", true);
        expect(runtime?.sandbox.trace).to.deep.equal([
            "Auto/during",
            "Heat/exit",
            "Auto/exit",
            "Auto/entry",
            "Idle/entry",
        ]);
        expect(host.active.at(-1)).to.equal("Auto.Idle");
    });

    it("restores nested states", async () => {
        const host = await start(createHeatingChart(), { "test.0.temp": 18, "test.0.manual": false });
        runtime?.handleInput("test.0.temp", 18);
        expect(host.active.at(-1)).to.equal("Auto.Heat");
        const trace = [...runtime?.sandbox.trace];
        runtime?.stop();

        host.active = [];
        runtime = new ChartRuntime("heating", createHeatingChart(), host);
        await runtime.start({ restore: true });
        expect(host.active).to.deep.equal(["Auto.Heat"]);
        expect([...runtime.enteredAt.keys()]).to.deep.equal(["auto", "heat"]);
        // the trace (a local) is restored as well, without new entry actions,
        // only the during actions of the wakeup after the start are added
        expect(runtime.sandbox.trace).to.deep.equal([...trace, "Auto/during", "Heat/during"]);
    });

    it("uses the first child if the initial state is no child (anymore)", async () => {
        const chart = createHeatingChart();
        // e.g. "idle" was the initial state and was moved out of "auto" in the editor
        chart.states[0].initial = "manualState";
        chart.initial = "heat";
        const host = await start(chart, { "test.0.temp": 21, "test.0.manual": false });
        expect(host.active).to.deep.equal(["Auto.Idle"]);
    });

    it("does not change the initial values of locals in the chart model", async () => {
        const chart = createHeatingChart();
        await start(chart, { "test.0.temp": 18, "test.0.manual": false });
        expect(chart.symbols.find(s => s.name === "trace")?.initial).to.deep.equal([]);
    });
});
