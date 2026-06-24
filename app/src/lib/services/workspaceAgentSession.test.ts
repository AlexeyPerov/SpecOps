import { describe, expect, it } from "vitest";
import { createSessionTab, createFileTab } from "../domain/contracts";
import type { SessionIndexEntry } from "../domain/contracts";
import {
  sessionExistsInIndex,
  findNextOpenSessionTabAfterClose,
  flattenSidebarSessions,
  isSessionMappingValid,
  mappedSessionForId,
  nextSidebarSessionId,
  reconcileSessionMapping,
  openSessionTabIds,
  resolveRestoredActiveSession,
  selectedTabAfterMissingLastSession,
} from "./workspaceAgentSession";

function agent(id: string, lastUsedAt: string): SessionIndexEntry {
  return { id, title: id, lastUsedAt };
}

describe("workspaceAgentSession", () => {
  it("finds the next open agent tab in tab-bar order", () => {
    const tabs = [
      createFileTab("tab-1", "doc-1"),
      createSessionTab("tab-2", "agent-a"),
      createSessionTab("tab-3", "agent-b"),
      createFileTab("tab-4", "doc-2"),
    ];
    expect(findNextOpenSessionTabAfterClose(tabs, "tab-2")?.sessionId).toBe("agent-b");
    expect(findNextOpenSessionTabAfterClose(tabs, "tab-3")?.sessionId).toBe("agent-a");
  });

  it("returns null when no other agent tabs remain", () => {
    const tabs = [createFileTab("tab-1", "doc-1"), createSessionTab("tab-2", "agent-a")];
    expect(findNextOpenSessionTabAfterClose(tabs, "tab-2")).toBeNull();
  });

  it("orders sidebar agents by date groups", () => {
    const now = new Date("2026-05-28T12:00:00.000Z");
    const agents = [
      agent("older", "2026-05-01T12:00:00.000Z"),
      agent("today-b", "2026-05-28T10:00:00.000Z"),
      agent("today-a", "2026-05-28T11:00:00.000Z"),
    ];
    expect(flattenSidebarSessions(agents, now).map((entry) => entry.id)).toEqual([
      "today-a",
      "today-b",
      "older",
    ]);
  });

  it("selects the next sidebar row after close", () => {
    const now = new Date("2026-05-28T12:00:00.000Z");
    const agents = [
      agent("a", "2026-05-28T11:00:00.000Z"),
      agent("b", "2026-05-28T10:00:00.000Z"),
      agent("c", "2026-05-01T12:00:00.000Z"),
    ];
    expect(nextSidebarSessionId(agents, "a", now)).toBe("b");
    expect(nextSidebarSessionId(agents, "c", now)).toBeNull();
  });

  it("restores last active agent only when it still exists", () => {
    const index = [agent("agent-a", "2026-05-28T12:00:00.000Z")];
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

  it("collects open agent tab ids", () => {
    const tabs = [
      createSessionTab("tab-1", "agent-a"),
      createFileTab("tab-2", "doc-1"),
      createSessionTab("tab-3", "agent-b"),
    ];
    expect(openSessionTabIds(tabs)).toEqual(["agent-a", "agent-b"]);
  });

  it("moves selection off agent tabs when last active is missing", () => {
    const tabs = [
      createFileTab("tab-1", "doc-1"),
      createSessionTab("tab-2", "agent-a"),
    ];
    expect(selectedTabAfterMissingLastSession(tabs, "tab-2")).toBe("tab-1");
    expect(selectedTabAfterMissingLastSession(tabs, "tab-1")).toBe("tab-1");
  });

  it("detects agent membership in index", () => {
    const index = [agent("agent-a", "2026-05-28T12:00:00.000Z")];
    expect(sessionExistsInIndex(index, "agent-a")).toBe(true);
    expect(sessionExistsInIndex(index, "agent-b")).toBe(false);
  });

  it("returns mapped opencode session metadata for an agent", () => {
    const index: SessionIndexEntry[] = [
      {
        id: "agent-a",
        title: "A",
        lastUsedAt: "2026-05-28T12:00:00.000Z",
        opencodeSessionId: "sess-1",
        opencodeModelId: "gpt-4o-mini",
        opencodeProviderId: "opencode",
      },
    ];
    expect(mappedSessionForId(index, "agent-a")).toEqual({
      sessionId: "agent-a",
      opencodeSessionId: "sess-1",
      modelId: "gpt-4o-mini",
      providerId: "opencode",
    });
    expect(mappedSessionForId(index, "missing")).toBeNull();
  });

  it("validates mapping presence against known session ids", () => {
    const known = new Set(["sess-1"]);
    expect(
      isSessionMappingValid(
        { sessionId: "agent-a", opencodeSessionId: "sess-1" },
        known,
      ),
    ).toBe(true);
    expect(
      isSessionMappingValid(
        { sessionId: "agent-a", opencodeSessionId: "sess-2" },
        known,
      ),
    ).toBe(false);
    expect(isSessionMappingValid(null, known)).toBe(false);
  });

  it("reconciles missing mapping to deterministic replacement session", () => {
    const known = new Set(["sess-1"]);
    expect(
      reconcileSessionMapping({
        mapping: { sessionId: "agent-a", opencodeSessionId: "sess-1" },
        existingSessionIds: known,
        createdSessionId: "sess-created",
      }),
    ).toEqual({
      sessionId: "sess-1",
      shouldReplaceMapping: false,
    });
    expect(
      reconcileSessionMapping({
        mapping: { sessionId: "agent-a", opencodeSessionId: "sess-missing" },
        existingSessionIds: known,
        createdSessionId: "sess-created",
      }),
    ).toEqual({
      sessionId: "sess-created",
      shouldReplaceMapping: true,
    });
  });
});
