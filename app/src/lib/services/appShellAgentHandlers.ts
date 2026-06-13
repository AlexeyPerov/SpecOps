import {
  CHAT_HTTP_CONTEXT_ID,
  isAgentTab,
  isFileTab,
} from "../domain/contracts";
import { appState } from "../state/appState";
import { chatStore } from "../state/chatStore";
import { closeTabWithUnsavedPrompt } from "./closeTabFlow";
import {
  WorkspaceAgentBackendError,
  createWorkspaceAgentBackend,
} from "../ai/backends/workspaceAgentBackend";
import {
  isAgentSessionMappingValid,
  mappedSessionForAgent,
  nextSidebarAgentId,
  openAgentTabIds,
  resolveRestoredActiveAgent,
  selectedTabAfterMissingLastAgent,
} from "./workspaceAgentSession";
import { isOpencodeEnabled } from "./opencodeSettings";

export interface AppShellAgentHandlersDeps {
  getIsChatHttpActive: () => boolean;
  getCurrentWindowId: () => string;
  notify: (message: string) => void;
}

export function createAppShellAgentHandlers(deps: AppShellAgentHandlersDeps) {
  const { getIsChatHttpActive, getCurrentWindowId, notify } = deps;

  async function reconcileWorkspaceSessionMappings(normalizedRoot: string): Promise<void> {
    const snapshot = appState.getSnapshot();
    if (!isOpencodeEnabled(snapshot.settings.opencode)) {
      return;
    }
    const backend = createWorkspaceAgentBackend("opencode", {
      resolveRuntimeConfig: async () => {
        const { mode, baseUrl } = appState.getSnapshot().settings.opencode;
        return { mode, baseUrl };
      },
    });
    let existingSessionIds: ReadonlySet<string>;
    try {
      existingSessionIds = new Set(
        (await backend.listSessions({ workspaceRootPath: normalizedRoot })).map(
          (session) => session.id,
        ),
      );
    } catch (error: unknown) {
      if (
        error instanceof WorkspaceAgentBackendError &&
        (error.code === "serverUnavailable" ||
          error.code === "transportError" ||
          error.code === "authFailure")
      ) {
        return;
      }
      throw error;
    }

    const index = chatStore.getAgentIndex();
    for (const entry of index) {
      const mapping = mappedSessionForAgent(index, entry.id);
      if (isAgentSessionMappingValid(mapping, existingSessionIds)) {
        continue;
      }
      if (!mapping) {
        continue;
      }
      chatStore.clearAgentSessionLink(entry.id, normalizedRoot);
    }
  }

  function handleNewAgent(): void {
    const agentId = chatStore.createDraftAgent();
    if (!agentId) {
      return;
    }
    appState.setLastActiveAgentId(agentId);
    appState.openOrFocusAgentTab(agentId);
  }

  function handleSelectAgent(agentId: string): void {
    chatStore.setActiveAgentId(agentId);
    appState.setLastActiveAgentId(agentId);
    appState.openOrFocusAgentTab(agentId);
    void chatStore.runAccessPreflight();
  }

  async function handleDeleteAgent(agentId: string): Promise<void> {
    appState.closeTabsForAgent(agentId);
    const deleted = await chatStore.deleteAgent(agentId);
    if (!deleted) {
      return;
    }
    const nextAgentId = chatStore.getActiveAgentId();
    if (nextAgentId) {
      appState.openOrFocusAgentTab(nextAgentId);
    }
  }

  function ensureChatHttpAgentTab(): void {
    if (!getIsChatHttpActive()) {
      return;
    }
    const activeScope = chatStore.getActiveChatScopeKey();
    if (activeScope !== CHAT_HTTP_CONTEXT_ID) {
      return;
    }
    let agentId = chatStore.getActiveAgentId();
    if (!agentId) {
      agentId = chatStore.createDraftAgent();
    }
    if (!agentId) {
      return;
    }
    chatStore.setActiveAgentId(agentId);
    appState.setLastActiveAgentId(agentId);
    const sessionSnapshot = appState.getActiveSession();
    const selectedTab = sessionSnapshot.openTabs.find(
      (tab) => tab.id === sessionSnapshot.selectedTabId,
    );
    const selectedMatchesChatAgent =
      selectedTab && isAgentTab(selectedTab) && selectedTab.agentId === agentId;
    if (selectedMatchesChatAgent) {
      return;
    }
    const fileTabIds = sessionSnapshot.openTabs
      .filter((tab) => isFileTab(tab))
      .map((tab) => tab.id);
    if (fileTabIds.length > 0) {
      appState.closeTabsByIds(fileTabIds, null);
    }
    appState.openOrFocusAgentTab(agentId);
  }

  async function handleDeleteAgentFromChat(): Promise<void> {
    const agentId = chatStore.getActiveAgentId();
    if (!agentId) {
      return;
    }
    await handleDeleteAgent(agentId);
  }

  async function restoreWorkspaceAgentSession(
    normalizedRoot: string,
    options?: { skipOpencodeReconcile?: boolean },
  ): Promise<void> {
    const snapshot = appState.getSnapshot();
    if (!isOpencodeEnabled(snapshot.settings.opencode)) {
      chatStore.setActiveAgentId(null);
      appState.setLastActiveAgentId(null);
      return;
    }
    const session = appState.getActiveSession();
    await chatStore.loadWorkspaceAgents(normalizedRoot);
    chatStore.mergeSessionDraftAgents(normalizedRoot, openAgentTabIds(session.openTabs));
    if (!options?.skipOpencodeReconcile) {
      await reconcileWorkspaceSessionMappings(normalizedRoot);
    }
    const agentIndex = chatStore.getAgentIndex();
    const restored = resolveRestoredActiveAgent(session, agentIndex);
    if (restored.shouldFocusAgentTab && restored.activeAgentId) {
      chatStore.setActiveAgentId(restored.activeAgentId);
      appState.setLastActiveAgentId(restored.activeAgentId);
      appState.openOrFocusAgentTab(restored.activeAgentId);
      void chatStore.runAccessPreflight();
      return;
    }
    chatStore.setActiveAgentId(null);
    appState.setLastActiveAgentId(null);
    const tabs = appState.getActiveSession().openTabs;
    const selectedTabId = appState.getActiveSession().selectedTabId;
    const nextSelected = selectedTabAfterMissingLastAgent(tabs, selectedTabId);
    if (nextSelected && nextSelected !== selectedTabId) {
      appState.selectTab(nextSelected);
    }
  }

  async function handleCloseTab(tabId: string): Promise<void> {
    const beforeSession = appState.getActiveSession();
    const closingTab = beforeSession.openTabs.find((tab) => tab.id === tabId);
    const closedAgentId =
      closingTab && isAgentTab(closingTab) ? closingTab.agentId : null;
    const wasSelected = beforeSession.selectedTabId === tabId;
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();

    const closed = await closeTabWithUnsavedPrompt(tabId, {
      getWindowId: getCurrentWindowId,
      notify,
    });
    if (!closed) {
      return;
    }

    if (closedAgentId && workspaceRoot) {
      chatStore.cancelAgentGeneration(workspaceRoot, closedAgentId);
    }

    if (!closedAgentId || !wasSelected) {
      return;
    }

    const afterSession = appState.getActiveSession();
    const selectedAfter = afterSession.openTabs.find(
      (tab) => tab.id === afterSession.selectedTabId,
    );
    if (selectedAfter && isAgentTab(selectedAfter)) {
      return;
    }

    const nextSidebarId = nextSidebarAgentId(chatStore.getAgentIndex(), closedAgentId);
    if (nextSidebarId) {
      chatStore.setActiveAgentId(nextSidebarId);
      appState.setLastActiveAgentId(nextSidebarId);
      return;
    }
    chatStore.setActiveAgentId(null);
    appState.setLastActiveAgentId(null);
  }

  return {
    handleNewAgent,
    handleSelectAgent,
    handleDeleteAgent,
    ensureChatHttpAgentTab,
    handleDeleteAgentFromChat,
    restoreWorkspaceAgentSession,
    handleCloseTab,
  };
}
