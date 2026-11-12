import { useCallback, useRef, useState } from "react";

/** Maximum number of steps which can be undone */
const MAX_STEPS = 100;

/** Changes with the same key within this time are one step, e.g. typing in a field */
const MERGE_MS = 1000;

/** A document in the history */
export interface HistoryEntry<T> {
    /** The edited document before/after a change */
    document: T;
    /** Identifies the document, used to know if it is the saved one */
    version: number;
}

/** The undo/redo history of a document */
export interface History<T> {
    /** The documents before the current one, the last one is restored by undo */
    past: HistoryEntry<T>[];
    /** The documents after the current one, the first one is restored by redo */
    future: HistoryEntry<T>[];
    /** Of the current document */
    version: number;
    /** Version of the saved document */
    savedVersion: number;
    /** Version of the next change */
    nextVersion: number;
    /** Key of the last recorded change */
    lastKey: string | null;
    /** Time of the last recorded change */
    lastTime: number;
}

/**
 * @returns an empty history of an unchanged document
 */
export function createHistory<T>(): History<T> {
    return { past: [], future: [], version: 0, savedVersion: 0, nextVersion: 1, lastKey: null, lastTime: 0 };
}

/**
 * Records the document before a change
 *
 * @param history The current history
 * @param document The document before the change
 * @param key Changes with the same key within a short time are one step
 * @param now The current time
 */
export function recordChange<T>(history: History<T>, document: T, key: string | null, now: number): History<T> {
    if (key !== null && key === history.lastKey && now - history.lastTime < MERGE_MS) {
        return { ...history, lastTime: now };
    }
    return {
        ...history,
        past: [...history.past.slice(-(MAX_STEPS - 1)), { document, version: history.version }],
        future: [],
        version: history.nextVersion,
        nextVersion: history.nextVersion + 1,
        lastKey: key,
        lastTime: now,
    };
}

/**
 * @param history The current history
 * @param current The current document
 * @returns null if there is nothing to undo
 */
export function undoChange<T>(history: History<T>, current: T): { history: History<T>; document: T } | null {
    const entry = history.past.at(-1);
    if (!entry) {
        return null;
    }
    return {
        document: entry.document,
        history: {
            ...history,
            past: history.past.slice(0, -1),
            future: [{ document: current, version: history.version }, ...history.future],
            version: entry.version,
            lastKey: null,
        },
    };
}

/**
 * @param history The current history
 * @param current The current document
 * @returns null if there is nothing to redo
 */
export function redoChange<T>(history: History<T>, current: T): { history: History<T>; document: T } | null {
    const entry = history.future[0];
    if (!entry) {
        return null;
    }
    return {
        document: entry.document,
        history: {
            ...history,
            past: [...history.past, { document: current, version: history.version }],
            future: history.future.slice(1),
            version: entry.version,
            lastKey: null,
        },
    };
}

/**
 * @param history The current history
 * @param version The version which was saved, changes during saving are still unsaved
 */
export function markSaved<T>(history: History<T>, version: number): History<T> {
    // the next change is a new step, even if it has the same key as the last one
    return { ...history, savedVersion: version, lastKey: null };
}

/** Undo/redo of an editor, see useEditHistory() */
export interface EditHistory {
    /**
     * Must be called before the document is changed
     *
     * @param key Changes with the same key within a short time are one step
     */
    record: (key?: string | null) => void;
    /** Restores the document before the last change */
    undo: () => void;
    /** Restores the document after the last undone change */
    redo: () => void;
    /** Must be called after the document was saved, with the version which was saved */
    markSaved: (version: number) => void;
    /** the version of the current document, see markSaved() */
    version: number;
    /** There is a change which can be undone */
    canUndo: boolean;
    /** There is an undone change which can be redone */
    canRedo: boolean;
    /** true if the document differs from the saved one */
    changed: boolean;
}

/**
 * Undo/redo for an editor. The editor calls record() before each change of its document.
 *
 * @param document The current document
 * @param restore Sets the document of the editor
 */
export function useEditHistory<T>(document: T, restore: (document: T) => void): EditHistory {
    // the refs are updated during render, so the callbacks always see the current values,
    // even if they are called several times before the next render (see undo())
    const documentRef = useRef(document);
    // eslint-disable-next-line react-hooks/refs
    documentRef.current = document;
    const restoreRef = useRef(restore);
    // eslint-disable-next-line react-hooks/refs
    restoreRef.current = restore;

    const [history, setHistory] = useState<History<T>>(createHistory);
    // the history is also read by event handlers, which may run several times before the next render
    const historyRef = useRef(history);
    // eslint-disable-next-line react-hooks/refs
    historyRef.current = history;

    // stable, it only uses the ref and the setter of the state
    const update = useCallback((value: History<T>): void => {
        historyRef.current = value;
        setHistory(value);
    }, []);

    const record = useCallback(
        (key: string | null = null) => update(recordChange(historyRef.current, documentRef.current, key, Date.now())),
        [update],
    );

    const undo = useCallback(() => {
        const result = undoChange(historyRef.current, documentRef.current);
        if (result) {
            restoreRef.current(result.document);
            // several undos may run before the next render
            documentRef.current = result.document;
            update(result.history);
        }
    }, [update]);

    const redo = useCallback(() => {
        const result = redoChange(historyRef.current, documentRef.current);
        if (result) {
            restoreRef.current(result.document);
            documentRef.current = result.document;
            update(result.history);
        }
    }, [update]);

    return {
        record,
        undo,
        redo,
        markSaved: useCallback((version: number) => update(markSaved(historyRef.current, version)), [update]),
        version: history.version,
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
        changed: history.version !== history.savedVersion,
    };
}
