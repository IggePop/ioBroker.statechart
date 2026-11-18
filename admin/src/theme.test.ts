import { expect } from "chai";
import { resolveThemeName } from "./theme";

describe("theme => resolveThemeName", () => {
    it("keeps the themes of @iobroker/adapter-react-v5", () => {
        expect(resolveThemeName("dark", null, false)).to.equal("dark");
        expect(resolveThemeName("blue", null, false)).to.equal("blue");
        expect(resolveThemeName("light", null, true)).to.equal("light");
    });

    it("maps the modern themes of admin 8", () => {
        expect(resolveThemeName("modernDark", null, false)).to.equal("dark");
        expect(resolveThemeName("modernLight", null, true)).to.equal("light");
        expect(resolveThemeName(null, "modernDark", false)).to.equal("dark");
    });

    it("follows the system for auto and unknown themes", () => {
        expect(resolveThemeName("auto", null, true)).to.equal("dark");
        expect(resolveThemeName(undefined, "auto", false)).to.equal("light");
        expect(resolveThemeName("someTheme", null, true)).to.equal("dark");
    });
});
