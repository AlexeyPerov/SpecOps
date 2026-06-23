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
  type WorkspaceAgentSessionDetails,
} from "../ai/backends/workspaceAgentBackend";
import { createOpencodeBackendFromAppState } from "../ai/backends/opencodeBackendFactory";
import {
  isAgentSessionMappingValid,
  mappedSessionForAgent,
  nextSidebarAgentId,
  openAgentTabIds,
  resolveRestoredActiveAgent,
  selectedTabAfterMissingLastAgent,
} from "./workspaceAgentSession";
import { hydrateWorkspaceAgentMessages } from "./workspaceAgentHydration";
import { isOpencodeEnabled } from "./opencodeSettings";
import { promptEntryName } from "./entryNamePrompt";
import { promptRevertPreview } from "./revertPreviewPrompt";
import { saveFileAs } from "./fileSystem";
import {
  buildSessionTranscriptMarkdown,
  suggestExportFileName,
} from "../ai/backends/opencodeSessionExport";
import { logDiagnostic } from "./logging";

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
    const backend = createOpencodeBackendFromAppState();
    if (!backend) {
      return;
    }
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
    // M1-T3: hydrate the display source of truth from OpenCode session.messages.
    // Non-fatal — local snapshot remains as offline cache/fallback on failure.
    await hydrateWorkspaceAgentMessages({
      backend: createOpencodeBackendFromAppState()!,
      workspaceRootPath: normalizedRoot,
      agents: agentIndex,
    }).catch(() => {
      // Hydration is best-effort; the local snapshot stays in place.
    });
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

  // --- OpenCode session lifecycle handlers (M2) -------------------------------
  //
  // Each handler follows the same shape: look up the agent's linked session,
  // short-circuit when there isn't one (no-op + notify), call the backend,
  // then mutate the chatStore / appState to reflect the new state. Backend
  // errors are surfaced via `notify` rather than thrown — these are
  // user-initiated actions from the UI, not programmatic flows.

  function createOpencodeBackend() {
    return createOpencodeBackendFromAppState()!;
  }

  function resolveLinkedSession(agentId: string): {
    sessionId: string;
    workspaceRoot: string;
  } | null {
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();
    if (!workspaceRoot) {
      return null;
    }
    const link = chatStore.getAgentSessionLink(agentId, workspaceRoot);
    if (!link?.opencodeSessionId) {
      return null;
    }
    return { sessionId: link.opencodeSessionId, workspaceRoot };
  }

  function describeBackendError(error: unknown): string {
    if (error instanceof WorkspaceAgentBackendError) {
      return error.message;
    }
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * M2-T1 — rename the active (or specified) agent tab. Prompts for a new
   * title, calls `session.update({ title })`, then updates the SpecOps index
   * entry. The OpenCode call happens first so we never show a title the
   * server rejected.
   */
  async function handleRenameAgent(agentId: string): Promise<void> {
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }
    const link = chatStore.getAgentSessionLink(agentId, workspaceRoot);
    const currentTitle = chatStore.getAgentTitle(agentId) ?? "";
    const next = await promptEntryName({
      title: "Rename session",
      defaultValue: currentTitle,
      confirmLabel: "Rename",
    });
    if (!next || next.trim().length === 0 || next.trim() === currentTitle.trim()) {
      return;
    }
    // Draft agents (no linked session yet) only need a local rename.
    if (!link?.opencodeSessionId) {
      chatStore.renameAgent(agentId, next, workspaceRoot);
      notify("Session renamed.");
      return;
    }
    try {
      await createOpencodeBackend().updateSessionTitle({
        workspaceRootPath: workspaceRoot,
        sessionId: link.opencodeSessionId,
        title: next,
      });
    } catch (error: unknown) {
      notify(`Rename failed: ${describeBackendError(error)}`);
      return;
    }
    chatStore.renameAgent(agentId, next, workspaceRoot);
    notify("Session renamed.");
  }

  /**
   * M2-T3 — fork the active agent's session from a message. Calls
   * `session.fork`, then creates a fresh agent tab linked to the child
   * session (per Q14: fork → new tab). The parent tab is left untouched.
   */
  async function handleForkAgent(
    agentId: string,
    messageId?: string,
  ): Promise<string | null> {
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();
    if (!workspaceRoot) {
      notify("Open a workspace to fork a session.");
      return null;
    }
    const link = chatStore.getAgentSessionLink(agentId, workspaceRoot);
    if (!link?.opencodeSessionId) {
      notify("This session isn't linked to OpenCode yet.");
      return null;
    }
    let child: WorkspaceAgentSessionDetails;
    try {
      child = await createOpencodeBackend().forkSession({
        workspaceRootPath: workspaceRoot,
        sessionId: link.opencodeSessionId,
        ...(messageId ? { messageId } : {}),
      });
    } catch (error: unknown) {
      notify(`Fork failed: ${describeBackendError(error)}`);
      return null;
    }
    const newAgentId = chatStore.forkAgent(
      {
        opencodeSessionId: child.id,
        opencodeParentSessionId: link.opencodeSessionId,
        title: child.title,
        ...(link.opencodeModelId ? { opencodeModelId: link.opencodeModelId } : {}),
        ...(link.opencodeProviderId
          ? { opencodeProviderId: link.opencodeProviderId }
          : {}),
      },
      workspaceRoot,
    );
    if (!newAgentId) {
      notify("Fork completed but the new tab could not be opened.");
      return null;
    }
    appState.setLastActiveAgentId(newAgentId);
    appState.openOrFocusAgentTab(newAgentId);
    notify("Forked into a new session tab.");
    return newAgentId;
  }

  /**
   * M2-T4 undo — revert the active session to a message in place (per Q14).
   * Confirms via the revert-preview dialog before applying (the SDK's
   * `session.revert` is destructive — it's the apply step, not a dry-run).
   * Returns the resulting session details so the caller can surface the diff.
   */
  async function handleRevertSession(
    agentId: string,
    messageId?: string,
  ): Promise<WorkspaceAgentSessionDetails | null> {
    const resolved = resolveLinkedSession(agentId);
    if (!resolved) {
      notify("This session isn't linked to OpenCode yet.");
      return null;
    }
    const messageLabel = resolveRevertMessageLabel(agentId, messageId);
    const confirmed = await promptRevertPreview({
      messageId: messageId ?? "latest",
      messageLabel,
      // We don't have a pre-apply diff from OpenCode; the dialog explains the
      // effect instead. The post-revert result carries `revert.diff`.
      diff: null,
    });
    if (!confirmed) {
      return null;
    }
    try {
      const updated = await createOpencodeBackend().revertSession({
        workspaceRootPath: resolved.workspaceRoot,
        sessionId: resolved.sessionId,
        ...(messageId ? { messageId } : {}),
      });
      notify("Reverted session to the selected message.");
      return updated;
    } catch (error: unknown) {
      notify(`Undo failed: ${describeBackendError(error)}`);
      return null;
    }
  }

  /**
   * Builds a short label for the revert target message — used in the confirm
   * dialog. Falls back to "the latest message" when no id is given.
   */
  function resolveRevertMessageLabel(agentId: string, messageId?: string): string {
    if (!messageId) {
      return "the latest message";
    }
    const messages = chatStore.getMessages(agentId);
    const target = messages.find((message) => message.id === messageId);
    if (!target) {
      return "the selected message";
    }
    const body = target.content.trim();
    if (body.length === 0) {
      return `${target.role} message`;
    }
    return body.length > 60 ? `${body.slice(0, 60)}…` : body;
  }

  /** M2-T4 redo — restore a previously-reverted session in place. */
  async function handleUnrevertSession(
    agentId: string,
  ): Promise<WorkspaceAgentSessionDetails | null> {
    const resolved = resolveLinkedSession(agentId);
    if (!resolved) {
      notify("This session isn't linked to OpenCode yet.");
      return null;
    }
    try {
      const updated = await createOpencodeBackend().unrevertSession({
        workspaceRootPath: resolved.workspaceRoot,
        sessionId: resolved.sessionId,
      });
      notify("Restored reverted messages.");
      return updated;
    } catch (error: unknown) {
      notify(`Redo failed: ${describeBackendError(error)}`);
      return null;
    }
  }

  /**
   * M2-T5 — share / unshare. Shares return a public URL that we persist on
   * the index entry and copy to the clipboard.
   */
  async function handleShareAgent(agentId: string): Promise<string | null> {
    const resolved = resolveLinkedSession(agentId);
    if (!resolved) {
      notify("This session isn't linked to OpenCode yet.");
      return null;
    }
    try {
      const updated = await createOpencodeBackend().shareSession({
        workspaceRootPath: resolved.workspaceRoot,
        sessionId: resolved.sessionId,
      });
      const url = updated.shareUrl;
      if (!url) {
        notify("OpenCode did not return a share URL.");
        return null;
      }
      chatStore.setAgentSessionLink(
        agentId,
        { opencodeShareUrl: url },
        resolved.workspaceRoot,
      );
      await copyToClipboard(url);
      notify("Share link copied to clipboard.");
      return url;
    } catch (error: unknown) {
      notify(`Share failed: ${describeBackendError(error)}`);
      return null;
    }
  }

  async function handleUnshareAgent(agentId: string): Promise<void> {
    const resolved = resolveLinkedSession(agentId);
    if (!resolved) {
      return;
    }
    try {
      await createOpencodeBackend().unshareSession({
        workspaceRootPath: resolved.workspaceRoot,
        sessionId: resolved.sessionId,
      });
      chatStore.setAgentSessionLink(
        agentId,
        { opencodeShareUrl: "" },
        resolved.workspaceRoot,
      );
      notify("Session is no longer shared.");
    } catch (error: unknown) {
      notify(`Unshare failed: ${describeBackendError(error)}`);
    }
  }

  /** M2-T6 — generate / refresh the session summary via OpenCode. */
  async function handleSummarizeAgent(agentId: string): Promise<boolean> {
    const resolved = resolveLinkedSession(agentId);
    if (!resolved) {
      notify("This session isn't linked to OpenCode yet.");
      return false;
    }
    notify("Summarizing session…");
    try {
      const ok = await createOpencodeBackend().summarizeSession({
        workspaceRootPath: resolved.workspaceRoot,
        sessionId: resolved.sessionId,
      });
      if (!ok) {
        notify("No summary was produced.");
        return false;
      }
      // Re-hydrate so the freshly-generated summary lands in thread metadata
      // and the SessionSummary banner picks it up. Best-effort: hydration
      // failures don't undo the summarize (the summary is stored server-side).
      await hydrateWorkspaceAgentMessages({
        backend: createOpencodeBackend(),
        workspaceRootPath: resolved.workspaceRoot,
        agents: chatStore.getAgentIndex(),
      }).catch(() => {
        // Hydration is best-effort.
      });
      notify("Session summary generated.");
      return true;
    } catch (error: unknown) {
      notify(`Summarize failed: ${describeBackendError(error)}`);
      return false;
    }
  }

  /**
   * M2-T7 — export the active agent's transcript to a Markdown file via the
   * Tauri save dialog. Hydration is best-effort: we export whatever messages
   * are currently in the store (already hydrated from `session.messages` for
   * workspace agents).
   */
  async function handleExportAgent(agentId: string): Promise<void> {
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();
    if (!workspaceRoot) {
      notify("Open a workspace to export a transcript.");
      return;
    }
    const link = chatStore.getAgentSessionLink(agentId, workspaceRoot);
    const title = chatStore.getAgentTitle(agentId) ?? "session";
    const messages = chatStore.getMessages(agentId);
    const markdown = buildSessionTranscriptMarkdown({
      title,
      workspaceRootPath: workspaceRoot,
      sessionId: link?.opencodeSessionId ?? null,
      messages,
    });
    const defaultFileName = suggestExportFileName(
      title,
      link?.opencodeSessionId ?? null,
    );
    const saved = await saveFileAs(markdown, defaultFileName);
    if (saved) {
      notify(`Exported transcript to ${saved.path}`);
    }
  }

  /**
   * M2-T2 — open an OpenCode session that may not have a SpecOps agent tab
   * yet (e.g. created from the TUI or another client). Creates a fresh agent
   * tab linked to it.
   */
  async function handleOpenExternalSession(sessionId: string, title?: string): Promise<void> {
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();
    if (!workspaceRoot) {
      notify("Open a workspace first.");
      return;
    }
    // Reuse an existing tab if one is already linked to this session.
    const index = chatStore.getAgentIndex();
    const existing = index.find((entry) => entry.opencodeSessionId === sessionId);
    if (existing) {
      chatStore.setActiveAgentId(existing.id);
      appState.setLastActiveAgentId(existing.id);
      appState.openOrFocusAgentTab(existing.id);
      return;
    }
    // M7-T4: seed the title from getSessionDetails so the tab isn't stuck on
    // the placeholder. Best-effort — a fetch failure falls back to the caller-
    // supplied title (e.g. from the list panel) or the placeholder.
    let resolvedTitle = title?.trim() || "Opened session";
    try {
      const details = await createOpencodeBackend().getSessionDetails({
        workspaceRootPath: workspaceRoot,
        sessionId,
      });
      if (details?.title?.trim()) {
        resolvedTitle = details.title.trim();
      }
    } catch {
      // Non-fatal — the placeholder title stays; hydration may still refresh it.
    }
    const agentId = chatStore.forkAgent(
      {
        opencodeSessionId: sessionId,
        opencodeParentSessionId: "",
        title: resolvedTitle,
      },
      workspaceRoot,
    );
    if (!agentId) {
      notify("Could not open the session.");
      return;
    }
    appState.setLastActiveAgentId(agentId);
    appState.openOrFocusAgentTab(agentId);
    // M7-T4: hydrate the thread from session.messages (best-effort, matching
    // the M2 convention) so the tab shows its messages instead of an empty list
    // until the user reopens it.
    await hydrateWorkspaceAgentMessages({
      backend: createOpencodeBackend(),
      workspaceRootPath: workspaceRoot,
      agents: chatStore.getAgentIndex(),
    }).catch(() => {
      // Hydration is best-effort; the local snapshot stays in place.
    });
    notify("Opened session in a new tab.");
  }

  /**
   * M2-T2 — fetch the rich session list for the active workspace. Used by the
   * SessionListPanel. Errors degrade to `[]` (so the panel can show "no
   * sessions" rather than blocking) but are now surfaced as a diagnostic
   * (M7-T5) — previously a bare `catch {}` swallowed them silently.
   */
  async function handleListWorkspaceSessions(
    options?: { search?: string; limit?: number },
  ): Promise<WorkspaceAgentSessionDetails[]> {
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();
    if (!workspaceRoot) {
      return [];
    }
    try {
      return await createOpencodeBackend().listSessionDetails({
        workspaceRootPath: workspaceRoot,
        ...(options?.search ? { search: options.search } : {}),
        ...(options?.limit ? { limit: options.limit } : {}),
      });
    } catch (error: unknown) {
      // Keep the degrade-to-[] contract but make the failure observable
      // (consistent with every sibling handler).
      void logDiagnostic({
        level: "warn",
        source: "frontend",
        timestamp: new Date().toISOString(),
        message: "workspace session list failed",
        metadata: {
          kind: "opencode.session.list",
          workspaceRootPath: workspaceRoot,
          error: error instanceof Error ? error.message : undefined,
        },
      });
      return [];
    }
  }

  return {
    handleNewAgent,
    handleSelectAgent,
    handleDeleteAgent,
    ensureChatHttpAgentTab,
    handleDeleteAgentFromChat,
    restoreWorkspaceAgentSession,
    handleCloseTab,
    handleRenameAgent,
    handleForkAgent,
    handleRevertSession,
    handleUnrevertSession,
    handleShareAgent,
    handleUnshareAgent,
    handleSummarizeAgent,
    handleExportAgent,
    handleOpenExternalSession,
    handleListWorkspaceSessions,
  };
}

/**
 * Clipboard helper. Uses the web `navigator.clipboard` API (the codebase
 * convention — see ProjectTreeContextMenu / tabContextMenuActions) and falls
 * back to a no-op when unavailable (e.g. non-secure context in tests).
 */
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Non-fatal — the share URL is still persisted on the agent entry.
  }
}
