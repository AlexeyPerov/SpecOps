import { get } from "svelte/store";
import type { AppCommandId, AppDomainState } from "../domain/contracts";
import { getSessionActiveTab, tabDocumentId } from "../domain/contracts";
import { appState } from "../state/appState";
import { getActiveDocuments, getActiveSession } from "../state/appState/contextHelpers";
import { logDiagnostic } from "../services/logging";
import { sanitizeErrorDetails, serializeUnknownError, summarizeError } from "./commandErrors";
import { getKeyBindingsByPlatform } from "./commandBindingRuntime";
import {
  buildCommandAvailabilitySnapshot,
  resolveCommandAvailability,
} from "./availability";
import { commandDefinitions } from "./definitions";
import { appHandlers } from "./handlers/app";
import { editHandlers } from "./handlers/edit";
import { fileHandlers } from "./handlers/file";
import type { CommandContext, CommandHandlerMap } from "./handlers/types";
import { viewHandlers } from "./handlers/view";
import { workspaceHandlers } from "./handlers/workspace";

function getSnapshot() {
  return get(appState);
}

export { expandPlatformKeymaps } from "./commandBindings";
export { commandDefinitions } from "./definitions";
export { resetCommandBindingOverrides, setCommandBindingOverrides } from "./commandBindingRuntime";

const handlers: CommandHandlerMap = {
  ...appHandlers,
  ...fileHandlers,
  ...workspaceHandlers,
  ...editHandlers,
  ...viewHandlers,
};

const definitionById = new Map(
  commandDefinitions.map((definition) => [definition.id, definition] as const),
);

/** Build the availability snapshot used by palette and shortcut routing. */
export function availabilitySnapshotFromAppState(
  state: AppDomainState,
): ReturnType<typeof buildCommandAvailabilitySnapshot> {
  const session = getActiveSession(state);
  const activeTab = getSessionActiveTab(session);
  const activeDocumentId = tabDocumentId(activeTab);
  const activeDocument = activeDocumentId
    ? getActiveDocuments(state).find((document) => document.id === activeDocumentId)
    : undefined;
  const workspaceRoot =
    state.contexts.workspaces.find(
      (workspace) => workspace.id === state.contexts.activeContextId,
    )?.rootPath ?? null;
  return buildCommandAvailabilitySnapshot({
    hasWorkspace: Boolean(workspaceRoot),
    hasActiveDocument: Boolean(activeDocument),
    isDirty: activeDocument?.isDirty ?? false,
    paneCount: session.editorLayout.panes.length,
    markdownPreviewAvailable: activeDocument?.language === "markdown",
    markdownEditAvailable: activeDocument?.language === "markdown",
  });
}

/** True when a shortcut should run (and preventDefault) for this command. */
export function isCommandAvailableInState(
  commandId: AppCommandId,
  state: AppDomainState,
): boolean {
  const definition = definitionById.get(commandId);
  const availability = resolveCommandAvailability(
    definition?.availability,
    availabilitySnapshotFromAppState(state),
  );
  return availability.status === "enabled";
}

export function getRegisteredCommandIds(): AppCommandId[] {
  return Object.keys(handlers) as AppCommandId[];
}

export function dispatchCommand(
  commandId: AppCommandId,
  context: CommandContext,
  payload?: unknown,
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
  Promise.resolve(handler(context, payload)).catch((error: unknown) => {
    const message = summarizeError(error);
    context.notify(`Command failed: ${message}`);
    const details = sanitizeErrorDetails(serializeUnknownError(error));
    void logDiagnostic({
      level: "error",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: `command failed: ${commandId} (${message})`,
      metadata: { commandId, reason: message, ...details },
    });
  });
}

export function dispatchMenuCommand(
  commandId: AppCommandId,
  context: CommandContext,
): void {
  dispatchCommand(commandId, context);
}

export { initializeAppMenu, refreshOpenRecentMenu, shouldInitializeAppMenu } from "../services/appMenu";

export const EDITOR_GLOBAL_COMMANDS: ReadonlySet<AppCommandId> = new Set([
  "file.new",
  "file.save",
  "file.saveAs",
  "file.saveAll",
  "tab.close",
]);

export function isEditorGlobalCommand(commandId: AppCommandId): boolean {
  return EDITOR_GLOBAL_COMMANDS.has(commandId);
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

  return getKeyBindingsByPlatform()[token] ?? null;
}

export function getActiveDocumentContent(): string {
  const state = getSnapshot();
  const activeTab = getSessionActiveTab(getActiveSession(state));
  if (!activeTab) {
    return "";
  }
  const activeDocumentId = tabDocumentId(activeTab);
  const activeDocument = activeDocumentId
    ? getActiveDocuments(state).find((documentState) => documentState.id === activeDocumentId)
    : undefined;
  return activeDocument?.content ?? "";
}
