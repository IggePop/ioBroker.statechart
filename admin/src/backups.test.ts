import { expect } from "chai";
import { MAX_BACKUPS, addBackup, getBackups } from "./backups";
import { createChart } from "../../src/lib/chart-model";
import type { Chart } from "../../src/lib/chart-model";

function chartWith(name: string): Chart {
    return { ...createChart("Test"), comment: name };
}

describe("backups => addBackup", () => {
    it("keeps the previous version in front when the chart changed", () => {
        const backups = addBackup([], chartWith("v1"), chartWith("v2"), 1000);
        expect(backups).to.deep.equal([{ ts: 1000, chart: chartWith("v1") }]);
        const more = addBackup(backups, chartWith("v2"), chartWith("v3"), 2000);
        expect(more.map(b => b.chart.comment)).to.deep.equal(["v2", "v1"]);
    });

    it("adds nothing for a new chart or an unchanged one, also if only started or paused", () => {
        expect(addBackup([], undefined, chartWith("v1"), 1000)).to.deep.equal([]);
        expect(addBackup([], chartWith("v1"), chartWith("v1"), 1000)).to.deep.equal([]);
        expect(addBackup([], chartWith("v1"), { ...chartWith("v1"), enabled: true }, 1000)).to.deep.equal([]);
        // the same content with the keys in another order, e.g. read from the database
        const reordered = Object.fromEntries(Object.entries(chartWith("v1")).reverse()) as unknown as Chart;
        expect(addBackup([], reordered, chartWith("v1"), 1000)).to.deep.equal([]);
    });

    it("keeps at most MAX_BACKUPS versions, the oldest are dropped", () => {
        let backups: ReturnType<typeof addBackup> = [];
        for (let i = 0; i < MAX_BACKUPS + 3; i++) {
            backups = addBackup(backups, chartWith(`v${i}`), chartWith(`v${i + 1}`), i);
        }
        expect(backups).to.have.length(MAX_BACKUPS);
        expect(backups[0].chart.comment).to.equal(`v${MAX_BACKUPS + 2}`);
    });
});

describe("backups => getBackups", () => {
    it("ignores missing and broken entries", () => {
        expect(getBackups(undefined)).to.deep.equal([]);
        expect(getBackups("x")).to.deep.equal([]);
        const valid = { ts: 1, chart: chartWith("v1") };
        expect(getBackups([valid, null, { ts: "x", chart: {} }, { ts: 2 }])).to.deep.equal([valid]);
    });
});
