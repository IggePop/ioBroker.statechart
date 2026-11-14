import React, { useEffect, useState } from "react";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";
import { Check as CopiedIcon, ContentCopy as CopyIcon } from "@mui/icons-material";
import { copy, I18n } from "@iobroker/adapter-react-v5";
import InfoTip from "./InfoTip";
import CodeViewer from "./CodeViewer";

/**
 * Shows the code generated from the chart
 *
 * @param props Component properties
 * @param props.code The generated code
 * @param props.unsaved If the chart has unsaved changes, which are included in the code
 * @param props.onClose Called when the dialog is closed
 */
export default function GeneratedCodeDialog({
    code,
    unsaved,
    onClose,
}: {
    code: string;
    unsaved: boolean;
    onClose: () => void;
}): React.JSX.Element {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) {
            return undefined;
        }
        const timer = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(timer);
    }, [copied]);

    return (
        <Dialog
            open
            onClose={onClose}
            maxWidth="lg"
            fullWidth
            slotProps={{ paper: { sx: { height: "85vh" } } }}
        >
            <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {I18n.t("Generated code")}
                <InfoTip text={I18n.t("generatedCodeHelp")} />
            </DialogTitle>
            <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {/* a status, not an explanation: it stays visible */}
                {unsaved && (
                    <Typography
                        variant="body2"
                        color="text.secondary"
                    >
                        {I18n.t("generatedCodeUnsaved")}
                    </Typography>
                )}
                <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                    <CodeViewer value={code} />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button
                    startIcon={copied ? <CopiedIcon /> : <CopyIcon />}
                    onClick={() => {
                        copy(code);
                        setCopied(true);
                    }}
                >
                    {I18n.t(copied ? "Copied" : "Copy")}
                </Button>
                <Button
                    variant="contained"
                    onClick={onClose}
                >
                    {I18n.t("Close")}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
