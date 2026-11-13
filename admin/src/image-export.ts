/*
 * Export of the whole chart as PNG image, also the parts outside of the visible area
 */

import { toPng } from "html-to-image";

/** A rectangle in the coordinates of the flow */
export interface Frame {
    /** Left border */
    x: number;
    /** Top border */
    y: number;
    /** Width */
    width: number;
    /** Height */
    height: number;
}

/** Space around the chart in the image, also for the marker of the initial state left of it */
export const IMAGE_PADDING = 50;

/** The image has this many pixels per pixel of the chart, so the text stays sharp when zooming into it */
const PIXEL_RATIO = 2;

/** Elements of the editor which are not part of the chart: connection points, resize handles, grips */
const EXCLUDED_CLASSES = ["react-flow__handle", "react-flow__resize-control", "statechart-grip"];

/**
 * @param rects The rectangles of all elements of the chart: states, function blocks, notes, transitions, labels
 * @param padding Space around them
 * @returns the smallest rectangle around all of them with the padding, null if there are none
 */
export function getImageFrame(rects: Frame[], padding = IMAGE_PADDING): Frame | null {
    if (!rects.length) {
        return null;
    }
    const left = Math.min(...rects.map(r => r.x));
    const top = Math.min(...rects.map(r => r.y));
    const right = Math.max(...rects.map(r => r.x + r.width));
    const bottom = Math.max(...rects.map(r => r.y + r.height));
    return {
        x: Math.floor(left - padding),
        y: Math.floor(top - padding),
        width: Math.ceil(right - left + 2 * padding),
        height: Math.ceil(bottom - top + 2 * padding),
    };
}

/**
 * Renders a part of the flow as PNG image
 *
 * @param viewport The element ".react-flow__viewport" of React Flow, it contains the nodes, edges and labels
 * @param frame The part of the flow, in its coordinates
 * @param background Color of the background
 * @returns the image as data URL
 */
export function renderImage(viewport: HTMLElement, frame: Frame, background: string): Promise<string> {
    return toPng(viewport, {
        backgroundColor: background,
        width: frame.width,
        height: frame.height,
        pixelRatio: PIXEL_RATIO,
        // shows the frame at zoom 1, independent of the current zoom and position of the editor
        style: {
            width: `${frame.width}px`,
            height: `${frame.height}px`,
            transform: `translate(${-frame.x}px, ${-frame.y}px) scale(1)`,
        },
        // text nodes have no classList; written without DOM types, the tests of the adapter compile this file too
        filter: node => {
            const classes = (node as { classList?: { contains: (name: string) => boolean } }).classList;
            return !EXCLUDED_CLASSES.some(c => classes?.contains(c));
        },
    });
}
