/*
 * Conversion between the chart model (src/lib/chart-model.ts) and the nodes/edges of React Flow
 */

import type { Edge, Node } from "@xyflow/react";
import type { Chart, ChartFunction, ChartNote, ChartState, ChartTransition } from "../../src/lib/chart-model";
import { sortByOrder } from "../../src/lib/chart-structure";

export type StateFlowNode = Node<{ state: ChartState }, "state">;
export type FunctionFlowNode = Node<{ fn: ChartFunction }, "function">;
export type NoteFlowNode = Node<{ note: ChartNote }, "note">;
export type ChartFlowNode = StateFlowNode | FunctionFlowNode | NoteFlowNode;
export type TransitionFlowEdge = Edge<{ transition: ChartTransition }>;

export const DEFAULT_STATE_WIDTH = 180;
export const DEFAULT_STATE_HEIGHT = 90;
export const DEFAULT_FUNCTION_WIDTH = 260;
export const DEFAULT_FUNCTION_HEIGHT = 120;
export const DEFAULT_NOTE_WIDTH = 200;
export const DEFAULT_NOTE_HEIGHT = 100;

/** Background color of states without their own color (ChartState.color) */
export const DEFAULT_STATE_COLOR = "#fcf3cf";

/** Colors offered for states, light enough for black text. The first one is the default. */
export const STATE_COLORS = [
    DEFAULT_STATE_COLOR, // yellow
    "#d6eaf8", // blue
    "#d5f5e3", // green
    "#fde3cf", // orange
    "#fadbd8", // red
    "#e8daef", // purple
    "#eaeded", // gray
    "#ffffff", // white
];

/**
 * @param color Background color of a state, see ChartState.color
 * @param dark The editor uses the dark theme
 * @param depth Nesting depth of the state, 0 for top level states
 * @returns the color to show. Every second level (sub states of top level states, their sub sub sub states...)
 *   is darker, so nested states stand out from their parents, also with the same color. In the dark theme, a dark
 *   shade of the color is shown, so the light text stays readable, and every second level is lighter.
 */
export function stateBackground(color: string | undefined, dark: boolean, depth = 0): string {
    const hex = color || DEFAULT_STATE_COLOR;
    const alternate = depth % 2 === 1;
    const channels = [1, 3, 5].map(i => parseInt(hex.substring(i, i + 2), 16));
    let rgb: number[];
    if (dark) {
        // mix the color with the dark background of the editor: 25%, or 35% on every second level
        const share = alternate ? 0.35 : 0.25;
        rgb = channels.map(c => c * share + 0x1e * (1 - share));
    } else {
        rgb = alternate ? channels.map(c => c * 0.9) : channels;
    }
    return `#${rgb.map(c => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * @param nodes The nodes of React Flow
 * @returns the nesting depth of each node by ID, 0 for nodes without parent
 */
export function getNestingDepths(nodes: { id: string; parentId?: string }[]): Map<string, number> {
    const byId = new Map(nodes.map(n => [n.id, n]));
    const depths = new Map<string, number>();
    for (const node of nodes) {
        let depth = 0;
        // the limit protects against cycles in broken charts
        for (let parent = node.parentId; parent && depth < nodes.length; depth++) {
            parent = byId.get(parent)?.parentId;
        }
        depths.set(node.id, depth);
    }
    return depths;
}

/** Node types which can be placed in a state (and move together with it) */
const NESTABLE_TYPES = ["state", "note"];

/** Prefix of the IDs of new nodes */
export const ID_PREFIXES = { state: "s", function: "f", note: "n" };

/**
 * @param chart The chart
 */
export function chartToFlow(chart: Chart): { nodes: ChartFlowNode[]; edges: TransitionFlowEdge[] } {
    const stateIds = new Set(chart.states.map(s => s.id));
    const states: StateFlowNode[] = chart.states.map(state => ({
        id: state.id,
        type: "state",
        // like in React Flow, the position of a child is relative to its parent
        position: { x: state.x, y: state.y },
        width: state.width || DEFAULT_STATE_WIDTH,
        height: state.height || DEFAULT_STATE_HEIGHT,
        ...(state.parent && stateIds.has(state.parent) ? { parentId: state.parent, expandParent: true } : {}),
        data: { state },
    }));
    const functions: FunctionFlowNode[] = (chart.functions || []).map(fn => ({
        id: fn.id,
        type: "function",
        position: { x: fn.x, y: fn.y },
        width: fn.width || DEFAULT_FUNCTION_WIDTH,
        height: fn.height || DEFAULT_FUNCTION_HEIGHT,
        data: { fn },
    }));
    const notes: NoteFlowNode[] = (chart.notes || []).map(note => ({
        id: note.id,
        type: "note",
        position: { x: note.x, y: note.y },
        width: note.width || DEFAULT_NOTE_WIDTH,
        height: note.height || DEFAULT_NOTE_HEIGHT,
        ...(note.parent && stateIds.has(note.parent) ? { parentId: note.parent, expandParent: true } : {}),
        data: { note },
    }));
    return {
        nodes: sortParentsFirst<ChartFlowNode>([...states, ...functions, ...notes]),
        edges: chart.transitions.map(transition => ({
            id: transition.id,
            type: "transition",
            source: transition.source,
            target: transition.target,
            sourceHandle: transition.sourceHandle,
            targetHandle: transition.targetHandle,
            data: { transition },
        })),
    };
}

function getGeometry(
    node: ChartFlowNode,
    defaultWidth: number,
    defaultHeight: number,
): { id: string; x: number; y: number; width: number; height: number } {
    return {
        id: node.id,
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
        width: Math.round(node.width ?? node.measured?.width ?? defaultWidth),
        height: Math.round(node.height ?? node.measured?.height ?? defaultHeight),
    };
}

/**
 * Writes positions, sizes and connections from React Flow back into the chart
 *
 * @param chart Chart with the chart level properties (name, symbols, ...)
 * @param nodes The nodes of React Flow
 * @param edges The edges of React Flow
 */
export function flowToChart(chart: Chart, nodes: ChartFlowNode[], edges: TransitionFlowEdge[]): Chart {
    const states: ChartState[] = [];
    const functions: ChartFunction[] = [];
    const notes: ChartNote[] = [];
    for (const node of nodes) {
        if (node.type === "function") {
            functions.push({
                ...node.data.fn,
                ...getGeometry(node, DEFAULT_FUNCTION_WIDTH, DEFAULT_FUNCTION_HEIGHT),
            });
        } else if (node.type === "note") {
            notes.push({
                ...node.data.note,
                ...getGeometry(node, DEFAULT_NOTE_WIDTH, DEFAULT_NOTE_HEIGHT),
                parent: node.parentId || null,
            });
        } else {
            states.push({
                ...node.data.state,
                ...getGeometry(node, DEFAULT_STATE_WIDTH, DEFAULT_STATE_HEIGHT),
                parent: node.parentId || null,
            });
        }
    }
    return {
        ...chart,
        states,
        functions,
        notes,
        transitions: edges.map(edge => ({
            ...edge.data?.transition,
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle ?? undefined,
            targetHandle: edge.targetHandle ?? undefined,
        })),
    };
}

/**
 * React Flow requires parents to be before their children in the list of nodes
 *
 * @param nodes The nodes to sort
 */
export function sortParentsFirst<T extends { id: string; parentId?: string }>(nodes: T[]): T[] {
    const byId = new Map(nodes.map(n => [n.id, n]));
    const depth = (node: T): number => {
        let d = 0;
        for (let parent = node.parentId; parent && d <= nodes.length; d++) {
            parent = byId.get(parent)?.parentId;
        }
        return d;
    };
    // the sort is stable, so the order of the states on the same level is kept
    return [...nodes].sort((a, b) => depth(a) - depth(b));
}

/**
 * @param nodes All nodes
 * @param ancestorId ID of the possible ancestor
 * @param id ID of the possible descendant
 * @returns true if node "id" is a (direct or indirect) child of node "ancestorId"
 */
export function isDescendantNode(nodes: { id: string; parentId?: string }[], ancestorId: string, id: string): boolean {
    const byId = new Map(nodes.map(n => [n.id, n]));
    let parent = byId.get(id)?.parentId;
    for (let i = 0; parent && i < nodes.length; i++) {
        if (parent === ancestorId) {
            return true;
        }
        parent = byId.get(parent)?.parentId;
    }
    return false;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Finds the state a node is dropped into: the smallest state which contains the center of the node.
 * The node itself, its children and function blocks are no candidates.
 *
 * @param nodes All nodes
 * @param id ID of the dragged node
 * @param getRect Absolute position and size of a node
 * @returns ID of the new parent, null for the top level
 */
export function findDropParent(
    nodes: ChartFlowNode[],
    id: string,
    getRect: (id: string) => Rect | null,
): string | null {
    const rect = getRect(id);
    if (!rect) {
        return null;
    }
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    let best = null;
    let bestArea = Infinity;
    for (const node of nodes) {
        if (node.type !== "state" || node.id === id || isDescendantNode(nodes, id, node.id)) {
            continue;
        }
        const r = getRect(node.id);
        if (
            r &&
            cx >= r.x &&
            cx <= r.x + r.width &&
            cy >= r.y &&
            cy <= r.y + r.height &&
            r.width * r.height < bestArea
        ) {
            best = node.id;
            bestArea = r.width * r.height;
        }
    }
    return best;
}

/**
 * Moves dragged states and notes into the state they were dropped into, or out of their parent.
 * The positions are converted, so they stay where they were dropped.
 *
 * @param nodes All nodes
 * @param draggedIds IDs of the dragged nodes
 * @param getRect Absolute position and size of a node (before the change)
 * @returns the same array if nothing changed
 */
export function reparentNodes(
    nodes: ChartFlowNode[],
    draggedIds: string[],
    getRect: (id: string) => Rect | null,
): ChartFlowNode[] {
    let result = nodes;
    for (const id of draggedIds) {
        const node = result.find(n => n.id === id);
        // a child dragged together with its parent stays in it
        if (!node || !NESTABLE_TYPES.includes(node.type) || (node.parentId && draggedIds.includes(node.parentId))) {
            continue;
        }
        const parentId = findDropParent(result, id, getRect);
        const rect = getRect(id);
        if ((node.parentId || null) === parentId || !rect) {
            continue;
        }
        const parentRect = parentId ? getRect(parentId) : null;
        const moved: ChartFlowNode = {
            ...node,
            position: { x: rect.x - (parentRect?.x ?? 0), y: rect.y - (parentRect?.y ?? 0) },
        };
        if (parentId) {
            moved.parentId = parentId;
            moved.expandParent = true;
        } else {
            delete moved.parentId;
            delete moved.expandParent;
        }
        result = result.map(n => (n.id === id ? moved : n));
    }
    return result === nodes ? nodes : sortParentsFirst(result);
}

/**
 * The initial state of every level: the configured one if it is valid, otherwise the first state,
 * exactly like the runtime does it. Parallel levels have no initial state, all their states are active.
 *
 * @param nodes All nodes
 * @param chartInitial Initial state of the top level
 * @param chartParallel If the top level states are parallel
 * @returns IDs of all initial states
 */
export function getInitialStateIds(
    nodes: ChartFlowNode[],
    chartInitial: string | undefined,
    chartParallel = false,
): Set<string> {
    /** children by parent ID, "" for the top level */
    const children = new Map<string, string[]>();
    /** configured initial state by parent ID */
    const configured = new Map<string, string | undefined>([["", chartInitial]]);
    for (const node of nodes) {
        if (node.type !== "state") {
            continue;
        }
        const parent = node.parentId || "";
        children.set(parent, [...(children.get(parent) || []), node.id]);
        configured.set(node.id, node.data.state.initial);
    }
    const parallel = getParallelLevels(nodes, chartParallel);
    const result = new Set<string>();
    for (const [parent, ids] of children) {
        if (parallel.has(parent)) {
            continue;
        }
        const initial = configured.get(parent);
        result.add(initial && ids.includes(initial) ? initial : ids[0]);
    }
    return result;
}

/**
 * @param nodes All nodes
 * @param chartParallel If the top level states are parallel
 * @returns IDs of the states with parallel children, "" for the top level
 */
function getParallelLevels(nodes: ChartFlowNode[], chartParallel: boolean): Set<string> {
    const levels = new Set(nodes.flatMap(n => (n.type === "state" && n.data.state.parallel ? [n.id] : [])));
    if (chartParallel) {
        levels.add("");
    }
    return levels;
}

/**
 * @param nodes All nodes
 * @returns IDs of the states with exclusive (OR) sub states, only they can have a history junction
 */
export function getExclusiveParentIds(nodes: ChartFlowNode[]): Set<string> {
    const parallel = getParallelLevels(nodes, false);
    const result = new Set<string>();
    for (const node of nodes) {
        if (node.type === "state" && node.parentId && !parallel.has(node.parentId)) {
            result.add(node.parentId);
        }
    }
    return result;
}

/**
 * The execution order of the parallel states, as the runtime uses it
 *
 * @param nodes All nodes
 * @param chartParallel If the top level states are parallel
 * @returns the position (1, 2, ...) among its siblings of each state whose parent is parallel
 */
export function getExecutionOrder(nodes: ChartFlowNode[], chartParallel = false): Map<string, number> {
    const parallel = getParallelLevels(nodes, chartParallel);
    /** the states of parallel levels by parent ID, "" for the top level */
    const siblings = new Map<string, ChartState[]>();
    for (const node of nodes) {
        const parent = node.parentId || "";
        if (node.type === "state" && parallel.has(parent)) {
            siblings.set(parent, [...(siblings.get(parent) || []), node.data.state]);
        }
    }
    const result = new Map<string, number>();
    for (const states of siblings.values()) {
        sortByOrder(states).forEach((state, i) => result.set(state.id, i + 1));
    }
    return result;
}

/**
 * Creates an ID which is not used yet
 *
 * @param prefix Prefix of the ID, e.g. "s" for states
 * @param existing The elements with the IDs in use
 */
export function createId(prefix: string, existing: { id: string }[]): string {
    const ids = new Set(existing.map(item => item.id));
    let i = existing.length + 1;
    while (ids.has(`${prefix}${i}`)) {
        i++;
    }
    return `${prefix}${i}`;
}

/**
 * Copied states, function blocks and transitions
 */
export interface ClipboardContent {
    nodes: ChartFlowNode[];
    edges: TransitionFlowEdge[];
}

/**
 * Copies the selected states and function blocks, together with the sub states of copied states
 * and the transitions between copied states
 *
 * @param nodes All nodes
 * @param edges All edges
 * @param getRect Absolute position and size of a node
 * @returns null if nothing is selected
 */
export function copySelection(
    nodes: ChartFlowNode[],
    edges: TransitionFlowEdge[],
    getRect: (id: string) => Rect | null,
): ClipboardContent | null {
    const selected = new Set(nodes.filter(n => n.selected).map(n => n.id));
    const copied = new Set(
        nodes
            .filter(n => selected.has(n.id) || [...selected].some(id => isDescendantNode(nodes, id, n.id)))
            .map(n => n.id),
    );
    if (!copied.size) {
        return null;
    }
    const copiedNodes: ChartFlowNode[] = [];
    for (const node of nodes) {
        if (!copied.has(node.id)) {
            continue;
        }
        // a copy which is independent of the editor state
        const copy = {
            ...node,
            selected: false,
            data: JSON.parse(JSON.stringify(node.data)),
        } as ChartFlowNode;
        if (node.parentId && !copied.has(node.parentId)) {
            // the parent is not copied: the copy is a top level state at the same place
            const rect = getRect(node.id);
            copy.position = rect ? { x: rect.x, y: rect.y } : { ...node.position };
            delete copy.parentId;
            delete copy.expandParent;
        }
        copiedNodes.push(copy);
    }
    const copiedEdges = edges
        .filter(e => copied.has(e.source) && copied.has(e.target))
        .map(e => ({ ...e, selected: false, data: JSON.parse(JSON.stringify(e.data)) }));
    return { nodes: copiedNodes, edges: copiedEdges };
}

/**
 * Inserts copied elements with new IDs, moved by an offset. The inserted elements are selected,
 * all others are deselected.
 *
 * @param clipboard The copied elements
 * @param nodes All nodes
 * @param edges All edges
 * @param offset Added to the position of the inserted top level elements
 */
export function pasteClipboard(
    clipboard: ClipboardContent,
    nodes: ChartFlowNode[],
    edges: TransitionFlowEdge[],
    offset: number,
): { nodes: ChartFlowNode[]; edges: TransitionFlowEdge[] } {
    /** old ID -> new ID */
    const ids = new Map<string, string>();
    /** all IDs in use, to create unique ones */
    const used: { id: string }[] = [...nodes];
    for (const node of clipboard.nodes) {
        const id = createId(ID_PREFIXES[node.type], used);
        ids.set(node.id, id);
        used.push({ id });
    }

    const pasted = clipboard.nodes.map((node): ChartFlowNode => {
        const id = ids.get(node.id) as string;
        const parentId = node.parentId ? ids.get(node.parentId) : undefined;
        // children keep their position relative to the (copied) parent
        const position = parentId ? { ...node.position } : { x: node.position.x + offset, y: node.position.y + offset };
        if (node.type === "function") {
            return { ...node, id, position, selected: true, data: { fn: { ...node.data.fn, id } } };
        }
        let copy: ChartFlowNode;
        if (node.type === "note") {
            copy = {
                ...node,
                id,
                position,
                selected: true,
                data: { note: { ...node.data.note, id, parent: parentId ?? null } },
            };
        } else {
            const state = { ...node.data.state, id, parent: parentId ?? null };
            if (state.initial) {
                state.initial = ids.get(state.initial);
            }
            copy = { ...node, id, position, selected: true, data: { state } };
        }
        if (parentId) {
            copy.parentId = parentId;
        } else {
            delete copy.parentId;
            delete copy.expandParent;
        }
        return copy;
    });

    const usedEdges: { id: string }[] = [...edges];
    const pastedEdges = clipboard.edges.map((edge): TransitionFlowEdge => {
        const id = createId("t", usedEdges);
        usedEdges.push({ id });
        const source = ids.get(edge.source) as string;
        const target = ids.get(edge.target) as string;
        return {
            ...edge,
            id,
            source,
            target,
            selected: true,
            data: { transition: { ...edge.data?.transition, id, source, target } },
        };
    });

    return {
        nodes: sortParentsFirst([...nodes.map(n => ({ ...n, selected: false })), ...pasted]),
        edges: [...edges.map(e => ({ ...e, selected: false })), ...pastedEdges],
    };
}

/** How selected nodes are aligned or distributed */
export type Alignment = "left" | "centerX" | "right" | "top" | "centerY" | "bottom" | "distributeX" | "distributeY";

/**
 * Aligns rectangles, e.g. at the left border of the leftmost one, or distributes them with equal gaps between
 * the outermost ones
 *
 * @param rects The absolute positions and sizes by ID
 * @param alignment How they are aligned
 * @returns the new absolute positions by ID, only of the rectangles which are moved
 */
export function alignRects(rects: Map<string, Rect>, alignment: Alignment): Map<string, { x: number; y: number }> {
    const list = [...rects.entries()].map(([id, rect]) => ({ id, ...rect }));
    const result = new Map<string, { x: number; y: number }>();
    const set = (id: string, x: number, y: number): void => {
        const rect = rects.get(id)!;
        if (Math.round(x) !== Math.round(rect.x) || Math.round(y) !== Math.round(rect.y)) {
            result.set(id, { x: Math.round(x), y: Math.round(y) });
        }
    };
    if (list.length < 2) {
        return result;
    }
    const left = Math.min(...list.map(r => r.x));
    const right = Math.max(...list.map(r => r.x + r.width));
    const top = Math.min(...list.map(r => r.y));
    const bottom = Math.max(...list.map(r => r.y + r.height));

    if (alignment === "distributeX" || alignment === "distributeY") {
        const horizontal = alignment === "distributeX";
        const start = (r: Rect): number => (horizontal ? r.x : r.y);
        const size = (r: Rect): number => (horizontal ? r.width : r.height);
        // the outermost ones stay where they are
        const sorted = [...list].sort((a, b) => start(a) - start(b));
        const total = (horizontal ? right - left : bottom - top) - sorted.reduce((sum, r) => sum + size(r), 0);
        const gap = total / (sorted.length - 1);
        let position = horizontal ? left : top;
        for (const rect of sorted) {
            set(rect.id, horizontal ? position : rect.x, horizontal ? rect.y : position);
            position += size(rect) + gap;
        }
        return result;
    }

    for (const r of list) {
        switch (alignment) {
            case "left":
                set(r.id, left, r.y);
                break;
            case "centerX":
                set(r.id, (left + right) / 2 - r.width / 2, r.y);
                break;
            case "right":
                set(r.id, right - r.width, r.y);
                break;
            case "top":
                set(r.id, r.x, top);
                break;
            case "centerY":
                set(r.id, r.x, (top + bottom) / 2 - r.height / 2);
                break;
            case "bottom":
                set(r.id, r.x, bottom - r.height);
                break;
        }
    }
    return result;
}
