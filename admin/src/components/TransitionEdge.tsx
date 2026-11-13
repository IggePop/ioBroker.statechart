import React, { memo, useEffect, useRef, useState } from "react";
import {
    BaseEdge,
    EdgeLabelRenderer,
    getBezierPath,
    getSmoothStepPath,
    useInternalNode,
    useReactFlow,
} from "@xyflow/react";
import type { Edge, EdgeProps, InternalNode, Position } from "@xyflow/react";
import { Box, useTheme } from "@mui/material";
import { I18n } from "@iobroker/adapter-react-v5";
import type { ChartTransition, EdgeAnchor } from "../../../src/lib/chart-model";
import {
    DIRECTIONS,
    LABEL_LINE_HEIGHT,
    anchorPoint,
    getFloatingEdgeEnds,
    getLoopEnds,
    getLoopPath,
    isValidAnchor,
    leaderLineEnd,
    loopLabelTransform,
    nearestAnchor,
} from "../floating-edges";
import type { Box as Rect, Point } from "../floating-edges";
import CommentBadge from "./CommentBadge";
import ProblemBadge, { getProblemColor } from "./ProblemBadge";
import type { ProblemList } from "./ProblemBadge";

/**
 * @param node A node as React Flow shows it
 * @returns its absolute position and size, null if it is not measured yet
 */
function getBox(node: InternalNode | undefined): Rect | null {
    const width = node?.measured.width ?? node?.width;
    const height = node?.measured.height ?? node?.height;
    if (!node || !width || !height) {
        return null;
    }
    return { ...node.internals.positionAbsolute, width, height };
}

/** Right-angled transitions: distance from the state before the first bend, if the target is behind the start */
const ORTHOGONAL_OFFSET = 20;

/** A label dropped closer to the middle of its arrow goes back there */
const LABEL_SNAP = 8;
/** From this distance on, a moved label is connected to its arrow by a line */
const LEADER_FROM = 30;

/** Which end of a transition */
export type EdgeEnd = "source" | "target";

type TransitionEdgeProps = EdgeProps<
    Edge<{
        transition: ChartTransition;
        showPriority?: boolean;
        inner?: boolean;
        /** "toChild": the target is a child of the source, "toParent": the source is a child of the target */
        nesting?: "toChild" | "toParent";
        /** moves the edge sideways, if there are several edges between the same states */
        offset?: number;
        /** vertical position of the label relative to the middle between the edges, see getLabelStackOffsets */
        labelStack?: number;
        /** right angles instead of a curve, see Chart.orthogonalTransitions */
        orthogonal?: boolean;
        /** the transition was just taken by the running chart */
        flash?: boolean;
        /** the simulation stops when the transition is taken */
        breakpoint?: boolean;
        problems?: ProblemList;
        /** Fixes an end on the border of its state, undefined makes it automatic again */
        onAnchorChange?: (id: string, end: EdgeEnd, anchor: EdgeAnchor | undefined) => void;
        /** Moves an end to another state */
        onReconnect?: (id: string, end: EdgeEnd, stateId: string) => void;
        /** Called while an end is dragged over another state, to highlight it (null: over no other state) */
        onReconnectPreview?: (stateId: string | null) => void;
        /** Moves the label away from the middle of the arrow, undefined puts it back */
        onLabelMove?: (id: string, offset: Point | undefined) => void;
        /** Selects the transition (click on the label), and shows its properties (double click) */
        onSelect?: (id: string, showProperties: boolean) => void;
    }>
>;

/**
 * @param x Screen position
 * @param y Screen position
 * @param ownState The state the dragged end is on
 * @returns the innermost state under the position, null if it is the own state or there is none
 */
function otherStateAt(x: number, y: number, ownState: string): string | null {
    for (const element of document.elementsFromPoint(x, y)) {
        // React Flow adds the type of the node to its class name
        const node = element.closest(".react-flow__node-state");
        if (node instanceof HTMLElement && node.dataset.id) {
            return node.dataset.id === ownState ? null : node.dataset.id;
        }
    }
    return null;
}

interface EndGripProps {
    /** Where the grip is */
    point: Point;
    /** The state the end is on, it is moved along its border */
    box: Rect;
    /** ID of that state */
    stateId: string;
    /** If the end is fixed by the user (filled grip) or placed automatically (hollow grip) */
    fixed: boolean;
    /** Called with the new anchor while dragging along the border, with undefined on a double click */
    onChange: (anchor: EdgeAnchor | undefined) => void;
    /** Called while the grip is dragged over another state (with the pointer), null when it is not anymore */
    onPreview: (preview: { point: Point; stateId: string } | null) => void;
    /** Called when the grip is dropped on another state */
    onReconnect: (stateId: string) => void;
}

/**
 * A grip at an end of the selected transition: dragged along the border of its state it fixes the end there,
 * dropped on another state it moves the end to that state
 *
 * @param props Component properties, see EndGripProps
 * @param props.point Where the grip is
 * @param props.box The state the end is on
 * @param props.stateId ID of that state
 * @param props.fixed If the end is fixed by the user
 * @param props.onChange Called with the new anchor while dragging along the border
 * @param props.onPreview Called while the grip is dragged over another state
 * @param props.onReconnect Called when the grip is dropped on another state
 */
function EndGrip({ point, box, stateId, fixed, onChange, onPreview, onReconnect }: EndGripProps): React.JSX.Element {
    const { screenToFlowPosition } = useReactFlow();
    const theme = useTheme();

    const onPointerDown = (e: React.PointerEvent<SVGCircleElement>): void => {
        // React Flow must neither pan nor select something else
        e.stopPropagation();
        e.preventDefault();
        const grip = e.currentTarget;
        grip.setPointerCapture(e.pointerId);
        /** the other state the grip is over */
        let over: string | null = null;
        const move = (ev: PointerEvent): void => {
            const position = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
            over = otherStateAt(ev.clientX, ev.clientY, stateId);
            if (over) {
                onPreview({ point: position, stateId: over });
            } else {
                onPreview(null);
                onChange(nearestAnchor(box, position));
            }
        };
        const stop = (ev: PointerEvent): void => {
            grip.removeEventListener("pointermove", move);
            grip.removeEventListener("pointerup", stop);
            grip.removeEventListener("pointercancel", stop);
            onPreview(null);
            // a cancelled drag (e.g. by the system) does not move the transition
            if (ev.type === "pointerup" && over) {
                onReconnect(over);
            }
        };
        grip.addEventListener("pointermove", move);
        grip.addEventListener("pointerup", stop);
        grip.addEventListener("pointercancel", stop);
    };

    return (
        <circle
            // statechart-grip: not part of an exported image
            className="nodrag nopan statechart-grip"
            cx={point.x}
            cy={point.y}
            r={6}
            onPointerDown={onPointerDown}
            onDoubleClick={e => {
                e.stopPropagation();
                onChange(undefined);
            }}
            style={{
                cursor: "move",
                pointerEvents: "all",
                // fixed: filled with the primary color, automatic: hollow
                fill: fixed ? theme.palette.primary.main : theme.palette.background.paper,
                stroke: fixed ? theme.palette.primary.main : theme.palette.text.secondary,
                strokeWidth: 2,
            }}
        >
            <title>{I18n.t(fixed ? "endGripFixed" : "endGripAutomatic")}</title>
        </circle>
    );
}

function TransitionEdge(props: TransitionEdgeProps): React.JSX.Element {
    const {
        id,
        source,
        target,
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        markerEnd,
        style,
        selected,
        data,
    } = props;
    const transition = data?.transition;
    const sourceNode = useInternalNode(source);
    const targetNode = useInternalNode(target);
    const sourceBox = getBox(sourceNode);
    const targetBox = getBox(targetNode);
    // React Flow draws all labels in one layer below the states, so a superstate would cover the labels of the
    // transitions inside it. A label is above the states it connects, and above their parents.
    const labelZIndex = Math.max(sourceNode?.internals.z ?? 0, targetNode?.internals.z ?? 0) + 1;
    const sourceAnchor = isValidAnchor(transition?.sourceAnchor) ? transition.sourceAnchor : undefined;
    const targetAnchor = isValidAnchor(transition?.targetAnchor) ? transition.targetAnchor : undefined;
    /** an end dragged over another state: the edge is drawn to the pointer */
    const [preview, setPreview] = useState<{ end: EdgeEnd; point: Point } | null>(null);
    /** the offset of the label while it is dragged, it is stored when it is dropped */
    const [labelDrag, setLabelDrag] = useState<Point | null>(null);
    /** the label, its size is measured so the line to a moved label ends at its border */
    const labelRef = useRef<HTMLDivElement>(null);
    const [labelSize, setLabelSize] = useState<{ width: number; height: number } | null>(null);
    // like the condition for rendering the label below, the priority is shown if the source has several transitions
    const hasLabel = !!(
        data?.showPriority ||
        transition?.label ||
        transition?.comment?.trim() ||
        data?.breakpoint ||
        data?.problems
    );
    useEffect(() => {
        const element = labelRef.current;
        if (!element) {
            return undefined;
        }
        // offsetWidth/offsetHeight are not scaled by the zoom, they are in the coordinates of the flow
        const observer = new ResizeObserver(() =>
            setLabelSize({ width: element.offsetWidth, height: element.offsetHeight }),
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [hasLabel]);
    const { screenToFlowPosition } = useReactFlow();

    // floating edges: the ends are on the borders of the states, facing each other, unless the user fixed them
    // by dragging. The handles are only used to create transitions, and for the side of self transitions.
    // Until the states are measured, the positions of the handles are used.
    let path: string;
    let labelX: number;
    let labelY: number;
    /** moves the label up or down, if it is stacked with the labels of other edges between the same states */
    let stackY = 0;
    let start = { x: sourceX, y: sourceY };
    let end = { x: targetX, y: targetY };
    /** where the grip of a self transition is, it moves the whole loop */
    let loopAnchor: Point | null = null;
    /** how the label is placed relative to its point: centered, or next to a self transition */
    let labelAlign = "translate(-50%, -50%)";
    /** the side of a self transition, its label is next to its point on this side instead of centered */
    let loopSide: Position | null = null;
    if (source === target) {
        const side = (sourceAnchor?.side as Position | undefined) ?? sourcePosition;
        loopSide = side;
        const ends = sourceBox ? getLoopEnds(sourceBox, side, sourceAnchor?.pos) : null;
        start = ends?.start ?? start;
        end = ends?.end ?? end;
        loopAnchor = sourceBox ? anchorPoint(sourceBox, { side, pos: sourceAnchor?.pos ?? 0.5 }) : null;
        const loop = getLoopPath(start, end, side, data?.orthogonal);
        path = loop.path;
        ({ x: labelX, y: labelY } = loop.label);
        // the label is next to the loop, on its outer side
        labelAlign = loopLabelTransform(side);
    } else {
        const ends =
            sourceBox && targetBox
                ? getFloatingEdgeEnds(
                      sourceBox,
                      targetBox,
                      data?.nesting,
                      data?.offset,
                      sourceAnchor,
                      targetAnchor,
                      data?.orthogonal,
                  )
                : { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition };
        start = { x: ends.sourceX, y: ends.sourceY };
        end = { x: ends.targetX, y: ends.targetY };
        // right angles: horizontal and vertical lines with slightly rounded corners, otherwise a curve
        [path, labelX, labelY] = data?.orthogonal
            ? getSmoothStepPath({ ...ends, borderRadius: 8, offset: ORTHOGONAL_OFFSET })
            : getBezierPath(ends);
        if (data?.labelStack !== undefined && sourceBox && targetBox) {
            // several edges between the same states: their labels are stacked instead of covering each other
            const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
            // vertical part of the sideways shift of the edge (see shift() in floating-edges)
            const shiftY = ((end.x - start.x) / length) * (data.offset ?? 0);
            // the stack is in the order of the arrows from the smaller to the larger node ID, from top to bottom if
            // that direction points to the right, from bottom to top otherwise
            const pointsLeft = (source < target ? 1 : -1) * (end.x - start.x) < 0;
            stackY = (pointsLeft ? -data.labelStack : data.labelStack) - shiftY;
        }
    }
    if (preview) {
        // a straight line from the end which stays to the pointer
        const from = preview.end === "source" ? end : start;
        path = `M ${from.x} ${from.y} L ${preview.point.x} ${preview.point.y}`;
    }

    const labelOffset = labelDrag ?? transition?.labelOffset ?? { x: 0, y: 0 };
    /** where the label belongs to, the middle of the arrow */
    const anchor = { x: labelX, y: labelY };
    labelX += labelOffset.x;
    labelY += labelOffset.y + stackY;

    // a moved label is connected to its arrow by a line, which ends at the border of the label, not in its text
    let leaderEnd: Point | null = null;
    if (Math.hypot(labelOffset.x, labelOffset.y) >= LEADER_FROM && !preview) {
        const width = labelSize?.width ?? 0;
        const height = labelSize?.height ?? 0;
        // the center of the label: on its point, or beside it for a self transition
        const [dx, dy] = loopSide ? DIRECTIONS[loopSide] : [0, 0];
        const center = { x: labelX + (dx * width) / 2, y: labelY + (dy * height) / 2 };
        leaderEnd = leaderLineEnd(anchor, center, width, height);
    }

    /**
     * Drags the label. A click without moving selects the transition, like a click on the arrow.
     *
     * @param e The event
     */
    const onLabelPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
        if (e.button !== 0) {
            return;
        }
        // React Flow must neither pan nor select something else
        e.stopPropagation();
        const label = e.currentTarget;
        label.setPointerCapture(e.pointerId);
        const startScreen = { x: e.clientX, y: e.clientY };
        const startFlow = screenToFlowPosition(startScreen);
        const startOffset = transition?.labelOffset ?? { x: 0, y: 0 };
        let moved = false;
        let offset = startOffset;
        const move = (ev: PointerEvent): void => {
            // small movements of a click are no drag
            if (!moved && Math.hypot(ev.clientX - startScreen.x, ev.clientY - startScreen.y) < 4) {
                return;
            }
            moved = true;
            const position = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
            offset = {
                x: Math.round(startOffset.x + position.x - startFlow.x),
                y: Math.round(startOffset.y + position.y - startFlow.y),
            };
            setLabelDrag(offset);
        };
        const stop = (ev: PointerEvent): void => {
            label.removeEventListener("pointermove", move);
            label.removeEventListener("pointerup", stop);
            label.removeEventListener("pointercancel", stop);
            setLabelDrag(null);
            if (ev.type !== "pointerup") {
                return;
            }
            if (!moved) {
                data?.onSelect?.(id, false);
            } else {
                // dropped near the middle: back to the automatic position
                data?.onLabelMove?.(id, Math.hypot(offset.x, offset.y) < LABEL_SNAP ? undefined : offset);
            }
        };
        label.addEventListener("pointermove", move);
        label.addEventListener("pointerup", stop);
        label.addEventListener("pointercancel", stop);
    };

    const problemColor = getProblemColor(data?.problems);
    const text = `${data?.showPriority ? `${transition?.priority ?? "?"}: ` : ""}${transition?.label || ""}`;
    const showGrips = selected && !!data?.onAnchorChange && !!sourceBox && !!targetBox;
    // the properties of the grip of one end
    const grip = (gripEnd: EdgeEnd): Omit<EndGripProps, "point" | "box" | "fixed"> => ({
        stateId: gripEnd === "source" ? source : target,
        onChange: anchor => data?.onAnchorChange?.(id, gripEnd, anchor),
        onPreview: p => {
            setPreview(p ? { end: gripEnd, point: p.point } : null);
            data?.onReconnectPreview?.(p?.stateId ?? null);
        },
        onReconnect: stateId => data?.onReconnect?.(id, gripEnd, stateId),
    });

    return (
        <>
            <BaseEdge
                path={path}
                markerEnd={markerEnd}
                // the keyframes are defined in ChartEditor
                style={{
                    ...style,
                    ...(data?.flash ? { animation: "statechart-flash 1.5s ease-out" } : {}),
                    ...(preview ? { strokeDasharray: "6 4" } : {}),
                }}
            />
            {data?.inner && !preview && (
                // inner transitions start with a dot, like in other statechart tools
                <circle
                    cx={start.x}
                    cy={start.y}
                    r={4}
                    style={{ fill: "var(--xy-edge-stroke, var(--xy-edge-stroke-default))" }}
                />
            )}
            {leaderEnd && (
                // a moved label is connected to its arrow by a thin line, which ends at the border of the label
                <path
                    d={`M ${anchor.x} ${anchor.y} L ${leaderEnd.x} ${leaderEnd.y}`}
                    style={{
                        stroke: "var(--xy-edge-stroke, var(--xy-edge-stroke-default))",
                        strokeWidth: 1,
                        strokeDasharray: "2 3",
                        fill: "none",
                        pointerEvents: "none",
                    }}
                />
            )}
            {showGrips && loopAnchor && (
                <EndGrip
                    point={preview?.point ?? loopAnchor}
                    box={sourceBox}
                    fixed={!!sourceAnchor}
                    // the grip of a self transition moves its target to another state
                    {...grip("target")}
                    onChange={anchor => data?.onAnchorChange?.(id, "source", anchor)}
                />
            )}
            {showGrips && !loopAnchor && (
                <>
                    <EndGrip
                        point={preview?.end === "source" ? preview.point : start}
                        box={sourceBox}
                        fixed={!!sourceAnchor}
                        {...grip("source")}
                    />
                    <EndGrip
                        point={preview?.end === "target" ? preview.point : end}
                        box={targetBox}
                        fixed={!!targetAnchor}
                        {...grip("target")}
                    />
                </>
            )}
            {(text || transition?.comment?.trim() || data?.breakpoint || data?.problems) && (
                <EdgeLabelRenderer>
                    <Box
                        ref={labelRef}
                        className="nodrag nopan"
                        title={data?.onLabelMove ? I18n.t("labelDragHint") : undefined}
                        onPointerDown={data?.onLabelMove ? onLabelPointerDown : undefined}
                        onDoubleClick={() => data?.onSelect?.(id, true)}
                        sx={{
                            position: "absolute",
                            zIndex: labelZIndex,
                            transform: `translate(${labelX}px, ${labelY}px) ${labelAlign}`,
                            pointerEvents: "all",
                            cursor: data?.onLabelMove ? "move" : undefined,
                            // the selected transition is also shown at its label
                            boxShadow: selected ? 2 : 0,
                            // transparent, so the label does not cover the states and the background
                            bgcolor: "transparent",
                            color: problemColor ?? "text.primary",
                            border: 1,
                            borderColor: problemColor ?? "transparent",
                            borderRadius: 1,
                            px: 0.5,
                            fontFamily: "monospace",
                            fontSize: 12,
                            // fixed, so the height of a label is known when labels are stacked
                            lineHeight: `${LABEL_LINE_HEIGHT}px`,
                            whiteSpace: "pre",
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                        }}
                    >
                        {data?.breakpoint && (
                            <Box
                                component="span"
                                title={I18n.t("Breakpoint")}
                                sx={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: "50%",
                                    bgcolor: "error.main",
                                    flexShrink: 0,
                                }}
                            />
                        )}
                        {text}
                        <CommentBadge comment={transition?.comment} />
                        <ProblemBadge problems={data?.problems} />
                    </Box>
                </EdgeLabelRenderer>
            )}
        </>
    );
}

export default memo(TransitionEdge);
