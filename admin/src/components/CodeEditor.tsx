import React, { useEffect, useMemo, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExtension } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { forceLinting, linter } from "@codemirror/lint";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { Box, Typography, useTheme } from "@mui/material";
import type { Theme } from "@mui/material";
import { I18n } from "@iobroker/adapter-react-v5";
import type { Diagnostic } from "../../../src/lib/chart-validation";

/** An entry of the completion list */
export interface Completion {
    /** The inserted text, e.g. the name of a variable */
    label: string;
    /** Short text shown next to the label, e.g. the scope of a variable */
    detail?: string;
    /** Longer description shown beside the list for the selected entry */
    info?: string;
    /** Kind of the entry, selects the icon of CodeMirror, e.g. "variable" or "function" */
    type?: string;
}

/**
 * Translates a diagnostic, the English message is used if there is no translation
 *
 * @param diagnostic The diagnostic to translate
 */
export function translateDiagnostic(diagnostic: Diagnostic): string {
    // I18n.t returns the key itself if it is unknown, the key contains %s placeholders
    return I18n.t(diagnostic.key, ...diagnostic.args);
}

/**
 * @param theme The MUI theme
 * @param minRows Minimum height of the editor in lines
 */
export function createTheme(theme: Theme, minRows: number): Extension[] {
    const dark = theme.palette.mode === "dark";
    return [
        EditorView.theme(
            {
                // the border is drawn by the surrounding fieldset, like a TextField of MUI
                "&": {
                    fontSize: "13px",
                    color: theme.palette.text.primary,
                    borderRadius: "4px",
                },
                "&.cm-focused": { outline: "none" },
                ".cm-content": {
                    fontFamily: "monospace",
                    minHeight: `${minRows * 1.4 + 0.8}em`,
                    caretColor: theme.palette.text.primary,
                    // the padding of a small TextField
                    padding: "8.5px 0",
                },
                ".cm-line": { lineHeight: "1.4", padding: "0 14px" },
                ".cm-cursor": { borderLeftColor: theme.palette.text.primary },
                ".cm-placeholder": { color: theme.palette.text.disabled },
                ".cm-tooltip": {
                    backgroundColor: theme.palette.background.paper,
                    color: theme.palette.text.primary,
                    border: `1px solid ${theme.palette.divider}`,
                },
            },
            { dark },
        ),
        syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle),
    ];
}

interface CodeEditorProps {
    /** Shown in the border, like the label of a TextField */
    label: string;
    /** The code */
    value: string;
    /** Called with the code after each change */
    onChange: (value: string) => void;
    /** Checks the code, the problems are underlined and shown below */
    validate: (text: string) => Diagnostic[];
    /** Offered while typing */
    completions: Completion[];
    /** Shown while the code is empty */
    placeholder?: string;
    /** Shown if there are no problems */
    helperText?: string;
    /** Minimum height in lines */
    minRows?: number;
}

/**
 * Code input with JavaScript syntax highlighting, underlined errors and completion of variable names
 *
 * @param props Component properties, see CodeEditorProps
 * @param props.label Shown in the border
 * @param props.value The code
 * @param props.onChange Called with the code after each change
 * @param props.validate Checks the code
 * @param props.completions Offered while typing
 * @param props.placeholder Shown while the code is empty
 * @param props.helperText Shown if there are no problems
 * @param props.minRows Minimum height in lines
 */
export default function CodeEditor({
    label,
    value,
    onChange,
    validate,
    completions,
    placeholder,
    helperText,
    minRows = 2,
}: CodeEditorProps): React.JSX.Element {
    const theme = useTheme();
    const container = useRef<HTMLDivElement | null>(null);
    const view = useRef<EditorView | null>(null);
    const themeCompartment = useRef(new Compartment());

    // the extensions are created once, they read the current props through this ref
    const props = useRef({ onChange, validate, completions });
    // eslint-disable-next-line react-hooks/refs
    props.current = { onChange, validate, completions };

    useEffect(() => {
        const editor = new EditorView({
            parent: container.current as HTMLDivElement,
            state: EditorState.create({
                doc: value,
                extensions: [
                    history(),
                    closeBrackets(),
                    bracketMatching(),
                    javascript(),
                    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap]),
                    placeholderExtension(placeholder || ""),
                    EditorView.lineWrapping,
                    autocompletion({
                        override: [
                            context => {
                                const word = context.matchBefore(/[\w$]+/);
                                if (!word || (word.from === word.to && !context.explicit)) {
                                    return null;
                                }
                                return {
                                    from: word.from,
                                    options: props.current.completions.map(c => ({ type: "variable", ...c })),
                                };
                            },
                        ],
                    }),
                    linter(
                        v => {
                            const length = v.state.doc.length;
                            return props.current.validate(v.state.doc.toString()).map(d => ({
                                from: Math.min(d.from, length),
                                to: Math.min(d.to, length),
                                severity: d.severity,
                                message: translateDiagnostic(d),
                            }));
                        },
                        { delay: 300 },
                    ),
                    EditorView.updateListener.of(update => {
                        if (update.docChanged) {
                            props.current.onChange(update.state.doc.toString());
                        }
                    }),
                    themeCompartment.current.of(createTheme(theme, minRows)),
                ],
            }),
        });
        view.current = editor;
        return () => editor.destroy();
        // the editor is created only once, changes of the props are applied by the effects below
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // e.g. another state was selected
    useEffect(() => {
        const editor = view.current;
        if (editor && editor.state.doc.toString() !== value) {
            editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
        }
    }, [value]);

    useEffect(() => {
        view.current?.dispatch({ effects: themeCompartment.current.reconfigure(createTheme(theme, minRows)) });
    }, [theme, minRows]);

    // check again if e.g. a variable was added
    useEffect(() => {
        if (view.current) {
            forceLinting(view.current);
        }
    }, [validate]);

    const diagnostics = useMemo(() => validate(value), [validate, value]);

    // looks like an outlined TextField of MUI: the label in a gap of the border, the border darker on hover and in
    // the primary color while editing, the helper text indented
    const borderColor = theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.23)" : "rgba(0, 0, 0, 0.23)";
    return (
        <Box className="nokey">
            <Box
                sx={{
                    position: "relative",
                    borderRadius: "4px",
                    "&:hover fieldset": { borderColor: "text.primary" },
                    "&:focus-within fieldset": { borderColor: "primary.main", borderWidth: 2 },
                    "&:focus-within > label": { color: "primary.main" },
                }}
            >
                <Box
                    component="label"
                    sx={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        zIndex: 1,
                        transform: "translate(14px, -9px) scale(0.75)",
                        transformOrigin: "top left",
                        fontSize: "1rem",
                        lineHeight: "1.4375em",
                        color: "text.secondary",
                        pointerEvents: "none",
                        whiteSpace: "nowrap",
                    }}
                >
                    {label}
                </Box>
                <div ref={container} />
                <Box
                    component="fieldset"
                    aria-hidden
                    sx={{
                        position: "absolute",
                        inset: "-5px 0 0",
                        m: 0,
                        px: 1,
                        py: 0,
                        pointerEvents: "none",
                        borderRadius: "inherit",
                        border: 1,
                        borderColor,
                        minWidth: 0,
                        overflow: "hidden",
                        fontSize: "1rem",
                    }}
                >
                    <Box
                        component="legend"
                        sx={{
                            float: "unset",
                            width: "auto",
                            overflow: "hidden",
                            display: "block",
                            p: 0,
                            height: 11,
                            fontSize: "0.75em",
                            visibility: "hidden",
                            maxWidth: "100%",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {/* only the width of the label is used: the gap in the border */}
                        <Box
                            component="span"
                            sx={{ px: "5px", display: "inline-block", opacity: 0, visibility: "visible" }}
                        >
                            {label}
                        </Box>
                    </Box>
                </Box>
            </Box>
            {diagnostics.length ? (
                diagnostics.map((d, i) => (
                    <Typography
                        key={i}
                        variant="caption"
                        component="div"
                        color={`${d.severity}.main`}
                        sx={{ mt: "3px", mx: 1.75 }}
                    >
                        {translateDiagnostic(d)}
                    </Typography>
                ))
            ) : helperText ? (
                <Typography
                    variant="caption"
                    component="div"
                    color="text.secondary"
                    sx={{ mt: "3px", mx: 1.75 }}
                >
                    {helperText}
                </Typography>
            ) : null}
        </Box>
    );
}
