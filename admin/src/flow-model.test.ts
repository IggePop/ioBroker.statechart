import { expect } from "chai";
import { alignRects } from "./flow-model";
import type { Rect } from "./flow-model";

/** Three rectangles of different sizes, "a" is the leftmost and topmost */
function createRects(): Map<string, Rect> {
    return new Map([
        ["a", { x: 0, y: 0, width: 100, height: 50 }],
        ["b", { x: 300, y: 100, width: 50, height: 100 }],
        ["c", { x: 150, y: 400, width: 200, height: 20 }],
    ]);
}

describe("flow-model => alignRects", () => {
    it("aligns at the outermost border, only the moved rectangles are returned", () => {
        expect(Object.fromEntries(alignRects(createRects(), "left"))).to.deep.equal({
            b: { x: 0, y: 100 },
            c: { x: 0, y: 400 },
        });
        expect(Object.fromEntries(alignRects(createRects(), "right"))).to.deep.equal({
            a: { x: 250, y: 0 },
            // "c" is already at the right border
        });
        expect(Object.fromEntries(alignRects(createRects(), "bottom"))).to.deep.equal({
            a: { x: 0, y: 370 },
            b: { x: 300, y: 320 },
        });
    });

    it("aligns the centers", () => {
        // the bounding box is 0..350 x 0..420
        expect(Object.fromEntries(alignRects(createRects(), "centerX"))).to.deep.equal({
            a: { x: 125, y: 0 },
            b: { x: 150, y: 100 },
            c: { x: 75, y: 400 },
        });
        expect(alignRects(createRects(), "centerY").get("c")).to.deep.equal({ x: 150, y: 200 });
    });

    it("distributes with equal gaps, the outermost ones stay", () => {
        const rects = new Map<string, Rect>([
            ["a", { x: 0, y: 0, width: 100, height: 50 }],
            ["b", { x: 120, y: 10, width: 50, height: 50 }],
            ["c", { x: 400, y: 20, width: 100, height: 50 }],
        ]);
        // 500 wide, 250 for the rectangles, so 125 between them
        expect(Object.fromEntries(alignRects(rects, "distributeX"))).to.deep.equal({ b: { x: 225, y: 10 } });
        expect(Object.fromEntries(alignRects(rects, "distributeY"))).to.deep.equal({});
    });

    it("does nothing with less than two rectangles", () => {
        const rects = new Map([["a", { x: 5, y: 5, width: 10, height: 10 }]]);
        expect(alignRects(rects, "left").size).to.equal(0);
    });
});
