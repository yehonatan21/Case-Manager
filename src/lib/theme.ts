/** The appearance a person chose: follow the device ("system"), or always light or dark. Kept in a cookie. */
export const THEME_COOKIE = "cm_theme";
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const parseTheme = (v: string | undefined | null): Theme => (v === "light" || v === "dark" ? v : "system");

/** The browser-bar colour that matches each appearance's page background. */
export const THEME_COLOR = { light: "#f9f6f2", dark: "#0c121a" } as const;
