import type { ChatHttpSettings } from "../domain/contracts";
import { isChatHttpEnabled } from "./chatHttpSettings";
import { appState } from "../state/appState";

export type SettingsDialogTab =
  | "editor"
  | "shortcuts"
  | "appearance"
  | "versionControl"
  | "dev"
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

/**
 * Tabs gated behind the chat-http master toggle. When the toggle is off,
 * these tabs are hidden from the sidebar and unreachable from any panel
 * switcher / deep link.
 */
export const CHAT_HTTP_GATED_TABS = [
  CONNECTIONS_TAB,
  CHAT_MODES_TAB,
  DEBUG_AI_TAB,
] as const satisfies readonly SettingsTabDefinition[];

const CHAT_HTTP_GATED_TAB_IDS: ReadonlySet<SettingsDialogTab> = new Set(
  CHAT_HTTP_GATED_TABS.map((tab) => tab.id),
);

/**
 * Whether a given tab id belongs to the chat-http beta subtree and should
 * only be reachable when the user has opted into the chat-http beta.
 */
export function isChatHttpGatedTab(tab: SettingsDialogTab): boolean {
  return CHAT_HTTP_GATED_TAB_IDS.has(tab);
}

/**
 * Fallback tab used when a chat-http gated tab is requested while the beta
 * is disabled. Defaults to the Dev master panel so users land on the toggle
 * rather than a missing tab.
 */
export const DEV_FALLBACK_TAB: SettingsDialogTab = "dev";

const ALL_TABS = [
  EDITOR_TAB,
  SHORTCUTS_TAB,
  APPEARANCE_TAB,
  VERSION_CONTROL_TAB,
  DEV_TAB,
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

export const SETTINGS_TABS = ALL_TABS;

/**
 * Resolve a deep-link tab against the chat-http beta gate. When the gate is
 * closed, chat-http tabs redirect to the Dev master panel; other tabs pass
 * through unchanged.
 */
export function resolveOpenSettingsDialogTab(
  requested: SettingsDialogTab,
  chatHttp: ChatHttpSettings | null | undefined,
): SettingsDialogTab {
  if (!isChatHttpGatedTab(requested)) {
    return requested;
  }
  return isChatHttpEnabled(chatHttp) ? requested : DEV_FALLBACK_TAB;
}

/**
 * Build the sidebar entries for the settings dialog. The Dev section always
 * contains its master toggle plus Logs; the chat-http subtree (Providers,
 * Chat modes, Debug Provider) is appended only when the beta is enabled so
 * hidden tabs are not reachable from measure/layout code paths.
 */
export function buildSettingsSidebar(
  chatHttp: ChatHttpSettings | null | undefined,
): readonly SettingsSidebarEntry[] {
  const devTabs: readonly SettingsTabDefinition[] = isChatHttpEnabled(chatHttp)
    ? [DEV_TAB, LOGS_TAB, ...CHAT_HTTP_GATED_TABS]
    : [DEV_TAB, LOGS_TAB];
  return [
    { kind: "tab", tab: EDITOR_TAB },
    { kind: "tab", tab: SHORTCUTS_TAB },
    { kind: "tab", tab: APPEARANCE_TAB },
    { kind: "tab", tab: VERSION_CONTROL_TAB },
    { kind: "section", label: "Dev", tabs: devTabs },
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
  ] as const satisfies readonly SettingsSidebarEntry[];
}

export const SETTINGS_SIDEBAR = buildSettingsSidebar({ enabled: false });

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
    return resolveOpenSettingsDialogTab(tab, state.settings.chatHttp);
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