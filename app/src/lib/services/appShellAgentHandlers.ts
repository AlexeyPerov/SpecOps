import {
  allTabs,
  getSessionSelectedTabId,
  getSessionTabs,
  isSessionTab,
} from "../domain/contracts";
import { appState } from "../state/appState";
import { chatStore } from "../state/chatStore";
import { closeTabWithUnsavedPrompt } from "./closeTabFlow";
import {
  isOpencodeEnabled,
} from "./opencodeSettings";
import { promptEntryName } from "./entryNamePrompt";
import { getAgentHostClient, resetAgentHostEnsureCache } from "./agentHostRuntime";
import {
  nextSidebarSessionId,
  openSessionTabIds,
  resolveRestoredActiveSession,
  selectedTabAfterMissingLastSession,
} from "./workspaceAgentSession";
import { elapsedMs, logPerfTiming, nowMs } from "./perfDiagnostics";

export interface AppShellAgentHandlersDeps {
  getCurrentWindowId: () => string;
  notify: (message: string) => void;
}

/**
 * Workspace Sessions lifecycle handlers (phase F).
 *
 * Turns, permissions, questions, and session create/resume run through the
 * supervised Agent Host client (`services/agentHostRuntime`); this module owns
 * the tab/sidebar lifecycle glue. Runtime capabilities without a host protocol
 * method (fork / revert / share / summarize / export / external session list)
 * are hidden rather than stubbed — phase 02+ adapters re-expose them through
 * the versioned host contract when they land.
 */
export function createAppShellAgentHandlers(deps: AppShellAgentHandlersDeps) {
  const { getCurrentWindowId, notify } = deps;

  function handleNewSession(): void {
    const sessionId = chatStore.createDraftSession();
    if (!sessionId) {
      return;
    }
    appState.setLastActiveSessionId(sessionId);
    appState.openOrFocusSessionTab(sessionId);
  }

  function handleSelectSession(sessionId: string): void {
    chatStore.setActiveSessionId(sessionId);
    appState.setLastActiveSessionId(sessionId);
    appState.openOrFocusSessionTab(sessionId);
    void chatStore.ensureSessionThreadHydrated(sessionId).finally(() => {
      void chatStore.runAccessPreflight();
    });
  }

  async function handleDeleteSession(sessionId: string): Promise<void> {
    appState.closeTabsForSession(sessionId);
    const deleted = await chatStore.deleteSession(sessionId);
    if (!deleted) {
      return;
    }
    const nextSessionId = chatStore.getActiveSessionId();
    if (nextSessionId) {
      appState.openOrFocusSessionTab(nextSessionId);
    }
  }

  async function handleDeleteSessionFromChat(): Promise<void> {
    const sessionId = chatStore.getActiveSessionId();
    if (!sessionId) {
      return;
    }
    await handleDeleteSession(sessionId);
  }

  async function restoreWorkspaceSession(
    normalizedRoot: string,
    options?: { preferCachedIndex?: boolean },
  ): Promise<void> {
    const isRestoreTargetActive = (): boolean =>
      appState.getWorkspaceRoot() === normalizedRoot;
    const snapshot = appState.getSnapshot();
    // Dev feature gate for Sessions (neutral settings gate is follow-up
    // cleanup; the gate itself stays).
    if (!isOpencodeEnabled(snapshot.settings.opencode)) {
      if (!isRestoreTargetActive()) {
        return;
      }
      chatStore.setActiveSessionId(null);
      appState.setLastActiveSessionId(null);
      return;
    }
    const session = appState.getActiveSession();
    const openTabSessionIds = openSessionTabIds(allTabs(session.editorLayout));
    const prioritySessionIds = [
      ...openTabSessionIds,
      ...(session.lastActiveSessionId ? [session.lastActiveSessionId] : []),
    ];
    const restoreStartedAt = nowMs();
    const loadSessionsStartedAt = nowMs();
    await chatStore.loadWorkspaceSessions(normalizedRoot, {
      prioritySessionIds,
      ...(options?.preferCachedIndex ? { preferCachedIndex: true } : {}),
    });
    if (!isRestoreTargetActive()) {
      return;
    }
    const sessionIndex = chatStore.getSessionIndex();
    const loadSessionsDurationMs = elapsedMs(loadSessionsStartedAt);
    chatStore.mergeSessionDrafts(normalizedRoot, openTabSessionIds);

    const restored = resolveRestoredActiveSession(session, sessionIndex);
    if (restored.shouldFocusSessionTab && restored.activeSessionId) {
      await chatStore.ensureSessionThreadHydrated(restored.activeSessionId, normalizedRoot);
      if (!isRestoreTargetActive()) {
        return;
      }
      chatStore.setActiveSessionId(restored.activeSessionId);
      appState.setLastActiveSessionId(restored.activeSessionId);
      appState.openOrFocusSessionTab(restored.activeSessionId);
      void chatStore.runAccessPreflight();
    } else {
      chatStore.setActiveSessionId(null);
      appState.setLastActiveSessionId(null);
      // Recovery selection is intentionally scoped to the focused pane.
      const tabs = getSessionTabs(appState.getActiveSession());
      const selectedTabId = getSessionSelectedTabId(appState.getActiveSession());
      const nextSelected = selectedTabAfterMissingLastSession(tabs, selectedTabId);
      if (nextSelected && nextSelected !== selectedTabId) {
        appState.selectTab(nextSelected);
      }
    }

    void logPerfTiming("restoreWorkspaceSession complete", {
      metric: "workspace.restore",
      durationMs: elapsedMs(restoreStartedAt),
      workspaceRoot: normalizedRoot,
      sessionCount: sessionIndex.length,
      loadSessionsDurationMs,
      prioritySessionCount: new Set(prioritySessionIds).size,
      preferCachedIndex: Boolean(options?.preferCachedIndex),
      focusedSessionTab: Boolean(restored.shouldFocusSessionTab && restored.activeSessionId),
    });
  }

  async function handleCloseTab(_paneId: string, tabId: string): Promise<void> {
    const beforeSession = appState.getActiveSession();
    const beforeTabs = allTabs(beforeSession.editorLayout);
    const closingTab = beforeTabs.find((tab) => tab.id === tabId);
    const closedSessionId =
      closingTab && isSessionTab(closingTab) ? closingTab.sessionId : null;
    const wasSelected = getSessionSelectedTabId(beforeSession) === tabId;
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();

    const closed = await closeTabWithUnsavedPrompt(tabId, {
      getWindowId: getCurrentWindowId,
      notify,
    });
    if (!closed) {
      return;
    }

    if (closedSessionId && workspaceRoot) {
      chatStore.cancelSessionGeneration(workspaceRoot, closedSessionId);
    }

    if (!closedSessionId || !wasSelected) {
      return;
    }

    const afterSession = appState.getActiveSession();
    // Sidebar synchronization follows the focused pane after the close.
    const selectedAfter = getSessionTabs(afterSession).find((tab) =>
      tab.id === getSessionSelectedTabId(afterSession),
    );
    if (selectedAfter && isSessionTab(selectedAfter)) {
      return;
    }

    const nextSidebarId = nextSidebarSessionId(chatStore.getSessionIndex(), closedSessionId);
    if (nextSidebarId) {
      chatStore.setActiveSessionId(nextSidebarId);
      appState.setLastActiveSessionId(nextSidebarId);
      return;
    }
    chatStore.setActiveSessionId(null);
    appState.setLastActiveSessionId(null);
  }

  // --- Session lifecycle actions ---------------------------------------------
  //
  // Actions without a host protocol method are intentionally absent (see the
  // module doc). Rename is local-store only.

  /**
   * Rename the active (or specified) session tab. Prompts for a new title,
   * then updates the local session index. The runtime is not involved — the
   * host protocol has no session-rename method.
   */
  async function handleRenameSession(sessionId: string): Promise<void> {
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }
    const currentTitle = chatStore.getSessionTitle(sessionId) ?? "";
    const next = await promptEntryName({
      title: "Rename session",
      defaultValue: currentTitle,
      confirmLabel: "Rename",
    });
    if (!next || next.trim().length === 0 || next.trim() === currentTitle.trim()) {
      return;
    }
    chatStore.renameSession(sessionId, next, workspaceRoot);
    notify("Session renamed.");
  }

  /**
   * Restart the supervised Agent Host (crash-loop / stuck recovery). The next
   * send re-ensures the host; bound sessions resume through `session.resume`.
   */
  async function handleRestartAgentHost(): Promise<void> {
    const client = getAgentHostClient();
    try {
      const status = await client.restart();
      resetAgentHostEnsureCache();
      if (status.health === "healthy") {
        notify("Agent host restarted.");
      } else {
        notify(`Agent host restarted with health "${status.health}".`);
      }
    } catch (error: unknown) {
      notify(`Agent host restart failed: ${describeHostError(error)}`);
    }
  }

  function describeHostError(error: unknown): string {
    const hostError = error as { message?: unknown };
    if (typeof hostError?.message === "string" && hostError.message.trim().length > 0) {
      return hostError.message.trim();
    }
    return error instanceof Error ? error.message : String(error);
  }

  return {
    handleNewSession,
    handleSelectSession,
    handleDeleteSession,
    handleDeleteSessionFromChat,
    restoreWorkspaceSession,
    handleCloseTab,
    handleRenameSession,
    handleRestartAgentHost,
  };
}
