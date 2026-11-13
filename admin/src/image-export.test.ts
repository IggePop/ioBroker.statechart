import { expect } from "chai";
import { getImageFrame } from "./image-export";

describe("image-export => getImageFrame", () => {
    it("encloses all elements with the padding", () => {
        const frame = getImageFrame(
            [
                { x: 0, y: 0, width: 100, height: 50 },
                // e.g. a label left of and below the state
                { x: -30.5, y: 40, width: 20, height: 30.2 },
            ],
            10,
        );
        // left -30.5 - 10, right 100 + 10, top 0 - 10, bottom 70.2 + 10, rounded outwards
        expect(frame).to.deep.equal({ x: -41, y: -10, width: 151, height: 91 });
    });

    it("returns null for an empty chart", () => {
        expect(getImageFrame([])).to.equal(null);
    });
});
