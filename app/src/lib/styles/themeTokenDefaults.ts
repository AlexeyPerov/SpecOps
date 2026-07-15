import type { BuiltinThemeId, ThemeTokenKey } from "./themeTokenSchema";
import type { ThemeSyntaxPalette } from "./themeSyntaxTokens";

export const BUILTIN_LABELS: Record<BuiltinThemeId, string> = {
  "dark-amber": "Amber",
  "light-blue": "Blue",
};

export const BUILTIN_ACCENT_HEX: Record<BuiltinThemeId, string> = {
  "dark-amber": "#d97706",
  "light-blue": "#2376ff",
};

export const MODE_UI_TOKEN_KEYS = [
  "color-bg-root",
  "color-surface-1",
  "color-surface-overlay",
  "color-border-subtle",
  "color-text-primary",
  "color-text-secondary",
  "color-statusbar-bg",
  "color-hover",
  "color-pressed",
  "color-focus-ring",
  "color-search-match",
  "color-search-match-current",
  "scrollbar-track",
  "scrollbar-thumb",
  "scrollbar-thumb-hover",
] as const satisfies ReadonlyArray<ThemeTokenKey>;

type ModeUiTokenKey = (typeof MODE_UI_TOKEN_KEYS)[number];

export const MODE_UI_TOKENS: Record<"dark" | "light", Record<ModeUiTokenKey, string>> = {
  dark: {
    "color-bg-root": "#0f141b",
    "color-surface-1": "#131a23",
    "color-surface-overlay": "rgb(25 31 40 / var(--opacity-overlay-tint))",
    "color-border-subtle": "rgb(215 227 248 / 18%)",
    "color-text-primary": "#e2e8f0",
    "color-text-secondary": "#9db0c8",
    "color-statusbar-bg": "#101620",
    "color-hover": "rgb(89 152 243 / 18%)",
    "color-pressed": "rgb(89 152 243 / 26%)",
    "color-focus-ring": "color-mix(in srgb, var(--color-accent) 76%, white)",
    "color-search-match": "rgba(255, 200, 0, 0.28)",
    "color-search-match-current": "rgba(255, 150, 50, 0.55)",
    "scrollbar-track": "#0f141b",
    "scrollbar-thumb": "rgb(122 137 159 / 72%)",
    "scrollbar-thumb-hover": "rgb(151 169 196 / 82%)",
  },
  light: {
    "color-bg-root": "#f3f6fa",
    "color-surface-1": "#ffffff",
    "color-surface-overlay": "rgb(255 255 255 / var(--opacity-overlay-tint))",
    "color-border-subtle": "rgb(4 14 26 / 14%)",
    "color-text-primary": "#101828",
    "color-text-secondary": "#475467",
    "color-statusbar-bg": "#ebeff6",
    "color-hover": "rgb(20 71 170 / 10%)",
    "color-pressed": "rgb(20 71 170 / 18%)",
    "color-focus-ring": "color-mix(in srgb, var(--color-accent) 80%, white)",
    "color-search-match": "rgba(255, 200, 0, 0.45)",
    "color-search-match-current": "rgba(255, 150, 50, 0.75)",
    "scrollbar-track": "#e8edf4",
    "scrollbar-thumb": "rgb(71 84 103 / 45%)",
    "scrollbar-thumb-hover": "rgb(71 84 103 / 62%)",
  },
};

export const PROJECT_PANE_TOKENS: Record<
  "dark" | "light",
  Record<"project-pane-color-hidden" | "project-pane-color-text", string>
> = {
  dark: {
    "project-pane-color-hidden": "#9db0c8",
    "project-pane-color-text": "#56b6c2",
  },
  light: {
    "project-pane-color-hidden": "#475467",
    "project-pane-color-text": "#0891b2",
  },
};

export const SYNTAX_PALETTE_FIXED: Record<
  "dark" | "light",
  Omit<ThemeSyntaxPalette, "keyword" | "type" | "link" | "plaintext-symbol">
> = {
  dark: {
    string: "#98c379",
    comment: "#5c6370",
    number: "#d19a66",
    heading: "#e06c75",
    markup: "#56b6c2",
    punctuation: "#abb2bf",
  },
  light: {
    string: "#50a14f",
    comment: "#a0a1a7",
    number: "#986801",
    heading: "#e45649",
    markup: "#0184bc",
    punctuation: "#383a42",
  },
};
