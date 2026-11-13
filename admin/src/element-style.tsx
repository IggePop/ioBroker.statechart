/*
 * Color and icon of each kind of element, used in the toolbar, in the headings of the properties and in the list of
 * charts, so the same kind always looks the same
 */

import type React from "react";
import {
    AccountTreeOutlined as ChartIcon,
    Functions as FunctionIcon,
    RectangleOutlined as StateIcon,
    StickyNote2Outlined as NoteIcon,
    TrendingFlat as TransitionIcon,
} from "@mui/icons-material";

/** A color of the MUI theme, so it works in the light and in the dark theme */
export type ElementColor = "primary" | "secondary" | "info" | "warning" | "success";

/** The kinds of elements */
export type ElementKind = "state" | "transition" | "function" | "note" | "chart";

/** Color and icon of a kind of element */
export interface ElementStyle {
    /** Color of the theme */
    color: ElementColor;
    /** Icon of MUI */
    Icon: React.ElementType;
}

/** Color and icon of each kind of element */
export const ELEMENT_STYLES: Record<ElementKind, ElementStyle> = {
    state: { color: "primary", Icon: StateIcon },
    transition: { color: "info", Icon: TransitionIcon },
    function: { color: "secondary", Icon: FunctionIcon },
    note: { color: "warning", Icon: NoteIcon },
    chart: { color: "success", Icon: ChartIcon },
};
