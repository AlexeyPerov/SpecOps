import { describe, expect, it } from "vitest";
import { createAgentTab, createFileTab } from "../domain/contracts";
import type { AgentIndexEntry } from "../domain/contracts";
import {
  agentExistsInIndex,
  findNextOpenAgentTabAfterClose,
  flattenSidebarAgents,
  isAgentSessionMappingValid,
  mappedSessionForAgent,
  nextSidebarAgentId,
  reconcileAgentSessionMapping,
  openAgentTabIds,
  resolveRestoredActiveAgent,
  selectedTabAfterMissingLastAgent,
} from "./workspaceAgentSession";

function agent(id: string, lastUsedAt: string): AgentIndexEntry {
  return { id, title: id, lastUsedAt };
}

describe("workspaceAgentSession", () => {
  it("finds the next open agent tab in tab-bar order", () => {
    const tabs = [
      createFileTab("tab-1", "doc-1"),
      createAgentTab("tab-2", "agent-a"),
      createAgentTab("tab-3", "agent-b"),
      createFileTab("tab-4", "doc-2"),
    ];
    expect(findNextOpenAgentTabAfterClose(tabs, "tab-2")?.agentId).toBe("agent-b");
    expect(findNextOpenAgentTabAfterClose(tabs, "tab-3")?.agentId).toBe("agent-a");
  });

  it("returns null when no other agent tabs remain", () => {
    const tabs = [createFileTab("tab-1", "doc-1"), createAgentTab("tab-2", "agent-a")];
    expect(findNextOpenAgentTabAfterClose(tabs, "tab-2")).toBeNull();
  });

  it("orders sidebar agents by date groups", () => {
    const now = new Date("2026-05-28T12:00:00.000Z");
    const agents = [
      agent("older", "2026-05-01T12:00:00.000Z"),
      agent("today-b", "2026-05-28T10:00:00.000Z"),
      agent("today-a", "2026-05-28T11:00:00.000Z"),
    ];
    expect(flattenSidebarAgents(agents, now).map((entry) => entry.id)).toEqual([
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
    expect(nextSidebarAgentId(agents, "a", now)).toBe("b");
    expect(nextSidebarAgentId(agents, "c", now)).toBeNull();
  });

  it("restores last active agent only when it still exists", () => {
    const index = [agent("agent-a", "2026-05-28T12:00:00.000Z")];
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

  it("collects open agent tab ids", () => {
    const tabs = [
      createAgentTab("tab-1", "agent-a"),
      createFileTab("tab-2", "doc-1"),
      createAgentTab("tab-3", "agent-b"),
    ];
    expect(openAgentTabIds(tabs)).toEqual(["agent-a", "agent-b"]);
  });

  it("moves selection off agent tabs when last active is missing", () => {
    const tabs = [
      createFileTab("tab-1", "doc-1"),
      createAgentTab("tab-2", "agent-a"),
    ];
    expect(selectedTabAfterMissingLastAgent(tabs, "tab-2")).toBe("tab-1");
    expect(selectedTabAfterMissingLastAgent(tabs, "tab-1")).toBe("tab-1");
  });

  it("detects agent membership in index", () => {
    const index = [agent("agent-a", "2026-05-28T12:00:00.000Z")];
    expect(agentExistsInIndex(index, "agent-a")).toBe(true);
    expect(agentExistsInIndex(index, "agent-b")).toBe(false);
  });

  it("returns mapped opencode session metadata for an agent", () => {
    const index: AgentIndexEntry[] = [
      {
        id: "agent-a",
        title: "A",
        lastUsedAt: "2026-05-28T12:00:00.000Z",
        opencodeSessionId: "sess-1",
        opencodeModelId: "gpt-4o-mini",
        opencodeProviderId: "opencode",
      },
    ];
    expect(mappedSessionForAgent(index, "agent-a")).toEqual({
      agentId: "agent-a",
      sessionId: "sess-1",
      modelId: "gpt-4o-mini",
      providerId: "opencode",
    });
    expect(mappedSessionForAgent(index, "missing")).toBeNull();
  });

  it("validates mapping presence against known session ids", () => {
    const known = new Set(["sess-1"]);
    expect(
      isAgentSessionMappingValid(
        { agentId: "agent-a", sessionId: "sess-1" },
        known,
      ),
    ).toBe(true);
    expect(
      isAgentSessionMappingValid(
        { agentId: "agent-a", sessionId: "sess-2" },
        known,
      ),
    ).toBe(false);
    expect(isAgentSessionMappingValid(null, known)).toBe(false);
  });

  it("reconciles missing mapping to deterministic replacement session", () => {
    const known = new Set(["sess-1"]);
    expect(
      reconcileAgentSessionMapping({
        mapping: { agentId: "agent-a", sessionId: "sess-1" },
        existingSessionIds: known,
        createdSessionId: "sess-created",
      }),
    ).toEqual({
      sessionId: "sess-1",
      shouldReplaceMapping: false,
    });
    expect(
      reconcileAgentSessionMapping({
        mapping: { agentId: "agent-a", sessionId: "sess-missing" },
        existingSessionIds: known,
        createdSessionId: "sess-created",
      }),
    ).toEqual({
      sessionId: "sess-created",
      shouldReplaceMapping: true,
    });
  });
});
