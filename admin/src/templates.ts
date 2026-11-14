/*
 * Templates for new charts: examples which work as soon as the states of the inputs and outputs are selected.
 * The states are left empty on purpose, the check of the chart then shows which ones are missing.
 */

import { createChart } from "../../src/lib/chart-model";
import type { Chart } from "../../src/lib/chart-model";

/** A template for a new chart */
export interface ChartTemplate {
    /** Stable ID of the template */
    id: string;
    /** Name shown in the dialog */
    title: string;
    /** What the chart does, shown in the dialog */
    description: string;
    /**
     * @param name Name of the new chart
     * @returns the new chart, paused
     */
    create: (name: string) => Chart;
}

/**
 * @param t Translates a text into the language of the editor
 * @returns the templates, the first one is the empty chart
 */
export function getTemplates(t: (text: string) => string): ChartTemplate[] {
    // a translated text as JavaScript string literal, for the code of actions
    const s = (text: string): string => JSON.stringify(t(text));
    return [
        {
            id: "empty",
            title: t("Empty chart"),
            description: t("templateEmptyDescription"),
            create: name => createChart(name),
        },
        {
            id: "light",
            title: t("Light with motion detector"),
            description: t("templateLightDescription"),
            create: name => ({
                ...createChart(name),
                initial: "off",
                symbols: [
                    { name: "motion", scope: "input", stateId: "", trigger: "change" },
                    { name: "light", scope: "output", stateId: "" },
                ],
                states: [
                    { id: "off", name: t("Off"), entry: "light = false;", x: 0, y: 0, width: 200, height: 90 },
                    { id: "on", name: t("On"), entry: "light = true;", x: 360, y: 0, width: 200, height: 90 },
                ],
                transitions: [
                    { id: "t_on", source: "off", target: "on", label: "motion[motion]" },
                    { id: "t_off", source: "on", target: "off", label: "after(2, min, !motion)" },
                ],
                notes: [{ id: "n_info", text: t("templateLightNote"), x: 0, y: 180, width: 560, height: 120 }],
            }),
        },
        {
            id: "heating",
            title: t("Heating with window contact"),
            description: t("templateHeatingDescription"),
            create: name => ({
                ...createChart(name),
                initial: "auto",
                symbols: [
                    { name: "temperature", scope: "input", stateId: "", trigger: "change" },
                    { name: "window", scope: "input", stateId: "", trigger: "change" },
                    { name: "heating", scope: "output", stateId: "" },
                    { name: "target", scope: "local", initial: 21 },
                ],
                states: [
                    {
                        id: "auto",
                        name: t("Automatic"),
                        initial: "idle",
                        x: 0,
                        y: 0,
                        width: 600,
                        height: 220,
                    },
                    {
                        id: "idle",
                        name: t("Idle"),
                        parent: "auto",
                        entry: "heating = false;",
                        x: 30,
                        y: 80,
                        width: 200,
                        height: 90,
                    },
                    {
                        id: "heat",
                        name: t("Heating"),
                        parent: "auto",
                        entry: "heating = true;",
                        x: 370,
                        y: 80,
                        width: 200,
                        height: 90,
                    },
                    {
                        id: "window",
                        name: t("Window open"),
                        entry: "heating = false;",
                        x: 200,
                        y: 340,
                        width: 200,
                        height: 90,
                    },
                ],
                transitions: [
                    { id: "t_heat", source: "idle", target: "heat", label: "[temperature < target - 0.5]" },
                    { id: "t_idle", source: "heat", target: "idle", label: "[temperature > target + 0.5]" },
                    { id: "t_open", source: "auto", target: "window", label: "window[window]" },
                    { id: "t_closed", source: "window", target: "auto", label: "after(1, min, !window)" },
                ],
                notes: [{ id: "n_info", text: t("templateHeatingNote"), x: 660, y: 0, width: 300, height: 200 }],
            }),
        },
        {
            id: "alarm",
            title: t("Alarm system"),
            description: t("templateAlarmDescription"),
            create: name => ({
                ...createChart(name),
                initial: "disarmed",
                orthogonalTransitions: true,
                symbols: [
                    { name: "armed", scope: "input", stateId: "" },
                    { name: "door", scope: "input", stateId: "", trigger: "change" },
                    { name: "window", scope: "input", stateId: "", trigger: "change" },
                    { name: "motion", scope: "input", stateId: "", trigger: "change", debounceMs: 300 },
                    { name: "panic", scope: "input", stateId: "", ack: "command" },
                    { name: "siren", scope: "output", stateId: "" },
                    { name: "flash", scope: "output", stateId: "" },
                    { name: "status", scope: "output", stateId: "" },
                    { name: "source", scope: "local", initial: "" },
                    { name: "alarms", scope: "local", initial: 0 },
                ],
                states: [
                    {
                        id: "disarmed",
                        name: t("Disarmed"),
                        entry: `status = ${s("Disarmed")};\nsiren = false;\nflash = false;`,
                        x: -270,
                        y: 0,
                        width: 210,
                        height: 680,
                    },
                    { id: "armedState", name: t("Armed"), x: 340, y: 0, width: 1160, height: 690 },
                    {
                        id: "exitDelay",
                        name: t("Exit delay"),
                        parent: "armedState",
                        entry: `status = ${s("Exit delay")};\nflash = true;`,
                        exit: "flash = false;",
                        x: 40,
                        y: 60,
                        width: 220,
                        height: 110,
                    },
                    {
                        id: "monitoring",
                        name: t("Monitoring"),
                        parent: "armedState",
                        entry: `status = ${s("Armed")};`,
                        x: 400,
                        y: 60,
                        width: 220,
                        height: 110,
                    },
                    {
                        id: "entryDelay",
                        name: t("Entry delay"),
                        parent: "armedState",
                        entry: `status = ${s("Entry delay")};\nflash = true;`,
                        exit: "flash = false;",
                        x: 870,
                        y: 60,
                        width: 250,
                        height: 110,
                    },
                    {
                        id: "alarm",
                        name: t("Alarm"),
                        parent: "armedState",
                        parallel: true,
                        entry: `alarms++;\nstatus = ${s("ALARM")} + ": " + source;`,
                        exit: "siren = false;\nflash = false;",
                        x: 40,
                        y: 270,
                        width: 1080,
                        height: 400,
                    },
                    {
                        id: "sirenRegion",
                        name: t("Siren"),
                        parent: "alarm",
                        order: 1,
                        x: 20,
                        y: 130,
                        width: 550,
                        height: 250,
                    },
                    {
                        id: "notificationRegion",
                        name: t("Notification"),
                        parent: "alarm",
                        order: 2,
                        x: 590,
                        y: 130,
                        width: 480,
                        height: 250,
                    },
                    {
                        id: "loud",
                        name: t("Loud"),
                        parent: "sirenRegion",
                        entry: "siren = true;\nflash = true;",
                        x: 20,
                        y: 70,
                        width: 170,
                        height: 100,
                    },
                    {
                        id: "silent",
                        name: t("Silent"),
                        parent: "sirenRegion",
                        entry: "siren = false;",
                        x: 360,
                        y: 70,
                        width: 170,
                        height: 100,
                    },
                    {
                        id: "notified",
                        name: t("Notified"),
                        parent: "notificationRegion",
                        entry: `notify(${s("Alarm")} + " " + alarms + ": " + source);`,
                        x: 50,
                        y: 70,
                        width: 400,
                        height: 100,
                    },
                ],
                transitions: [
                    {
                        id: "t_arm",
                        source: "disarmed",
                        target: "armedState",
                        label: "armed[hasChangedTo(armed, true) && !window]",
                        priority: 1,
                        sourceAnchor: { side: "right", pos: 0.59 },
                        targetAnchor: { side: "left", pos: 0.58 },
                        labelOffset: { x: 0, y: 10 },
                    },
                    {
                        id: "t_windowOpen",
                        source: "disarmed",
                        target: "disarmed",
                        label: `armed[hasChangedTo(armed, true) && window]\n{notify(${s("Not armed: window open")});}`,
                        priority: 2,
                        sourceAnchor: { side: "top", pos: 0.48 },
                        labelOffset: { x: 20, y: -20 },
                    },
                    {
                        id: "t_night",
                        source: "disarmed",
                        target: "armedState",
                        label: `at("23:00")[!window]{log(${s("Armed automatically")});}`,
                        priority: 3,
                        sourceAnchor: { side: "right", pos: 0.5 },
                        labelOffset: { x: 0, y: 10 },
                    },
                    {
                        id: "t_panic",
                        source: "disarmed",
                        target: "alarm",
                        label: `after(3, panic){source = ${s("Panic button")};}`,
                        priority: 4,
                        sourceAnchor: { side: "right", pos: 0.65 },
                        targetAnchor: { side: "left", pos: 0.6 },
                        labelOffset: { x: 0, y: 50 },
                    },
                    {
                        id: "t_disarm",
                        source: "armedState",
                        target: "disarmed",
                        label: "armed[!armed]",
                        sourceAnchor: { side: "left", pos: 0.23 },
                        targetAnchor: { side: "right", pos: 0.15 },
                        labelOffset: { x: 0, y: -40 },
                    },
                    {
                        id: "t_active",
                        source: "exitDelay",
                        target: "monitoring",
                        label: "after(30, sec)",
                        labelOffset: { x: 0, y: 10 },
                    },
                    {
                        id: "t_door",
                        source: "monitoring",
                        target: "entryDelay",
                        label: `door[door]{source = ${s("Front door")};}`,
                        priority: 1,
                        labelOffset: { x: 0, y: 10 },
                    },
                    {
                        id: "t_window",
                        source: "monitoring",
                        target: "alarm",
                        label: `window[window]{source = ${s("Window")};}`,
                        priority: 2,
                        sourceAnchor: { side: "bottom", pos: 0.18 },
                        targetAnchor: { side: "top", pos: 0.37 },
                        labelOffset: { x: -140, y: 0 },
                    },
                    {
                        id: "t_motion",
                        source: "monitoring",
                        target: "alarm",
                        label: `after(2, sec, motion)[!nightMode()]\n{source = ${s("Motion detector")};}`,
                        priority: 3,
                        sourceAnchor: { side: "bottom", pos: 0.82 },
                        targetAnchor: { side: "top", pos: 0.5 },
                        labelOffset: { x: 160, y: 0 },
                    },
                    {
                        id: "t_entry",
                        source: "entryDelay",
                        target: "alarm",
                        label: "after(20, sec)",
                        sourceAnchor: { side: "bottom", pos: 0.32 },
                        targetAnchor: { side: "top", pos: 0.9 },
                        labelOffset: { x: -20, y: 10 },
                    },
                    {
                        id: "t_silent",
                        source: "loud",
                        target: "silent",
                        label: "after(3, min)",
                        labelOffset: { x: 0, y: 10 },
                    },
                    {
                        id: "t_remind",
                        source: "notified",
                        target: "notified",
                        label: "after(10, min)",
                        labelOffset: { x: 80, y: 10 },
                    },
                ],
                functions: [
                    {
                        id: "f_helpers",
                        code: [
                            "// at night, motion inside does not count",
                            "function nightMode() {",
                            '    return isTimeBetween("22:00", "06:00");',
                            "}",
                            "",
                            "function notify(text) {",
                            '    log(text, "warn");',
                            "    // e.g. a message with Telegram",
                            '    sendTo("telegram.0", "send", { text });',
                            "}",
                        ].join("\n"),
                        x: 1100,
                        y: -280,
                        width: 380,
                        height: 240,
                    },
                ],
                notes: [{ id: "n_info", text: t("templateAlarmNote"), x: 330, y: -280, width: 360, height: 220 }],
            }),
        },
    ];
}
