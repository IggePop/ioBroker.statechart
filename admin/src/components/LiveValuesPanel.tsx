import React, { useState } from "react";
import { Box, IconButton, InputBase, Switch, Tooltip, Typography } from "@mui/material";
import { Bolt as EventIcon } from "@mui/icons-material";
import { I18n } from "@iobroker/adapter-react-v5";
import type { ChartSymbol } from "../../../src/lib/chart-model";

/** Longer values are shortened, the full value is shown as tooltip */
const MAX_LENGTH = 40;

/**
 * @param value A value of a variable
 * @returns the value as JSON, undefined as "undefined"
 */
export function formatValue(value: any): string {
    return value === undefined ? "undefined" : JSON.stringify(value);
}

/**
 * @param text An entered value: JSON (number, boolean, string in quotes, object), anything else is a string
 */
function parseValue(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/**
 * The value of an input in a simulation, which can be changed: a switch for booleans, otherwise a text field
 * which sets the value with Enter
 *
 * @param props Component properties
 * @param props.value The current value
 * @param props.onChange Sets the value
 */
function SimulatedValue({ value, onChange }: { value: any; onChange: (value: any) => void }): React.JSX.Element {
    const [text, setText] = useState<string | null>(null);
    if (typeof value === "boolean") {
        return (
            <Switch
                size="small"
                checked={value}
                onChange={e => onChange(e.target.checked)}
            />
        );
    }
    return (
        <Tooltip title={I18n.t("simulatedValueHelp")}>
            <InputBase
                // the typed text is kept until it is set, then the value from the adapter is shown again
                value={text ?? formatValue(value)}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                    if (e.key === "Enter" && text !== null) {
                        onChange(parseValue(text));
                        setText(null);
                    } else if (e.key === "Escape") {
                        setText(null);
                    }
                }}
                onBlur={() => setText(null)}
                // compact, but with the border colors of an outlined TextField of MUI. A typed value which is not
                // set yet is marked
                sx={theme => ({
                    fontFamily: "monospace",
                    fontSize: 12,
                    px: 0.5,
                    border: 1,
                    borderColor:
                        text !== null
                            ? "warning.main"
                            : theme.palette.mode === "dark"
                              ? "rgba(255, 255, 255, 0.23)"
                              : "rgba(0, 0, 0, 0.23)",
                    borderRadius: 0.5,
                    width: 140,
                    ...(text === null && {
                        "&:hover": { borderColor: "text.primary" },
                        "&.Mui-focused": { borderColor: "primary.main" },
                    }),
                })}
            />
        </Tooltip>
    );
}

/**
 * The current values of the variables of the running chart, shown on the canvas. In a simulation, the values of the
 * inputs can be changed.
 *
 * @param props Component properties
 * @param props.symbols The variables of the chart in the editor
 * @param props.values The values published by the adapter, empty if the chart does not run
 * @param props.simulating If the chart runs as simulation
 * @param props.onSetInput Simulation: sets the value of an input
 * @param props.onEvent Simulation: wakes up the chart with the event of an input, without changing its value
 */
export default function LiveValuesPanel({
    symbols,
    values,
    simulating = false,
    onSetInput,
    onEvent,
}: {
    symbols: ChartSymbol[];
    values: Record<string, any>;
    simulating?: boolean;
    onSetInput?: (name: string, value: any) => void;
    onEvent?: (name: string) => void;
}): React.JSX.Element {
    const running = Object.keys(values).length > 0;
    return (
        <Box
            className="nodrag nopan nowheel"
            sx={{
                bgcolor: "background.paper",
                color: "text.primary",
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                boxShadow: 2,
                px: 1,
                py: 0.5,
                maxWidth: 360,
                maxHeight: "40vh",
                overflow: "auto",
            }}
        >
            <Typography
                variant="caption"
                color="text.secondary"
                component="div"
            >
                {I18n.t(simulating ? "Simulation: set the inputs" : "Live values")}
            </Typography>
            {!running ? (
                <Typography
                    variant="body2"
                    sx={{ fontStyle: "italic" }}
                >
                    {I18n.t("The chart does not run")}
                </Typography>
            ) : (
                <Box
                    component="table"
                    sx={{ borderCollapse: "collapse", fontFamily: "monospace", fontSize: 12 }}
                >
                    <tbody>
                        {symbols.map(symbol => {
                            const text = symbol.name in values ? formatValue(values[symbol.name]) : "-";
                            const editable = simulating && symbol.scope === "input";
                            return (
                                <tr key={symbol.name}>
                                    <Box
                                        component="td"
                                        sx={{ pr: 1, color: "text.secondary", whiteSpace: "nowrap" }}
                                        title={I18n.t(
                                            symbol.scope === "input"
                                                ? "Input"
                                                : symbol.scope === "output"
                                                  ? "Output"
                                                  : "Local",
                                        )}
                                    >
                                        {symbol.name}
                                    </Box>
                                    {editable ? (
                                        <Box
                                            component="td"
                                            sx={{ whiteSpace: "nowrap" }}
                                        >
                                            <SimulatedValue
                                                value={values[symbol.name]}
                                                onChange={value => onSetInput?.(symbol.name, value)}
                                            />
                                            <Tooltip title={I18n.t("simulatedEventHelp")}>
                                                <IconButton
                                                    size="small"
                                                    onClick={() => onEvent?.(symbol.name)}
                                                >
                                                    <EventIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </Box>
                                    ) : (
                                        <Box
                                            component="td"
                                            sx={{ whiteSpace: "nowrap" }}
                                            title={text.length > MAX_LENGTH ? text : undefined}
                                        >
                                            {text.length > MAX_LENGTH ? `${text.substring(0, MAX_LENGTH)}…` : text}
                                        </Box>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </Box>
            )}
        </Box>
    );
}
