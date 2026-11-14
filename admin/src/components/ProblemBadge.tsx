import React from "react";
import type { SxProps } from "@mui/material";
import { ErrorOutline as ErrorIcon, InfoOutlined as InfoIcon, WarningAmber as WarningIcon } from "@mui/icons-material";
import type { Severity } from "../../../src/lib/chart-analysis";
import { TapTooltip } from "./InfoTip";

/** The translated problems of a state, transition, function block or variable */
export interface ProblemList {
    /** The translated messages, shown in the tooltip */
    messages: string[];
    /** The most severe one */
    severity: Severity;
}

const RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

/**
 * Adds a problem to the problems of an element
 *
 * @param problems The problems by element
 * @param id ID of the element
 * @param message The translated message
 * @param severity Its severity
 */
export function addProblem(problems: Map<string, ProblemList>, id: string, message: string, severity: Severity): void {
    const list = problems.get(id);
    if (!list) {
        problems.set(id, { messages: [message], severity });
        return;
    }
    list.messages.push(message);
    if (RANK[severity] > RANK[list.severity]) {
        list.severity = severity;
    }
}

/**
 * @param problems The problems of an element
 * @returns the color of its border: only errors and warnings change it, hints are only shown by the badge
 */
export function getProblemColor(problems: ProblemList | undefined): string | undefined {
    return problems && problems.severity !== "info" ? `${problems.severity}.main` : undefined;
}

/**
 * Shows the problems of an element as icon of their severity, the messages are shown as tooltip, also on tap
 *
 * @param props Component properties
 * @param props.problems The problems, nothing is shown if there are none
 * @param props.sx Additional styles of the icon
 */
export default function ProblemBadge({
    problems,
    sx,
}: {
    problems: ProblemList | undefined;
    sx?: SxProps;
}): React.JSX.Element | null {
    if (!problems?.messages.length) {
        return null;
    }
    const Icon = { error: ErrorIcon, warning: WarningIcon, info: InfoIcon }[problems.severity];
    const text = problems.messages.join("\n");
    return (
        <TapTooltip text={text}>
            <Icon
                color={problems.severity}
                sx={{ fontSize: 16, flexShrink: 0, ...sx }}
                aria-label={text}
            />
        </TapTooltip>
    );
}
