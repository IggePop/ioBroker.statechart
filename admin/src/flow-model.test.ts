import { expect } from "chai";
import { DEFAULT_STATE_COLOR, alignRects, getNestingDepths, stateBackground } from "./flow-model";
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

describe("flow-model => stateBackground", () => {
    it("uses the color in the light theme and a dark shade of it in the dark theme", () => {
        expect(stateBackground(undefined, false)).to.equal(DEFAULT_STATE_COLOR);
        expect(stateBackground("#fde3cf", false)).to.equal("#fde3cf");
        // 25% of the color, 75% of the background #1e1e1e
        expect(stateBackground("#ffffff", true)).to.equal("#565656");
        expect(stateBackground("#000000", true)).to.equal("#171717");
    });

    it("alternates between the color and a darker one on the nesting levels", () => {
        expect(stateBackground("#fcf3cf", false, 0)).to.equal("#fcf3cf");
        // 90% of each channel
        expect(stateBackground("#fcf3cf", false, 1)).to.equal("#e3dbba");
        expect(stateBackground("#fcf3cf", false, 2)).to.equal("#fcf3cf");
        expect(stateBackground("#fcf3cf", false, 3)).to.equal("#e3dbba");
        // in the dark theme, 35% instead of 25% of the color: lighter
        expect(stateBackground("#ffffff", true, 1)).to.equal("#6d6d6d");
        expect(stateBackground("#ffffff", true, 2)).to.equal("#565656");
    });
});

describe("flow-model => getNestingDepths", () => {
    it("counts the parents of each node", () => {
        const depths = getNestingDepths([
            { id: "a" },
            { id: "b", parentId: "a" },
            { id: "c", parentId: "b" },
            { id: "d" },
        ]);
        expect(Object.fromEntries(depths)).to.deep.equal({ a: 0, b: 1, c: 2, d: 0 });
    });
});
