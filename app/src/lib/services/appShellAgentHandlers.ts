import {
  CHAT_HTTP_CONTEXT_ID,
  getSessionSelectedTabId,
  getSessionTabs,
  isFileTab,
  isSessionTab,
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
  isSessionMappingValid,
  mappedSessionForId,
  nextSidebarSessionId,
  openSessionTabIds,
  resolveRestoredActiveSession,
  selectedTabAfterMissingLastSession,
} from "./workspaceAgentSession";
import { hydrateWorkspaceAgentMessages } from "./workspaceAgentHydration";
import { ensureOpencodeSidecar } from "./opencodeSidecarEnsure";
import { isOpencodeEnabled } from "./opencodeSettings";
import { promptEntryName } from "./entryNamePrompt";
import { promptRevertPreview } from "./revertPreviewPrompt";
import { saveFileAs } from "./fileSystem";
import { logDiagnostic } from "./logging";
import {
  buildSessionTranscriptMarkdown,
  suggestExportFileName,
} from "../ai/backends/opencodeSessionExport";

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

    const index = chatStore.getSessionIndex();
    for (const entry of index) {
      const mapping = mappedSessionForId(index, entry.id);
      if (isSessionMappingValid(mapping, existingSessionIds)) {
        continue;
      }
      if (!mapping) {
        continue;
      }
      chatStore.clearSessionLink(entry.id, normalizedRoot);
    }
  }

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
    void chatStore.runAccessPreflight();
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

  function ensureChatHttpSessionTab(): void {
    if (!getIsChatHttpActive()) {
      return;
    }
    const activeScope = chatStore.getActiveChatScopeKey();
    if (activeScope !== CHAT_HTTP_CONTEXT_ID) {
      return;
    }
    let sessionId = chatStore.getActiveSessionId();
    if (!sessionId) {
      sessionId = chatStore.createDraftSession();
    }
    if (!sessionId) {
      return;
    }
    chatStore.setActiveSessionId(sessionId);
    appState.setLastActiveSessionId(sessionId);
    const sessionSnapshot = appState.getActiveSession();
    const selectedTab = getSessionTabs(sessionSnapshot).find((tab) =>
      tab.id === getSessionSelectedTabId(sessionSnapshot),
    );
    const selectedMatchesChatSession =
      selectedTab && isSessionTab(selectedTab) && selectedTab.sessionId === sessionId;
    if (selectedMatchesChatSession) {
      return;
    }
    const fileTabIds = getSessionTabs(sessionSnapshot)
      .filter((tab) => isFileTab(tab))
      .map((tab) => tab.id);
    if (fileTabIds.length > 0) {
      appState.closeTabsByIds(fileTabIds, null);
    }
    appState.openOrFocusSessionTab(sessionId);
  }

  async function handleDeleteSessionFromChat(): Promise<void> {
    const sessionId = chatStore.getActiveSessionId();
    if (!sessionId) {
      return;
    }
    await handleDeleteSession(sessionId);
  }

  /**
   * M13.5 — conditional background reconcile + hydrate (L3). Runs only when:
   *   1. Sidecar is already running and healthy (probe only — no spawn).
   *   2. Active session has a linked OpenCode session id.
   *   3. Active session thread has ≥1 message.
   *   4. Last message role is `"user"` (skip when `"assistant"` — L3-A).
   *
   * Fire-and-forget; never blocks the caller.
   */
  async function maybeBackgroundSyncWorkspaceSession(): Promise<void> {
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }
    const ensured = await ensureOpencodeSidecar({
      intent: "background-sync",
      directory: workspaceRoot,
    });
    if (!ensured || ensured.status.health !== "healthy") {
      return;
    }
    const activeSessionId = chatStore.getActiveSessionId();
    if (!activeSessionId) {
      return;
    }
    const link = chatStore.getSessionLink(activeSessionId, workspaceRoot);
    if (!link?.opencodeSessionId) {
      return;
    }
    const thread = chatStore.getActiveThreadSnapshot(activeSessionId);
    if (!thread || thread.messages.length === 0) {
      return;
    }
    const lastMessage = thread.messages[thread.messages.length - 1]!;
    if (lastMessage.role !== "user") {
      return;
    }
    // L3 met — single-flight reconcile + hydrate the active session.
    try {
      await reconcileWorkspaceSessionMappings(workspaceRoot);
      const backend = createOpencodeBackendFromAppState({
        ensureIntent: "background-sync",
      });
      if (backend) {
        await hydrateWorkspaceAgentMessages({
          backend,
          workspaceRootPath: workspaceRoot,
          agents: chatStore.getSessionIndex(),
        }).catch(() => {});
      }
    } catch {
      // Best-effort; local cache stays in place.
    }
  }

  async function restoreWorkspaceSession(
    normalizedRoot: string,
    options?: { skipOpencodeReconcile?: boolean },
  ): Promise<void> {
    const snapshot = appState.getSnapshot();
    if (!isOpencodeEnabled(snapshot.settings.opencode)) {
      chatStore.setActiveSessionId(null);
      appState.setLastActiveSessionId(null);
      return;
    }
    const session = appState.getActiveSession();
    const loadSessionsStartedAt = Date.now();
    await chatStore.loadWorkspaceSessions(normalizedRoot);
    const sessionIndex = chatStore.getSessionIndex();
    void logDiagnostic({
      level: "info",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "restoreWorkspaceSession: sessions loaded",
      metadata: {
        workspaceRoot: normalizedRoot,
        durationMs: Date.now() - loadSessionsStartedAt,
        sessionCount: sessionIndex.length,
      },
    });
    chatStore.mergeSessionDrafts(normalizedRoot, openSessionTabIds(getSessionTabs(session)));

    const restored = resolveRestoredActiveSession(session, sessionIndex);
    if (restored.shouldFocusSessionTab && restored.activeSessionId) {
      chatStore.setActiveSessionId(restored.activeSessionId);
      appState.setLastActiveSessionId(restored.activeSessionId);
      appState.openOrFocusSessionTab(restored.activeSessionId);
      void chatStore.runAccessPreflight();
    } else {
      chatStore.setActiveSessionId(null);
      appState.setLastActiveSessionId(null);
      const tabs = getSessionTabs(appState.getActiveSession());
      const selectedTabId = getSessionSelectedTabId(appState.getActiveSession());
      const nextSelected = selectedTabAfterMissingLastSession(tabs, selectedTabId);
      if (nextSelected && nextSelected !== selectedTabId) {
        appState.selectTab(nextSelected);
      }
    }

    if (options?.skipOpencodeReconcile) {
      return;
    }

    // M13.5 — session tab path: hydrate is conditional on L3 (sidecar healthy,
    // linked session, ≥1 message, last message user). Fire-and-forget so the
    // caller doesn't wait on OpenCode.
    void maybeBackgroundSyncWorkspaceSession();
  }

  async function handleCloseTab(_paneId: string, tabId: string): Promise<void> {
    const beforeSession = appState.getActiveSession();
    const beforeTabs = getSessionTabs(beforeSession);
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

  // --- OpenCode session lifecycle handlers (M2) -------------------------------
  //
  // Each handler follows the same shape: look up the session's linked OpenCode
  // session, short-circuit when there isn't one (no-op + notify), call the
  // backend, then mutate the chatStore / appState to reflect the new state.
  // Backend errors are surfaced via `notify` rather than thrown — these are
  // user-initiated actions from the UI, not programmatic flows.

  function createOpencodeBackend() {
    return createOpencodeBackendFromAppState()!;
  }

  function resolveLinkedSession(sessionId: string): {
    opencodeSessionId: string;
    workspaceRoot: string;
  } | null {
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();
    if (!workspaceRoot) {
      return null;
    }
    const link = chatStore.getSessionLink(sessionId, workspaceRoot);
    if (!link?.opencodeSessionId) {
      return null;
    }
    return { opencodeSessionId: link.opencodeSessionId, workspaceRoot };
  }

  function describeBackendError(error: unknown): string {
    if (error instanceof WorkspaceAgentBackendError) {
      return error.message;
    }
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * M2-T1 — rename the active (or specified) session tab. Prompts for a new
   * title, calls `session.update({ title })`, then updates the SpecOps index
   * entry. The OpenCode call happens first so we never show a title the
   * server rejected.
   */
  async function handleRenameSession(sessionId: string): Promise<void> {
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }
    const link = chatStore.getSessionLink(sessionId, workspaceRoot);
    const currentTitle = chatStore.getSessionTitle(sessionId) ?? "";
    const next = await promptEntryName({
      title: "Rename session",
      defaultValue: currentTitle,
      confirmLabel: "Rename",
    });
    if (!next || next.trim().length === 0 || next.trim() === currentTitle.trim()) {
      return;
    }
    // Draft sessions (no linked session yet) only need a local rename.
    if (!link?.opencodeSessionId) {
      chatStore.renameSession(sessionId, next, workspaceRoot);
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
    chatStore.renameSession(sessionId, next, workspaceRoot);
    notify("Session renamed.");
  }

  /**
   * M2-T3 — fork the active session from a message. Calls `session.fork`,
   * then creates a fresh session tab linked to the child session (per Q14:
   * fork → new tab). The parent tab is left untouched.
   */
  async function handleForkSession(
    sessionId: string,
    messageId?: string,
  ): Promise<string | null> {
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();
    if (!workspaceRoot) {
      notify("Open a workspace to fork a session.");
      return null;
    }
    const link = chatStore.getSessionLink(sessionId, workspaceRoot);
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
    const newSessionId = chatStore.forkSession(
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
    if (!newSessionId) {
      notify("Fork completed but the new tab could not be opened.");
      return null;
    }
    appState.setLastActiveSessionId(newSessionId);
    appState.openOrFocusSessionTab(newSessionId);
    notify("Forked into a new session tab.");
    return newSessionId;
  }

  /**
   * M2-T4 undo — revert the active session to a message in place (per Q14).
   * Confirms via the revert-preview dialog before applying (the SDK's
   * `session.revert` is destructive — it's the apply step, not a dry-run).
   * Returns the resulting session details so the caller can surface the diff.
   */
  async function handleRevertSession(
    sessionId: string,
    messageId?: string,
  ): Promise<WorkspaceAgentSessionDetails | null> {
    const resolved = resolveLinkedSession(sessionId);
    if (!resolved) {
      notify("This session isn't linked to OpenCode yet.");
      return null;
    }
    const messageLabel = resolveRevertMessageLabel(sessionId, messageId);
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
        sessionId: resolved.opencodeSessionId,
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
  function resolveRevertMessageLabel(sessionId: string, messageId?: string): string {
    if (!messageId) {
      return "the latest message";
    }
    const messages = chatStore.getMessages(sessionId);
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
    sessionId: string,
  ): Promise<WorkspaceAgentSessionDetails | null> {
    const resolved = resolveLinkedSession(sessionId);
    if (!resolved) {
      notify("This session isn't linked to OpenCode yet.");
      return null;
    }
    try {
      const updated = await createOpencodeBackend().unrevertSession({
        workspaceRootPath: resolved.workspaceRoot,
        sessionId: resolved.opencodeSessionId,
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
  async function handleShareSession(sessionId: string): Promise<string | null> {
    const resolved = resolveLinkedSession(sessionId);
    if (!resolved) {
      notify("This session isn't linked to OpenCode yet.");
      return null;
    }
    try {
      const updated = await createOpencodeBackend().shareSession({
        workspaceRootPath: resolved.workspaceRoot,
        sessionId: resolved.opencodeSessionId,
      });
      const url = updated.shareUrl;
      if (!url) {
        notify("OpenCode did not return a share URL.");
        return null;
      }
      chatStore.setSessionLink(
        sessionId,
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

  async function handleUnshareSession(sessionId: string): Promise<void> {
    const resolved = resolveLinkedSession(sessionId);
    if (!resolved) {
      return;
    }
    try {
      await createOpencodeBackend().unshareSession({
        workspaceRootPath: resolved.workspaceRoot,
        sessionId: resolved.opencodeSessionId,
      });
      chatStore.setSessionLink(
        sessionId,
        { opencodeShareUrl: "" },
        resolved.workspaceRoot,
      );
      notify("Session is no longer shared.");
    } catch (error: unknown) {
      notify(`Unshare failed: ${describeBackendError(error)}`);
    }
  }

  /** M2-T6 — generate / refresh the session summary via OpenCode. */
  async function handleSummarizeSession(sessionId: string): Promise<boolean> {
    const resolved = resolveLinkedSession(sessionId);
    if (!resolved) {
      notify("This session isn't linked to OpenCode yet.");
      return false;
    }
    notify("Summarizing session…");
    try {
      const ok = await createOpencodeBackend().summarizeSession({
        workspaceRootPath: resolved.workspaceRoot,
        sessionId: resolved.opencodeSessionId,
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
        agents: chatStore.getSessionIndex(),
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
   * M2-T7 — export the active session's transcript to a Markdown file via the
   * Tauri save dialog. Hydration is best-effort: we export whatever messages
   * are currently in the store (already hydrated from `session.messages` for
   * workspace sessions).
   */
  async function handleExportSession(sessionId: string): Promise<void> {
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();
    if (!workspaceRoot) {
      notify("Open a workspace to export a transcript.");
      return;
    }
    const link = chatStore.getSessionLink(sessionId, workspaceRoot);
    const title = chatStore.getSessionTitle(sessionId) ?? "session";
    const messages = chatStore.getMessages(sessionId);
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
   * M2-T2 — open an OpenCode session that may not have a SpecOps session tab
   * yet (e.g. created from the TUI or another client). Creates a fresh
   * session tab linked to it.
   */
  async function handleOpenExternalSession(sessionId: string, title?: string): Promise<void> {
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();
    if (!workspaceRoot) {
      notify("Open a workspace first.");
      return;
    }
    // Reuse an existing tab if one is already linked to this session.
    const index = chatStore.getSessionIndex();
    const existing = index.find((entry) => entry.opencodeSessionId === sessionId);
    if (existing) {
      chatStore.setActiveSessionId(existing.id);
      appState.setLastActiveSessionId(existing.id);
      appState.openOrFocusSessionTab(existing.id);
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
    const newSessionId = chatStore.forkSession(
      {
        opencodeSessionId: sessionId,
        opencodeParentSessionId: "",
        title: resolvedTitle,
      },
      workspaceRoot,
    );
    if (!newSessionId) {
      notify("Could not open the session.");
      return;
    }
    appState.setLastActiveSessionId(newSessionId);
    appState.openOrFocusSessionTab(newSessionId);
    // M7-T4: hydrate the thread from session.messages (best-effort, matching
    // the M2 convention) so the tab shows its messages instead of an empty list
    // until the user reopens it.
    await hydrateWorkspaceAgentMessages({
      backend: createOpencodeBackend(),
      workspaceRootPath: workspaceRoot,
      agents: chatStore.getSessionIndex(),
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
    handleNewSession,
    handleSelectSession,
    handleDeleteSession,
    ensureChatHttpSessionTab,
    handleDeleteSessionFromChat,
    restoreWorkspaceSession,
    handleCloseTab,
    handleRenameSession,
    handleForkSession,
    handleRevertSession,
    handleUnrevertSession,
    handleShareSession,
    handleUnshareSession,
    handleSummarizeSession,
    handleExportSession,
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
    // Non-fatal — the share URL is still persisted on the session entry.
  }
}
