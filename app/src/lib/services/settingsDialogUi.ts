export type SettingsDialogTab =
  | "editor"
  | "shortcuts"
  | "connections"
  | "chatModes"
  | "debugAi"
  | "opencode"
  | "debugAgent"
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

const CONNECTIONS_TAB = {
  id: "connections",
  label: "Providers",
  panelAriaLabel: "HTTP provider settings",
} as const satisfies SettingsTabDefinition;

const CHAT_MODES_TAB = {
  id: "chatModes",
  label: "Chat modes",
  panelAriaLabel: "Chat modes settings",
} as const satisfies SettingsTabDefinition;

const DEBUG_AI_TAB = {
  id: "debugAi",
  label: "Debug Provider",
  panelAriaLabel: "Debug Provider settings for Chats",
} as const satisfies SettingsTabDefinition;

const OPENCODE_TAB = {
  id: "opencode",
  label: "OpenCode",
  panelAriaLabel: "OpenCode settings for Workspaces",
} as const satisfies SettingsTabDefinition;

const DEBUG_AGENT_TAB = {
  id: "debugAgent",
  label: "Debug Provider",
  panelAriaLabel: "Debug Provider settings for Workspaces",
} as const satisfies SettingsTabDefinition;

const LOGS_TAB = {
  id: "logs",
  label: "Logs",
  panelAriaLabel: "Logging settings",
} as const satisfies SettingsTabDefinition;

export const SETTINGS_SIDEBAR = [
  { kind: "tab", tab: EDITOR_TAB },
  { kind: "tab", tab: SHORTCUTS_TAB },
  { kind: "section", label: "Chats", tabs: [CONNECTIONS_TAB, CHAT_MODES_TAB, DEBUG_AI_TAB] },
  { kind: "section", label: "Workspaces", tabs: [OPENCODE_TAB, DEBUG_AGENT_TAB] },
  { kind: "section", label: "Logging", tabs: [LOGS_TAB] },
] as const satisfies readonly SettingsSidebarEntry[];

export const SETTINGS_TABS = [
  EDITOR_TAB,
  SHORTCUTS_TAB,
  CONNECTIONS_TAB,
  CHAT_MODES_TAB,
  DEBUG_AI_TAB,
  OPENCODE_TAB,
  DEBUG_AGENT_TAB,
  LOGS_TAB,
] as const satisfies readonly SettingsTabDefinition[];

type SettingsDialogOpener = (tab: SettingsDialogTab) => void;

let opener: SettingsDialogOpener | null = null;

export function registerSettingsDialogOpener(next: SettingsDialogOpener | null): void {
  opener = next;
}

export function openSettingsDialog(tab: SettingsDialogTab = "editor"): void {
  opener?.(tab);
}

export function getSettingsTabDefinition(tab: SettingsDialogTab): SettingsTabDefinition {
  const definition = SETTINGS_TABS.find((entry) => entry.id === tab);
  if (!definition) {
    throw new Error(`Unknown settings tab: ${tab}`);
  }
  return definition;
}
