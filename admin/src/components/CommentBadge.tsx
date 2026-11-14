import React from "react";
import type { SxProps } from "@mui/material";
import { ChatBubbleOutline as CommentIcon } from "@mui/icons-material";
import { TapTooltip } from "./InfoTip";

/**
 * Shows that an element has a comment, the comment itself is shown as tooltip, also on tap
 *
 * @param props Component properties
 * @param props.comment The comment, nothing is shown if it is empty
 * @param props.sx Additional styles of the icon
 */
export default function CommentBadge({
    comment,
    sx,
}: {
    comment: string | undefined;
    sx?: SxProps;
}): React.JSX.Element | null {
    if (!comment?.trim()) {
        return null;
    }
    return (
        <TapTooltip text={comment.trim()}>
            <CommentIcon
                sx={{ fontSize: 14, opacity: 0.7, ...sx }}
                aria-label={comment}
            />
        </TapTooltip>
    );
}
