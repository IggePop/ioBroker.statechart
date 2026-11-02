import React, { memo } from "react";
import { Handle, NodeResizer, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { Box, Typography } from "@mui/material";
import { I18n } from "@iobroker/adapter-react-v5";
import type { ChartState } from "../../../src/lib/chart-model";
import CommentBadge from "./CommentBadge";

/** One connection point per side, in loose connection mode each of them can start and end transitions */
const SIDES: [string, Position][] = [
    ["top", Position.Top],
    ["right", Position.Right],
    ["bottom", Position.Bottom],
    ["left", Position.Left],
];

const ACTIONS = ["entry", "during", "exit"] as const;

/**
 * Default transition marker (dot with arrow) shown left of the initial state
 */
function InitialMarker(): React.JSX.Element {
    return (
        <Box
            component="svg"
            width={40}
            height={20}
            sx={{ position: "absolute", left: -42, top: 8, color: "text.primary", pointerEvents: "none" }}
        >
            <circle
                cx={5}
                cy={10}
                r={4}
                fill="currentColor"
            />
            <line
                x1={9}
                y1={10}
                x2={34}
                y2={10}
                stroke="currentColor"
                strokeWidth={2}
            />
            <polygon
                points="40,10 32,5 32,15"
                fill="currentColor"
            />
        </Box>
    );
}

type StateNodeProps = NodeProps<
    Node<{
        state: ChartState;
        isInitial?: boolean;
        isActive?: boolean;
        isDropTarget?: boolean;
        problems?: string[];
        /** Position in the execution order, only for parallel states (whose parent is parallel) */
        order?: number;
        /** The simulation stops when the state is entered */
        breakpoint?: boolean;
    }>
>;

function StateNode({ data, selected }: StateNodeProps): React.JSX.Element {
    const { state, isInitial, isActive, isDropTarget, problems, order, breakpoint } = data;
    let borderColor = "text.secondary";
    if (isDropTarget) {
        borderColor = "primary.main";
    } else if (isActive) {
        borderColor = "success.main";
    } else if (problems) {
        borderColor = "error.main";
    } else if (selected) {
        borderColor = "primary.main";
    }
    return (
        <>
            <NodeResizer
                isVisible={selected}
                minWidth={100}
                minHeight={50}
            />
            {isInitial && <InitialMarker />}
            {breakpoint && (
                <Box
                    title={I18n.t("Breakpoint")}
                    sx={{
                        position: "absolute",
                        left: -6,
                        top: -6,
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        bgcolor: "error.main",
                        border: 2,
                        borderColor: "background.paper",
                        zIndex: 1,
                    }}
                />
            )}
            <Box
                title={problems?.join("\n")}
                sx={{
                    width: "100%",
                    height: "100%",
                    border: isActive || isDropTarget ? 3 : 2,
                    // like in Stateflow, parallel states have a dashed border
                    borderStyle: order !== undefined ? "dashed" : "solid",
                    borderColor,
                    borderRadius: 3,
                    // a state shows that the dragged state is moved into it when it is dropped
                    bgcolor: isDropTarget ? "action.selected" : "background.paper",
                    boxShadow: isActive ? 6 : 0,
                    px: 1,
                    py: 0.5,
                    overflow: "hidden",
                }}
            >
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Typography
                        variant="subtitle2"
                        sx={{ fontWeight: "bold", flex: 1, minWidth: 0 }}
                        noWrap
                    >
                        {state.name}
                    </Typography>
                    <CommentBadge comment={state.comment} />
                    {order !== undefined && (
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            title={I18n.t("executionOrderTitle", String(order))}
                            sx={{ fontWeight: "bold" }}
                        >
                            {order}
                        </Typography>
                    )}
                </Box>
                {ACTIONS.filter(action => state[action]).map(action => (
                    <Typography
                        key={action}
                        variant="caption"
                        component="div"
                        sx={{ fontFamily: "monospace", whiteSpace: "pre", lineHeight: 1.3 }}
                    >
                        {`${action}: ${state[action]}`}
                    </Typography>
                ))}
            </Box>
            {SIDES.map(([side, position]) => (
                <Handle
                    key={side}
                    id={side}
                    type="source"
                    position={position}
                />
            ))}
        </>
    );
}

export default memo(StateNode);
