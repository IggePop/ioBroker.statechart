import React, { memo } from "react";
import { NodeResizer } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { Box, Typography } from "@mui/material";
import { I18n } from "@iobroker/adapter-react-v5";
import type { ChartNote } from "../../../src/lib/chart-model";

type NoteNodeProps = NodeProps<
    Node<{
        note: ChartNote;
        isDropTarget?: boolean;
    }>
>;

/**
 * A note on the canvas, like a sticky note. It has no connection points.
 *
 * @param props Properties of the node from React Flow
 * @param props.data The note, and if a dragged node would be dropped into it
 * @param props.selected The note is selected
 */
function NoteNode({ data, selected }: NoteNodeProps): React.JSX.Element {
    const { note } = data;
    return (
        <>
            <NodeResizer
                isVisible={selected}
                minWidth={80}
                minHeight={40}
            />
            <Box
                sx={theme => ({
                    width: "100%",
                    height: "100%",
                    px: 1,
                    py: 0.5,
                    overflow: "auto",
                    // yellow like a sticky note, darker in the dark theme
                    bgcolor: theme.palette.mode === "dark" ? "#5c5320" : "#fff6b3",
                    color: theme.palette.mode === "dark" ? "#fdf6c9" : "#3b3510",
                    border: 1,
                    borderColor: selected ? "primary.main" : theme.palette.mode === "dark" ? "#8a7d30" : "#e6d77a",
                    borderRadius: 0.5,
                    boxShadow: 2,
                })}
            >
                <Typography
                    variant="body2"
                    component="div"
                    sx={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontStyle: note.text ? "normal" : "italic",
                        opacity: note.text ? 1 : 0.6,
                    }}
                >
                    {note.text || I18n.t("Note")}
                </Typography>
            </Box>
        </>
    );
}

export default memo(NoteNode);
