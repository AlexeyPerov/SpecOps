export type SettingsDialogTab =
  | "editor"
  | "shortcuts"
  | "appearance"
  | "connections"
  | "chatModes"
  | "debugAi"
  | "opencode"
  | "openCodeConfig"
  | "providers"
  | "mcp"
  | "agents"
  | "permissions"
  | "commands"
  | "instructions"
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

const APPEARANCE_TAB = {
  id: "appearance",
  label: "Appearance",
  panelAriaLabel: "Appearance and feedback settings",
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
  { kind: "tab", tab: APPEARANCE_TAB },
  { kind: "section", label: "Chats", tabs: [CONNECTIONS_TAB, CHAT_MODES_TAB, DEBUG_AI_TAB] },
  {
    kind: "section",
    label: "Workspaces",
    tabs: [
      OPENCODE_TAB,
      OPENCODE_CONFIG_TAB,
      PROVIDERS_TAB,
      MCP_TAB,
      AGENTS_TAB,
      PERMISSIONS_TAB,
      COMMANDS_TAB,
      INSTRUCTIONS_TAB,
      DEBUG_AGENT_TAB,
    ],
  },
  { kind: "section", label: "Logging", tabs: [LOGS_TAB] },
] as const satisfies readonly SettingsSidebarEntry[];

export const SETTINGS_TABS = [
  EDITOR_TAB,
  SHORTCUTS_TAB,
  APPEARANCE_TAB,
  CONNECTIONS_TAB,
  CHAT_MODES_TAB,
  DEBUG_AI_TAB,
  OPENCODE_TAB,
  OPENCODE_CONFIG_TAB,
  PROVIDERS_TAB,
  MCP_TAB,
  AGENTS_TAB,
  PERMISSIONS_TAB,
  COMMANDS_TAB,
  INSTRUCTIONS_TAB,
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
