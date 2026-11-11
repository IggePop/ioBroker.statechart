import React, { useMemo } from "react";
import { Box, Button, Checkbox, FormControlLabel, TextField, Typography } from "@mui/material";
import { Delete as DeleteIcon } from "@mui/icons-material";
import { I18n } from "@iobroker/adapter-react-v5";
import { GLOBALS, validateChart, validateCode, validateTransitionLabel } from "../../../src/lib/chart-validation";
import type { Declaration, Diagnostic } from "../../../src/lib/chart-validation";
import { HELPERS } from "../../../src/lib/chart-helpers";
import { MAX_SUPER_STEPS } from "../../../src/lib/chart-model";
import type {
    Chart,
    ChartFunction,
    ChartNote,
    ChartState,
    ChartSymbol,
    ChartTransition,
} from "../../../src/lib/chart-model";
import CodeEditor from "./CodeEditor";
import type { Completion } from "./CodeEditor";
import { DEFAULT_STATE_COLOR, STATE_COLORS } from "../flow-model";

interface CodeTools {
    validateAction: (code: string) => Diagnostic[];
    validateLabel: (label: string) => Diagnostic[];
    /**
     * Function blocks are also checked against each other (e.g. duplicate names), so the whole chart is
     * validated with the edited code
     */
    validateFunction: (id: string) => (code: string) => Diagnostic[];
    completions: Completion[];
}

/**
 * Validation and completion for the code editors, depending on the variables and functions of the chart
 *
 * @param symbols The variables of the chart
 * @param functions The current function blocks
 * @param declarations Names declared in all function blocks
 */
function useCodeTools(symbols: ChartSymbol[], functions: ChartFunction[], declarations: Declaration[]): CodeTools {
    return useMemo(() => {
        const functionNames = declarations.map(d => d.name);
        return {
            validateAction: code => validateCode(code, "statements", symbols, 0, functionNames),
            validateLabel: label => validateTransitionLabel(label, symbols, functionNames),
            validateFunction: id => code =>
                validateChart(
                    {
                        version: 1,
                        name: "",
                        enabled: true,
                        symbols,
                        states: [],
                        transitions: [],
                        functions: functions.map(fn => (fn.id === id ? { ...fn, code } : fn)),
                    },
                    { analyze: false },
                )
                    .filter(p => p.kind === "function" && p.id === id)
                    .map(p => p.diagnostic),
            completions: [
                ...symbols.map(s => ({
                    label: s.name,
                    detail: I18n.t(s.scope === "input" ? "Input" : s.scope === "output" ? "Output" : "Local"),
                })),
                ...declarations.map(d => ({ label: d.name, detail: d.signature || "" })),
                // the helper functions with their signature and description, then the JavaScript globals
                ...Object.entries(HELPERS).map(([name, helper]) => ({
                    label: name,
                    detail: helper.signature,
                    info: helper.description,
                    type: "function",
                })),
                ...[...GLOBALS].filter(name => !(name in HELPERS)).map(name => ({ label: name })),
                // the temporal logic operators of transition labels
                { label: "after", detail: "after(5, sec), after(3, input), after(5, min, condition)" },
                { label: "before", detail: "before(5, sec), before(3, input)" },
                { label: "at", detail: 'at(5, sec), at(3, input), at("sunset", -30), at("22:30")' },
                { label: "every", detail: "every(10, min), every(3, input)" },
            ],
        };
    }, [symbols, functions, declarations]);
}

/**
 * Free text for the documentation, has no influence on the execution
 *
 * @param props Component properties
 * @param props.value The comment
 * @param props.onChange Called with the changed comment
 */
function CommentField({
    value,
    onChange,
}: {
    value: string | undefined;
    onChange: (comment: string | undefined) => void;
}): React.JSX.Element {
    return (
        <TextField
            size="small"
            multiline
            minRows={2}
            label={I18n.t("Comment")}
            value={value || ""}
            helperText={I18n.t("commentHelp")}
            // an empty comment is removed, so it does not appear in the stored chart
            onChange={e => onChange(e.target.value || undefined)}
        />
    );
}

/**
 * Background color of a state: the predefined colors and a field for any other color
 *
 * @param props Component properties
 * @param props.value The color as "#rrggbb", undefined for the default color
 * @param props.onChange Called with the new color, undefined for the default color
 */
function ColorField({
    value,
    onChange,
}: {
    value: string | undefined;
    onChange: (color: string | undefined) => void;
}): React.JSX.Element {
    const current = (value || DEFAULT_STATE_COLOR).toLowerCase();
    const isCustom = !STATE_COLORS.includes(current);
    const swatch = {
        width: 24,
        height: 24,
        p: 0,
        borderRadius: "50%",
        border: 1,
        borderColor: "divider",
        cursor: "pointer",
        // the selected color is outlined
        outlineOffset: 2,
    };
    return (
        <Box>
            <Typography
                variant="caption"
                color="text.secondary"
            >
                {I18n.t("Color")}
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mt: 0.5 }}>
                {STATE_COLORS.map(color => (
                    <Box
                        key={color}
                        component="button"
                        type="button"
                        title={color === DEFAULT_STATE_COLOR ? I18n.t("Default color") : color}
                        aria-pressed={color === current}
                        // the default color is stored as undefined, so it does not appear in the chart
                        onClick={() => onChange(color === DEFAULT_STATE_COLOR ? undefined : color)}
                        sx={{
                            ...swatch,
                            bgcolor: color,
                            outline: color === current ? 2 : 0,
                            outlineColor: theme => theme.palette.primary.main,
                        }}
                    />
                ))}
                <Box
                    component="input"
                    type="color"
                    title={I18n.t("Custom color")}
                    value={current}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        onChange(e.target.value === DEFAULT_STATE_COLOR ? undefined : e.target.value)
                    }
                    sx={{
                        ...swatch,
                        borderRadius: 1,
                        bgcolor: "background.paper",
                        outline: isCustom ? 2 : 0,
                        outlineColor: theme => theme.palette.primary.main,
                    }}
                />
            </Box>
        </Box>
    );
}

function NoteProperties({
    note,
    onChange,
    onDelete,
}: {
    note: ChartNote;
    onChange: (patch: Partial<ChartNote>) => void;
    onDelete: () => void;
}): React.JSX.Element {
    return (
        <>
            <Typography variant="h6">{I18n.t("Note")}</Typography>
            <TextField
                multiline
                minRows={8}
                label={I18n.t("Text")}
                value={note.text}
                helperText={I18n.t("noteHelp")}
                onChange={e => onChange({ text: e.target.value })}
            />
            <Button
                color="error"
                variant="outlined"
                startIcon={<DeleteIcon />}
                onClick={onDelete}
            >
                {I18n.t("Delete note")}
            </Button>
        </>
    );
}

/**
 * Decomposition of the children of a state or of the top level: exclusive (OR) or parallel (AND)
 *
 * @param props Component properties
 * @param props.label Label of the checkbox
 * @param props.parallel If the children are parallel
 * @param props.onChange Called with the new value, undefined for the default (exclusive)
 */
function ParallelCheckbox({
    label,
    parallel,
    onChange,
}: {
    label: string;
    parallel: boolean | undefined;
    onChange: (parallel: boolean | undefined) => void;
}): React.JSX.Element {
    return (
        <Box>
            <FormControlLabel
                control={
                    <Checkbox
                        checked={!!parallel}
                        // the default is stored as undefined, so it does not appear in the chart
                        onChange={e => onChange(e.target.checked || undefined)}
                    />
                }
                label={label}
            />
            <Typography
                variant="caption"
                component="div"
                color="text.secondary"
            >
                {I18n.t("parallelHelp")}
            </Typography>
        </Box>
    );
}

/**
 * A breakpoint of the simulation on a state or transition, it is not stored in the chart
 *
 * @param props Component properties
 * @param props.label Label of the checkbox
 * @param props.checked If the breakpoint is set
 * @param props.onToggle Sets or removes it
 */
function BreakpointCheckbox({
    label,
    checked,
    onToggle,
}: {
    label: string;
    checked: boolean;
    onToggle: () => void;
}): React.JSX.Element {
    return (
        <FormControlLabel
            control={
                <Checkbox
                    checked={checked}
                    color="error"
                    onChange={onToggle}
                />
            }
            label={label}
        />
    );
}

function StateProperties({
    state,
    tools,
    isInitial,
    executionOrder,
    canHaveHistory,
    breakpoint,
    onToggleBreakpoint,
    onChange,
    onSetInitial,
    onDelete,
}: {
    state: ChartState;
    tools: CodeTools;
    isInitial: boolean;
    /** Position in the execution order if the state is parallel, i.e. its parent is parallel */
    executionOrder: number | undefined;
    /** The state has exclusive sub states, so a history junction is possible */
    canHaveHistory: boolean;
    breakpoint: boolean;
    onToggleBreakpoint: () => void;
    onChange: (patch: Partial<ChartState>) => void;
    onSetInitial: () => void;
    onDelete: () => void;
}): React.JSX.Element {
    return (
        <>
            <Typography variant="h6">{I18n.t("State")}</Typography>
            <TextField
                size="small"
                label={I18n.t("Name")}
                value={state.name}
                onChange={e => onChange({ name: e.target.value })}
            />
            <ColorField
                value={state.color}
                onChange={color => onChange({ color })}
            />
            {executionOrder === undefined ? (
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={isInitial}
                            disabled={isInitial}
                            onChange={onSetInitial}
                        />
                    }
                    label={I18n.t("Initial state")}
                />
            ) : (
                // parallel states have no initial state, they are all active
                <TextField
                    size="small"
                    type="number"
                    label={I18n.t("Execution order")}
                    value={state.order ?? ""}
                    placeholder={String(executionOrder)}
                    helperText={I18n.t("executionOrderHelp", String(executionOrder))}
                    onChange={e =>
                        onChange({ order: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })
                    }
                />
            )}
            <ParallelCheckbox
                label={I18n.t("Sub states are parallel (AND)")}
                parallel={state.parallel}
                onChange={parallel => onChange({ parallel })}
            />
            {canHaveHistory && (
                <Box>
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={!!state.history}
                                // the default is stored as undefined, so it does not appear in the chart
                                onChange={e => onChange({ history: e.target.checked || undefined })}
                            />
                        }
                        label={I18n.t("Return to the last active sub state (history)")}
                    />
                    <Typography
                        variant="caption"
                        component="div"
                        color="text.secondary"
                    >
                        {I18n.t("historyJunctionHelp")}
                    </Typography>
                </Box>
            )}
            {(["entry", "during", "exit"] as const).map(action => (
                <CodeEditor
                    key={action}
                    label={action}
                    placeholder={action === "entry" ? "light = true;" : ""}
                    value={state[action] || ""}
                    onChange={value => onChange({ [action]: value })}
                    validate={tools.validateAction}
                    completions={tools.completions}
                />
            ))}
            <Typography
                variant="body2"
                color="text.secondary"
            >
                {I18n.t("actionsHelp")}
            </Typography>
            <CommentField
                value={state.comment}
                onChange={comment => onChange({ comment })}
            />
            <BreakpointCheckbox
                label={I18n.t("Breakpoint: the simulation stops when the state is entered")}
                checked={breakpoint}
                onToggle={onToggleBreakpoint}
            />
            <Button
                color="error"
                variant="outlined"
                startIcon={<DeleteIcon />}
                onClick={onDelete}
            >
                {I18n.t("Delete state")}
            </Button>
        </>
    );
}

/**
 * @param props Component properties
 * @param props.transition The transition
 * @param props.toChild If the target is a child of the source
 * @param props.tools Validation and completion
 * @param props.onChange Called with the changed properties
 * @param props.onDelete Deletes the transition
 */
function TransitionProperties({
    transition,
    toChild,
    tools,
    breakpoint,
    onToggleBreakpoint,
    onChange,
    onDelete,
}: {
    transition: ChartTransition;
    toChild: boolean;
    tools: CodeTools;
    breakpoint: boolean;
    onToggleBreakpoint: () => void;
    onChange: (patch: Partial<ChartTransition>) => void;
    onDelete: () => void;
}): React.JSX.Element {
    return (
        <>
            <Typography variant="h6">{I18n.t("Transition")}</Typography>
            <CodeEditor
                label={I18n.t("Label")}
                placeholder="event[condition]{action}"
                value={transition.label || ""}
                onChange={label => onChange({ label })}
                validate={tools.validateLabel}
                completions={tools.completions}
                helperText={I18n.t("labelHelp")}
                minRows={3}
            />
            <TextField
                size="small"
                type="number"
                label={I18n.t("Priority")}
                value={transition.priority ?? ""}
                helperText={I18n.t("priorityHelp")}
                onChange={e => onChange({ priority: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
            />
            {toChild && (
                <Box>
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={!!transition.reenterParent}
                                onChange={e => onChange({ reenterParent: e.target.checked || undefined })}
                            />
                        }
                        label={I18n.t("Leave and enter the parent state again")}
                    />
                    <Typography
                        variant="caption"
                        component="div"
                        color="text.secondary"
                    >
                        {I18n.t(transition.reenterParent ? "outerToChildHelp" : "innerTransitionHelp")}
                    </Typography>
                </Box>
            )}
            <CommentField
                value={transition.comment}
                onChange={comment => onChange({ comment })}
            />
            <BreakpointCheckbox
                label={I18n.t("Breakpoint: the simulation stops when the transition is taken")}
                checked={breakpoint}
                onToggle={onToggleBreakpoint}
            />
            <Box>
                <Button
                    variant="outlined"
                    size="small"
                    disabled={!transition.sourceAnchor && !transition.targetAnchor && !transition.labelOffset}
                    onClick={() =>
                        onChange({ sourceAnchor: undefined, targetAnchor: undefined, labelOffset: undefined })
                    }
                >
                    {I18n.t("Place ends and label automatically")}
                </Button>
                <Typography
                    variant="caption"
                    component="div"
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                >
                    {I18n.t("anchorsHelp")}
                </Typography>
            </Box>
            <Button
                color="error"
                variant="outlined"
                startIcon={<DeleteIcon />}
                onClick={onDelete}
            >
                {I18n.t("Delete transition")}
            </Button>
        </>
    );
}

function FunctionProperties({
    fn,
    tools,
    onChange,
    onDelete,
}: {
    fn: ChartFunction;
    tools: CodeTools;
    onChange: (patch: Partial<ChartFunction>) => void;
    onDelete: () => void;
}): React.JSX.Element {
    const validate = useMemo(() => tools.validateFunction(fn.id), [tools, fn.id]);
    return (
        <>
            <Typography variant="h6">{I18n.t("Function")}</Typography>
            <CodeEditor
                label={I18n.t("Code")}
                placeholder="function myFunction(value) { return value; }"
                value={fn.code}
                onChange={code => onChange({ code })}
                validate={validate}
                completions={tools.completions}
                helperText={I18n.t("functionHelp")}
                minRows={16}
            />
            <CommentField
                value={fn.comment}
                onChange={comment => onChange({ comment })}
            />
            <Button
                color="error"
                variant="outlined"
                startIcon={<DeleteIcon />}
                onClick={onDelete}
            >
                {I18n.t("Delete function")}
            </Button>
        </>
    );
}

function ChartProperties({
    chart,
    onChange,
}: {
    chart: Chart;
    onChange: (patch: Partial<Chart>) => void;
}): React.JSX.Element {
    return (
        <>
            <Typography variant="h6">{I18n.t("Chart")}</Typography>
            <TextField
                size="small"
                label={I18n.t("Name")}
                value={chart.name}
                onChange={e => onChange({ name: e.target.value })}
            />
            <CommentField
                value={chart.comment}
                onChange={comment => onChange({ comment })}
            />
            {/* running or paused is changed with the button in the chart list */}
            <Box>
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={chart.restoreState !== false}
                            onChange={e => onChange({ restoreState: e.target.checked })}
                        />
                    }
                    label={I18n.t("Restore the state after a restart")}
                />
                <Typography
                    variant="caption"
                    component="div"
                    color="text.secondary"
                >
                    {I18n.t("restoreStateHelp")}
                </Typography>
            </Box>
            <ParallelCheckbox
                label={I18n.t("Top level states are parallel (AND)")}
                parallel={chart.parallel}
                onChange={parallel => onChange({ parallel })}
            />
            <Box>
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={!!chart.superStep}
                            // the default is stored as undefined, so it does not appear in the chart
                            onChange={e => onChange({ superStep: e.target.checked || undefined })}
                        />
                    }
                    label={I18n.t("Take transitions until none is valid (super step)")}
                />
                <Typography
                    variant="caption"
                    component="div"
                    color="text.secondary"
                >
                    {I18n.t("superStepHelp", String(MAX_SUPER_STEPS))}
                </Typography>
            </Box>
            <Typography
                variant="body2"
                color="text.secondary"
            >
                {I18n.t("chartHelp")}
            </Typography>
        </>
    );
}

interface PropertiesPanelProps {
    /** Chart level properties, states/transitions/functions may be outdated */
    chart: Chart;
    selectedState: ChartState | null;
    selectedTransition: ChartTransition | null;
    selectedFunction: ChartFunction | null;
    selectedNote: ChartNote | null;
    onNoteChange: (id: string, patch: Partial<ChartNote>) => void;
    /** If the selected state is the initial state of its level */
    isInitial: boolean;
    /** Position of the selected state in the execution order, if it is parallel */
    executionOrder: number | undefined;
    /** The selected state has exclusive sub states, so a history junction is possible */
    canHaveHistory: boolean;
    /** IDs of the states and transitions with a breakpoint of the simulation */
    breakpoints: ReadonlySet<string>;
    onToggleBreakpoint: (id: string) => void;
    /** If the target of the selected transition is a child of its source */
    toChild: boolean;
    /** Makes a state the initial state of its level */
    onSetInitial: (id: string) => void;
    /** The current function blocks */
    functions: ChartFunction[];
    /** Names declared in all function blocks */
    declarations: Declaration[];
    onChartChange: (patch: Partial<Chart>) => void;
    onStateChange: (id: string, patch: Partial<ChartState>) => void;
    onTransitionChange: (id: string, patch: Partial<ChartTransition>) => void;
    onFunctionChange: (id: string, patch: Partial<ChartFunction>) => void;
    /** Deletes a state or function block */
    onDeleteNode: (id: string) => void;
    onDeleteTransition: (id: string) => void;
}

/**
 * Shows the properties of the selected state, transition or function block, or of the chart if nothing is selected
 *
 * @param props Component properties
 */
export default function PropertiesPanel(props: PropertiesPanelProps): React.JSX.Element {
    const { chart, selectedState, selectedTransition, selectedFunction, functions, declarations } = props;
    const tools = useCodeTools(chart.symbols, functions, declarations);
    let content;
    if (selectedState) {
        content = (
            <StateProperties
                state={selectedState}
                tools={tools}
                isInitial={props.isInitial}
                executionOrder={props.executionOrder}
                canHaveHistory={props.canHaveHistory}
                breakpoint={props.breakpoints.has(selectedState.id)}
                onToggleBreakpoint={() => props.onToggleBreakpoint(selectedState.id)}
                onChange={patch => props.onStateChange(selectedState.id, patch)}
                onSetInitial={() => props.onSetInitial(selectedState.id)}
                onDelete={() => props.onDeleteNode(selectedState.id)}
            />
        );
    } else if (selectedTransition) {
        content = (
            <TransitionProperties
                transition={selectedTransition}
                toChild={props.toChild}
                tools={tools}
                breakpoint={props.breakpoints.has(selectedTransition.id)}
                onToggleBreakpoint={() => props.onToggleBreakpoint(selectedTransition.id)}
                onChange={patch => props.onTransitionChange(selectedTransition.id, patch)}
                onDelete={() => props.onDeleteTransition(selectedTransition.id)}
            />
        );
    } else if (props.selectedNote) {
        const note = props.selectedNote;
        content = (
            <NoteProperties
                note={note}
                onChange={patch => props.onNoteChange(note.id, patch)}
                onDelete={() => props.onDeleteNode(note.id)}
            />
        );
    } else if (selectedFunction) {
        content = (
            <FunctionProperties
                fn={selectedFunction}
                tools={tools}
                onChange={patch => props.onFunctionChange(selectedFunction.id, patch)}
                onDelete={() => props.onDeleteNode(selectedFunction.id)}
            />
        );
    } else {
        content = (
            <ChartProperties
                chart={chart}
                onChange={props.onChartChange}
            />
        );
    }
    return <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>{content}</Box>;
}
