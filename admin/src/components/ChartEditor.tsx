import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    applyEdgeChanges,
    applyNodeChanges,
    Background,
    ConnectionMode,
    Controls,
    MarkerType,
    MiniMap,
    Panel,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
} from "@xyflow/react";
import type { OnConnect, OnEdgesChange, OnNodeDrag, OnNodesChange } from "@xyflow/react";
import {
    Box,
    Divider,
    GlobalStyles,
    IconButton,
    ListItemIcon,
    ListItemText,
    Menu,
    MenuItem,
    Tab,
    Tabs,
    Toolbar,
    Tooltip,
} from "@mui/material";
import {
    Add as AddIcon,
    AlignHorizontalCenter as AlignCenterXIcon,
    AlignHorizontalLeft as AlignLeftIcon,
    AlignHorizontalRight as AlignRightIcon,
    AlignVerticalBottom as AlignBottomIcon,
    AlignVerticalCenter as AlignCenterYIcon,
    AlignVerticalTop as AlignTopIcon,
    ViewColumn as DistributeXIcon,
    ViewStream as DistributeYIcon,
    Code as CodeIcon,
    ContentCopy as CopyIcon,
    ContentPaste as PasteIcon,
    FileDownload as ExportIcon,
    Functions as FunctionIcon,
    MonitorHeartOutlined as LiveIcon,
    StickyNote2Outlined as NoteIcon,
    Redo as RedoIcon,
    Save as SaveIcon,
    Science as SimulationIcon,
    Undo as UndoIcon,
} from "@mui/icons-material";
import { I18n } from "@iobroker/adapter-react-v5";
import type { AdminConnection, IobTheme } from "@iobroker/adapter-react-v5";
import { useEditHistory } from "../edit-history";

import StateNode from "./StateNode";
import FunctionNode from "./FunctionNode";
import NoteNode from "./NoteNode";
import TransitionEdge from "./TransitionEdge";
import PropertiesPanel from "./PropertiesPanel";
import ResizablePanel from "./ResizablePanel";
import SymbolsEditor from "./SymbolsEditor";
import GeneratedCodeDialog from "./GeneratedCodeDialog";
import HistoryPanel from "./HistoryPanel";
import LiveValuesPanel from "./LiveValuesPanel";
import SimulationBar from "./SimulationBar";
import type { HistoryEntry, SimulationStatus } from "../../../src/lib/chart-runtime";
import { generateChartCode } from "../../../src/lib/chart-codegen";
import { createExport } from "../../../src/lib/chart-model";
import type {
    Chart,
    ChartFunction,
    ChartNote,
    ChartState,
    ChartTransition,
    EdgeAnchor,
} from "../../../src/lib/chart-model";
import type { EdgeEnd } from "./TransitionEdge";
import { downloadJson } from "../download";
import { translateDiagnostic } from "./CodeEditor";
import { addProblem } from "./ProblemBadge";
import type { ProblemList } from "./ProblemBadge";
import {
    chartToFlow,
    copySelection,
    createId,
    DEFAULT_FUNCTION_HEIGHT,
    DEFAULT_FUNCTION_WIDTH,
    DEFAULT_NOTE_HEIGHT,
    DEFAULT_NOTE_WIDTH,
    DEFAULT_STATE_HEIGHT,
    DEFAULT_STATE_WIDTH,
    alignRects,
    findDropParent,
    flowToChart,
    getExclusiveParentIds,
    getNestingDepths,
    getExecutionOrder,
    getInitialStateIds,
    isDescendantNode,
    pasteClipboard,
    reparentNodes,
} from "../flow-model";
import type { Alignment, ChartFlowNode, ClipboardContent, Rect, TransitionFlowEdge } from "../flow-model";
import { getLabelStackOffsets, getParallelOffsets, isValidAnchor } from "../floating-edges";
import { getDeclarations, validateChart } from "../../../src/lib/chart-validation";

// defined outside the component, so React Flow does not re-create them on every render
const nodeTypes = { state: StateNode, function: FunctionNode, note: NoteNode };
const edgeTypes = { transition: TransitionEdge };
const markerEnd = { type: MarkerType.ArrowClosed, width: 18, height: 18 };

/**
 * Copied elements, outside the component so they can be pasted into another chart as well
 */
let clipboard: ClipboardContent | null = null;

/** Distance of pasted elements from the copied ones */
const PASTE_OFFSET = 30;

/** How long a taken transition is highlighted */
const FLASH_MS = 1500;

/** Key in the browser storage: if the live values are shown on the canvas */
const SHOW_LIVE_KEY = "statechart.showLiveValues";

function loadShowLive(): boolean {
    try {
        return window.localStorage.getItem(SHOW_LIVE_KEY) !== "false";
    } catch {
        return true;
    }
}

function saveShowLive(show: boolean): void {
    try {
        window.localStorage.setItem(SHOW_LIVE_KEY, String(show));
    } catch {
        // only a convenience
    }
}

/** The entries of the menu for aligning the selected nodes */
const ALIGNMENTS: { alignment: Alignment; title: string; icon: React.ReactNode }[] = [
    { alignment: "left", title: "Align left", icon: <AlignLeftIcon fontSize="small" /> },
    { alignment: "centerX", title: "Align centers horizontally", icon: <AlignCenterXIcon fontSize="small" /> },
    { alignment: "right", title: "Align right", icon: <AlignRightIcon fontSize="small" /> },
    { alignment: "top", title: "Align top", icon: <AlignTopIcon fontSize="small" /> },
    { alignment: "centerY", title: "Align centers vertically", icon: <AlignCenterYIcon fontSize="small" /> },
    { alignment: "bottom", title: "Align bottom", icon: <AlignBottomIcon fontSize="small" /> },
    { alignment: "distributeX", title: "Distribute horizontally", icon: <DistributeXIcon fontSize="small" /> },
    { alignment: "distributeY", title: "Distribute vertically", icon: <DistributeYIcon fontSize="small" /> },
];

/**
 * A button of the toolbar: only an icon, the title is shown as tooltip
 *
 * @param props Component properties
 * @param props.title Shown as tooltip
 * @param props.icon The icon of the button
 * @param props.onClick Called when the button is clicked
 * @param props.disabled If the button is disabled
 * @param props.color Color of the icon
 */
function ToolButton({
    title,
    icon,
    onClick,
    disabled,
    color = "default",
}: {
    title: string;
    icon: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    color?: "default" | "primary" | "warning";
}): React.JSX.Element {
    return (
        <Tooltip title={title}>
            {/* disabled buttons get no mouse events, the span shows the tooltip anyway */}
            <span>
                <IconButton
                    size="small"
                    color={color}
                    disabled={disabled}
                    onClick={onClick}
                    aria-label={title}
                >
                    {icon}
                </IconButton>
            </span>
        </Tooltip>
    );
}

/**
 * @param target Target of a keyboard event
 * @returns true for text fields and code editors, which handle the keyboard shortcuts themselves
 */
function isTextInput(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
        return false;
    }
    return (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        (target instanceof HTMLElement && target.isContentEditable) ||
        !!target.closest(".cm-editor")
    );
}

interface ChartEditorProps {
    /** ID of the chart (last part of the object ID) */
    chartId: string;
    /** The saved chart */
    chart: Chart;
    /** IDs of the currently active states */
    activeIds: string[];
    /** Current values of the variables, empty if the chart does not run */
    liveValues: Record<string, any>;
    /** Starts and transitions of the running chart, null while they are loaded */
    chartHistory: HistoryEntry[] | null;
    /** If the chart runs as simulation */
    simulating: boolean;
    /** Status of the simulation, null if none runs or it is not known yet */
    simulationStatus: SimulationStatus | null;
    /** Sends a command of the simulation to the adapter, e.g. "simulationStart" */
    onSimulate: (command: string, message?: Record<string, any>) => void;
    onClearHistory: () => void;
    onSave: (chart: Chart) => Promise<void>;
    /** Called when the editor gets or loses unsaved changes */
    onChangedChange?: (changed: boolean) => void;
    /** Set to a function which saves the chart */
    saveRef?: { current: (() => Promise<void>) | null };
    socket: AdminConnection;
    theme: IobTheme;
}

type Shortcut = "undo" | "redo" | "copy" | "cut" | "paste";

function ChartEditorInner({
    chartId,
    chart: savedChart,
    activeIds,
    liveValues,
    chartHistory,
    simulating,
    simulationStatus,
    onSimulate,
    onClearHistory,
    onSave,
    onChangedChange,
    saveRef,
    socket,
    theme,
}: ChartEditorProps): React.JSX.Element {
    const reactFlow = useReactFlow<ChartFlowNode, TransitionFlowEdge>();
    /** chart level properties (name, symbols, initial state, ...), states and transitions live in nodes/edges */
    const [chart, setChart] = useState(savedChart);
    const [nodes, setNodes] = useState(() => chartToFlow(savedChart).nodes);
    const [edges, setEdges] = useState(() => chartToFlow(savedChart).edges);
    const history = useEditHistory({ chart, nodes, edges }, document => {
        // selected elements of the past would show their (old) properties, so the selection is cleared
        setChart(document.chart);
        setNodes(document.nodes.map(n => ({ ...n, selected: false })));
        setEdges(document.edges.map(e => ({ ...e, selected: false })));
    });
    const { record, changed } = history;
    /** how often the clipboard was pasted, each time a bit further away */
    const pasteCount = useRef(0);
    /** the clipboard is no state, this re-renders the editor (to enable the paste button) when it is filled */
    const [hasClipboard, setHasClipboard] = useState(!!clipboard);
    const [saving, setSaving] = useState(false);
    const [panelTab, setPanelTab] = useState("properties");
    /** the code generated from the current (maybe unsaved) chart, null if the dialog is closed */
    const [generatedCode, setGeneratedCode] = useState<string | null>(null);
    /** state into which the dragged state would be moved when it is dropped */
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [showLive, setShowLive] = useState(loadShowLive);
    /** IDs of the states and transitions where the simulation stops, they are not stored in the chart */
    const [breakpoints, setBreakpoints] = useState<ReadonlySet<string>>(new Set());
    /** transitions which were just taken by the running chart, they are highlighted for a moment */
    const [flashing, setFlashing] = useState<ReadonlySet<string>>(new Set());
    /** time of the newest history entry already seen, null until the history is loaded */
    const lastSeen = useRef<number | null>(null);

    useEffect(() => {
        if (!chartHistory) {
            return;
        }
        const newest = chartHistory.reduce((max, e) => Math.max(max, e.ts), lastSeen.current ?? 0);
        if (lastSeen.current === null) {
            // the history from before the editor was opened is not animated
            lastSeen.current = newest;
            return;
        }
        const since = lastSeen.current;
        lastSeen.current = newest;
        const ids = chartHistory.filter(e => e.ts > since && e.transition).map(e => e.transition as string);
        if (!ids.length) {
            return;
        }
        setFlashing(current => new Set([...current, ...ids]));
        // not cancelled by a newer history, the transitions must not stay highlighted
        setTimeout(() => setFlashing(current => new Set([...current].filter(id => !ids.includes(id)))), FLASH_MS);
    }, [chartHistory]);

    /**
     * Absolute position and size of a node, as currently shown by React Flow
     */
    const getRect = useCallback(
        (id: string): Rect | null => {
            const node = reactFlow.getInternalNode(id);
            if (!node) {
                return null;
            }
            return {
                ...node.internals.positionAbsolute,
                width: node.measured.width ?? node.width ?? 0,
                height: node.measured.height ?? node.height ?? 0,
            };
        },
        [reactFlow],
    );

    /** The button which opened the menu for aligning the selected nodes */
    const [alignMenu, setAlignMenu] = useState<HTMLElement | null>(null);
    const alignButton = useRef<HTMLSpanElement>(null);

    /**
     * Aligns or distributes the selected nodes. Their absolute positions are changed, also of nodes inside other
     * selected nodes, and converted back to positions relative to their parents.
     *
     * @param alignment How they are aligned
     */
    const align = (alignment: Alignment): void => {
        setAlignMenu(null);
        const rects = new Map<string, Rect>();
        for (const node of nodes) {
            const rect = node.selected ? getRect(node.id) : null;
            if (rect) {
                rects.set(node.id, rect);
            }
        }
        const moved = alignRects(rects, alignment);
        if (!moved.size) {
            return;
        }
        /** the new absolute position of a node, or the current one */
        const absolute = (id: string): { x: number; y: number } | null => moved.get(id) ?? getRect(id);
        record();
        setNodes(nds =>
            nds.map(n => {
                const position = moved.get(n.id);
                const parent = n.parentId ? absolute(n.parentId) : { x: 0, y: 0 };
                return position && parent
                    ? { ...n, position: { x: position.x - parent.x, y: position.y - parent.y } }
                    : n;
            }),
        );
    };

    const onNodeDrag = useCallback<OnNodeDrag<ChartFlowNode>>(
        (_event, node, dragged) => {
            const target =
                dragged.length === 1 && (node.type === "state" || node.type === "note")
                    ? findDropParent(nodes, node.id, getRect)
                    : null;
            // only show a target if the state/note would really be moved into another parent
            setDropTarget(target !== (node.parentId || null) ? target : null);
        },
        [nodes, getRect],
    );

    const onNodeDragStop = useCallback<OnNodeDrag<ChartFlowNode>>(
        (_event, _node, dragged) => {
            setDropTarget(null);
            setNodes(nds =>
                reparentNodes(
                    nds,
                    dragged.map(n => n.id),
                    getRect,
                ),
            );
        },
        [getRect],
    );

    const onNodesChange = useCallback<OnNodesChange<ChartFlowNode>>(
        changes => {
            // selection and measuring are no modifications of the chart
            if (changes.some(c => c.type === "remove")) {
                // removing states also removes their transitions: one step
                record("remove");
            } else if (changes.some(c => c.type === "dimensions" && c.resizing)) {
                record("resize");
            } else if (changes.some(c => c.type === "position" && c.position)) {
                // dragged or moved with the arrow keys, all position changes of a drag are one step
                // (including moving the state into another state when it is dropped)
                record("move");
            }
            setNodes(nds => applyNodeChanges(changes, nds));
        },
        [record],
    );

    const onEdgesChange = useCallback<OnEdgesChange<TransitionFlowEdge>>(
        changes => {
            if (changes.some(c => c.type === "remove")) {
                record("remove");
            }
            setEdges(eds => applyEdgeChanges(changes, eds));
        },
        [record],
    );

    const onConnect = useCallback<OnConnect>(
        connection => {
            record();
            setEdges(eds => {
                const id = createId("t", eds);
                const outgoing = eds.filter(e => e.source === connection.source).length;
                return [
                    ...eds.map(e => ({ ...e, selected: false })),
                    {
                        id,
                        type: "transition",
                        source: connection.source,
                        target: connection.target,
                        sourceHandle: connection.sourceHandle,
                        targetHandle: connection.targetHandle,
                        selected: true,
                        data: {
                            transition: {
                                id,
                                source: connection.source,
                                target: connection.target,
                                label: "",
                                priority: outgoing + 1,
                            },
                        },
                    },
                ];
            });
            setNodes(nds => nds.map(n => ({ ...n, selected: false })));
        },
        [record],
    );

    /**
     * Sets or removes a breakpoint of the simulation
     *
     * @param id ID of the state or transition
     */
    const toggleBreakpoint = (id: string): void => {
        const changed = new Set(breakpoints);
        if (!changed.delete(id)) {
            changed.add(id);
        }
        setBreakpoints(changed);
        if (simulating) {
            onSimulate("simulationBreakpoints", { breakpoints: [...changed] });
        }
    };

    // a double click selects the state/transition (first click) and shows its properties
    /** Counts the double clicks on states and transitions, each one expands the collapsed properties panel */
    const [propertiesRequest, setPropertiesRequest] = useState(0);
    const showProperties = useCallback(() => {
        setPanelTab("properties");
        setPropertiesRequest(n => n + 1);
    }, []);

    /** Fixes an end of a transition on the border of its state (dragged in the editor), undefined: automatic */
    const changeAnchor = useCallback(
        (id: string, end: EdgeEnd, anchor: EdgeAnchor | undefined) => {
            // all moves of a drag are one step
            record(`transition:${id}:${end}Anchor`);
            setEdges(eds =>
                eds.map(e =>
                    e.id === id && e.data
                        ? { ...e, data: { ...e.data, transition: { ...e.data.transition, [`${end}Anchor`]: anchor } } }
                        : e,
                ),
            );
        },
        [record],
    );

    /** Moves the label of a transition away from the middle of its arrow, undefined puts it back */
    const moveLabel = useCallback(
        (id: string, offset: { x: number; y: number } | undefined) => {
            record(`transition:${id}:labelOffset`);
            setEdges(eds =>
                eds.map(e =>
                    e.id === id && e.data
                        ? { ...e, data: { ...e.data, transition: { ...e.data.transition, labelOffset: offset } } }
                        : e,
                ),
            );
        },
        [record],
    );

    /** Selects a transition by its label, and shows its properties after a double click */
    const selectByLabel = useCallback(
        (id: string, properties: boolean) => {
            setNodes(nds => nds.map(n => (n.selected ? { ...n, selected: false } : n)));
            setEdges(eds => eds.map(e => (e.selected === (e.id === id) ? e : { ...e, selected: e.id === id })));
            if (properties) {
                showProperties();
            }
        },
        [showProperties],
    );

    /** Moves an end of a transition to another state (its grip was dropped on it) */
    const reconnectTransition = useCallback(
        (id: string, end: EdgeEnd, stateId: string) => {
            record(`transition:${id}:reconnect`);
            setDropTarget(null);
            setEdges(eds => {
                // a new source: the transition is checked after the other transitions of that state
                const priority = eds.filter(e => e.source === stateId && e.id !== id).length + 1;
                return eds.map(e => {
                    if (e.id !== id || !e.data) {
                        return e;
                    }
                    const moved = end === "source" ? { source: stateId } : { target: stateId };
                    const transition = {
                        ...e.data.transition,
                        ...moved,
                        // the end is placed automatically on the new state
                        [`${end}Anchor`]: undefined,
                        ...(end === "source" ? { priority } : {}),
                    };
                    return { ...e, ...moved, data: { ...e.data, transition } };
                });
            });
        },
        [record],
    );

    /**
     * Adds a node in the middle of the visible area and selects it
     *
     * @param create Creates the node at the given position
     * @param idPrefix Prefix of the ID of the new node
     * @returns ID of the new node
     */
    const addNode = (create: (id: string, x: number, y: number) => ChartFlowNode, idPrefix: string): string => {
        record();
        const id = createId(idPrefix, nodes);
        const { x, y } = reactFlow.screenToFlowPosition({ x: window.innerWidth / 3, y: window.innerHeight / 3 });
        setNodes(nds => [
            ...nds.map(n => ({ ...n, selected: false })),
            { ...create(id, Math.round(x), Math.round(y)), selected: true },
        ]);
        setEdges(eds => eds.map(e => ({ ...e, selected: false })));
        setPanelTab("properties");
        return id;
    };

    const addState = (): void => {
        const states = nodes.filter(n => n.type === "state");
        const id = addNode(
            (id, x, y) => ({
                id,
                type: "state",
                position: { x, y },
                width: DEFAULT_STATE_WIDTH,
                height: DEFAULT_STATE_HEIGHT,
                data: { state: { id, name: `${I18n.t("State")} ${states.length + 1}`, x, y } },
            }),
            "s",
        );
        if (!states.some(n => n.id === chart.initial)) {
            setChart(c => ({ ...c, initial: id }));
        }
    };

    const addNote = (): void => {
        addNode(
            (id, x, y) => ({
                id,
                type: "note",
                position: { x, y },
                width: DEFAULT_NOTE_WIDTH,
                height: DEFAULT_NOTE_HEIGHT,
                data: { note: { id, text: "", x, y } },
            }),
            "n",
        );
    };

    const addFunction = (): void => {
        addNode(
            (id, x, y) => ({
                id,
                type: "function",
                position: { x, y },
                width: DEFAULT_FUNCTION_WIDTH,
                height: DEFAULT_FUNCTION_HEIGHT,
                data: { fn: { id, code: "function myFunction(value) {\n    return value;\n}", x, y } },
            }),
            "f",
        );
    };

    const updateChart = (patch: Partial<Chart>): void => {
        // typing in the same field is one step
        record(`chart:${Object.keys(patch).join()}`);
        setChart(c => ({ ...c, ...patch }));
    };

    const updateState = (id: string, patch: Partial<ChartState>): void => {
        record(`state:${id}:${Object.keys(patch).join()}`);
        setNodes(nds =>
            nds.map(n =>
                n.id === id && n.type === "state" ? { ...n, data: { state: { ...n.data.state, ...patch } } } : n,
            ),
        );
    };

    const updateNote = (id: string, patch: Partial<ChartNote>): void => {
        record(`note:${id}:${Object.keys(patch).join()}`);
        setNodes(nds =>
            nds.map(n =>
                n.id === id && n.type === "note" ? { ...n, data: { note: { ...n.data.note, ...patch } } } : n,
            ),
        );
    };

    const updateFunction = (id: string, patch: Partial<ChartFunction>): void => {
        record(`function:${id}:${Object.keys(patch).join()}`);
        setNodes(nds =>
            nds.map(n =>
                n.id === id && n.type === "function" ? { ...n, data: { fn: { ...n.data.fn, ...patch } } } : n,
            ),
        );
    };

    const updateTransition = (id: string, patch: Partial<ChartTransition>): void => {
        record(`transition:${id}:${Object.keys(patch).join()}`);
        setEdges(eds =>
            eds.map(e =>
                e.id === id
                    ? {
                          ...e,
                          data: {
                              ...e.data,
                              transition: { ...e.data?.transition, ...patch, id, source: e.source, target: e.target },
                          },
                      }
                    : e,
            ),
        );
    };

    /**
     * @returns the chart as shown in the editor, including unsaved changes
     */
    const getCurrentChart = (): Chart => {
        const current = flowToChart(chart, nodes, edges);
        const topLevel = current.states.filter(s => !s.parent);
        if (!topLevel.some(s => s.id === current.initial)) {
            current.initial = topLevel[0]?.id;
        }
        return current;
    };

    const exportChart = (): void => downloadJson(`${chartId}.statechart.json`, createExport([getCurrentChart()]));

    const save = async (): Promise<void> => {
        const newChart = getCurrentChart();
        const version = history.version;
        setSaving(true);
        try {
            await onSave(newChart);
            setChart(c => ({ ...c, initial: newChart.initial }));
            history.markSaved(version);
        } finally {
            setSaving(false);
        }
    };

    const copy = (): boolean => {
        const content = copySelection(nodes, edges, getRect);
        if (content) {
            clipboard = content;
            pasteCount.current = 0;
            setHasClipboard(true);
        }
        return !!content;
    };

    const cut = (): void => {
        if (copy()) {
            void reactFlow.deleteElements({
                nodes: nodes.filter(n => n.selected).map(n => ({ id: n.id })),
                edges: edges.filter(e => e.selected).map(e => ({ id: e.id })),
            });
        }
    };

    const paste = (): void => {
        if (!clipboard) {
            return;
        }
        record();
        pasteCount.current++;
        const result = pasteClipboard(clipboard, nodes, edges, PASTE_OFFSET * pasteCount.current);
        setNodes(result.nodes);
        setEdges(result.edges);
        setPanelTab("properties");
    };

    // the keyboard shortcuts call the functions of the current render
    const shortcuts = useRef<Record<Shortcut, () => void>>({
        undo: history.undo,
        redo: history.redo,
        copy,
        cut,
        paste,
    });
    // eslint-disable-next-line react-hooks/refs
    shortcuts.current = { undo: history.undo, redo: history.redo, copy, cut, paste };

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            // text fields and code editors have their own undo, copy and paste
            if (!(e.ctrlKey || e.metaKey) || e.altKey || isTextInput(e.target)) {
                return;
            }
            const key = e.key.toLowerCase();
            const keys: Record<string, Shortcut> = { z: "undo", y: "redo", c: "copy", x: "cut", v: "paste" };
            const action = key === "z" && e.shiftKey ? "redo" : !e.shiftKey && keys[key];
            if (action) {
                e.preventDefault();
                shortcuts.current[action]();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    useEffect(() => {
        if (!changed) {
            return undefined;
        }
        // the browser asks before the page is closed or reloaded
        const onBeforeUnload = (e: BeforeUnloadEvent): void => {
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [changed]);

    useEffect(() => onChangedChange?.(changed), [changed, onChangedChange]);
    useEffect(() => {
        if (saveRef) {
            saveRef.current = save;
        }
    });

    const selectedNodes = nodes.filter(n => n.selected);
    const selectedEdges = edges.filter(e => e.selected);
    const selectedNode = selectedNodes.length === 1 && !selectedEdges.length ? selectedNodes[0] : null;
    const selectedState = selectedNode?.type === "state" ? selectedNode.data.state : null;
    const selectedFunction = selectedNode?.type === "function" ? selectedNode.data.fn : null;
    const selectedNote = selectedNode?.type === "note" ? selectedNode.data.note : null;
    const selectedTransition =
        selectedEdges.length === 1 && !selectedNodes.length ? selectedEdges[0].data?.transition || null : null;

    // add the information which is not stored in the nodes/edges themselves
    // only the code and the variables matter for the validation, not e.g. the positions which change while dragging
    /** everything the validation and the analysis use, but not the positions */
    const codeSignature = JSON.stringify([
        chart.symbols,
        chart.initial,
        chart.parallel,
        nodes.map(n => {
            if (n.type === "function") {
                return [n.id, n.data.fn.code];
            }
            if (n.type !== "state") {
                // notes have no code
                return null;
            }
            const { entry, during, exit, initial, parallel, order } = n.data.state;
            return [n.id, n.parentId, entry, during, exit, initial, parallel, order];
        }),
        edges.map(e => [e.id, e.source, e.target, e.data?.transition.label, e.data?.transition.priority]),
        edges.map(e => e.data?.transition.reenterParent),
    ]);
    const functionCodes = JSON.stringify(nodes.map(n => (n.type === "function" ? n.data.fn.code : null)));
    const { functions, declarations } = useMemo(() => {
        const fns = nodes.flatMap(n => (n.type === "function" ? [n.data.fn] : []));
        return {
            functions: fns,
            /** names declared in the function blocks, they can be used in all conditions and actions */
            declarations: fns.flatMap(fn => getDeclarations(fn.code)),
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [functionCodes]);

    /** translated problems by state/transition/function ID, and of the variables by name */
    const { problems, symbolProblems } = useMemo(() => {
        const byId = new Map<string, ProblemList>();
        const byName = new Map<string, ProblemList>();
        for (const { kind, id, field, diagnostic } of validateChart(flowToChart(chart, nodes, edges))) {
            const prefix = kind === "state" && field ? `${field}: ` : "";
            const message = prefix + translateDiagnostic(diagnostic);
            addProblem(kind === "symbol" ? byName : byId, id, message, diagnostic.severity);
        }
        return { problems: byId, symbolProblems: byName };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [codeSignature]);

    /**
     * Makes a state the initial state of its level: of its parent, or of the chart for top level states
     *
     * @param id ID of the state
     */
    const setInitial = (id: string): void => {
        const parentId = nodes.find(n => n.id === id)?.parentId;
        if (parentId) {
            updateState(parentId, { initial: id });
        } else {
            updateChart({ initial: id });
        }
    };

    const initialIds = useMemo(
        () => getInitialStateIds(nodes, chart.initial, chart.parallel),
        [nodes, chart.initial, chart.parallel],
    );
    const executionOrder = useMemo(() => getExecutionOrder(nodes, chart.parallel), [nodes, chart.parallel]);
    const exclusiveParents = useMemo(() => getExclusiveParentIds(nodes), [nodes]);
    const depths = useMemo(() => getNestingDepths(nodes), [nodes]);

    const displayNodes = useMemo(
        () =>
            nodes.map(n => ({
                ...n,
                // the extra fields are only read by the node components
                data: {
                    ...n.data,
                    isInitial: initialIds.has(n.id),
                    isActive: activeIds.includes(n.id),
                    isDropTarget: n.id === dropTarget,
                    problems: problems.get(n.id),
                    order: executionOrder.get(n.id),
                    // like the runtime, the history junction is only used with exclusive sub states
                    history: n.type === "state" && !!n.data.state.history && exclusiveParents.has(n.id),
                    breakpoint: breakpoints.has(n.id),
                    depth: depths.get(n.id),
                } as any,
            })),
        [nodes, initialIds, executionOrder, exclusiveParents, depths, activeIds, dropTarget, problems, breakpoints],
    );
    const displayEdges = useMemo(() => {
        const outgoing: Record<string, number> = {};
        edges.forEach(e => (outgoing[e.source] = (outgoing[e.source] || 0) + 1));
        const offsets = getParallelOffsets(edges);
        // the ends of a transition fixed by the user are not moved sideways, so its label stays on its arrow
        const labelStack = getLabelStackOffsets(
            edges
                .filter(e => !isValidAnchor(e.data?.transition.sourceAnchor))
                .filter(e => !isValidAnchor(e.data?.transition.targetAnchor))
                .map(e => ({
                    id: e.id,
                    source: e.source,
                    target: e.target,
                    lines: (e.data?.transition.label || "").split("\n").length,
                })),
        );
        return edges.map(e => {
            const toChild = isDescendantNode(nodes, e.source, e.target);
            const toParent = !toChild && isDescendantNode(nodes, e.target, e.source);
            return {
                ...e,
                // like the nodes: no zooming on double click and no panning when dragging the edge
                className: "nopan",
                markerEnd,
                data: {
                    ...e.data,
                    showPriority: outgoing[e.source] > 1,
                    // a transition to an own child which keeps the parent active
                    inner: toChild && !e.data?.transition.reenterParent,
                    nesting: toChild ? "toChild" : toParent ? "toParent" : undefined,
                    offset: offsets.get(e.id),
                    labelStack: labelStack.get(e.id),
                    orthogonal: !!chart.orthogonalTransitions,
                    problems: problems.get(e.id),
                    flash: flashing.has(e.id),
                    breakpoint: breakpoints.has(e.id),
                    onAnchorChange: changeAnchor,
                    onReconnect: reconnectTransition,
                    onReconnectPreview: setDropTarget,
                    onLabelMove: moveLabel,
                    onSelect: selectByLabel,
                },
            } as TransitionFlowEdge;
        });
    }, [
        edges,
        nodes,
        chart.orthogonalTransitions,
        problems,
        flashing,
        breakpoints,
        changeAnchor,
        reconnectTransition,
        moveLabel,
        selectByLabel,
    ]);

    /**
     * Selects a transition, e.g. from the history
     *
     * @param id ID of the transition
     */
    const selectTransition = (id: string): void => {
        setNodes(nds => nds.map(n => (n.selected ? { ...n, selected: false } : n)));
        setEdges(eds => eds.map(e => ({ ...e, selected: e.id === id })));
    };

    /** Color of the transitions and their arrowheads */
    const edgeColor = theme.palette.mode === "dark" ? theme.palette.common.white : theme.palette.common.black;

    return (
        <Box sx={{ display: "flex", height: "100%", minHeight: 0 }}>
            <GlobalStyles
                styles={{
                    // a taken transition: thick and colored, then back to normal
                    "@keyframes statechart-flash": {
                        from: { strokeWidth: 6, stroke: theme.palette.success.main },
                        to: { strokeWidth: 1, stroke: theme.palette.success.main },
                    },
                }}
            />
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <Toolbar
                    variant="dense"
                    sx={{ gap: 0.5, borderBottom: 1, borderColor: "divider" }}
                >
                    <ToolButton
                        title={`${I18n.t("Save")} (${changed ? I18n.t("unsaved changes") : I18n.t("no changes")})`}
                        icon={<SaveIcon />}
                        // highlighted when there is something to save
                        color={changed ? "primary" : "default"}
                        disabled={!changed || saving}
                        onClick={save}
                    />
                    <ToolButton
                        title={`${I18n.t("Copy")} (Ctrl+C)`}
                        icon={<CopyIcon />}
                        disabled={!nodes.some(n => n.selected)}
                        onClick={copy}
                    />
                    <ToolButton
                        title={`${I18n.t("Paste")} (Ctrl+V)`}
                        icon={<PasteIcon />}
                        disabled={!hasClipboard}
                        onClick={paste}
                    />
                    <ToolButton
                        title={`${I18n.t("Undo")} (Ctrl+Z)`}
                        icon={<UndoIcon />}
                        disabled={!history.canUndo}
                        onClick={history.undo}
                    />
                    <ToolButton
                        title={`${I18n.t("Redo")} (Ctrl+Y)`}
                        icon={<RedoIcon />}
                        disabled={!history.canRedo}
                        onClick={history.redo}
                    />
                    <Divider
                        orientation="vertical"
                        flexItem
                        sx={{ mx: 0.5 }}
                    />
                    {/* the anchor of the menu */}
                    <span ref={alignButton}>
                        <ToolButton
                            title={I18n.t("Align the selected elements")}
                            icon={<AlignLeftIcon />}
                            disabled={selectedNodes.length < 2}
                            onClick={() => setAlignMenu(alignButton.current)}
                        />
                    </span>
                    <Menu
                        anchorEl={alignMenu}
                        open={!!alignMenu}
                        onClose={() => setAlignMenu(null)}
                    >
                        {ALIGNMENTS.map(({ alignment, title, icon }) => (
                            <MenuItem
                                key={alignment}
                                dense
                                // distributing needs one in the middle
                                disabled={alignment.startsWith("distribute") && selectedNodes.length < 3}
                                onClick={() => align(alignment)}
                            >
                                <ListItemIcon>{icon}</ListItemIcon>
                                <ListItemText>{I18n.t(title)}</ListItemText>
                            </MenuItem>
                        ))}
                    </Menu>
                    <ToolButton
                        title={I18n.t("Show code")}
                        icon={<CodeIcon />}
                        onClick={() => setGeneratedCode(generateChartCode(flowToChart(chart, nodes, edges), chartId))}
                    />
                    <ToolButton
                        title={I18n.t("Add state")}
                        icon={<AddIcon />}
                        onClick={addState}
                    />
                    <ToolButton
                        title={I18n.t("Add function")}
                        icon={<FunctionIcon />}
                        onClick={addFunction}
                    />
                    <ToolButton
                        title={I18n.t("Add note")}
                        icon={<NoteIcon />}
                        onClick={addNote}
                    />
                    <Divider
                        orientation="vertical"
                        flexItem
                        sx={{ mx: 0.5 }}
                    />
                    <ToolButton
                        title={`${I18n.t("Export chart")}${changed ? ` (${I18n.t("including unsaved changes")})` : ""}`}
                        icon={<ExportIcon />}
                        onClick={exportChart}
                    />
                    <Divider
                        orientation="vertical"
                        flexItem
                        sx={{ mx: 0.5 }}
                    />
                    <ToolButton
                        title={I18n.t(showLive ? "Hide live values" : "Show live values")}
                        icon={<LiveIcon />}
                        color={showLive ? "primary" : "default"}
                        // the live values are needed to set the inputs of a simulation
                        disabled={simulating}
                        onClick={() => {
                            saveShowLive(!showLive);
                            setShowLive(!showLive);
                        }}
                    />
                    <ToolButton
                        title={I18n.t(simulating ? "Stop simulation" : "simulationStartTitle")}
                        icon={<SimulationIcon />}
                        color={simulating ? "warning" : "default"}
                        // the simulation runs the chart as shown, including unsaved changes
                        onClick={() =>
                            simulating
                                ? onSimulate("simulationStop")
                                : onSimulate("simulationStart", {
                                      chart: getCurrentChart(),
                                      breakpoints: [...breakpoints],
                                  })
                        }
                    />
                </Toolbar>
                <Box sx={{ flex: 1, minHeight: 0 }}>
                    <ReactFlow
                        nodes={displayNodes}
                        edges={displayEdges}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onNodeDoubleClick={showProperties}
                        onEdgeDoubleClick={showProperties}
                        onNodeDrag={onNodeDrag}
                        onNodeDragStop={onNodeDragStop}
                        // children above their parents, transitions of children above the parents as well
                        zIndexMode="auto"
                        // the grips to move the ends of the selected transition are on the borders of the states
                        elevateEdgesOnSelect
                        connectionMode={ConnectionMode.Loose}
                        colorMode={theme.palette.mode}
                        // black transitions instead of the gray of React Flow (white in the dark theme), the
                        // selected one in the primary color
                        style={
                            {
                                "--xy-edge-stroke": edgeColor,
                                "--xy-edge-stroke-selected": theme.palette.primary.main,
                            } as React.CSSProperties
                        }
                        defaultMarkerColor={edgeColor}
                        snapToGrid
                        snapGrid={[10, 10]}
                        deleteKeyCode={["Delete", "Backspace"]}
                        fitView
                        fitViewOptions={{ maxZoom: 1 }}
                    >
                        <Background />
                        <Controls />
                        <MiniMap
                            pannable
                            zoomable
                        />
                        {(showLive || simulating) && (
                            <Panel position="top-left">
                                <LiveValuesPanel
                                    symbols={chart.symbols}
                                    values={liveValues}
                                    simulating={simulating}
                                    onSetInput={(name, value) => onSimulate("simulationInput", { name, value })}
                                    onEvent={name => onSimulate("simulationEvent", { name })}
                                />
                            </Panel>
                        )}
                        {simulating && (
                            <Panel position="top-center">
                                <SimulationBar
                                    status={simulationStatus}
                                    onCommand={onSimulate}
                                />
                            </Panel>
                        )}
                    </ReactFlow>
                </Box>
            </Box>
            <ResizablePanel
                side="right"
                storageKey="statechart.propertiesWidth"
                defaultWidth={360}
                minWidth={260}
                maxWidth={900}
                label={I18n.t("Properties")}
                expandRequest={propertiesRequest}
            >
                <Tabs
                    value={panelTab}
                    onChange={(_e, value: string) => setPanelTab(value)}
                    variant="fullWidth"
                >
                    <Tab
                        value="properties"
                        label={I18n.t("Properties")}
                    />
                    <Tab
                        value="symbols"
                        label={I18n.t("Variables")}
                    />
                    <Tab
                        value="history"
                        label={I18n.t("History")}
                    />
                </Tabs>
                <Box sx={{ p: 2, overflow: "auto", flex: 1 }}>
                    {panelTab === "properties" ? (
                        <PropertiesPanel
                            chart={chart}
                            selectedState={selectedState}
                            selectedTransition={selectedTransition}
                            selectedFunction={selectedFunction}
                            selectedNote={selectedNote}
                            onNoteChange={updateNote}
                            isInitial={!!selectedState && initialIds.has(selectedState.id)}
                            executionOrder={selectedState ? executionOrder.get(selectedState.id) : undefined}
                            canHaveHistory={!!selectedState && exclusiveParents.has(selectedState.id)}
                            breakpoints={breakpoints}
                            onToggleBreakpoint={toggleBreakpoint}
                            toChild={
                                !!selectedTransition &&
                                isDescendantNode(nodes, selectedTransition.source, selectedTransition.target)
                            }
                            onSetInitial={setInitial}
                            functions={functions}
                            declarations={declarations}
                            onChartChange={updateChart}
                            onStateChange={updateState}
                            onTransitionChange={updateTransition}
                            onFunctionChange={updateFunction}
                            onDeleteNode={id => void reactFlow.deleteElements({ nodes: [{ id }] })}
                            onDeleteTransition={id => void reactFlow.deleteElements({ edges: [{ id }] })}
                        />
                    ) : panelTab === "symbols" ? (
                        <SymbolsEditor
                            symbols={chart.symbols}
                            problems={symbolProblems}
                            onChange={symbols => updateChart({ symbols })}
                            liveValues={liveValues}
                            socket={socket}
                            theme={theme}
                        />
                    ) : (
                        <HistoryPanel
                            history={chartHistory}
                            transitionIds={new Set(edges.map(e => e.id))}
                            onSelectTransition={selectTransition}
                            onClear={onClearHistory}
                        />
                    )}
                </Box>
            </ResizablePanel>
            {generatedCode !== null && (
                <GeneratedCodeDialog
                    code={generatedCode}
                    unsaved={changed}
                    onClose={() => setGeneratedCode(null)}
                />
            )}
        </Box>
    );
}

/**
 * Graphical editor for one chart
 *
 * @param props Component properties
 */
export default function ChartEditor(props: ChartEditorProps): React.JSX.Element {
    return (
        <ReactFlowProvider>
            <ChartEditorInner {...props} />
        </ReactFlowProvider>
    );
}
