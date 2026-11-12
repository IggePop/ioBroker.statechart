import React, { useState } from "react";
import { Box, Button, ButtonBase, Collapse, IconButton, MenuItem, TextField, Tooltip, Typography } from "@mui/material";
import {
    Add as AddIcon,
    ChevronRight as CollapsedIcon,
    DataObject as LocalIcon,
    Delete as DeleteIcon,
    ErrorOutline as ErrorIcon,
    ExpandMore as ExpandedIcon,
    Input as InputIcon,
    ListAlt as SelectIdIcon,
    Output as OutputIcon,
    Search as SearchIcon,
} from "@mui/icons-material";
import { DialogSelectID, I18n } from "@iobroker/adapter-react-v5";
import type { AdminConnection, IobTheme } from "@iobroker/adapter-react-v5";
import type { ChartSymbol, SymbolScope } from "../../../src/lib/chart-model";
import { formatValue } from "./LiveValuesPanel";
import ProblemBadge from "./ProblemBadge";
import type { ProblemList } from "./ProblemBadge";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Initial values of locals are entered as JSON (number, boolean, string in quotes), anything else is a string
 *
 * @param text The entered text
 */
function parseInitial(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/**
 * Keeps the typed text, so editing is not disturbed by converting the value back and forth
 *
 * @param props Component properties
 * @param props.value The initial value
 * @param props.onChange Called with the parsed value
 */
function InitialValueField({ value, onChange }: { value: any; onChange: (value: any) => void }): React.JSX.Element {
    const [text, setText] = useState(value === undefined ? "" : JSON.stringify(value));
    return (
        <TextField
            size="small"
            label={I18n.t("Initial value")}
            value={text}
            helperText={I18n.t("initialHelp")}
            onChange={e => {
                setText(e.target.value);
                onChange(e.target.value === "" ? undefined : parseInitial(e.target.value));
            }}
            slotProps={{ htmlInput: { style: { fontFamily: "monospace" } } }}
        />
    );
}

/**
 * When an input wakes up the chart. The default values are stored as undefined, so they do not appear in the chart.
 *
 * @param props Component properties
 * @param props.symbol The input
 * @param props.onChange Called with the changed properties
 */
function InputTriggerFields({
    symbol,
    onChange,
}: {
    symbol: ChartSymbol;
    onChange: (patch: Partial<ChartSymbol>) => void;
}): React.JSX.Element {
    return (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <TextField
                select
                size="small"
                label={I18n.t("Wake up on")}
                value={symbol.trigger || "update"}
                onChange={e => onChange({ trigger: e.target.value === "change" ? "change" : undefined })}
                sx={{ flex: "1 1 140px" }}
            >
                <MenuItem value="update">{I18n.t("every update")}</MenuItem>
                <MenuItem value="change">{I18n.t("value changes only")}</MenuItem>
            </TextField>
            <TextField
                select
                size="small"
                label={I18n.t("Acknowledged (ack)")}
                value={symbol.ack || "any"}
                onChange={e =>
                    onChange({
                        ack: e.target.value === "any" ? undefined : (e.target.value as ChartSymbol["ack"]),
                    })
                }
                sx={{ flex: "1 1 140px" }}
            >
                <MenuItem value="any">{I18n.t("any")}</MenuItem>
                <MenuItem value="ack">{I18n.t("confirmed values only")}</MenuItem>
                <MenuItem value="command">{I18n.t("commands only")}</MenuItem>
            </TextField>
            <TextField
                size="small"
                type="number"
                label={I18n.t("Debounce (ms)")}
                value={symbol.debounceMs || ""}
                placeholder="0"
                onChange={e => {
                    const ms = parseInt(e.target.value, 10);
                    onChange({ debounceMs: ms > 0 ? ms : undefined });
                }}
                slotProps={{ htmlInput: { min: 0, step: 100 } }}
                sx={{ flex: "1 1 100px" }}
            />
            <Typography
                variant="caption"
                color="text.secondary"
                sx={{ flexBasis: "100%" }}
            >
                {I18n.t("triggerHelp")}
            </Typography>
        </Box>
    );
}

/** The groups of the list, in this order */
const GROUPS: { scope: SymbolScope; title: string; add: string; icon: React.JSX.Element }[] = [
    { scope: "input", title: "Inputs", add: "Add input", icon: <InputIcon fontSize="small" /> },
    { scope: "output", title: "Outputs", add: "Add output", icon: <OutputIcon fontSize="small" /> },
    { scope: "local", title: "Locals", add: "Add local", icon: <LocalIcon fontSize="small" /> },
];

/** From this number of variables on, a search field is shown */
const SEARCH_FROM = 8;

/**
 * @param symbol The variable
 * @param index Its index
 * @param names The names of all variables
 * @returns the problem of the name, empty if there is none
 */
function getNameError(symbol: ChartSymbol, index: number, names: string[]): string {
    if (!IDENTIFIER.test(symbol.name)) {
        return I18n.t("Invalid name");
    }
    return names.indexOf(symbol.name) !== index ? I18n.t("Name already used") : "";
}

/**
 * @param symbol An input
 * @returns true if it does not wake up the chart like by default (on every update, any ack, no debounce)
 */
const hasTriggerOptions = (symbol: ChartSymbol): boolean => !!(symbol.trigger || symbol.ack || symbol.debounceMs);

/**
 * The collapsed line of a variable: name, state or initial value, current value and problems
 *
 * @param props Component properties
 * @param props.symbol The variable
 * @param props.open If its fields are shown
 * @param props.problem Its problem, empty if there is none
 * @param props.hints Problems found by the analysis of the chart, e.g. that it is not used
 * @param props.liveValues Current values of the variables
 * @param props.onClick Opens or closes the fields
 */
function SymbolRow({
    symbol,
    open,
    problem,
    hints,
    liveValues,
    onClick,
}: {
    symbol: ChartSymbol;
    open: boolean;
    problem: string;
    hints: ProblemList | undefined;
    liveValues: Record<string, any>;
    onClick: () => void;
}): React.JSX.Element {
    const detail = symbol.scope === "local" ? (JSON.stringify(symbol.initial) ?? "") : symbol.stateId || "";
    return (
        <ButtonBase
            onClick={onClick}
            sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                width: "100%",
                px: 0.5,
                py: 0.5,
                borderRadius: 1,
                textAlign: "left",
                bgcolor: open ? "action.selected" : undefined,
                "&:hover": { bgcolor: "action.hover" },
            }}
        >
            {open ? <ExpandedIcon fontSize="small" /> : <CollapsedIcon fontSize="small" />}
            <Typography
                variant="body2"
                sx={{ fontFamily: "monospace", fontWeight: "bold", flexShrink: 0, maxWidth: "45%" }}
                noWrap
            >
                {symbol.name}
            </Typography>
            <Typography
                variant="caption"
                color="text.secondary"
                title={detail}
                // the end of a state ID is the most telling part, so a long ID is cut at the start
                sx={{ flex: 1, minWidth: 0, direction: "rtl", textAlign: "left" }}
                noWrap
            >
                {/* keeps the characters in their order despite the direction */}
                <bdi>{detail}</bdi>
            </Typography>
            {symbol.name in liveValues && (
                <Typography
                    variant="caption"
                    title={I18n.t("currentValue", formatValue(liveValues[symbol.name]))}
                    sx={{ fontFamily: "monospace", maxWidth: "30%", flexShrink: 0 }}
                    noWrap
                >
                    {formatValue(liveValues[symbol.name])}
                </Typography>
            )}
            {problem ? (
                <Tooltip title={problem}>
                    <ErrorIcon
                        fontSize="small"
                        color="error"
                    />
                </Tooltip>
            ) : (
                <ProblemBadge
                    problems={hints}
                    sx={{ fontSize: 20 }}
                />
            )}
        </ButtonBase>
    );
}

/**
 * The fields of the open variable
 *
 * @param props Component properties
 * @param props.symbol The variable
 * @param props.nameError Problem of the name, empty if there is none
 * @param props.autoFocus Focus the name, for new variables
 * @param props.onChange Called with the changed properties
 * @param props.onDelete Deletes the variable
 * @param props.onSelectState Opens the dialog to select the state
 */
function SymbolDetails({
    symbol,
    nameError,
    autoFocus,
    onChange,
    onDelete,
    onSelectState,
}: {
    symbol: ChartSymbol;
    nameError: string;
    autoFocus: boolean;
    onChange: (patch: Partial<ChartSymbol>) => void;
    onDelete: () => void;
    onSelectState: () => void;
}): React.JSX.Element {
    // options which differ from the default are shown right away
    const [advanced, setAdvanced] = useState(() => hasTriggerOptions(symbol));
    return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 1.5, pb: 2, pl: 3 }}>
            <Box sx={{ display: "flex", gap: 1 }}>
                <TextField
                    size="small"
                    label={I18n.t("Name")}
                    value={symbol.name}
                    error={!!nameError}
                    helperText={nameError}
                    autoFocus={autoFocus}
                    onChange={e => onChange({ name: e.target.value })}
                    sx={{ flex: 1 }}
                    slotProps={{ htmlInput: { style: { fontFamily: "monospace" } } }}
                />
                <TextField
                    select
                    size="small"
                    label={I18n.t("Scope")}
                    value={symbol.scope}
                    onChange={e => onChange({ scope: e.target.value as SymbolScope })}
                    sx={{ width: 120 }}
                >
                    <MenuItem value="input">{I18n.t("Input")}</MenuItem>
                    <MenuItem value="output">{I18n.t("Output")}</MenuItem>
                    <MenuItem value="local">{I18n.t("Local")}</MenuItem>
                </TextField>
                <Tooltip title={I18n.t("Delete")}>
                    <IconButton
                        size="small"
                        onClick={onDelete}
                    >
                        <DeleteIcon />
                    </IconButton>
                </Tooltip>
            </Box>
            {symbol.scope === "local" ? (
                <InitialValueField
                    value={symbol.initial}
                    onChange={initial => onChange({ initial })}
                />
            ) : (
                <Box sx={{ display: "flex", gap: 1 }}>
                    <TextField
                        size="small"
                        label={I18n.t("State ID")}
                        value={symbol.stateId || ""}
                        error={!symbol.stateId?.trim()}
                        onChange={e => onChange({ stateId: e.target.value })}
                        sx={{ flex: 1 }}
                    />
                    <Tooltip title={I18n.t("Select state")}>
                        <IconButton
                            size="small"
                            onClick={onSelectState}
                        >
                            <SelectIdIcon />
                        </IconButton>
                    </Tooltip>
                </Box>
            )}
            {symbol.scope === "input" && (
                <Box>
                    <Button
                        size="small"
                        startIcon={advanced ? <ExpandedIcon /> : <CollapsedIcon />}
                        onClick={() => setAdvanced(!advanced)}
                    >
                        {I18n.t("Wake up options")}
                    </Button>
                    <Collapse in={advanced}>
                        <Box sx={{ pt: 1.5 }}>
                            <InputTriggerFields
                                symbol={symbol}
                                onChange={onChange}
                            />
                        </Box>
                    </Collapse>
                </Box>
            )}
        </Box>
    );
}

interface SymbolsEditorProps {
    symbols: ChartSymbol[];
    /** Problems found by the analysis of the chart, by name */
    problems: Map<string, ProblemList>;
    onChange: (symbols: ChartSymbol[]) => void;
    /** Current values of the variables, empty if the chart does not run */
    liveValues: Record<string, any>;
    socket: AdminConnection;
    theme: IobTheme;
}

/**
 * The variables of a chart, grouped by scope. Each variable is one line, a click shows its fields below it.
 *
 * @param props Component properties, see SymbolsEditorProps
 * @param props.symbols The variables of the chart
 * @param props.problems Problems found by the analysis of the chart, by name
 * @param props.onChange Called with the changed variables
 * @param props.liveValues Current values of the variables, empty if the chart does not run
 * @param props.socket Connection to ioBroker, for the dialog to select a state
 * @param props.theme Theme of the admin, for the dialog to select a state
 */
export default function SymbolsEditor({
    symbols,
    problems,
    onChange,
    liveValues,
    socket,
    theme,
}: SymbolsEditorProps): React.JSX.Element {
    /** index of the variable whose fields are shown */
    const [open, setOpen] = useState<number | null>(null);
    /** index of the variable just added, its name gets the focus */
    const [added, setAdded] = useState<number | null>(null);
    /** scopes whose group is collapsed */
    const [collapsed, setCollapsed] = useState<ReadonlySet<SymbolScope>>(new Set());
    const [search, setSearch] = useState("");
    /** index of the symbol for which the state selection dialog is open */
    const [selectFor, setSelectFor] = useState<number | null>(null);

    const names = symbols.map(s => s.name);

    const update = (index: number, patch: Partial<ChartSymbol>): void =>
        onChange(symbols.map((s, i) => (i === index ? { ...s, ...patch } : s)));

    const remove = (index: number): void => {
        onChange(symbols.filter((_, i) => i !== index));
        setOpen(null);
    };

    const add = (scope: SymbolScope): void => {
        let i = symbols.length + 1;
        while (names.includes(`var${i}`)) {
            i++;
        }
        onChange([
            ...symbols,
            scope === "local" ? { name: `var${i}`, scope } : { name: `var${i}`, scope, stateId: "" },
        ]);
        // the new variable is shown with its fields
        setOpen(symbols.length);
        setAdded(symbols.length);
        setSearch("");
        setCollapsed(c => new Set([...c].filter(s => s !== scope)));
    };

    const toggleGroup = (scope: SymbolScope): void =>
        setCollapsed(c => (c.has(scope) ? new Set([...c].filter(s => s !== scope)) : new Set([...c, scope])));

    const query = search.trim().toLowerCase();
    const matches = (symbol: ChartSymbol): boolean =>
        !query || symbol.name.toLowerCase().includes(query) || !!symbol.stateId?.toLowerCase().includes(query);

    return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography
                variant="body2"
                color="text.secondary"
            >
                {I18n.t("symbolsHelp")}
            </Typography>
            {symbols.length >= SEARCH_FROM && (
                <TextField
                    size="small"
                    placeholder={I18n.t("Search variables")}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    slotProps={{
                        input: {
                            startAdornment: (
                                <SearchIcon
                                    fontSize="small"
                                    sx={{ mr: 1 }}
                                />
                            ),
                        },
                    }}
                />
            )}
            {GROUPS.map(group => {
                const members = symbols
                    .map((symbol, index) => ({ symbol, index }))
                    .filter(m => m.symbol.scope === group.scope);
                const shown = members.filter(m => matches(m.symbol));
                // a search shows the matches of all groups
                const isCollapsed = !query && collapsed.has(group.scope);
                return (
                    <Box key={group.scope}>
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 0.5,
                                borderBottom: 1,
                                borderColor: "divider",
                            }}
                        >
                            <ButtonBase
                                onClick={() => toggleGroup(group.scope)}
                                sx={{ flex: 1, justifyContent: "flex-start", gap: 0.5, py: 0.5, borderRadius: 1 }}
                            >
                                {isCollapsed ? <CollapsedIcon fontSize="small" /> : <ExpandedIcon fontSize="small" />}
                                {group.icon}
                                <Typography variant="subtitle2">
                                    {I18n.t(group.title)} (
                                    {query ? `${shown.length}/${members.length}` : members.length})
                                </Typography>
                            </ButtonBase>
                            <Tooltip title={I18n.t(group.add)}>
                                <IconButton
                                    size="small"
                                    onClick={() => add(group.scope)}
                                >
                                    <AddIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                        <Collapse in={!isCollapsed}>
                            {shown.map(({ symbol, index }) => {
                                const nameError = getNameError(symbol, index, names);
                                const problem =
                                    nameError ||
                                    (symbol.scope !== "local" && !symbol.stateId?.trim()
                                        ? I18n.t("No state selected")
                                        : "");
                                return (
                                    <Box key={index}>
                                        <SymbolRow
                                            symbol={symbol}
                                            open={open === index}
                                            problem={problem}
                                            hints={problems.get(symbol.name)}
                                            liveValues={liveValues}
                                            onClick={() => {
                                                setOpen(open === index ? null : index);
                                                setAdded(null);
                                            }}
                                        />
                                        {open === index && (
                                            <SymbolDetails
                                                symbol={symbol}
                                                nameError={nameError}
                                                autoFocus={added === index}
                                                onChange={patch => update(index, patch)}
                                                onDelete={() => remove(index)}
                                                onSelectState={() => setSelectFor(index)}
                                            />
                                        )}
                                    </Box>
                                );
                            })}
                            {!shown.length && (
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    component="div"
                                    sx={{ px: 1, py: 0.5 }}
                                >
                                    {I18n.t(query ? "No matching variables" : "No variables")}
                                </Typography>
                            )}
                        </Collapse>
                    </Box>
                );
            })}
            {selectFor !== null && (
                <DialogSelectID
                    socket={socket}
                    theme={theme}
                    themeType={theme.palette.mode}
                    imagePrefix="../.."
                    dialogName="statechart"
                    types={["state"]}
                    selected={symbols[selectFor]?.stateId || ""}
                    onClose={() => setSelectFor(null)}
                    onOk={selected => {
                        const id = Array.isArray(selected) ? selected[0] : selected;
                        if (id) {
                            update(selectFor, { stateId: id });
                        }
                        setSelectFor(null);
                    }}
                />
            )}
        </Box>
    );
}
