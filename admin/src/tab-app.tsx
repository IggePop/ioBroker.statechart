import React from "react";
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    StyledEngineProvider,
    TextField,
    ThemeProvider,
    Toolbar,
    Tooltip,
    Typography,
} from "@mui/material";
import {
    Add as AddIcon,
    Delete as DeleteIcon,
    FileDownload as ExportIcon,
    FileUpload as ImportIcon,
    FiberManualRecord as StatusIcon,
    Pause as PauseIcon,
    PlayArrow as StartIcon,
} from "@mui/icons-material";
import { DialogConfirm, GenericApp, I18n, Loader } from "@iobroker/adapter-react-v5";
import type { GenericAppProps, GenericAppState } from "@iobroker/adapter-react-v5";
import "@xyflow/react/dist/style.css";

import ChartEditor from "./components/ChartEditor";
import { ELEMENT_STYLES } from "./element-style";
import ResizablePanel from "./components/ResizablePanel";
import { downloadJson } from "./download";
import { createChart, createExport, nameToId, parseExport } from "../../src/lib/chart-model";
import type { Chart } from "../../src/lib/chart-model";
import type { HistoryEntry, SimulationStatus } from "../../src/lib/chart-runtime";
import en from "./i18n/en.json";
import de from "./i18n/de.json";
import ru from "./i18n/ru.json";
import pt from "./i18n/pt.json";
import nl from "./i18n/nl.json";
import fr from "./i18n/fr.json";
import it from "./i18n/it.json";
import es from "./i18n/es.json";
import pl from "./i18n/pl.json";
import uk from "./i18n/uk.json";
import zhCn from "./i18n/zh-cn.json";

interface TabAppState extends GenericAppState {
    charts: Record<string, ioBroker.Object>;
    selectedChart: string | null;
    activeIds: string[];
    /** current values of the variables of the selected chart, empty if it does not run */
    liveValues: Record<string, any>;
    /** events of the selected chart, null until they are loaded */
    history: HistoryEntry[] | null;
    /** if the selected chart runs as simulation */
    simulating: boolean;
    /** status of the simulation of the selected chart, null if none runs */
    simulationStatus: SimulationStatus | null;
    newChartName: string | null;
    deleteChart: string | null;
    /** if the editor has unsaved changes */
    changed: boolean;
    /** the chart to show after the user decided what to do with the unsaved changes */
    pendingSelect: { id: string | null } | null;
}

/**
 * The admin tab: the list of charts on the left, the editor of the selected chart on the right. It loads and saves
 * the charts and subscribes the states of the selected chart while it runs (active states, values, history).
 */
class TabApp extends GenericApp<GenericAppProps, TabAppState> {
    private readonly chartPrefix: string;
    /** saves the chart in the editor */
    private readonly saveRef: { current: (() => Promise<void>) | null } = { current: null };
    /** hidden file input for importing charts */
    private readonly importInput = React.createRef<HTMLInputElement>();
    /** object ID of the chart whose live states (active states, values, history) are subscribed */
    private liveChart: string | null = null;
    /** keeps the simulation of the selected chart alive, the adapter ends it if the editor is closed */
    private simulationPing: ReturnType<typeof setInterval> | null = null;

    /**
     * @param props Properties from the admin, e.g. the instance
     */
    public constructor(props: GenericAppProps) {
        const extendedProps = {
            ...props,
            encryptedFields: [],
            // the tab is no settings dialog, so it needs no Save/Close buttons
            bottomButtons: false,
            translations: { en, de, ru, pt, nl, fr, it, es, pl, uk, "zh-cn": zhCn },
        };
        super(props, extendedProps);
        this.state = {
            ...this.state,
            charts: {},
            selectedChart: null,
            activeIds: [],
            liveValues: {},
            history: null,
            simulating: false,
            simulationStatus: null,
            newChartName: null,
            deleteChart: null,
            changed: false,
            pendingSelect: null,
        };
        this.chartPrefix = `${this.adapterName}.${this.instance}.charts.`;
    }

    /**
     * Executed when the connection to ioBroker is ready: loads all charts and keeps the list up to date
     */
    public override onConnectionReady(): void {
        void this.socket.getObjectViewSystem("channel", this.chartPrefix, `${this.chartPrefix}香`).then(charts => {
            const ids = Object.keys(charts).sort();
            this.setState({ charts });
            if (ids.length) {
                this.showChart(ids[0]);
            }
        });
        void this.socket.subscribeObject(`${this.chartPrefix}*`, this.onObjectChange);
    }

    /**
     * Ends the subscriptions and the simulation of the selected chart
     */
    public override componentWillUnmount(): void {
        void this.socket.unsubscribeObject(`${this.chartPrefix}*`, this.onObjectChange);
        this.unsubscribeLive();
        this.setSimulationPing(null);
        super.componentWillUnmount();
    }

    private onObjectChange = (id: string, obj: ioBroker.Object | null | undefined): void => {
        // only the chart objects themselves, not the states below them
        if (id.substring(this.chartPrefix.length).includes(".")) {
            return;
        }
        const charts = { ...this.state.charts };
        if (obj?.type === "channel") {
            charts[id] = obj;
        } else {
            delete charts[id];
        }
        this.setState({ charts });
    };

    /** the states of a running chart which the editor shows, see subscribeLive() */
    private static readonly LIVE_STATES = ["activeStateIds", "values", "history", "simulation", "simulationStatus"];

    private onLiveStateChange = (id: string, state: ioBroker.State | null | undefined): void => {
        if (!this.liveChart || !id.startsWith(`${this.liveChart}.`)) {
            return;
        }
        let value;
        try {
            value = JSON.parse(String(state?.val || "null"));
        } catch {
            // ignore invalid values
        }
        const name = id.substring(this.liveChart.length + 1);
        if (name === "activeStateIds") {
            this.setState({ activeIds: Array.isArray(value) ? value : [] });
        } else if (name === "values") {
            this.setState({ liveValues: value && typeof value === "object" ? value : {} });
        } else if (name === "history") {
            this.setState({ history: Array.isArray(value) ? value : [] });
        } else if (name === "simulationStatus") {
            this.setState({ simulationStatus: value && typeof value === "object" ? value : null });
        } else if (name === "simulation") {
            const simulating = value === true;
            this.setState({ simulating });
            this.setSimulationPing(simulating ? this.liveChart : null);
        }
    };

    /**
     * Sends a message about the simulation to the adapter
     *
     * @param command The command, e.g. "simulationStart"
     * @param message Its data, the chart ID is added
     * @param id Object ID of the chart
     */
    private async sendSimulation(command: string, message: Record<string, any>, id: string): Promise<void> {
        const response = await this.socket.sendTo(`${this.adapterName}.${this.instance}`, command, {
            ...message,
            chartId: id.substring(this.chartPrefix.length),
        });
        if (response?.error) {
            throw new Error(response.error);
        }
    }

    /**
     * Sends a sign of life for the simulation of a chart regularly, or stops sending it
     *
     * @param id Object ID of the simulated chart, null to stop
     */
    private setSimulationPing(id: string | null): void {
        if (this.simulationPing) {
            clearInterval(this.simulationPing);
            this.simulationPing = null;
        }
        if (id) {
            this.simulationPing = setInterval(() => {
                this.sendSimulation("simulationPing", {}, id).catch(() => {
                    // the next ping tries again, the state "simulation" shows if it ended
                });
            }, 30_000);
        }
    }

    /**
     * Starts or stops the simulation of the selected chart, or sets an input
     *
     * @param command The command, e.g. "simulationStart"
     * @param message Its data
     */
    private simulate = (command: string, message: Record<string, any> = {}): void => {
        const id = this.state.selectedChart;
        if (id) {
            this.sendSimulation(command, message, id).catch(err => this.showError(String(err.message || err)));
        }
    };

    /**
     * Subscribes to the active states, values and history of a chart
     *
     * @param id Object ID of the chart
     */
    private subscribeLive(id: string): void {
        this.liveChart = id;
        for (const name of TabApp.LIVE_STATES) {
            void this.socket.subscribeState(`${id}.${name}`, false, this.onLiveStateChange);
        }
    }

    private unsubscribeLive(): void {
        if (this.liveChart) {
            for (const name of TabApp.LIVE_STATES) {
                this.socket.unsubscribeState(`${this.liveChart}.${name}`, this.onLiveStateChange);
            }
            this.liveChart = null;
        }
    }

    /**
     * The adapter clears the history when it is written without ack
     *
     * @param id Object ID of the chart
     */
    private clearHistory(id: string): void {
        this.socket.setState(`${id}.history`, { val: "[]", ack: false }).catch(err => this.showError(String(err)));
    }

    /**
     * Shows another chart, but asks first if the editor has unsaved changes
     *
     * @param id Object ID of the chart
     */
    private selectChart(id: string | null): void {
        if (this.state.changed && id !== this.state.selectedChart) {
            this.setState({ pendingSelect: { id } });
        } else {
            this.showChart(id);
        }
    }

    /**
     * Shows another chart, unsaved changes are lost
     *
     * @param id Object ID of the chart
     */
    private showChart(id: string | null): void {
        const previous = this.state.selectedChart;
        if (previous && this.state.simulating) {
            // the simulation belongs to the editor of the chart
            this.sendSimulation("simulationStop", {}, previous).catch(err =>
                this.showError(String(err.message || err)),
            );
        }
        this.setSimulationPing(null);
        this.unsubscribeLive();
        this.setState({
            selectedChart: id,
            activeIds: [],
            liveValues: {},
            history: null,
            simulating: false,
            simulationStatus: null,
            changed: false,
        });
        if (id) {
            this.subscribeLive(id);
        }
    }

    /**
     * @param name Name of the chart
     * @param taken Object IDs which are used as well, but not yet in the list of charts
     * @returns an object ID which is not used yet
     */
    private getUniqueChartId(name: string, taken = new Set<string>()): string {
        let id = `${this.chartPrefix}${nameToId(name)}`;
        for (let i = 2; this.state.charts[id] || taken.has(id); i++) {
            id = `${this.chartPrefix}${nameToId(name)}_${i}`;
        }
        return id;
    }

    /**
     * Imports the charts of an export file as new charts. They are paused, because their variables
     * may refer to states of another system.
     *
     * @param file The export file
     */
    private async importFile(file: File): Promise<void> {
        let charts;
        try {
            charts = parseExport(await file.text());
        } catch (err) {
            this.showError(`${I18n.t("Import failed")}: ${err.message}`);
            return;
        }
        const taken = new Set<string>();
        const ids: string[] = [];
        try {
            for (const chart of charts) {
                const id = this.getUniqueChartId(chart.name, taken);
                taken.add(id);
                await this.socket.setObject(id, {
                    type: "channel",
                    common: { name: chart.name },
                    native: { chart: { ...chart, enabled: false } },
                });
                ids.push(id);
            }
        } catch (err) {
            this.showError(`${I18n.t("Import failed")}: ${err}`);
        }
        if (ids.length) {
            this.showToast(I18n.t("importedCharts", String(ids.length)));
            this.selectChart(ids[0]);
        }
    }

    /** Exports all saved charts to one file */
    private exportAll(): void {
        const charts = Object.keys(this.state.charts)
            .sort()
            .map(id => this.state.charts[id].native?.chart as Chart | undefined)
            .filter((chart): chart is Chart => !!chart);
        downloadJson(`${this.adapterName}.${this.instance}.charts.json`, createExport(charts));
    }

    /**
     * @param name Name of the new chart
     */
    private async createChart(name: string): Promise<void> {
        const id = this.getUniqueChartId(name);
        await this.socket.setObject(id, {
            type: "channel",
            common: { name },
            native: { chart: createChart(name) },
        });
        this.selectChart(id);
    }

    /**
     * @param id Object ID of the chart
     * @param chart The chart to save
     */
    private async saveChart(id: string, chart: Chart): Promise<void> {
        // running or paused is only changed with the button in the chart list, the editor may have an old value
        const enabled = this.state.charts[id]?.native?.chart?.enabled ?? chart.enabled;
        try {
            await this.socket.extendObject(id, {
                common: { name: chart.name },
                native: { chart: { ...chart, enabled } },
            });
        } catch (err) {
            this.showError(`${I18n.t("Cannot save chart")}: ${err}`);
            throw err;
        }
    }

    /**
     * Pauses a running chart or starts a paused one, the adapter applies it immediately
     *
     * @param id Object ID of the chart
     */
    private async toggleChart(id: string): Promise<void> {
        const enabled = this.state.charts[id]?.native?.chart?.enabled !== false;
        try {
            await this.socket.extendObject(id, { native: { chart: { enabled: !enabled } } });
        } catch (err) {
            this.showError(`${I18n.t("Cannot save chart")}: ${err}`);
        }
    }

    /**
     * @param id Object ID of the chart
     */
    private async deleteChart(id: string): Promise<void> {
        // also deletes the states below the chart
        await this.socket.delObjects(id, false);
        if (this.state.selectedChart === id) {
            // the chart is deleted, so its unsaved changes do not matter
            this.showChart(Object.keys(this.state.charts).find(chartId => chartId !== id) || null);
        }
    }

    private renderChartList(): React.JSX.Element {
        const ids = Object.keys(this.state.charts).sort();
        return (
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                <Toolbar
                    variant="dense"
                    sx={{ gap: 1, borderBottom: 1, borderColor: "divider" }}
                >
                    <ELEMENT_STYLES.chart.Icon sx={{ color: `${ELEMENT_STYLES.chart.color}.main` }} />
                    <Typography
                        variant="subtitle1"
                        sx={{ flex: 1 }}
                    >
                        {I18n.t("Charts")}
                    </Typography>
                    <Tooltip title={I18n.t("New chart")}>
                        <IconButton
                            size="small"
                            color="primary"
                            onClick={() => this.setState({ newChartName: "" })}
                        >
                            <AddIcon />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={I18n.t("Import charts")}>
                        <IconButton
                            size="small"
                            onClick={() => this.importInput.current?.click()}
                        >
                            <ImportIcon />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={I18n.t("Export all charts")}>
                        <span>
                            <IconButton
                                size="small"
                                disabled={!ids.length}
                                onClick={() => this.exportAll()}
                            >
                                <ExportIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <input
                        ref={this.importInput}
                        type="file"
                        accept=".json,application/json"
                        hidden
                        onChange={e => {
                            const file = e.target.files?.[0];
                            // allows importing the same file again
                            e.target.value = "";
                            if (file) {
                                void this.importFile(file);
                            }
                        }}
                    />
                </Toolbar>
                <List
                    dense
                    sx={{ overflow: "auto", flex: 1 }}
                >
                    {ids.map(id => {
                        const chart: Chart | undefined = this.state.charts[id].native?.chart;
                        const paused = chart?.enabled === false;
                        // unsaved changes are only shown by a dot behind the name
                        const unsaved = id === this.state.selectedChart && this.state.changed;
                        return (
                            <ListItemButton
                                key={id}
                                selected={id === this.state.selectedChart}
                                onClick={() => this.selectChart(id)}
                            >
                                {/* green while the chart runs, gray while it is paused */}
                                <ListItemIcon
                                    // the status as text only in the tooltip
                                    title={I18n.t(paused ? "paused" : "running")}
                                    sx={{ minWidth: 22 }}
                                >
                                    <StatusIcon
                                        sx={{ fontSize: 12, color: paused ? "text.disabled" : "success.main" }}
                                    />
                                </ListItemIcon>
                                <ListItemText
                                    primary={`${chart?.name || id.substring(this.chartPrefix.length)}${unsaved ? " •" : ""}`}
                                    slotProps={{ primary: { color: paused ? "text.secondary" : "text.primary" } }}
                                />
                                <Tooltip title={I18n.t(paused ? "Start chart" : "Pause chart")}>
                                    <IconButton
                                        size="small"
                                        color={paused ? "success" : "warning"}
                                        onClick={e => {
                                            e.stopPropagation();
                                            void this.toggleChart(id);
                                        }}
                                    >
                                        {paused ? <StartIcon fontSize="small" /> : <PauseIcon fontSize="small" />}
                                    </IconButton>
                                </Tooltip>
                                <Tooltip title={I18n.t("Delete chart")}>
                                    <IconButton
                                        size="small"
                                        edge="end"
                                        // red only on hover, so the list does not look alarming
                                        sx={{ "&:hover": { color: "error.main" } }}
                                        onClick={e => {
                                            e.stopPropagation();
                                            this.setState({ deleteChart: id });
                                        }}
                                    >
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            </ListItemButton>
                        );
                    })}
                </List>
            </Box>
        );
    }

    private renderNewChartDialog(): React.JSX.Element | null {
        if (this.state.newChartName === null) {
            return null;
        }
        const name = this.state.newChartName.trim();
        const close = (): void => this.setState({ newChartName: null });
        const create = (): void => {
            close();
            this.createChart(name).catch(err => this.showError(String(err)));
        };
        return (
            <Dialog
                open
                onClose={close}
                maxWidth="xs"
                fullWidth
                // otherwise the focus goes back to the "+" button, and the Enter key opens the dialog again
                disableRestoreFocus
            >
                <DialogTitle>{I18n.t("New chart")}</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        size="small"
                        // like the other fields, and with space for the label above the border
                        sx={{ mt: 1 }}
                        label={I18n.t("Name")}
                        value={this.state.newChartName}
                        onChange={e => this.setState({ newChartName: e.target.value })}
                        onKeyDown={e => {
                            if (e.key === "Enter" && name) {
                                // the key is handled here, it must not click another button as well
                                e.preventDefault();
                                create();
                            }
                        }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={close}>{I18n.t("Cancel")}</Button>
                    <Button
                        variant="contained"
                        disabled={!name}
                        onClick={create}
                    >
                        {I18n.t("Create")}
                    </Button>
                </DialogActions>
            </Dialog>
        );
    }

    private renderDeleteDialog(): React.JSX.Element | null {
        const id = this.state.deleteChart;
        if (!id) {
            return null;
        }
        return (
            <DialogConfirm
                title={I18n.t("Delete chart")}
                text={I18n.t("deleteChartText", this.state.charts[id]?.native?.chart?.name || id)}
                ok={I18n.t("Delete")}
                cancel={I18n.t("Cancel")}
                onClose={ok => {
                    this.setState({ deleteChart: null });
                    if (ok) {
                        this.deleteChart(id).catch(err => this.showError(String(err)));
                    }
                }}
            />
        );
    }

    private onChangedChange = (changed: boolean): void => this.setState({ changed });

    private renderUnsavedDialog(): React.JSX.Element | null {
        const pending = this.state.pendingSelect;
        if (!pending) {
            return null;
        }
        const selected = this.state.selectedChart;
        const name = (selected && this.state.charts[selected]?.native?.chart?.name) || selected;
        const close = (): void => this.setState({ pendingSelect: null });
        return (
            <Dialog
                open
                onClose={close}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>{I18n.t("Unsaved changes")}</DialogTitle>
                <DialogContent>
                    <Typography>{I18n.t("unsavedChangesText", String(name))}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={close}>{I18n.t("Cancel")}</Button>
                    <Button
                        color="error"
                        onClick={() => {
                            close();
                            this.showChart(pending.id);
                        }}
                    >
                        {I18n.t("Discard")}
                    </Button>
                    <Button
                        variant="contained"
                        onClick={async () => {
                            close();
                            try {
                                await this.saveRef.current?.();
                            } catch {
                                // saveChart() shows the error, the chart stays open so nothing is lost
                                return;
                            }
                            this.showChart(pending.id);
                        }}
                    >
                        {I18n.t("Save")}
                    </Button>
                </DialogActions>
            </Dialog>
        );
    }

    private renderContent(): React.JSX.Element {
        if (!this.state.loaded) {
            return <Loader themeType={this.state.themeType} />;
        }
        const selected = this.state.selectedChart;
        const chart: Chart | null | undefined = selected ? this.state.charts[selected]?.native?.chart : null;

        return (
            <Box sx={{ display: "flex", height: "100%", bgcolor: "background.default", color: "text.primary" }}>
                <ResizablePanel
                    side="left"
                    storageKey="statechart.chartListWidth"
                    defaultWidth={240}
                    minWidth={160}
                    maxWidth={600}
                    label={I18n.t("Charts")}
                >
                    {this.renderChartList()}
                </ResizablePanel>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    {selected && chart ? (
                        <ChartEditor
                            // a new editor for every chart, so no unsaved changes are carried over
                            key={selected}
                            chartId={selected.substring(this.chartPrefix.length)}
                            chart={chart}
                            activeIds={this.state.activeIds}
                            liveValues={this.state.liveValues}
                            chartHistory={this.state.history}
                            simulating={this.state.simulating}
                            simulationStatus={this.state.simulationStatus}
                            onSimulate={this.simulate}
                            onClearHistory={() => this.clearHistory(selected)}
                            onSave={newChart => this.saveChart(selected, newChart)}
                            onChangedChange={this.onChangedChange}
                            saveRef={this.saveRef}
                            socket={this.socket}
                            theme={this.state.theme}
                        />
                    ) : (
                        <Typography
                            sx={{ p: 2 }}
                            color="text.secondary"
                        >
                            {I18n.t("noChartsHelp")}
                        </Typography>
                    )}
                </Box>
                {this.renderNewChartDialog()}
                {this.renderDeleteDialog()}
                {this.renderUnsavedDialog()}
                {this.renderError()}
                {this.renderToast()}
            </Box>
        );
    }

    /**
     * @returns the content of the tab (see renderContent()) in the theme of the admin
     */
    public override render(): React.JSX.Element {
        return (
            <StyledEngineProvider injectFirst>
                <ThemeProvider theme={this.state.theme}>{this.renderContent()}</ThemeProvider>
            </StyledEngineProvider>
        );
    }
}

export default TabApp;
