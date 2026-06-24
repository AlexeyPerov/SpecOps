/**
 * M5.2 milestone validation — automated exit-criteria checks.
 *
 * Manual smoke (workspace UI; not covered here):
 * - Workspace → agents sidebar visible; notepad → hidden
 * - New agent (multiple drafts) → "New agent" title, no disk thread until send
 * - First message → title updates, thread persisted
 * - Two agents streaming Debug simultaneously
 * - Sidebar search by title
 * - Delete agent removes tab + files
 * - Close agent tab → next open agent tab → next sidebar row → none
 * - Restart → last active agent tab restored; missing agent → no tab
 * - Console logs-only
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendChatMessage } from "../ai/sendChatMessage";
import { registerTestDebugWorkspaceProvider, createTestCapabilityChecker } from "../ai/providers/debugProviderTestHelpers";
import { defaultDebugProviderSettings } from "../ai/providers/debugProviderSettings";
import {
  registerChatProvider,
  resetChatProviderRegistryForTests,
} from "../ai/providers/registry";
import { createRegistryCapabilityChecker } from "../ai/providers/capabilityChecker";
import { resetChatProvidersForTests } from "../ai/providers/bootstrap";
import {
  SESSION_DATE_GROUP_ORDER,
  DRAFT_SESSION_TITLE,
  filterSessionsByTitle,
  groupSessionsByLastUsedDate,
} from "../services/chatSessions";
import {
  deleteSessionPersistence,
  scheduleSessionThreadFilePersistence,
} from "../services/chatPersistence";
import * as consoleTabPrefs from "../services/consoleTabPrefs";
import {
  findNextOpenSessionTabAfterClose,
  nextSidebarSessionId,
  resolveRestoredActiveSession,
} from "../services/workspaceAgentSession";
import { createSessionTab, createFileTab } from "../domain/contracts";
import type { SessionIndexEntry } from "../domain/contracts";
import { appState } from "./appState";
import { chatStore } from "./chatStore";

vi.mock("../services/chatPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/chatPersistence")>();
  return {
    ...actual,
    scheduleSessionThreadFilePersistence: vi.fn(),
    deleteSessionPersistence: vi.fn(),
  };
});

vi.mock("../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn().mockResolvedValue("ready"),
}));

const schedulePersistMock = vi.mocked(scheduleSessionThreadFilePersistence);
const deleteSessionPersistenceMock = vi.mocked(deleteSessionPersistence);

describe("M5.2 milestone validation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chatStore.reset();
    resetChatProviderRegistryForTests();
    resetChatProvidersForTests();
    schedulePersistMock.mockReset();
    deleteSessionPersistenceMock.mockReset();
    deleteSessionPersistenceMock.mockResolvedValue(undefined);
    appState.updateDebugWorkspaceProviderSettings({
      ...defaultDebugProviderSettings,
      enabled: true,
      simulationSeed: 7,
      delayMsMin: 50,
      delayMsMax: 50,
      chunkCharsMin: 4,
      chunkCharsMax: 4,
      failureProbability: 0,
      includeDiagnostics: false,
    });
    registerTestDebugWorkspaceProvider();
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings,
        () => ({
          settings: appState.getSnapshot().settings.providerSettings.http,
          apiKey: appState.getSnapshot().settings.providerApiKeys.http ?? "",
        }),
      ),
    );
    chatStore.setDefaultChatProviderResolver(() => "debug-workspace");
    chatStore.setActiveWorkspaceRoot("/work/a");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps draft agents off disk until the first user message", () => {
    const agentId = chatStore.createDraftSession();
    expect(agentId).toBe("session-1");
    expect(chatStore.isSessionDraft(agentId!)).toBe(true);
    expect(chatStore.getSessionTitle(agentId!)).toBe(DRAFT_SESSION_TITLE);
    expect(chatStore.hasThread(agentId!)).toBe(false);
    expect(schedulePersistMock).not.toHaveBeenCalled();
  });

  it("supports multiple concurrent draft sessions titled New session", () => {
    chatStore.createDraftSession();
    chatStore.createDraftSession({ activate: true });

    const index = chatStore.getSessionIndex();
    expect(index).toHaveLength(2);
    expect(index.every((entry) => entry.title === DRAFT_SESSION_TITLE && entry.isDraft)).toBe(true);
  });

  it("promotes draft title and persists thread on first send", async () => {
    const agentId = chatStore.createDraftSession();
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, agentId!);

    const resultPromise = sendChatMessage("First persisted line", agentId!);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(chatStore.isSessionDraft(agentId!)).toBe(false);
    expect(chatStore.getSessionTitle(agentId!)).toBe("First persisted line");
    expect(schedulePersistMock).toHaveBeenCalled();
    expect(schedulePersistMock.mock.calls.at(-1)?.[2].thread.messages.at(-1)?.role).toBe("assistant");
  });

  it("allows two agents to generate with Debug at the same time", async () => {
    const agentA = chatStore.createDraftSession({ activate: false });
    const agentB = chatStore.createDraftSession({ activate: true });
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, agentA!);
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" }, undefined, agentB!);

    const sendA = sendChatMessage("Parallel question A", agentA!);
    const sendB = sendChatMessage("Parallel question B", agentB!);

    expect(chatStore.getRuntimeState(agentA!).isGenerating).toBe(true);
    expect(chatStore.getRuntimeState(agentB!).isGenerating).toBe(true);

    await vi.runAllTimersAsync();
    const [resultA, resultB] = await Promise.all([sendA, sendB]);

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    expect(chatStore.getRuntimeState(agentA!).isGenerating).toBe(false);
    expect(chatStore.getRuntimeState(agentB!).isGenerating).toBe(false);
    expect(chatStore.getMessages(agentA!).some((message) => message.role === "assistant")).toBe(true);
    expect(chatStore.getMessages(agentB!).some((message) => message.role === "assistant")).toBe(true);
  });

  it("groups sidebar agents by date and filters by title", () => {
    const now = new Date("2026-05-28T15:00:00.000Z");
    const agents: SessionIndexEntry[] = [
      { id: "a-today", title: "Today", lastUsedAt: "2026-05-28T10:00:00.000Z" },
      { id: "a-yesterday", title: "Yesterday", lastUsedAt: "2026-05-27T10:00:00.000Z" },
      { id: "draft-1", title: DRAFT_SESSION_TITLE, lastUsedAt: "2026-05-28T11:00:00.000Z", isDraft: true },
    ];
    const grouped = groupSessionsByLastUsedDate(agents, now);

    expect(SESSION_DATE_GROUP_ORDER.every((bucket) => bucket in grouped)).toBe(true);
    expect(grouped.today.map((entry) => entry.id)).toEqual(["draft-1", "a-today"]);
    expect(filterSessionsByTitle(agents, "new session").map((entry) => entry.id)).toEqual(["draft-1"]);
  });

  it("deleteSession clears store keys and schedules disk removal", async () => {
    const agentId = chatStore.createDraftSession();
    chatStore.appendMessage(
      {
        id: "m-1",
        role: "user",
        content: "hello",
        createdAt: "2026-05-28T12:00:00.000Z",
      },
      { sessionId: agentId! },
    );
    chatStore.beginTurn("turn-1", agentId!);

    await chatStore.deleteSession(agentId!);

    const workspace = chatStore.getWorkspaceSessionsState("/work/a");
    expect(workspace?.threadsBySessionId[agentId!]).toBeUndefined();
    expect(workspace?.runtimeBySessionId[agentId!]).toBeUndefined();
    expect(workspace?.sessionIndex.some((entry) => entry.id === agentId)).toBe(false);
    expect(deleteSessionPersistenceMock).toHaveBeenCalledWith("/work/a", agentId);
  });

  it("restores last active agent only when it still exists in the index", () => {
    const index: SessionIndexEntry[] = [
      { id: "agent-a", title: "Agent A", lastUsedAt: "2026-05-28T12:00:00.000Z" },
    ];
    expect(
      resolveRestoredActiveSession(
        {
          selectedTabId: "tab-1",
          openTabs: [],
          lastActiveWindowId: "main",
          windowBounds: null,
          lastActiveSessionId: "agent-a",
        },
        index,
      ),
    ).toEqual({ activeSessionId: "agent-a", shouldFocusSessionTab: true });
    expect(
      resolveRestoredActiveSession(
        {
          selectedTabId: "tab-1",
          openTabs: [],
          lastActiveWindowId: "main",
          windowBounds: null,
          lastActiveSessionId: "missing",
        },
        index,
      ),
    ).toEqual({ activeSessionId: null, shouldFocusSessionTab: false });
  });

  it("closes agent tabs with next open tab then next sidebar row fallback", () => {
    const now = new Date("2026-05-28T12:00:00.000Z");
    const tabs = [
      createFileTab("tab-1", "doc-1"),
      createSessionTab("tab-2", "agent-a"),
      createSessionTab("tab-3", "agent-b"),
    ];
    const agents: SessionIndexEntry[] = [
      { id: "agent-a", title: "A", lastUsedAt: "2026-05-28T11:00:00.000Z" },
      { id: "agent-b", title: "B", lastUsedAt: "2026-05-28T10:00:00.000Z" },
    ];

    expect(findNextOpenSessionTabAfterClose(tabs, "tab-2")?.sessionId).toBe("agent-b");
    expect(nextSidebarSessionId(agents, "agent-a", now)).toBe("agent-b");
    expect(nextSidebarSessionId(agents, "agent-b", now)).toBeNull();
    expect(findNextOpenSessionTabAfterClose([createSessionTab("tab-2", "agent-a")], "tab-2")).toBeNull();
  });

  it("exposes console height prefs only (logs-only console shell)", () => {
    expect(Object.keys(consoleTabPrefs).sort()).toEqual([
      "DEFAULT_CONSOLE_HEIGHT_PX",
      "MIN_CONSOLE_HEIGHT_PX",
      "normalizeConsoleHeightPx",
      "readConsoleHeightPreference",
      "writeConsoleHeightPreference",
    ]);
  });
});
