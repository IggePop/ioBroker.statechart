/*
 * Geometry of floating edges: a transition starts and ends on the border of its states, at the point
 * facing the other state, instead of at fixed connection points
 */

import { Position } from "@xyflow/react";
import type { EdgeAnchor } from "../../src/lib/chart-model";

export interface Point {
    x: number;
    y: number;
}

/** Absolute position and size of a node */
export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A point on the border of a node and the side it is on */
export interface BorderPoint extends Point {
    side: Position;
}

/** Ends of an edge and the direction the curve leaves/enters them, as used by getBezierPath() */
export interface EdgeEnds {
    sourceX: number;
    sourceY: number;
    sourcePosition: Position;
    targetX: number;
    targetY: number;
    targetPosition: Position;
}

/** The other side of a node */
export const OPPOSITE: Record<Position, Position> = {
    [Position.Top]: Position.Bottom,
    [Position.Right]: Position.Left,
    [Position.Bottom]: Position.Top,
    [Position.Left]: Position.Right,
};

/** Unit vectors pointing away from the node for each side */
export const DIRECTIONS: Record<Position, [number, number]> = {
    [Position.Top]: [0, -1],
    [Position.Right]: [1, 0],
    [Position.Bottom]: [0, 1],
    [Position.Left]: [-1, 0],
};

/**
 * @param box The node
 */
export function center(box: Box): Point {
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Where the line from the center of a node to a point leaves the node
 *
 * @param box The node
 * @param toward The point, outside of the node
 */
export function borderPoint(box: Box, toward: Point): BorderPoint {
    const c = center(box);
    const dx = toward.x - c.x;
    const dy = toward.y - c.y;
    if (!dx && !dy) {
        return { x: c.x, y: box.y, side: Position.Top };
    }
    const halfWidth = box.width / 2;
    const halfHeight = box.height / 2;
    // how far the line can go until it reaches the left/right or the top/bottom border
    const scaleX = dx ? halfWidth / Math.abs(dx) : Infinity;
    const scaleY = dy ? halfHeight / Math.abs(dy) : Infinity;
    if (scaleX < scaleY) {
        return { x: c.x + dx * scaleX, y: c.y + dy * scaleX, side: dx > 0 ? Position.Right : Position.Left };
    }
    return { x: c.x + dx * scaleY, y: c.y + dy * scaleY, side: dy > 0 ? Position.Bottom : Position.Top };
}

/**
 * Moves both ends of an edge sideways, so several edges between the same nodes do not cover each other
 *
 * @param ends The ends of the edge
 * @param offset Distance, positive to the right of the direction from source to target
 */
function shift(ends: EdgeEnds, offset: number): EdgeEnds {
    if (!offset) {
        return ends;
    }
    const dx = ends.targetX - ends.sourceX;
    const dy = ends.targetY - ends.sourceY;
    const length = Math.hypot(dx, dy) || 1;
    // perpendicular unit vector (right of the direction in screen coordinates, y pointing down)
    const px = -dy / length;
    const py = dx / length;
    return {
        ...ends,
        sourceX: ends.sourceX + px * offset,
        sourceY: ends.sourceY + py * offset,
        targetX: ends.targetX + px * offset,
        targetY: ends.targetY + py * offset,
    };
}

/**
 * The side of a parent node which is closest to its child
 *
 * @param parent The parent node
 * @param child The child node, inside of the parent
 */
function closestSide(parent: Box, child: Box): Position {
    const distances: [Position, number][] = [
        [Position.Top, child.y - parent.y],
        [Position.Bottom, parent.y + parent.height - (child.y + child.height)],
        [Position.Left, child.x - parent.x],
        [Position.Right, parent.x + parent.width - (child.x + child.width)],
    ];
    return distances.reduce((best, d) => (d[1] < best[1] ? d : best))[0];
}

/**
 * The point on the border of a node on the given side, at the given position along the side (clamped to the side)
 *
 * @param box The node
 * @param side The side
 * @param along x for top/bottom, y for left/right
 */
function pointOnSide(box: Box, side: Position, along: number): Point {
    const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
    switch (side) {
        case Position.Top:
            return { x: clamp(along, box.x, box.x + box.width), y: box.y };
        case Position.Bottom:
            return { x: clamp(along, box.x, box.x + box.width), y: box.y + box.height };
        case Position.Left:
            return { x: box.x, y: clamp(along, box.y, box.y + box.height) };
        default:
            return { x: box.x + box.width, y: clamp(along, box.y, box.y + box.height) };
    }
}

/**
 * An edge between a parent and its (direct or indirect) child: it crosses the border of the parent on the side
 * closest to the child, and ends on the facing side of the child
 *
 * @param parent The parent node
 * @param child The child node
 */
function nestedEnds(parent: Box, child: Box): { parentPoint: BorderPoint; childPoint: BorderPoint } {
    const side = closestSide(parent, child);
    const c = center(child);
    const along = side === Position.Top || side === Position.Bottom ? c.x : c.y;
    return {
        parentPoint: { ...pointOnSide(parent, side, along), side },
        childPoint: { ...pointOnSide(child, side, along), side },
    };
}

const SIDES: string[] = [Position.Top, Position.Right, Position.Bottom, Position.Left];

/**
 * @param anchor An anchor read from a chart
 * @returns false if it is missing or invalid, e.g. in an imported file
 */
export function isValidAnchor(anchor: EdgeAnchor | undefined): anchor is EdgeAnchor {
    return !!anchor && SIDES.includes(anchor.side) && Number.isFinite(anchor.pos);
}

/**
 * @param box The node
 * @param anchor A point on its border
 */
export function anchorPoint(box: Box, anchor: EdgeAnchor): BorderPoint {
    const side = anchor.side as Position;
    const pos = Math.min(1, Math.max(0, anchor.pos));
    const horizontal = side === Position.Top || side === Position.Bottom;
    const along = horizontal ? box.x + pos * box.width : box.y + pos * box.height;
    return { ...pointOnSide(box, side, along), side };
}

/**
 * The anchor on the border of a node which is closest to a point, used while an end of an edge is dragged
 *
 * @param box The node
 * @param point E.g. the mouse pointer, inside or outside of the node
 */
export function nearestAnchor(box: Box, point: Point): EdgeAnchor {
    const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
    const posX = clamp01((point.x - box.x) / box.width);
    const posY = clamp01((point.y - box.y) / box.height);
    const candidates: [EdgeAnchor, Point][] = [
        [
            { side: "top", pos: posX },
            { x: box.x + posX * box.width, y: box.y },
        ],
        [
            { side: "bottom", pos: posX },
            { x: box.x + posX * box.width, y: box.y + box.height },
        ],
        [
            { side: "left", pos: posY },
            { x: box.x, y: box.y + posY * box.height },
        ],
        [
            { side: "right", pos: posY },
            { x: box.x + box.width, y: box.y + posY * box.height },
        ],
    ];
    const distance = (p: Point): number => Math.hypot(p.x - point.x, p.y - point.y);
    return candidates.reduce((best, c) => (distance(c[1]) < distance(best[1]) ? c : best))[0];
}

/**
 * The ends of a floating edge between two different nodes
 *
 * @param source The source node
 * @param target The target node
 * @param nesting "toChild" if the target is a child of the source, "toParent" if the source is a child of the target
 * @param offset Moves the edge sideways, see shift(). Not used if an end is fixed by an anchor.
 * @param sourceAnchor Fixes the start on the border of the source, set by the user
 * @param targetAnchor Fixes the end on the border of the target, set by the user
 */
export function getFloatingEdgeEnds(
    source: Box,
    target: Box,
    nesting?: "toChild" | "toParent",
    offset = 0,
    sourceAnchor?: EdgeAnchor,
    targetAnchor?: EdgeAnchor,
): EdgeEnds {
    const auto = getAutomaticEnds(source, target, nesting, offset);
    const fixedSource = isValidAnchor(sourceAnchor) ? anchorPoint(source, sourceAnchor) : null;
    const fixedTarget = isValidAnchor(targetAnchor) ? anchorPoint(target, targetAnchor) : null;
    if (!fixedSource && !fixedTarget) {
        return auto;
    }
    // the end on the parent of a nested edge points into the parent
    const sourcePosition = (side: Position): Position => (nesting === "toChild" ? OPPOSITE[side] : side);
    const targetPosition = (side: Position): Position => (nesting === "toParent" ? OPPOSITE[side] : side);
    const ends = { ...auto };
    if (fixedSource) {
        Object.assign(ends, {
            sourceX: fixedSource.x,
            sourceY: fixedSource.y,
            sourcePosition: sourcePosition(fixedSource.side),
        });
    }
    if (fixedTarget) {
        Object.assign(ends, {
            targetX: fixedTarget.x,
            targetY: fixedTarget.y,
            targetPosition: targetPosition(fixedTarget.side),
        });
    }
    // without nesting, a free end points to the fixed one instead of to the center of the other node
    if (!nesting && fixedSource && !fixedTarget) {
        const t = borderPoint(target, fixedSource);
        Object.assign(ends, { targetX: t.x, targetY: t.y, targetPosition: t.side });
    } else if (!nesting && fixedTarget && !fixedSource) {
        const s = borderPoint(source, fixedTarget);
        Object.assign(ends, { sourceX: s.x, sourceY: s.y, sourcePosition: s.side });
    }
    return ends;
}

/**
 * The ends of an edge whose ends are not fixed by the user
 *
 * @param source The source node
 * @param target The target node
 * @param nesting See getFloatingEdgeEnds()
 * @param offset Moves the edge sideways, see shift()
 */
function getAutomaticEnds(
    source: Box,
    target: Box,
    nesting: "toChild" | "toParent" | undefined,
    offset: number,
): EdgeEnds {
    let ends: EdgeEnds;
    if (nesting === "toChild") {
        // starts at the border of the parent and goes into it, towards the child
        const { parentPoint, childPoint } = nestedEnds(source, target);
        ends = {
            sourceX: parentPoint.x,
            sourceY: parentPoint.y,
            sourcePosition: OPPOSITE[parentPoint.side],
            targetX: childPoint.x,
            targetY: childPoint.y,
            targetPosition: childPoint.side,
        };
    } else if (nesting === "toParent") {
        const { parentPoint, childPoint } = nestedEnds(target, source);
        ends = {
            sourceX: childPoint.x,
            sourceY: childPoint.y,
            sourcePosition: childPoint.side,
            targetX: parentPoint.x,
            targetY: parentPoint.y,
            targetPosition: OPPOSITE[parentPoint.side],
        };
    } else {
        const s = borderPoint(source, center(target));
        const t = borderPoint(target, center(source));
        ends = {
            sourceX: s.x,
            sourceY: s.y,
            sourcePosition: s.side,
            targetX: t.x,
            targetY: t.y,
            targetPosition: t.side,
        };
    }
    return shift(ends, offset);
}

/**
 * The two ends of a self transition: next to each other on the given side
 *
 * @param box The node
 * @param side The side the loop is on
 * @param pos Position of the loop along the side, 0 = left/top end, 1 = right/bottom end
 * @param gap Distance between the ends
 */
export function getLoopEnds(box: Box, side: Position, pos = 0.5, gap = 30): { start: Point; end: Point } {
    const horizontal = side === Position.Top || side === Position.Bottom;
    const middle = anchorPoint(box, { side, pos });
    return horizontal
        ? { start: { x: middle.x - gap / 2, y: middle.y }, end: { x: middle.x + gap / 2, y: middle.y } }
        : { start: { x: middle.x, y: middle.y - gap / 2 }, end: { x: middle.x, y: middle.y + gap / 2 } };
}

/**
 * Offsets for edges between the same two nodes, so they do not cover each other. The offset of an edge is
 * relative to its own direction, edges in opposite directions are moved to different sides.
 *
 * @param edges All edges
 * @param spacing Distance between neighboring edges
 * @returns offset by edge ID, edges without others between the same nodes are missing
 */
export function getParallelOffsets(
    edges: { id: string; source: string; target: string }[],
    spacing = 16,
): Map<string, number> {
    const offsets = new Map<string, number>();
    for (const group of groupParallelEdges(edges)) {
        group.forEach((edge, i) => {
            // the offset in the direction from the smaller to the larger ID, converted to the edge's own direction
            const offset = (i - (group.length - 1) / 2) * spacing;
            offsets.set(edge.id, edge.source < edge.target ? offset : -offset);
        });
    }
    return offsets;
}

/**
 * @param edges All edges
 * @returns the groups of at least two edges between the same two nodes, in either direction, without self transitions
 */
function groupParallelEdges<T extends { source: string; target: string }>(edges: T[]): T[][] {
    const groups = new Map<string, T[]>();
    for (const edge of edges) {
        if (edge.source === edge.target) {
            continue;
        }
        const key = edge.source < edge.target ? `${edge.source}\n${edge.target}` : `${edge.target}\n${edge.source}`;
        groups.set(key, [...(groups.get(key) || []), edge]);
    }
    return [...groups.values()].filter(group => group.length > 1);
}

/** Height of a line of a transition label, set in its style, so the height of a label is known before rendering */
export const LABEL_LINE_HEIGHT = 16;

/**
 * Vertical positions of the labels of edges between the same two nodes. The edges themselves are only a few pixels
 * apart (see getParallelOffsets), but their labels are much wider: in the middle of their arrows, they would cover
 * each other. Instead, they are stacked on top of each other, in the order of the arrows.
 *
 * @param edges All edges whose labels can be stacked, with the number of lines of their labels
 * @param gap Vertical space between neighboring labels
 * @returns the vertical position of the center of the label relative to the middle between the arrows, by edge ID.
 *   Edges without others between the same nodes are missing.
 */
export function getLabelStackOffsets(
    edges: { id: string; source: string; target: string; lines: number }[],
    gap = 4,
): Map<string, number> {
    const positions = new Map<string, number>();
    for (const group of groupParallelEdges(edges)) {
        // the border of a label adds 2 pixels
        const heights = group.map(edge => Math.max(edge.lines, 1) * LABEL_LINE_HEIGHT + 2);
        let top = -(heights.reduce((sum, h) => sum + h, 0) + gap * (group.length - 1)) / 2;
        group.forEach((edge, i) => {
            positions.set(edge.id, top + heights[i] / 2);
            top += heights[i] + gap;
        });
    }
    return positions;
}
