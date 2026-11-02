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
    label: string;
    detail?: string;
    info?: string;
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
                "&": {
                    fontSize: "13px",
                    backgroundColor: theme.palette.background.paper,
                    color: theme.palette.text.primary,
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: "4px",
                },
                "&.cm-focused": {
                    outline: `2px solid ${theme.palette.primary.main}`,
                    outlineOffset: "-1px",
                },
                ".cm-content": {
                    fontFamily: "monospace",
                    minHeight: `${minRows * 1.4 + 0.8}em`,
                    caretColor: theme.palette.text.primary,
                },
                ".cm-line": { lineHeight: "1.4" },
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
    label: string;
    value: string;
    onChange: (value: string) => void;
    validate: (text: string) => Diagnostic[];
    completions: Completion[];
    placeholder?: string;
    /** Shown if there are no problems */
    helperText?: string;
    minRows?: number;
}

/**
 * Code input with JavaScript syntax highlighting, underlined errors and completion of variable names
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

    return (
        <Box className="nokey">
            <Typography
                variant="caption"
                color="text.secondary"
                component="div"
                sx={{ mb: 0.5 }}
            >
                {label}
            </Typography>
            <div ref={container} />
            {diagnostics.length ? (
                diagnostics.map((d, i) => (
                    <Typography
                        key={i}
                        variant="caption"
                        component="div"
                        color={`${d.severity}.main`}
                        sx={{ mt: 0.5 }}
                    >
                        {translateDiagnostic(d)}
                    </Typography>
                ))
            ) : helperText ? (
                <Typography
                    variant="caption"
                    component="div"
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                >
                    {helperText}
                </Typography>
            ) : null}
        </Box>
    );
}
