import React from "react";
import { Box, Button, List, ListItemButton, ListItemText, Typography } from "@mui/material";
import { DeleteSweep as ClearIcon } from "@mui/icons-material";
import { I18n } from "@iobroker/adapter-react-v5";
import type { HistoryEntry } from "../../../src/lib/chart-runtime";

/**
 * @param ts Time in ms since 1970
 * @returns the time with milliseconds, with the date if it is not today
 */
function formatTime(ts: number): string {
    const date = new Date(ts);
    const time = `${date.toLocaleTimeString()}.${String(date.getMilliseconds()).padStart(3, "0")}`;
    return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString()} ${time}`;
}

function describeEntry(entry: HistoryEntry): { primary: string; secondary: string } {
    const active = I18n.t("activeAfter", entry.active || "-");
    if (entry.kind === "break") {
        return {
            primary: I18n.t("breakpointReached", entry.text ?? ""),
            secondary: `${I18n.t("Simulation")} · ${active}`,
        };
    }
    if (entry.kind === "effect") {
        return { primary: I18n.t("notExecuted", entry.text ?? ""), secondary: I18n.t("Simulation") };
    }
    if (entry.kind === "start") {
        if (entry.simulated) {
            return { primary: I18n.t("Simulation started"), secondary: active };
        }
        return { primary: I18n.t(entry.restored ? "Chart restored" : "Chart started"), secondary: active };
    }
    // entries of older versions have no cause: an input if the trigger is set, otherwise a timer
    const cause = entry.cause ?? (entry.trigger ? "input" : "timer");
    let trigger;
    if (cause === "input") {
        trigger = I18n.t("triggeredBy", entry.trigger ?? "");
    } else if (cause === "start") {
        trigger = I18n.t("triggeredByStart");
    } else {
        trigger = I18n.t("triggeredByTimer");
    }
    return {
        primary: `${entry.from} → ${entry.to}`,
        secondary: `${entry.simulated ? `${I18n.t("Simulation")} · ` : ""}${trigger} · ${active}`,
    };
}

interface HistoryPanelProps {
    /** null while the history is loaded */
    history: HistoryEntry[] | null;
    /** IDs of the transitions in the editor, entries of other transitions cannot be selected */
    transitionIds: Set<string>;
    /** Selects a transition in the editor */
    onSelectTransition: (id: string) => void;
    onClear: () => void;
}

/**
 * The starts and transitions of the running chart, newest first
 *
 * @param props Component properties, see HistoryPanelProps
 */
export default function HistoryPanel(props: HistoryPanelProps): React.JSX.Element {
    const { history, transitionIds, onSelectTransition, onClear } = props;
    const entries = [...(history || [])].reverse();
    return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography
                variant="body2"
                color="text.secondary"
            >
                {I18n.t("historyHelp")}
            </Typography>
            <Box>
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ClearIcon />}
                    disabled={!entries.length}
                    onClick={onClear}
                >
                    {I18n.t("Clear history")}
                </Button>
            </Box>
            {history && !entries.length && (
                <Typography
                    variant="body2"
                    sx={{ fontStyle: "italic" }}
                >
                    {I18n.t("noHistory")}
                </Typography>
            )}
            <List
                dense
                disablePadding
            >
                {entries.map((entry, i) => {
                    const { primary, secondary } = describeEntry(entry);
                    const selectable = !!entry.transition && transitionIds.has(entry.transition);
                    return (
                        <ListItemButton
                            // the history grows at the end, so the index from the end stays the same for an entry
                            // (until the adapter removes the oldest entries)
                            key={entries.length - i}
                            disabled={!selectable && entry.kind === "transition"}
                            onClick={() => entry.transition && selectable && onSelectTransition(entry.transition)}
                            sx={{
                                px: 1,
                                borderBottom: 1,
                                borderColor: "divider",
                                alignItems: "flex-start",
                                // events of a simulation are marked at the side
                                borderLeft: entry.simulated ? 3 : 0,
                                borderLeftColor: "warning.main",
                            }}
                        >
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ fontFamily: "monospace", minWidth: 96, pt: 0.25 }}
                            >
                                {formatTime(entry.ts)}
                            </Typography>
                            <ListItemText
                                primary={primary}
                                secondary={secondary}
                                sx={{ my: 0 }}
                                slotProps={{
                                    primary: { fontWeight: entry.kind === "start" ? "bold" : undefined },
                                }}
                            />
                        </ListItemButton>
                    );
                })}
            </List>
        </Box>
    );
}
