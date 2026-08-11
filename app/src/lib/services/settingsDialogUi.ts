import type { OpencodeSettings } from "../domain/contracts";
import { isOpencodeEnabled } from "./opencodeSettings";
import { appState } from "../state/appState";

export type SettingsDialogTab =
  | "editor"
  | "shortcuts"
  | "appearance"
  | "versionControl"
  | "dev"
  | "opencode"
  | "openCodeConfig"
  | "providers"
  | "mcp"
  | "agents"
  | "permissions"
  | "commands"
  | "instructions"
  | "logs";

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

const OPENCODE_TAB = {
  id: "opencode",
  label: "OpenCode",
  panelAriaLabel: "OpenCode settings for Workspaces",
} as const satisfies SettingsTabDefinition;

const OPENCODE_CONFIG_TAB = {
  id: "openCodeConfig",
  label: "Config",
  panelAriaLabel: "OpenCode configuration editor",
} as const satisfies SettingsTabDefinition;

const PROVIDERS_TAB = {
  id: "providers",
  label: "Providers",
  panelAriaLabel: "OpenCode provider management",
} as const satisfies SettingsTabDefinition;

const MCP_TAB = {
  id: "mcp",
  label: "MCP servers",
  panelAriaLabel: "OpenCode MCP server management",
} as const satisfies SettingsTabDefinition;

const AGENTS_TAB = {
  id: "agents",
  label: "Agents",
  panelAriaLabel: "OpenCode agent management",
} as const satisfies SettingsTabDefinition;

const PERMISSIONS_TAB = {
  id: "permissions",
  label: "Permissions",
  panelAriaLabel: "OpenCode permission rules editor",
} as const satisfies SettingsTabDefinition;

const COMMANDS_TAB = {
  id: "commands",
  label: "Commands",
  panelAriaLabel: "OpenCode slash command management",
} as const satisfies SettingsTabDefinition;

const INSTRUCTIONS_TAB = {
  id: "instructions",
  label: "Instructions",
  panelAriaLabel: "OpenCode instructions and skills management",
} as const satisfies SettingsTabDefinition;

const LOGS_TAB = {
  id: "logs",
  label: "Logs",
  panelAriaLabel: "Logging settings",
} as const satisfies SettingsTabDefinition;

/**
 * Tabs gated behind the OpenCode master toggle (the workspace-sessions beta).
 * When the toggle is off, these tabs are hidden from the sidebar and
 * unreachable from any panel switcher / deep link.
 */
export const OPENCODE_GATED_TABS = [
  OPENCODE_TAB,
  OPENCODE_CONFIG_TAB,
  PROVIDERS_TAB,
  MCP_TAB,
  AGENTS_TAB,
  PERMISSIONS_TAB,
  COMMANDS_TAB,
  INSTRUCTIONS_TAB,
] as const satisfies readonly SettingsTabDefinition[];

const OPENCODE_GATED_TAB_IDS: ReadonlySet<SettingsDialogTab> = new Set(
  OPENCODE_GATED_TABS.map((tab) => tab.id),
);

/**
 * Whether a given tab id belongs to the OpenCode workspace-sessions beta
 * subtree and should only be reachable when the user has opted in.
 */
export function isOpencodeGatedTab(tab: SettingsDialogTab): boolean {
  return OPENCODE_GATED_TAB_IDS.has(tab);
}

const ALL_TABS = [
  EDITOR_TAB,
  SHORTCUTS_TAB,
  APPEARANCE_TAB,
  VERSION_CONTROL_TAB,
  DEV_TAB,
  OPENCODE_TAB,
  OPENCODE_CONFIG_TAB,
  PROVIDERS_TAB,
  MCP_TAB,
  AGENTS_TAB,
  PERMISSIONS_TAB,
  COMMANDS_TAB,
  INSTRUCTIONS_TAB,
  LOGS_TAB,
] as const satisfies readonly SettingsTabDefinition[];

export const SETTINGS_TABS = ALL_TABS;

/**
 * Resolve a deep-link tab against the OpenCode beta gate. When the gate is
 * closed, its gated tabs redirect to the Dev master panel; other tabs pass
 * through unchanged.
 */
export function resolveOpenSettingsDialogTab(
  requested: SettingsDialogTab,
  opencode: OpencodeSettings | null | undefined,
): SettingsDialogTab {
  if (isOpencodeGatedTab(requested) && !isOpencodeEnabled(opencode)) {
    return "dev";
  }
  return requested;
}

/**
 * Build the sidebar entries for the settings dialog. The Dev section always
 * contains its master toggle plus Logs; the Workspaces subtree (OpenCode,
 * Config, Providers, MCP servers, Agents, Permissions, Commands,
 * Instructions) is appended only when OpenCode is enabled so hidden tabs are
 * not reachable from measure/layout code paths. The Workspaces section is
 * omitted entirely when OpenCode is disabled (no orphan header).
 */
export function buildSettingsSidebar(
  opencode: OpencodeSettings | null | undefined,
): readonly SettingsSidebarEntry[] {
  const devTabs: readonly SettingsTabDefinition[] = [DEV_TAB, LOGS_TAB];
  const entries: SettingsSidebarEntry[] = [
    { kind: "tab", tab: EDITOR_TAB },
    { kind: "tab", tab: SHORTCUTS_TAB },
    { kind: "tab", tab: APPEARANCE_TAB },
    { kind: "tab", tab: VERSION_CONTROL_TAB },
    { kind: "section", label: "Dev", tabs: devTabs },
  ];
  if (isOpencodeEnabled(opencode)) {
    entries.push({
      kind: "section",
      label: "Workspaces",
      tabs: [...OPENCODE_GATED_TABS],
    });
  }
  return entries;
}

export const SETTINGS_SIDEBAR = buildSettingsSidebar(
  { enabled: false, mode: "sidecar", baseUrl: "", sidecarPort: 4096 },
);

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
  const resolved = resolveAgainstCurrentAppState(tab);
  opener?.(resolved);
}

function resolveAgainstCurrentAppState(tab: SettingsDialogTab): SettingsDialogTab {
  try {
    const state = appState.getSnapshot();
    return resolveOpenSettingsDialogTab(tab, state.settings.opencode);
  } catch {
    return resolveOpenSettingsDialogTab(tab, null);
  }
}

export function getSettingsTabDefinition(tab: SettingsDialogTab): SettingsTabDefinition {
  const definition = SETTINGS_TABS.find((entry) => entry.id === tab);
  if (!definition) {
    throw new Error(`Unknown settings tab: ${tab}`);
  }
  return definition;
}
