import { expect } from "chai";
import { Position } from "@xyflow/react";
import {
    anchorPoint,
    borderPoint,
    getFloatingEdgeEnds,
    getLoopEnds,
    getLoopPath,
    getLabelStackOffsets,
    getParallelOffsets,
    isValidAnchor,
    loopLabelTransform,
    nearestAnchor,
    straightEnds,
} from "./floating-edges";

const box = (
    x: number,
    y: number,
    width = 100,
    height = 50,
): { x: number; y: number; width: number; height: number } => ({
    x,
    y,
    width,
    height,
});

describe("floating-edges => borderPoint", () => {
    it("leaves the node on the side facing the point", () => {
        // center (50, 25)
        expect(borderPoint(box(0, 0), { x: 500, y: 25 })).to.deep.equal({ x: 100, y: 25, side: Position.Right });
        expect(borderPoint(box(0, 0), { x: -500, y: 25 })).to.deep.equal({ x: 0, y: 25, side: Position.Left });
        expect(borderPoint(box(0, 0), { x: 50, y: 500 })).to.deep.equal({ x: 50, y: 50, side: Position.Bottom });
        expect(borderPoint(box(0, 0), { x: 50, y: -500 })).to.deep.equal({ x: 50, y: 0, side: Position.Top });
    });

    it("follows the direction to the point", () => {
        // 45° down right: reaches the bottom border (half height 25) before the right one (half width 50)
        const p = borderPoint(box(0, 0), { x: 150, y: 125 });
        expect(p).to.deep.equal({ x: 75, y: 50, side: Position.Bottom });
    });
});

describe("floating-edges => getFloatingEdgeEnds", () => {
    it("connects the facing sides of two nodes", () => {
        const ends = getFloatingEdgeEnds(box(0, 0), box(300, 0));
        expect(ends).to.deep.equal({
            sourceX: 100,
            sourceY: 25,
            sourcePosition: Position.Right,
            targetX: 300,
            targetY: 25,
            targetPosition: Position.Left,
        });
    });

    it("moves the edge sideways by the offset", () => {
        // from left to right, "right of the direction" is down
        const ends = getFloatingEdgeEnds(box(0, 0), box(300, 0), undefined, 10);
        expect([ends.sourceY, ends.targetY]).to.deep.equal([35, 35]);
    });

    it("goes from the closest side of a parent into the child", () => {
        // the child is close to the left border of the parent
        const parent = box(0, 0, 400, 300);
        const child = box(20, 100, 100, 50);
        expect(getFloatingEdgeEnds(parent, child, "toChild")).to.deep.equal({
            sourceX: 0,
            sourceY: 125,
            sourcePosition: Position.Right,
            targetX: 20,
            targetY: 125,
            targetPosition: Position.Left,
        });
        expect(getFloatingEdgeEnds(child, parent, "toParent")).to.deep.equal({
            sourceX: 20,
            sourceY: 125,
            sourcePosition: Position.Left,
            targetX: 0,
            targetY: 125,
            targetPosition: Position.Right,
        });
    });
});

describe("floating-edges => getLoopEnds", () => {
    it("places both ends next to each other in the middle of the side", () => {
        expect(getLoopEnds(box(0, 0), Position.Top)).to.deep.equal({ start: { x: 35, y: 0 }, end: { x: 65, y: 0 } });
        expect(getLoopEnds(box(0, 0), Position.Right)).to.deep.equal({
            start: { x: 100, y: 10 },
            end: { x: 100, y: 40 },
        });
    });
});

describe("floating-edges => getLoopPath", () => {
    it("bulges outwards on every side, the two parts of the loop do not cross", () => {
        for (const side of [Position.Top, Position.Right, Position.Bottom, Position.Left]) {
            const { start, end } = getLoopEnds(box(0, 0), side);
            const numbers = getLoopPath(start, end, side).path.match(/-?[\d.]+/g)!.map(Number);
            // M sx sy C c1x c1y, c2x c2y, ex ey
            const c1 = { x: numbers[2], y: numbers[3] };
            const c2 = { x: numbers[4], y: numbers[5] };
            const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
                Math.hypot(a.x - b.x, a.y - b.y);
            // each control point is on the side of its own end, so it is closer to it than to the other end
            expect(distance(c1, start)).to.be.lessThan(distance(c1, end), `start of the loop on side ${side}`);
            expect(distance(c2, end)).to.be.lessThan(distance(c2, start), `end of the loop on side ${side}`);
        }
    });

    it("draws a curve, or a rectangle with rounded corners, and places the label outside", () => {
        const { start, end } = getLoopEnds(box(0, 0), Position.Top);
        expect(getLoopPath(start, end, Position.Top)).to.deep.equal({
            path: "M 35 0 C 10 -50, 90 -50, 65 0",
            // the curve reaches 3/4 of 50, the label is 6 above it
            label: { x: 50, y: -43.5 },
        });
        expect(getLoopPath(start, end, Position.Top, true)).to.deep.equal({
            path: "M 35 0 L 35 -24 Q 35 -30 41 -30 L 59 -30 Q 65 -30 65 -24 L 65 0",
            label: { x: 50, y: -36 },
        });
    });

    it("aligns the label to the outer side of the loop", () => {
        expect(loopLabelTransform(Position.Top)).to.equal("translate(-50%, -100%)");
        expect(loopLabelTransform(Position.Right)).to.equal("translate(0, -50%)");
    });
});

describe("floating-edges => getParallelOffsets", () => {
    it("moves edges between the same nodes to different sides", () => {
        const offsets = getParallelOffsets([
            { id: "t1", source: "a", target: "b" },
            { id: "t2", source: "b", target: "a" },
            { id: "t3", source: "a", target: "c" },
            { id: "t4", source: "a", target: "a" },
        ]);
        expect(offsets.has("t3")).to.equal(false, "a single edge stays in the middle");
        expect(offsets.has("t4")).to.equal(false, "self transitions are loops");
        // the same value in their own direction, so the opposite edges are on different sides
        expect(offsets.get("t1")).to.equal(-8);
        expect(offsets.get("t2")).to.equal(-8);
        const down = getFloatingEdgeEnds(box(0, 0), box(300, 0), undefined, offsets.get("t1"));
        const up = getFloatingEdgeEnds(box(300, 0), box(0, 0), undefined, offsets.get("t2"));
        expect(down.sourceY).to.not.equal(up.targetY);
    });
});

describe("floating-edges => straightEnds", () => {
    it("connects nodes one above the other in the middle of their overlap", () => {
        // x ranges 0..100 and 60..160 overlap in 60..100
        expect(straightEnds(box(0, 0), box(60, 200))).to.deep.equal({
            sourceX: 80,
            sourceY: 50,
            sourcePosition: Position.Bottom,
            targetX: 80,
            targetY: 200,
            targetPosition: Position.Top,
        });
        expect(straightEnds(box(60, 200), box(0, 0))).to.include({ sourceY: 200, targetY: 50, sourceX: 80 });
    });

    it("connects nodes side by side in the middle of their overlap", () => {
        // y ranges 0..50 and 30..80 overlap in 30..50
        expect(straightEnds(box(0, 0), box(300, 30))).to.deep.equal({
            sourceX: 100,
            sourceY: 40,
            sourcePosition: Position.Right,
            targetX: 300,
            targetY: 40,
            targetPosition: Position.Left,
        });
    });

    it("returns null for diagonal or overlapping nodes", () => {
        expect(straightEnds(box(0, 0), box(300, 200))).to.equal(null);
        expect(straightEnds(box(0, 0), box(50, 20))).to.equal(null);
    });

    it("is only used for right-angled edges", () => {
        const curved = getFloatingEdgeEnds(box(0, 0), box(60, 200));
        const orthogonal = getFloatingEdgeEnds(box(0, 0), box(60, 200), undefined, 0, undefined, undefined, true);
        expect(curved.sourceX).to.not.equal(curved.targetX);
        expect(orthogonal.sourceX).to.equal(orthogonal.targetX);
    });
});

describe("floating-edges => getLabelStackOffsets", () => {
    it("stacks the labels of edges between the same nodes", () => {
        const positions = getLabelStackOffsets([
            { id: "t1", source: "a", target: "b", lines: 1 },
            { id: "t2", source: "b", target: "a", lines: 2 },
            { id: "t3", source: "a", target: "c", lines: 1 },
            { id: "t4", source: "a", target: "a", lines: 1 },
        ]);
        expect(positions.has("t3")).to.equal(false, "a single label stays on its arrow");
        expect(positions.has("t4")).to.equal(false, "self transitions are loops");
        // heights 18 and 34 with a gap of 4: 56 in all, centered around 0
        expect(positions.get("t1")).to.equal(-28 + 9);
        expect(positions.get("t2")).to.equal(-28 + 18 + 4 + 17);
    });
});

describe("floating-edges => anchors set by the user", () => {
    it("converts between anchors and points", () => {
        expect(anchorPoint(box(0, 0), { side: "top", pos: 0.25 })).to.deep.equal({ x: 25, y: 0, side: Position.Top });
        expect(anchorPoint(box(0, 0), { side: "right", pos: 1 })).to.deep.equal({
            x: 100,
            y: 50,
            side: Position.Right,
        });
        // a point outside of the node: the closest point on the border
        expect(nearestAnchor(box(0, 0), { x: 30, y: -40 })).to.deep.equal({ side: "top", pos: 0.3 });
        expect(nearestAnchor(box(0, 0), { x: 140, y: 10 })).to.deep.equal({ side: "right", pos: 0.2 });
        // a point inside of the node: the closest side
        expect(nearestAnchor(box(0, 0), { x: 50, y: 45 })).to.deep.equal({ side: "bottom", pos: 0.5 });
    });

    it("rejects invalid anchors", () => {
        expect(isValidAnchor(undefined)).to.equal(false);
        expect(isValidAnchor({ side: "middle" as any, pos: 0.5 })).to.equal(false);
        expect(isValidAnchor({ side: "top", pos: NaN })).to.equal(false);
        expect(isValidAnchor({ side: "top", pos: 0 })).to.equal(true);
    });

    it("uses fixed ends, the free end points to the fixed one", () => {
        const ends = getFloatingEdgeEnds(box(0, 0), box(300, 0), undefined, 8, { side: "bottom", pos: 0.5 });
        // the start is fixed, the offset is not used
        expect([ends.sourceX, ends.sourceY, ends.sourcePosition]).to.deep.equal([50, 50, Position.Bottom]);
        // the free end points to (50, 50): the left side of the target
        expect(ends.targetPosition).to.equal(Position.Left);
        expect(ends.targetX).to.equal(300);
    });

    it("points into the parent at a fixed end on the parent", () => {
        const parent = box(0, 0, 400, 300);
        const child = box(20, 100, 100, 50);
        const ends = getFloatingEdgeEnds(parent, child, "toChild", 0, { side: "top", pos: 0.5 });
        expect([ends.sourceX, ends.sourceY, ends.sourcePosition]).to.deep.equal([200, 0, Position.Bottom]);
    });

    it("moves a loop along its side", () => {
        expect(getLoopEnds(box(0, 0), Position.Top, 0.2)).to.deep.equal({
            start: { x: 5, y: 0 },
            end: { x: 35, y: 0 },
        });
    });
});
