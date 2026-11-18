import type { ThemeName } from "@iobroker/adapter-react-v5";

/** The themes which `@iobroker/adapter-react-v5` can create */
const KNOWN_THEMES: readonly ThemeName[] = ["light", "dark", "colored", "blue", "PT", "DX", "NW", "HA"];

/**
 * Finds the theme of the tab for the theme of the admin. Admin 8 has themes which `@iobroker/adapter-react-v5` does
 * not know, e.g. "modernDark": without this, the tab would always be light with them.
 *
 * @param name Theme name, e.g. from the admin; "auto", null or undefined for the one stored by the admin
 * @param storedName The theme name stored by the admin (local storage "App.themeName"), shared with the tab
 * @param prefersDark If the operating system or browser prefers a dark theme
 * @returns a theme which `@iobroker/adapter-react-v5` can create
 */
export function resolveThemeName(
    name: string | null | undefined,
    storedName: string | null | undefined,
    prefersDark: boolean,
): ThemeName {
    let theme = name && name !== "auto" ? name : storedName;
    if (!theme || theme === "auto") {
        return prefersDark ? "dark" : "light";
    }
    if ((KNOWN_THEMES as readonly string[]).includes(theme)) {
        return theme as ThemeName;
    }
    // e.g. "modernDark" and "modernLight" of admin 8
    theme = theme.toLowerCase();
    if (theme.includes("dark")) {
        return "dark";
    }
    if (theme.includes("light")) {
        return "light";
    }
    return prefersDark ? "dark" : "light";
}
