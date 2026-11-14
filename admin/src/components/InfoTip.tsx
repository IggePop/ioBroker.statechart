import React, { useState } from "react";
import { Box, Checkbox, ClickAwayListener, FormControlLabel, IconButton, InputAdornment, Tooltip } from "@mui/material";
import { InfoOutlined as InfoIcon } from "@mui/icons-material";
import { I18n } from "@iobroker/adapter-react-v5";

/**
 * An explanation behind an ⓘ icon: shown while the pointer is over the icon, and also on click or tap, so it works
 * on touch screens. A click elsewhere closes it.
 *
 * @param props Component properties
 * @param props.text The explanation
 */
export default function InfoTip({ text }: { text: string }): React.JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <ClickAwayListener onClickAway={() => setOpen(false)}>
            {/* the span is the reference of the click away listener */}
            <Box
                component="span"
                sx={{ display: "inline-flex", flexShrink: 0 }}
            >
                <Tooltip
                    title={<Box sx={{ whiteSpace: "pre-line" }}>{text}</Box>}
                    open={open}
                    onOpen={() => setOpen(true)}
                    onClose={() => setOpen(false)}
                    // a tap is handled by the click below: with the touch listener of the tooltip as well, the tap
                    // opened it and the click right after it closed it again
                    disableTouchListener
                    arrow
                >
                    <IconButton
                        size="small"
                        aria-label={I18n.t("Explanation")}
                        // only opens, a tap or click elsewhere closes it; inside the label of a checkbox, the click
                        // must not toggle the checkbox
                        onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpen(true);
                        }}
                        sx={{ p: 0.25, color: "text.secondary" }}
                    >
                        <InfoIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                </Tooltip>
            </Box>
        </ClickAwayListener>
    );
}

/**
 * @param text Explanation of a TextField
 * @returns slotProps for a TextField of MUI: the ⓘ icon at the end of the field, at the top of multiline fields
 */
export function infoSlotProps(text: string): { input: { endAdornment: React.ReactNode } } {
    return {
        input: {
            endAdornment: (
                <InputAdornment
                    position="end"
                    sx={{ alignSelf: "flex-start", mt: 1.25, height: "auto" }}
                >
                    <InfoTip text={text} />
                </InputAdornment>
            ),
        },
    };
}

/**
 * An option as checkbox, with its explanation behind an ⓘ icon
 *
 * @param props Component properties
 * @param props.label Label of the checkbox
 * @param props.checked If the option is on
 * @param props.onChange Called with the new value
 * @param props.info Explanation of the option
 */
export function OptionCheckbox({
    label,
    checked,
    onChange,
    info,
}: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    info: string;
}): React.JSX.Element {
    return (
        <Box sx={{ display: "flex", alignItems: "center" }}>
            <FormControlLabel
                sx={{ mr: 0.5 }}
                control={
                    <Checkbox
                        checked={checked}
                        onChange={e => onChange(e.target.checked)}
                    />
                }
                label={label}
            />
            <InfoTip text={info} />
        </Box>
    );
}
