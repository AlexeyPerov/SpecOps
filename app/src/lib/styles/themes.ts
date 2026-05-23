export type AppTheme =
  | "dark-blue"
  | "dark-violet"
  | "dark-green"
  | "dark-amber"
  | "dark-rose"
  | "dark-teal"
  | "light-blue"
  | "light-violet"
  | "light-green"
  | "light-amber"
  | "light-rose"
  | "light-teal";

export const APP_THEME_IDS: AppTheme[] = [
  "dark-blue",
  "dark-violet",
  "dark-green",
  "dark-amber",
  "dark-rose",
  "dark-teal",
  "light-blue",
  "light-violet",
  "light-green",
  "light-amber",
  "light-rose",
  "light-teal",
];

export const DEFAULT_THEME: AppTheme = "dark-blue";

const ACCENT_LABELS: Record<string, string> = {
  blue: "Blue",
  violet: "Violet",
  green: "Green",
  amber: "Amber",
  rose: "Rose",
  teal: "Teal",
};

export function getThemeLabel(id: AppTheme): string {
  const [mode, accent] = id.split("-");
  const modeLabel = mode === "dark" ? "Dark" : "Light";
  return `${ACCENT_LABELS[accent] ?? accent} (${modeLabel})`;
}

export function getThemeMode(id: AppTheme): "dark" | "light" {
  return id.startsWith("dark") ? "dark" : "light";
}

export function getThemeAccentHex(id: AppTheme): string {
  const isDark = getThemeMode(id) === "dark";
  const map: Record<string, [string, string]> = {
    blue: ["#2f80ed", "#2376ff"],
    violet: ["#8b5cf6", "#7c3aed"],
    green: ["#22a06b", "#16a34a"],
    amber: ["#d97706", "#b45309"],
    rose: ["#e11d48", "#be123c"],
    teal: ["#0891b2", "#0e7490"],
  };
  const [, accent] = id.split("-");
  const pair = map[accent] ?? map.blue;
  return isDark ? pair[0] : pair[1];
}

export function isValidTheme(value: string): value is AppTheme {
  return (APP_THEME_IDS as readonly string[]).includes(value);
}
