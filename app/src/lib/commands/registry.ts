import { get } from "svelte/store";
import type { AppCommandId, CommandDefinition } from "../domain/contracts";
import { appState } from "../state/appState";
import { logDiagnostic } from "../services/logging";

type CommandContext = {
  setSettingsPaneOpen: (next: boolean) => void;
  isSettingsPaneOpen: () => boolean;
  notify: (message: string) => void;
};

type CommandHandler = (context: CommandContext) => Promise<void> | void;

const keyBindingsByPlatform: Record<string, string> = {
  "Meta+,": "app.toggleSettingsPane",
  "Meta+Shift+t": "view.toggleTheme",
  "Meta+n": "file.new",
  "Ctrl+,": "app.toggleSettingsPane",
  "Ctrl+Shift+t": "view.toggleTheme",
  "Ctrl+n": "file.new",
};

export const commandDefinitions: CommandDefinition[] = [
  {
    id: "app.toggleSettingsPane",
    label: "Toggle Settings Pane",
    menuPath: "View/Settings Pane",
    binding: { mac: "Cmd+,", windows: "Ctrl+," },
  },
  {
    id: "view.toggleTheme",
    label: "Toggle Theme",
    menuPath: "View/Theme",
    binding: { mac: "Cmd+Shift+T", windows: "Ctrl+Shift+T" },
  },
  {
    id: "file.new",
    label: "New Tab",
    menuPath: "File/New",
    binding: { mac: "Cmd+N", windows: "Ctrl+N" },
  },
];

const handlers: Record<AppCommandId, CommandHandler> = {
  "app.toggleSettingsPane": ({ isSettingsPaneOpen, setSettingsPaneOpen }) => {
    setSettingsPaneOpen(!isSettingsPaneOpen());
  },
  "view.toggleTheme": () => {
    appState.toggleTheme();
  },
  "file.new": ({ notify }) => {
    notify("New file command scaffolded.");
  },
};

export function dispatchCommand(
  commandId: AppCommandId,
  context: CommandContext,
): void {
  const handler = handlers[commandId];
  if (!handler) {
    return;
  }

  void logDiagnostic({
    level: "info",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: `command dispatched: ${commandId}`,
    metadata: { commandId },
  });
  void handler(context);
}

export function dispatchMenuCommand(
  commandId: AppCommandId,
  context: CommandContext,
): void {
  dispatchCommand(commandId, context);
}

export function keymapCommandForEvent(event: KeyboardEvent): AppCommandId | null {
  const token = [
    event.metaKey ? "Meta" : event.ctrlKey ? "Ctrl" : "",
    event.shiftKey ? "Shift" : "",
    event.altKey ? "Alt" : "",
    event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase(),
  ]
    .filter(Boolean)
    .join("+");

  return (keyBindingsByPlatform[token] as AppCommandId | undefined) ?? null;
}

export function getActiveDocumentContent(): string {
  const state = get(appState);
  const activeTabId = state.session.selectedTabId;
  const activeTab = state.session.openTabs.find((tab) => tab.id === activeTabId);
  if (!activeTab) {
    return "";
  }
  const activeDocument = state.documents.find(
    (documentState) => documentState.id === activeTab.documentId,
  );
  return activeDocument?.content ?? "";
}
