
export type SettingsDialogTab =
  | "editor"
  | "shortcuts"
  | "appearance"
  | "versionControl"
  | "dev"
  | "logs"
  | "software";

export interface SettingsTabDefinition {
  id: SettingsDialogTab;
  label: string;
  panelAriaLabel: string;
}

export type SettingsSidebarEntry =
  | { kind: "tab"; tab: SettingsTabDefinition }
  | { kind: "section"; label: string; tabs: readonly SettingsTabDefinition[] };

const EDITOR_TAB = {
  id: "editor",
  label: "Editor",
  panelAriaLabel: "Editor settings",
} as const satisfies SettingsTabDefinition;

const SHORTCUTS_TAB = {
  id: "shortcuts",
  label: "Shortcuts",
  panelAriaLabel: "Keyboard shortcuts",
} as const satisfies SettingsTabDefinition;

const APPEARANCE_TAB = {
  id: "appearance",
  label: "Appearance",
  panelAriaLabel: "Appearance and feedback settings",
} as const satisfies SettingsTabDefinition;

const VERSION_CONTROL_TAB = {
  id: "versionControl",
  label: "Version Control",
  panelAriaLabel: "Version control and git integration settings",
} as const satisfies SettingsTabDefinition;

const DEV_TAB = {
  id: "dev",
  label: "Dev",
  panelAriaLabel: "Developer settings (beta features and logs)",
} as const satisfies SettingsTabDefinition;

const LOGS_TAB = {
  id: "logs",
  label: "Logs",
  panelAriaLabel: "Logging settings",
} as const satisfies SettingsTabDefinition;

const SOFTWARE_TAB = { id: "software", label: "Software", panelAriaLabel: "Agent software" } as const satisfies SettingsTabDefinition;

const ALL_TABS = [
  EDITOR_TAB,
  SHORTCUTS_TAB,
  APPEARANCE_TAB,
  VERSION_CONTROL_TAB,
  SOFTWARE_TAB,
  DEV_TAB,
  LOGS_TAB,
] as const satisfies readonly SettingsTabDefinition[];

export const SETTINGS_TABS = ALL_TABS;

/** Resolve an unknown deep link to the developer settings panel. */
export function resolveOpenSettingsDialogTab(
  requested: SettingsDialogTab,
): SettingsDialogTab {
  return SETTINGS_TABS.some(tab => tab.id === requested) ? requested : "dev";
}

/** Editor and developer settings; runtime profiles belong to Sessions. */
export function buildSettingsSidebar(
): readonly SettingsSidebarEntry[] {
  const devTabs: readonly SettingsTabDefinition[] = [DEV_TAB, LOGS_TAB];
  const entries: SettingsSidebarEntry[] = [
    { kind: "tab", tab: EDITOR_TAB },
    { kind: "tab", tab: SHORTCUTS_TAB },
    { kind: "tab", tab: APPEARANCE_TAB },
    { kind: "tab", tab: VERSION_CONTROL_TAB },
    { kind: "tab", tab: SOFTWARE_TAB },
    { kind: "section", label: "Dev", tabs: devTabs },
  ];
  return entries;
}

export const SETTINGS_SIDEBAR = buildSettingsSidebar();

function tabMatchesSettingsFilter(tab: SettingsTabDefinition, normalizedQuery: string): boolean {
  return tab.label.toLowerCase().includes(normalizedQuery);
}

/**
 * Client-side filter for the settings sidebar. Matches tab labels only; section
 * headers are kept when at least one tab in the section matches. Empty query
 * returns the input unchanged.
 */
export function filterSettingsSidebar(
  entries: readonly SettingsSidebarEntry[],
  query: string,
): readonly SettingsSidebarEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return entries;
  }

  const filtered: SettingsSidebarEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "tab") {
      if (tabMatchesSettingsFilter(entry.tab, normalizedQuery)) {
        filtered.push(entry);
      }
      continue;
    }

    const matchingTabs = entry.tabs.filter((tab) =>
      tabMatchesSettingsFilter(tab, normalizedQuery),
    );
    if (matchingTabs.length > 0) {
      filtered.push({ kind: "section", label: entry.label, tabs: matchingTabs });
    }
  }
  return filtered;
}

type SettingsDialogOpener = (tab: SettingsDialogTab) => void;

let opener: SettingsDialogOpener | null = null;

export function registerSettingsDialogOpener(next: SettingsDialogOpener | null): void {
  opener = next;
}

export function openSettingsDialog(tab: SettingsDialogTab = "editor"): void {
  const resolved = resolveOpenSettingsDialogTab(tab);
  opener?.(resolved);
}

export function getSettingsTabDefinition(tab: SettingsDialogTab): SettingsTabDefinition {
  const definition = SETTINGS_TABS.find((entry) => entry.id === tab);
  if (!definition) {
    throw new Error(`Unknown settings tab: ${tab}`);
  }
  return definition;
}
