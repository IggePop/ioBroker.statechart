/*
 * Backups of a chart: the former versions, stored in native.backups of the chart object when the chart is saved.
 * They are only used by the editor, the adapter reads native.chart, and they are not part of exported files.
 */

import type { Chart } from "../../src/lib/chart-model";

/** How many former versions of a chart are kept */
export const MAX_BACKUPS = 10;

/** A former version of a chart */
export interface ChartBackup {
    /** When this version was replaced by a newer one (ms since 1970) */
    ts: number;
    /** The chart as it was saved before */
    chart: Chart;
}

/**
 * @param value native.backups of the chart object, anything for robustness against old or broken objects
 * @returns the valid backups, newest first
 */
export function getBackups(value: unknown): ChartBackup[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter(
        (b): b is ChartBackup =>
            !!b && typeof b === "object" && Number.isFinite(b.ts) && !!b.chart && Array.isArray(b.chart.states),
    );
}

/**
 * @param backups native.backups of the chart object before saving
 * @param previous The chart before saving, undefined for a new chart
 * @param saved The chart which is saved now
 * @param now The current time
 * @returns the backups with the previous chart in front, if it differs from the saved one, at most MAX_BACKUPS.
 *   Starting or pausing the chart is no change.
 */
export function addBackup(backups: unknown, previous: Chart | undefined, saved: Chart, now: number): ChartBackup[] {
    const list = getBackups(backups);
    if (!previous || stableStringify({ ...previous, enabled: saved.enabled }) === stableStringify(saved)) {
        return list;
    }
    return [{ ts: now, chart: previous }, ...list].slice(0, MAX_BACKUPS);
}

/**
 * @param value Any JSON value
 * @returns JSON with the keys of all objects sorted, so the same content gives the same text in any order of keys
 */
function stableStringify(value: unknown): string {
    return JSON.stringify(value, (_key, v) =>
        v && typeof v === "object" && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
            : v,
    );
}
