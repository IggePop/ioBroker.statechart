import fs from "node:fs";
import path from "node:path";
import { expect } from "chai";
import { getTemplates } from "./templates";
import { validateChart } from "../../src/lib/chart-validation";
import { parseExport, createExport } from "../../src/lib/chart-model";
import { ChartRuntime } from "../../src/lib/chart-runtime";

describe("templates => getTemplates", () => {
    // also a translation with quotes, they must not break the code of the actions
    for (const [language, translate] of [
        ["the keys", (text: string) => text],
        ["a translation with quotes", (text: string) => `${text} "quoted" 'single'`],
    ] as const) {
        it(`creates valid charts with ${language}: only the states of inputs and outputs are missing`, () => {
            for (const template of getTemplates(translate)) {
                const chart = template.create("Test");
                const problems = validateChart(chart)
                    .map(p => `${template.id}: ${p.kind} ${p.id}: ${p.diagnostic.message}`)
                    .filter(p => !p.endsWith(": No state selected"));
                expect(problems).to.deep.equal([], template.id);
                // new charts are paused until the states are selected
                expect(chart.enabled).to.equal(false, template.id);
                expect(chart.name).to.equal("Test");
            }
        });
    }

    it("creates valid charts in all languages of the editor", () => {
        const dir = path.join(__dirname, "i18n");
        for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".json"))) {
            const texts: Record<string, string> = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
            for (const template of getTemplates(text => texts[text] ?? text)) {
                const problems = validateChart(template.create("Test"))
                    .map(p => `${file} ${template.id}: ${p.kind} ${p.id}: ${p.diagnostic.message}`)
                    .filter(p => !p.endsWith(": No state selected"));
                expect(problems).to.deep.equal([]);
            }
        }
    });

    it("creates charts which can be exported and imported", () => {
        for (const template of getTemplates(text => text)) {
            const chart = template.create("Test");
            expect(() => parseExport(JSON.stringify(createExport([chart])))).not.to.throw();
        }
    });

    it("starts with the empty chart", () => {
        const [empty] = getTemplates(text => text);
        expect(empty.id).to.equal("empty");
        expect(empty.create("Test").states).to.deep.equal([]);
    });
});

describe("templates => behavior", () => {
    let runtime: ChartRuntime | undefined;
    afterEach(() => runtime?.stop());

    /**
     * Runs a template as simulation: inputs are set by hand, the time is advanced, nothing is written
     *
     * @param id ID of the template
     */
    async function simulate(id: string): Promise<ChartRuntime> {
        const template = getTemplates(text => text).find(t => t.id === id)!;
        const chart = template.create("Test");
        // the states are selected by the user
        chart.symbols = chart.symbols.map(s => (s.scope === "local" ? s : { ...s, stateId: `test.0.${s.name}` }));
        const noop = (): void => undefined;
        runtime = new ChartRuntime(
            id,
            chart,
            {
                readState: async () => null,
                writeState: async () => undefined,
                getLocation: () => ({ latitude: 52.5, longitude: 13.4 }),
                onActiveChange: noop,
                log: { debug: noop, info: noop, warn: noop, error: noop },
            },
            true,
        );
        await runtime.start();
        return runtime;
    }
    const min = 60_000;

    it("washing machine: done after 3 minutes with low power, pauses do not count", async () => {
        const r = await simulate("washer");
        r.simulateInput("power", 500);
        expect(r.activeIds).to.deep.equal(["running"]);
        r.simulateInput("power", 2);
        r.advanceTime(2 * min);
        // rinsing: power again, the 3 minutes start anew
        r.simulateInput("power", 300);
        r.simulateInput("power", 2);
        r.advanceTime(2 * min);
        expect(r.activeIds).to.deep.equal(["running"]);
        r.advanceTime(1.5 * min);
        expect(r.activeIds).to.deep.equal(["done"]);
        expect(r.sandbox.running).to.equal(false);
        r.advanceTime(60 * min);
        expect(r.activeIds).to.deep.equal(["off"]);
    });

    it("push button: short, double and long press", async () => {
        const r = await simulate("button");
        r.simulateInput("button", true);
        r.simulateInput("button", false);
        r.advanceTime(500);
        expect(r.sandbox.light).to.equal(true);
        expect(r.activeIds).to.deep.equal(["idle"]);
        r.simulateInput("button", true);
        r.simulateInput("button", false);
        r.simulateInput("button", true);
        r.simulateInput("button", false);
        expect(r.sandbox.scene).to.equal(true);
        expect(r.sandbox.light).to.equal(true);
        r.simulateInput("button", true);
        r.advanceTime(1100);
        expect(r.sandbox.light).to.equal(false);
        expect(r.sandbox.scene).to.equal(false);
        expect(r.activeIds).to.deep.equal(["idle"]);
    });

    it("shutter: manual mode for 2 hours, then back in the automatic", async () => {
        const r = await simulate("shutter");
        expect(r.activeIds[0]).to.equal("auto");
        r.simulateInput("button", true);
        expect(r.activeIds).to.deep.equal(["manual"]);
        // another press in the manual mode starts the 2 hours anew
        r.advanceTime(100 * min);
        r.simulateInput("button", false);
        r.advanceTime(100 * min);
        expect(r.activeIds).to.deep.equal(["manual"]);
        r.advanceTime(21 * min);
        expect(r.activeIds[0]).to.equal("auto");
        expect(r.activeIds).to.have.length(2);
    });

    it("presence: away after 10 minutes without phone, home again with one", async () => {
        const r = await simulate("presence");
        r.simulateInput("phone1", true);
        r.simulateInput("phone1", false);
        r.advanceTime(9 * min);
        expect(r.sandbox.mode).to.equal("home");
        r.advanceTime(2 * min);
        expect(r.activeIds).to.deep.equal(["away"]);
        expect(r.sandbox.mode).to.equal("away");
        r.simulateInput("phone2", true);
        expect(r.sandbox.mode).to.equal("home");
    });
});
