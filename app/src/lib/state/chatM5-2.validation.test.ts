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
import { createDebugChatProvider } from "../ai/providers/debugChatProvider";
import { defaultDebugProviderSettings } from "../ai/providers/debugProviderSettings";
import {
  registerChatProvider,
  resetChatProviderRegistryForTests,
} from "../ai/providers/registry";
import { createRegistryCapabilityChecker } from "../ai/providers/capabilityChecker";
import { resetChatProvidersForTests } from "../ai/providers/bootstrap";
import {
  AGENT_DATE_GROUP_ORDER,
  DRAFT_AGENT_TITLE,
  filterAgentsByTitle,
  groupAgentsByLastUsedDate,
} from "../services/chatAgents";
import {
  deleteAgentPersistence,
  scheduleAgentThreadFilePersistence,
} from "../services/chatPersistence";
import * as consoleTabPrefs from "../services/consoleTabPrefs";
import {
  findNextOpenAgentTabAfterClose,
  nextSidebarAgentId,
  resolveRestoredActiveAgent,
} from "../services/workspaceAgentSession";
import { createAgentTab, createFileTab } from "../domain/contracts";
import type { AgentIndexEntry } from "../domain/contracts";
import { appState } from "./appState";
import { chatStore } from "./chatStore";

vi.mock("../services/chatPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/chatPersistence")>();
  return {
    ...actual,
    scheduleAgentThreadFilePersistence: vi.fn(),
    deleteAgentPersistence: vi.fn(),
  };
});

vi.mock("../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn().mockResolvedValue("ready"),
}));

const schedulePersistMock = vi.mocked(scheduleAgentThreadFilePersistence);
const deleteAgentPersistenceMock = vi.mocked(deleteAgentPersistence);

describe("M5.2 milestone validation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chatStore.reset();
    resetChatProviderRegistryForTests();
    resetChatProvidersForTests();
    schedulePersistMock.mockReset();
    deleteAgentPersistenceMock.mockReset();
    deleteAgentPersistenceMock.mockResolvedValue(undefined);
    appState.updateDebugProviderSettings({
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
    registerChatProvider(createDebugChatProvider(() => appState.getSnapshot().settings.providerSettings.debug));
    chatStore.setCapabilityChecker(
      createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings.debug,
        () => ({
          settings: appState.getSnapshot().settings.providerSettings.glm,
          apiKey: appState.getSnapshot().settings.glmApiKey,
        }),
      ),
    );
    chatStore.setDefaultChatProviderResolver(() => "debug");
    chatStore.setActiveWorkspaceRoot("/work/a");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps draft agents off disk until the first user message", () => {
    const agentId = chatStore.createDraftAgent();
    expect(agentId).toBe("agent-1");
    expect(chatStore.isAgentDraft(agentId!)).toBe(true);
    expect(chatStore.getAgentTitle(agentId!)).toBe(DRAFT_AGENT_TITLE);
    expect(chatStore.hasThread(agentId!)).toBe(false);
    expect(schedulePersistMock).not.toHaveBeenCalled();
  });

  it("supports multiple concurrent draft agents titled New agent", () => {
    chatStore.createDraftAgent();
    chatStore.createDraftAgent({ activate: true });

    const index = chatStore.getAgentIndex();
    expect(index).toHaveLength(2);
    expect(index.every((entry) => entry.title === DRAFT_AGENT_TITLE && entry.isDraft)).toBe(true);
  });

  it("promotes draft title and persists thread on first send", async () => {
    const agentId = chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "debug", mode: "ask" }, undefined, agentId!);

    const resultPromise = sendChatMessage("First persisted line", agentId!);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(chatStore.isAgentDraft(agentId!)).toBe(false);
    expect(chatStore.getAgentTitle(agentId!)).toBe("First persisted line");
    expect(schedulePersistMock).toHaveBeenCalledOnce();
  });

  it("allows two agents to generate with Debug at the same time", async () => {
    const agentA = chatStore.createDraftAgent({ activate: false });
    const agentB = chatStore.createDraftAgent({ activate: true });
    chatStore.updateThreadMetadata({ provider: "debug", mode: "ask" }, undefined, agentA!);
    chatStore.updateThreadMetadata({ provider: "debug", mode: "ask" }, undefined, agentB!);

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
    const agents: AgentIndexEntry[] = [
      { id: "a-today", title: "Today", lastUsedAt: "2026-05-28T10:00:00.000Z" },
      { id: "a-yesterday", title: "Yesterday", lastUsedAt: "2026-05-27T10:00:00.000Z" },
      { id: "draft-1", title: DRAFT_AGENT_TITLE, lastUsedAt: "2026-05-28T11:00:00.000Z", isDraft: true },
    ];
    const grouped = groupAgentsByLastUsedDate(agents, now);

    expect(AGENT_DATE_GROUP_ORDER.every((bucket) => bucket in grouped)).toBe(true);
    expect(grouped.today.map((entry) => entry.id)).toEqual(["draft-1", "a-today"]);
    expect(filterAgentsByTitle(agents, "new agent").map((entry) => entry.id)).toEqual(["draft-1"]);
  });

  it("deleteAgent clears store keys and schedules disk removal", async () => {
    const agentId = chatStore.createDraftAgent();
    chatStore.appendMessage(
      {
        id: "m-1",
        role: "user",
        content: "hello",
        createdAt: "2026-05-28T12:00:00.000Z",
      },
      { agentId: agentId! },
    );
    chatStore.beginTurn("turn-1", agentId!);

    await chatStore.deleteAgent(agentId!);

    const workspace = chatStore.getWorkspaceAgentsState("/work/a");
    expect(workspace?.threadsByAgentId[agentId!]).toBeUndefined();
    expect(workspace?.runtimeByAgentId[agentId!]).toBeUndefined();
    expect(workspace?.agentIndex.some((entry) => entry.id === agentId)).toBe(false);
    expect(deleteAgentPersistenceMock).toHaveBeenCalledWith("/work/a", agentId);
  });

  it("restores last active agent only when it still exists in the index", () => {
    const index: AgentIndexEntry[] = [
      { id: "agent-a", title: "Agent A", lastUsedAt: "2026-05-28T12:00:00.000Z" },
    ];
    expect(
      resolveRestoredActiveAgent(
        {
          selectedTabId: "tab-1",
          openTabs: [],
          lastActiveWindowId: "main",
          windowBounds: null,
          lastActiveAgentId: "agent-a",
        },
        index,
      ),
    ).toEqual({ activeAgentId: "agent-a", shouldFocusAgentTab: true });
    expect(
      resolveRestoredActiveAgent(
        {
          selectedTabId: "tab-1",
          openTabs: [],
          lastActiveWindowId: "main",
          windowBounds: null,
          lastActiveAgentId: "missing",
        },
        index,
      ),
    ).toEqual({ activeAgentId: null, shouldFocusAgentTab: false });
  });

  it("closes agent tabs with next open tab then next sidebar row fallback", () => {
    const now = new Date("2026-05-28T12:00:00.000Z");
    const tabs = [
      createFileTab("tab-1", "doc-1"),
      createAgentTab("tab-2", "agent-a"),
      createAgentTab("tab-3", "agent-b"),
    ];
    const agents: AgentIndexEntry[] = [
      { id: "agent-a", title: "A", lastUsedAt: "2026-05-28T11:00:00.000Z" },
      { id: "agent-b", title: "B", lastUsedAt: "2026-05-28T10:00:00.000Z" },
    ];

    expect(findNextOpenAgentTabAfterClose(tabs, "tab-2")?.agentId).toBe("agent-b");
    expect(nextSidebarAgentId(agents, "agent-a", now)).toBe("agent-b");
    expect(nextSidebarAgentId(agents, "agent-b", now)).toBeNull();
    expect(findNextOpenAgentTabAfterClose([createAgentTab("tab-2", "agent-a")], "tab-2")).toBeNull();
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
