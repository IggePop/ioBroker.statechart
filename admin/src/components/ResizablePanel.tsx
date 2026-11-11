import React, { useEffect, useRef, useState } from "react";
import { Box, IconButton } from "@mui/material";
import { ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon } from "@mui/icons-material";
import { I18n } from "@iobroker/adapter-react-v5";

function loadWidth(key: string, defaultWidth: number): number {
    try {
        const width = parseInt(window.localStorage.getItem(key) || "", 10);
        return Number.isFinite(width) ? width : defaultWidth;
    } catch {
        return defaultWidth;
    }
}

function saveWidth(key: string, width: number): void {
    try {
        window.localStorage.setItem(key, String(width));
    } catch {
        // the width is only a convenience, it does not matter if it cannot be stored
    }
}

function loadCollapsed(key: string): boolean {
    try {
        return window.localStorage.getItem(key) === "true";
    } catch {
        return false;
    }
}

function saveCollapsed(key: string, collapsed: boolean): void {
    try {
        window.localStorage.setItem(key, String(collapsed));
    } catch {
        // like the width, only a convenience
    }
}

/** Width of a collapsed panel */
const COLLAPSED_WIDTH = 28;

interface ResizablePanelProps {
    /** Side of the screen the panel is on, the drag handle is on the opposite side */
    side: "left" | "right";
    /** Key to remember the width, and with ".collapsed" if the panel is collapsed */
    storageKey: string;
    defaultWidth: number;
    minWidth: number;
    maxWidth: number;
    /** Name of the panel, shown on the collapsed panel and in the tooltips of its buttons */
    label: string;
    /** Expands the collapsed panel whenever this number changes, e.g. when its content is requested */
    expandRequest?: number;
    children: React.ReactNode;
}

/**
 * A column with a fixed width which can be changed by dragging its inner border, and which can be collapsed to a
 * narrow strip. The width and if it is collapsed are remembered in the browser.
 *
 * @param props Component properties, see ResizablePanelProps
 * @param props.side Side of the screen the panel is on
 * @param props.storageKey Key to remember the width and if the panel is collapsed
 * @param props.defaultWidth Width before it is changed, and after a double click on the border
 * @param props.minWidth Minimum width when dragging the border
 * @param props.maxWidth Maximum width when dragging the border
 * @param props.label Name of the panel
 * @param props.expandRequest Expands the collapsed panel whenever it changes
 * @param props.children Content of the panel
 */
export default function ResizablePanel({
    side,
    storageKey,
    defaultWidth,
    minWidth,
    maxWidth,
    label,
    expandRequest,
    children,
}: ResizablePanelProps): React.JSX.Element {
    const [width, setWidth] = useState(() =>
        Math.min(maxWidth, Math.max(minWidth, loadWidth(storageKey, defaultWidth))),
    );
    const collapsedKey = `${storageKey}.collapsed`;
    /**
     * The expand request at the time the panel was collapsed, null if it is expanded. A newer request expands the
     * panel, without an effect which changes the state.
     */
    const [collapsedAt, setCollapsedAt] = useState<number | undefined | null>(() =>
        loadCollapsed(collapsedKey) ? expandRequest : null,
    );
    const collapsed = collapsedAt !== null && collapsedAt === expandRequest;
    const drag = useRef<{ startX: number; startWidth: number } | null>(null);

    useEffect(() => saveCollapsed(collapsedKey, collapsed), [collapsedKey, collapsed]);

    const toggle = (value: boolean): void => setCollapsedAt(value ? expandRequest : null);

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
        e.preventDefault();
        // keep receiving the pointer events even if the pointer leaves the handle
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startWidth: width };
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
        if (!drag.current) {
            return;
        }
        const delta = e.clientX - drag.current.startX;
        const newWidth = drag.current.startWidth + (side === "left" ? delta : -delta);
        setWidth(Math.min(maxWidth, Math.max(minWidth, newWidth)));
    };

    const onPointerUp = (): void => {
        if (drag.current) {
            drag.current = null;
            saveWidth(storageKey, width);
        }
    };

    // the arrows point in the direction the panel moves
    const CollapseIcon = side === "left" ? ChevronLeftIcon : ChevronRightIcon;
    const ExpandIcon = side === "left" ? ChevronRightIcon : ChevronLeftIcon;
    const border = side === "left" ? { borderRight: 1 } : { borderLeft: 1 };

    if (collapsed) {
        return (
            <Box
                title={`${I18n.t("Expand")}: ${label}`}
                onClick={() => toggle(false)}
                sx={{
                    width: COLLAPSED_WIDTH,
                    flexShrink: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 1,
                    pt: 0.5,
                    cursor: "pointer",
                    ...border,
                    borderColor: "divider",
                    "&:hover": { bgcolor: "action.hover" },
                }}
            >
                <ExpandIcon fontSize="small" />
                <Box
                    component="span"
                    sx={{
                        // the name reads from top to bottom
                        writingMode: "vertical-rl",
                        whiteSpace: "nowrap",
                        fontSize: 13,
                        color: "text.secondary",
                    }}
                >
                    {label}
                </Box>
            </Box>
        );
    }

    const handle = (
        <Box
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => {
                setWidth(defaultWidth);
                saveWidth(storageKey, defaultWidth);
            }}
            sx={{
                position: "relative",
                width: 5,
                flexShrink: 0,
                cursor: "col-resize",
                touchAction: "none",
                bgcolor: "divider",
                transition: "background-color 0.2s",
                "&:hover, &:active": { bgcolor: "primary.main" },
            }}
        >
            <IconButton
                size="small"
                title={`${I18n.t("Collapse")}: ${label}`}
                // a click on the button is no drag of the border
                onPointerDown={e => e.stopPropagation()}
                onDoubleClick={e => e.stopPropagation()}
                onClick={() => toggle(true)}
                sx={{
                    position: "absolute",
                    top: 6,
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 1,
                    width: 20,
                    height: 20,
                    p: 0,
                    border: 1,
                    borderColor: "divider",
                    bgcolor: "background.paper",
                    cursor: "pointer",
                    "&:hover": { bgcolor: "background.paper", color: "primary.main" },
                }}
            >
                <CollapseIcon sx={{ fontSize: 16 }} />
            </IconButton>
        </Box>
    );

    return (
        <>
            {side === "right" && handle}
            <Box sx={{ width, flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>{children}</Box>
            {side === "left" && handle}
        </>
    );
}
