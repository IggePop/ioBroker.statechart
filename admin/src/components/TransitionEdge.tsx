import React, { memo, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useInternalNode, useReactFlow } from "@xyflow/react";
import type { Edge, EdgeProps, InternalNode, Position } from "@xyflow/react";
import { Box, useTheme } from "@mui/material";
import { I18n } from "@iobroker/adapter-react-v5";
import type { ChartTransition, EdgeAnchor } from "../../../src/lib/chart-model";
import {
    DIRECTIONS,
    anchorPoint,
    getFloatingEdgeEnds,
    getLoopEnds,
    isValidAnchor,
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

/**
 * Path of a self transition: a loop which leaves and enters the state on the side of the handles
 *
 * @param sx Start x
 * @param sy Start y
 * @param tx End x
 * @param ty End y
 * @param side Side of the state the loop is on
 * @returns path, label x, label y
 */
function getLoopPath(sx: number, sy: number, tx: number, ty: number, side: Position): [string, number, number] {
    const [dx, dy] = DIRECTIONS[side];
    // perpendicular to the direction, so the loop gets a width
    const [px, py] = [-dy, dx];
    const out = 60;
    const width = 35;
    const path =
        `M ${sx} ${sy} ` +
        `C ${sx + dx * out + px * width} ${sy + dy * out + py * width}, ` +
        `${tx + dx * out - px * width} ${ty + dy * out - py * width}, ${tx} ${ty}`;
    return [path, (sx + tx) / 2 + dx * out * 0.75, (sy + ty) / 2 + dy * out * 0.75];
}

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
            className="nodrag nopan"
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
    const sourceBox = getBox(useInternalNode(source));
    const targetBox = getBox(useInternalNode(target));
    const sourceAnchor = isValidAnchor(transition?.sourceAnchor) ? transition.sourceAnchor : undefined;
    const targetAnchor = isValidAnchor(transition?.targetAnchor) ? transition.targetAnchor : undefined;
    /** an end dragged over another state: the edge is drawn to the pointer */
    const [preview, setPreview] = useState<{ end: EdgeEnd; point: Point } | null>(null);
    /** the offset of the label while it is dragged, it is stored when it is dropped */
    const [labelDrag, setLabelDrag] = useState<Point | null>(null);
    const { screenToFlowPosition } = useReactFlow();

    // floating edges: the ends are on the borders of the states, facing each other, unless the user fixed them
    // by dragging. The handles are only used to create transitions, and for the side of self transitions.
    // Until the states are measured, the positions of the handles are used.
    let path: string;
    let labelX: number;
    let labelY: number;
    let start = { x: sourceX, y: sourceY };
    let end = { x: targetX, y: targetY };
    /** where the grip of a self transition is, it moves the whole loop */
    let loopAnchor: Point | null = null;
    if (source === target) {
        const side = (sourceAnchor?.side as Position | undefined) ?? sourcePosition;
        const ends = sourceBox ? getLoopEnds(sourceBox, side, sourceAnchor?.pos) : null;
        start = ends?.start ?? start;
        end = ends?.end ?? end;
        loopAnchor = sourceBox ? anchorPoint(sourceBox, { side, pos: sourceAnchor?.pos ?? 0.5 }) : null;
        [path, labelX, labelY] = getLoopPath(start.x, start.y, end.x, end.y, side);
    } else {
        const ends =
            sourceBox && targetBox
                ? getFloatingEdgeEnds(sourceBox, targetBox, data?.nesting, data?.offset, sourceAnchor, targetAnchor)
                : { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition };
        start = { x: ends.sourceX, y: ends.sourceY };
        end = { x: ends.targetX, y: ends.targetY };
        [path, labelX, labelY] = getBezierPath(ends);
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
    labelY += labelOffset.y;

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
    /** the properties of the grip of one end */
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
            {Math.hypot(labelOffset.x, labelOffset.y) >= LEADER_FROM && !preview && (
                // a moved label is connected to its arrow by a thin line
                <path
                    d={`M ${anchor.x} ${anchor.y} L ${labelX} ${labelY}`}
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
                        className="nodrag nopan"
                        title={data?.onLabelMove ? I18n.t("labelDragHint") : undefined}
                        onPointerDown={data?.onLabelMove ? onLabelPointerDown : undefined}
                        onDoubleClick={() => data?.onSelect?.(id, true)}
                        sx={{
                            position: "absolute",
                            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                            pointerEvents: "all",
                            cursor: data?.onLabelMove ? "move" : undefined,
                            // the selected transition is also shown at its label
                            boxShadow: selected ? 2 : 0,
                            bgcolor: "background.paper",
                            color: problemColor ?? "text.primary",
                            border: 1,
                            borderColor: problemColor ?? "transparent",
                            borderRadius: 1,
                            px: 0.5,
                            fontFamily: "monospace",
                            fontSize: 12,
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
