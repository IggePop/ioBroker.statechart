import fs from "node:fs";
import path from "node:path";
import { expect } from "chai";
import { getTemplates } from "./templates";
import { validateChart } from "../../src/lib/chart-validation";
import { parseExport, createExport } from "../../src/lib/chart-model";

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
