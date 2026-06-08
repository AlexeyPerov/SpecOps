export type BuiltinThemeId = "dark-amber" | "light-blue";

export const BUILTIN_THEME_IDS: BuiltinThemeId[] = ["dark-amber", "light-blue"];

export const DEFAULT_BUILTIN_THEME: BuiltinThemeId = "dark-amber";

export const THEME_TOKEN_KEYS = [
  "color-bg-root",
  "color-surface-1",
  "color-surface-overlay",
  "color-border-subtle",
  "color-text-primary",
  "color-text-secondary",
  "color-statusbar-bg",
  "accent-color",
  "color-accent",
  "color-hover",
  "color-pressed",
  "color-focus-ring",
  "color-search-match",
  "color-search-match-current",
  "scrollbar-track",
  "scrollbar-thumb",
  "scrollbar-thumb-hover",
  "syntax-keyword",
  "syntax-string",
  "syntax-comment",
  "syntax-number",
  "syntax-type",
  "syntax-heading",
  "syntax-link",
  "syntax-markup",
  "syntax-punctuation",
  "project-pane-color-hidden",
  "project-pane-color-text",
] as const;

export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number];
export type ThemeTokens = Record<ThemeTokenKey, string>;

export type ThemeTokenGroupId =
  | "background"
  | "text"
  | "accent"
  | "syntax"
  | "search"
  | "project-pane";

export interface ThemeTokenGroup {
  id: ThemeTokenGroupId;
  label: string;
  keys: ThemeTokenKey[];
}

export const THEME_TOKEN_GROUPS: ThemeTokenGroup[] = [
  {
    id: "background",
    label: "Background & surfaces",
    keys: [
      "color-bg-root",
      "color-surface-1",
      "color-surface-overlay",
      "color-statusbar-bg",
      "scrollbar-track",
      "scrollbar-thumb",
      "scrollbar-thumb-hover",
    ],
  },
  {
    id: "text",
    label: "Text & borders",
    keys: ["color-text-primary", "color-text-secondary", "color-border-subtle"],
  },
  {
    id: "accent",
    label: "Accent & interaction",
    keys: [
      "accent-color",
      "color-accent",
      "color-hover",
      "color-pressed",
      "color-focus-ring",
    ],
  },
  {
    id: "syntax",
    label: "Syntax",
    keys: [
      "syntax-keyword",
      "syntax-string",
      "syntax-comment",
      "syntax-number",
      "syntax-type",
      "syntax-heading",
      "syntax-link",
      "syntax-markup",
      "syntax-punctuation",
    ],
  },
  {
    id: "search",
    label: "Search",
    keys: ["color-search-match", "color-search-match-current"],
  },
  {
    id: "project-pane",
    label: "Project pane",
    keys: ["project-pane-color-hidden", "project-pane-color-text"],
  },
];

export const THEME_TOKEN_LABELS: Record<ThemeTokenKey, string> = {
  "color-bg-root": "App background",
  "color-surface-1": "Panels & editor surface",
  "color-surface-overlay": "Overlays",
  "color-border-subtle": "Subtle border",
  "color-text-primary": "Primary text",
  "color-text-secondary": "Secondary text",
  "color-statusbar-bg": "Status bar",
  "accent-color": "Accent",
  "color-accent": "Accent (CSS alias)",
  "color-hover": "Hover",
  "color-pressed": "Pressed",
  "color-focus-ring": "Focus ring",
  "color-search-match": "Search match",
  "color-search-match-current": "Current search match",
  "scrollbar-track": "Scrollbar track",
  "scrollbar-thumb": "Scrollbar thumb",
  "scrollbar-thumb-hover": "Scrollbar thumb (hover)",
  "syntax-keyword": "Keyword",
  "syntax-string": "String",
  "syntax-comment": "Comment",
  "syntax-number": "Number",
  "syntax-type": "Type",
  "syntax-heading": "Heading",
  "syntax-link": "Link",
  "syntax-markup": "Markup",
  "syntax-punctuation": "Punctuation",
  "project-pane-color-hidden": "Hidden (dot-prefixed)",
  "project-pane-color-text": "Text, Markdown, extensionless",
};
