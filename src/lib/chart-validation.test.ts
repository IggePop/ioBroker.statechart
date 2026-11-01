import { expect } from "chai";
import {
    getDeclarations,
    quoteChangeArguments,
    validateChart,
    validateCode,
    validateTransitionLabel,
} from "./chart-validation";
import type { ChartSymbol } from "./chart-model";
import type { Diagnostic } from "./chart-validation";

const symbols: ChartSymbol[] = [
    { name: "motion", scope: "input", stateId: "test.0.motion" },
    { name: "light", scope: "output", stateId: "test.0.light" },
    { name: "count", scope: "local", initial: 0 },
];

/**
 * @param diagnostics The diagnostics to summarize
 * @param text The checked text
 */
const summarize = (diagnostics: Diagnostic[], text: string): string[] =>
    diagnostics.map(d => `${d.severity}: ${d.message} @${text.substring(d.from, d.to)}`);

describe("chart-validation => validateCode", () => {
    it("accepts valid code", () => {
        expect(validateCode("light = motion && count > 1; log(Math.max(1, 2));", "statements", symbols)).to.deep.equal(
            [],
        );
        expect(validateCode("", "statements", symbols)).to.deep.equal([]);
    });

    it("reports unknown variables with their position", () => {
        const code = "light = motoin;";
        expect(summarize(validateCode(code, "statements", symbols), code)).to.deep.equal([
            'error: Unknown variable "motoin" @motoin',
        ]);
    });

    it("knows variables declared in the code", () => {
        const code = "let x = 1; const f = (a) => a + x; for (const i of [1]) { light = f(i); }";
        expect(validateCode(code, "statements", symbols)).to.deep.equal([]);
    });

    it("ignores property names", () => {
        expect(validateCode("light = { on: true }.on && JSON.parse('1').foo;", "statements", symbols)).to.deep.equal(
            [],
        );
    });

    it("warns when an input is assigned", () => {
        const code = "motion = false; count++;";
        expect(summarize(validateCode(code, "statements", symbols), code)).to.deep.equal([
            'warning: Input "motion" is overwritten on its next change @motion',
        ]);
    });

    it("reports syntax errors", () => {
        const code = "light = = true;";
        const diagnostics = validateCode(code, "statements", symbols);
        expect(diagnostics).to.have.length(1);
        expect(diagnostics[0].message).to.match(/^Syntax error: Unexpected token/);
        expect(code.substring(diagnostics[0].from, diagnostics[0].to)).to.equal("=");
    });

    it("rejects statements in conditions", () => {
        const code = "motion; light = 1";
        expect(summarize(validateCode(code, "expression", symbols), code)).to.deep.equal([
            'error: Unexpected "; light = 1" @; light = 1',
        ]);
    });
});

describe("chart-validation => change detection", () => {
    it("accepts variables of the chart, also as string", () => {
        const code = 'hasChanged(motion) && hasChangedTo(light, true) && hasChangedFrom("count", 0)';
        expect(validateCode(code, "expression", symbols)).to.deep.equal([]);
    });

    it("rejects other arguments", () => {
        const code = 'hasChanged(motion + 1) || hasChanged() || hasChangedTo("x", 1) || hasChanged(Math)';
        expect(summarize(validateCode(code, "expression", symbols), code)).to.deep.equal([
            "error: hasChanged() needs a variable of the chart as first argument @motion + 1",
            "error: hasChanged() needs a variable of the chart as first argument @hasChanged()",
            'error: hasChangedTo() needs a variable of the chart as first argument @"x"',
            "error: hasChanged() needs a variable of the chart as first argument @Math",
        ]);
    });

    it("reports an unknown variable only once", () => {
        const code = "hasChanged(motoin)";
        expect(summarize(validateCode(code, "expression", symbols), code)).to.deep.equal([
            'error: Unknown variable "motoin" @motoin',
        ]);
    });

    it("passes the names of the variables instead of their values", () => {
        expect(
            quoteChangeArguments('hasChangedTo(motion, true) && !hasChanged("light") && motion', "expression"),
        ).to.deep.equal({
            code: 'hasChangedTo("motion", true) && !hasChanged("light") && motion',
            names: ["motion", "light"],
        });
        expect(quoteChangeArguments("if (hasChanged(count)) { log(count); }", "statements").code).to.equal(
            'if (hasChanged("count")) { log(count); }',
        );
        // code with syntax errors is not executed anyway
        expect(quoteChangeArguments("hasChanged(motion", "expression")).to.deep.equal({
            code: "hasChanged(motion",
            names: [],
        });
    });
});

describe("chart-validation => validateTransitionLabel", () => {
    it("accepts valid labels", () => {
        expect(validateTransitionLabel("motion[motion && count < 3]{count++;}", symbols)).to.deep.equal([]);
        expect(validateTransitionLabel("after(5, sec)", symbols)).to.deep.equal([]);
    });

    it("reports problems at their position in the label", () => {
        const label = "motoin[motion && lightt]{light = tru;}";
        expect(summarize(validateTransitionLabel(label, symbols), label)).to.deep.equal([
            'error: Unknown event "motoin", use the name of an input @motoin',
            'error: Unknown variable "lightt" @lightt',
            'error: Unknown variable "tru" @tru',
        ]);
    });

    it("finds problems in multi line labels", () => {
        const label = "[motion]\n{\n  light = true;\n  cnt++;\n}";
        expect(summarize(validateTransitionLabel(label, symbols), label)).to.deep.equal([
            'error: Unknown variable "cnt" @cnt',
        ]);
    });

    it("reports structural errors with key and arguments for translation", () => {
        const [diagnostic] = validateTransitionLabel("[motion", symbols);
        expect(diagnostic).to.include({ key: 'Missing "%s"', message: 'Missing "]"', from: 0, to: 7 });
        expect(diagnostic.args).to.deep.equal(["]"]);
    });
});

describe("chart-validation => validateChart", () => {
    it("reports problems of states and transitions", () => {
        const problems = validateChart({
            version: 1,
            name: "Test",
            enabled: true,
            symbols,
            states: [{ id: "s1", name: "S1", entry: "lihgt = true;", x: 0, y: 0 }],
            transitions: [{ id: "t1", source: "s1", target: "s1", label: "[x]" }],
        });
        expect(problems.map(p => `${p.kind} ${p.id} ${p.field}: ${p.diagnostic.message}`)).to.deep.equal([
            'state s1 entry: Unknown variable "lihgt"',
            'transition t1 label: Unknown variable "x"',
        ]);
    });

    it("knows the functions of function blocks and checks the blocks", () => {
        const problems = validateChart({
            version: 1,
            name: "Test",
            enabled: true,
            symbols,
            states: [{ id: "s1", name: "S1", entry: "light = isOn(count) && LIMIT > 1;", x: 0, y: 0 }],
            transitions: [{ id: "t1", source: "s1", target: "s1", label: "[clamp(count, 0, 5) > 1]" }],
            functions: [
                { id: "f1", code: "function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }", x: 0, y: 0 },
                { id: "f2", code: "const LIMIT = 3;\nconst isOn = c => c > LIMIT && motoin;", x: 0, y: 0 },
                { id: "f3", code: "function clamp() {}\nfunction count() {}", x: 0, y: 0 },
            ],
        });
        expect(problems.map(p => `${p.kind} ${p.id} ${p.field}: ${p.diagnostic.message}`)).to.deep.equal([
            'function f2 code: Unknown variable "motoin"',
            'function f3 code: "clamp" is declared in more than one function block',
            'function f3 code: "count" is already the name of a variable',
        ]);
    });
});

describe("chart-validation => getDeclarations", () => {
    it("returns functions with their signature and other declarations", () => {
        const code = "function clamp(x, lo = 0, ...rest) {}\nconst f = (a, b) => a + b;\nlet counter = 0;";
        expect(getDeclarations(code).map(d => [d.name, d.signature, code.substring(d.from, d.to)])).to.deep.equal([
            ["clamp", "clamp(x, lo = 0, ...rest)", "clamp"],
            ["f", "f(a, b)", "f"],
            ["counter", null, "counter"],
        ]);
    });

    it("returns nothing for code with syntax errors", () => {
        expect(getDeclarations("function (")).to.deep.equal([]);
    });
});
