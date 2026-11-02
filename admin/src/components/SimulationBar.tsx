import React, { useEffect, useState } from "react";
import { Box, Button, IconButton, Tooltip, Typography } from "@mui/material";
import {
    FastForward as NextTimerIcon,
    Pause as PauseIcon,
    PlayArrow as ResumeIcon,
    Science as SimulationIcon,
    SkipNext as StepIcon,
} from "@mui/icons-material";
import { I18n } from "@iobroker/adapter-react-v5";
import type { SimulationStatus } from "../../../src/lib/chart-runtime";

/**
 * @param ms A duration
 * @returns e.g. "1:05" or "2:01:05"
 */
function formatDuration(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** Steps for advancing the time, in minutes */
const ADVANCE_MINUTES = [1, 10, 60];

interface SimulationBarProps {
    /** null until the adapter published it */
    status: SimulationStatus | null;
    /** Sends a command of the simulation to the adapter, e.g. "simulationStep" */
    onCommand: (command: string, message?: Record<string, any>) => void;
}

/**
 * Controls of a running simulation: time, pause, steps, advancing the time
 *
 * @param props Component properties
 */
export default function SimulationBar({ status, onCommand }: SimulationBarProps): React.JSX.Element {
    // the simulated time runs on, so it is shown again every second
    const [realNow, setRealNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setRealNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    const offset = status?.timeOffset ?? 0;
    const now = realNow + offset;
    const paused = !!status?.paused;
    const queued = status?.queued ?? 0;
    const next = status?.nextTimer;

    let state;
    if (!paused) {
        state = I18n.t("running");
    } else if (status?.breakpoint) {
        state = I18n.t("stopped at breakpoint %s", status.breakpoint);
    } else {
        state = I18n.t("paused");
    }

    return (
        <Box
            className="nodrag nopan nowheel"
            sx={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 1,
                px: 1.5,
                py: 0.5,
                maxWidth: "70vw",
                bgcolor: "warning.main",
                color: "warning.contrastText",
                borderRadius: 1,
                boxShadow: 3,
            }}
        >
            <SimulationIcon fontSize="small" />
            <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0, flex: "1 1 220px" }}>
                <Typography
                    variant="body2"
                    sx={{ fontWeight: "bold" }}
                >
                    {I18n.t("Simulation")}: {state}
                    {queued > 0 && ` · ${I18n.t("%s events waiting", String(queued))}`}
                </Typography>
                <Typography
                    variant="caption"
                    component="div"
                >
                    {I18n.t("simulatedTime", new Date(now).toLocaleTimeString())}
                    {offset >= 1000 && ` (+${formatDuration(offset)})`}
                    {" · "}
                    {next
                        ? I18n.t("nextTimer", next.label, formatDuration(next.due - now))
                        : I18n.t("No timer is running")}
                </Typography>
            </Box>
            <Tooltip title={I18n.t(paused ? "Continue" : "Pause: events wait until the next step")}>
                <IconButton
                    size="small"
                    color="inherit"
                    onClick={() => onCommand(paused ? "simulationResume" : "simulationPause")}
                >
                    {paused ? <ResumeIcon /> : <PauseIcon />}
                </IconButton>
            </Tooltip>
            <Tooltip title={I18n.t("Single step: process the next waiting event")}>
                {/* the span shows the tooltip of the disabled button */}
                <span>
                    <IconButton
                        size="small"
                        color="inherit"
                        disabled={!paused || !queued}
                        onClick={() => onCommand("simulationStep")}
                    >
                        <StepIcon />
                    </IconButton>
                </span>
            </Tooltip>
            <Tooltip title={I18n.t("Advance the time to the next timer")}>
                <span>
                    <IconButton
                        size="small"
                        color="inherit"
                        disabled={!next}
                        onClick={() => onCommand("simulationAdvance")}
                    >
                        <NextTimerIcon />
                    </IconButton>
                </span>
            </Tooltip>
            {ADVANCE_MINUTES.map(minutes => (
                <Tooltip
                    key={minutes}
                    title={I18n.t("Advance the time, timers due meanwhile fire")}
                >
                    <Button
                        size="small"
                        color="inherit"
                        sx={{ minWidth: 0, px: 0.75 }}
                        onClick={() => onCommand("simulationAdvance", { ms: minutes * 60_000 })}
                    >
                        +{minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
                    </Button>
                </Tooltip>
            ))}
            <Button
                size="small"
                color="inherit"
                variant="outlined"
                onClick={() => onCommand("simulationStop")}
            >
                {I18n.t("Stop simulation")}
            </Button>
        </Box>
    );
}
