import React, { memo } from "react";
import { NodeResizer } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { Box, Typography } from "@mui/material";
import { I18n } from "@iobroker/adapter-react-v5";
import type { ChartFunction } from "../../../src/lib/chart-model";
import { getDeclarations } from "../../../src/lib/chart-validation";
import CommentBadge from "./CommentBadge";
import { getProblemColor } from "./ProblemBadge";
import type { ProblemList } from "./ProblemBadge";

type FunctionNodeProps = NodeProps<
    Node<{
        fn: ChartFunction;
        problems?: ProblemList;
    }>
>;

/**
 * A function block: square corners and a different color than states, no connection points
 */
function FunctionNode({ data, selected }: FunctionNodeProps): React.JSX.Element {
    const { fn, problems } = data;
    const signatures = getDeclarations(fn.code)
        .filter(d => d.signature)
        .map(d => d.signature);
    let borderColor = "secondary.main";
    if (getProblemColor(problems)) {
        borderColor = getProblemColor(problems)!;
    } else if (selected) {
        borderColor = "primary.main";
    }
    return (
        <>
            <NodeResizer
                isVisible={selected}
                minWidth={120}
                minHeight={50}
            />
            <Box
                title={problems?.messages.join("\n")}
                sx={{
                    width: "100%",
                    height: "100%",
                    border: 2,
                    borderStyle: problems ? "dashed" : "solid",
                    borderColor,
                    borderRadius: 0,
                    // light gray, so function blocks stand out from the states, a dark gray in the dark theme
                    bgcolor: theme => theme.palette.grey[theme.palette.mode === "dark" ? 800 : 200],
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}
            >
                <Box
                    sx={{
                        bgcolor: "secondary.main",
                        color: "secondary.contrastText",
                        px: 1,
                        py: 0.25,
                        position: "relative",
                    }}
                >
                    <CommentBadge
                        comment={fn.comment}
                        sx={{ position: "absolute", right: 4, top: 4 }}
                    />
                    {signatures.length ? (
                        signatures.map(signature => (
                            <Typography
                                key={signature}
                                variant="subtitle2"
                                sx={{ fontFamily: "monospace", fontWeight: "bold" }}
                                noWrap
                            >
                                {`ƒ ${signature}`}
                            </Typography>
                        ))
                    ) : (
                        <Typography
                            variant="subtitle2"
                            sx={{ fontStyle: "italic" }}
                            noWrap
                        >
                            {`ƒ ${I18n.t("Function")}`}
                        </Typography>
                    )}
                </Box>
                <Typography
                    variant="caption"
                    component="div"
                    sx={{ fontFamily: "monospace", whiteSpace: "pre", lineHeight: 1.3, px: 1, py: 0.5, opacity: 0.8 }}
                >
                    {fn.code}
                </Typography>
            </Box>
        </>
    );
}

export default memo(FunctionNode);
