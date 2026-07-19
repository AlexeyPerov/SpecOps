import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OpencodeAgentDetail,
  OpencodeConfigDocument,
  OpencodeMcpStatusEntry,
  OpencodeProviderStatus,
  OpencodeSkillEntry,
} from "./backends/workspaceAgentBackend";
import {
  getOpencodeConfigStore,
  loadOpencodeConfigStore,
  resetOpencodeConfigStoreForTests,
} from "./opencodeConfigStore";

const getConfigMock = vi.fn();
const listProviderStatusesMock = vi.fn();
const listMcpStatusesMock = vi.fn();
const listAgentDetailsMock = vi.fn();
const listSkillsMock = vi.fn();

vi.mock("./backends/workspaceAgentBackend", () => ({
  createWorkspaceAgentBackend: vi.fn(() => ({
    getConfig: getConfigMock,
    listProviderStatuses: listProviderStatusesMock,
    listMcpStatuses: listMcpStatusesMock,
    listAgentDetails: listAgentDetailsMock,
    listSkills: listSkillsMock,
  })),
}));

vi.mock("./services/logging", () => ({
  logDiagnostic: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./backends/opencodeBackendFactory", () => ({
  createOpencodeBackendFromAppState: vi.fn(() => ({
    getConfig: getConfigMock,
    listProviderStatuses: listProviderStatusesMock,
    listMcpStatuses: listMcpStatusesMock,
    listAgentDetails: listAgentDetailsMock,
    listSkills: listSkillsMock,
  })),
}));

vi.mock("../state/appState", () => ({
  appState: {
    getSnapshot: () => ({
      settings: { opencode: { enabled: true, mode: "sidecar", baseUrl: "", sidecarPort: 4096 } },
    }),
  },
}));

vi.mock("../services/opencodeSettings", () => ({
  isOpencodeEnabled: () => true,
}));

const WS = "/repo/ws";

function configDoc(): OpencodeConfigDocument {
  return { model: "gpt-4o" };
}

function provider(id: string): OpencodeProviderStatus {
  return { id, name: id, connected: false, modelCount: 0 };
}

function mcp(name: string): OpencodeMcpStatusEntry {
  return { name, status: "connected", enabled: true };
}

function agent(name: string): OpencodeAgentDetail {
  return {
    name,
    mode: "primary",
    builtin: false,
    permissionRuleCount: 0,
  };
}

function skill(name: string): OpencodeSkillEntry {
  return { name, location: "/repo/ws/.opencode/skills" };
}

function mockSuccessLoad(): void {
  getConfigMock.mockResolvedValueOnce(configDoc());
  listProviderStatusesMock.mockResolvedValueOnce([provider("p1")]);
  listMcpStatusesMock.mockResolvedValueOnce([mcp("m1")]);
  listAgentDetailsMock.mockResolvedValueOnce([agent("a1")]);
  listSkillsMock.mockResolvedValueOnce([skill("s1")]);
}

beforeEach(() => {
  resetOpencodeConfigStoreForTests();
  getConfigMock.mockReset();
  listProviderStatusesMock.mockReset();
  listMcpStatusesMock.mockReset();
  listAgentDetailsMock.mockReset();
  listSkillsMock.mockReset();
});

describe("loadOpencodeConfigStore — transient reload failure (M7-T3)", () => {
  it("preserves the prior cached config/providers on a failing reload", async () => {
    // Successful first load populates the cache.
    mockSuccessLoad();
    const first = await loadOpencodeConfigStore(WS);
    expect(first.status).toBe("loaded");
    expect(first.config).toEqual(configDoc());
    expect(first.providers.map((p) => p.id)).toEqual(["p1"]);
    expect(first.mcpServers.map((m) => m.name)).toEqual(["m1"]);
    expect(first.agents.map((a) => a.name)).toEqual(["a1"]);
    expect(first.skills.map((s) => s.name)).toEqual(["s1"]);

    // A transient getConfig failure during a reload must not wipe the cache.
    getConfigMock.mockRejectedValueOnce(new Error("server hiccup"));
    listProviderStatusesMock.mockResolvedValueOnce([provider("p1")]);
    listMcpStatusesMock.mockResolvedValueOnce([mcp("m1")]);
    listAgentDetailsMock.mockResolvedValueOnce([agent("a1")]);
    listSkillsMock.mockResolvedValueOnce([skill("s1")]);

    const reloaded = await loadOpencodeConfigStore(WS);
    expect(reloaded.status).toBe("error");
    expect(reloaded.lastErrorMessage).toBe("server hiccup");
    // Prior cached slices survive the transient failure.
    expect(reloaded.config).toEqual(configDoc());
    expect(reloaded.providers.map((p) => p.id)).toEqual(["p1"]);
    expect(reloaded.mcpServers.map((m) => m.name)).toEqual(["m1"]);
    expect(reloaded.agents.map((a) => a.name)).toEqual(["a1"]);
    expect(reloaded.skills.map((s) => s.name)).toEqual(["s1"]);

    // And the snapshot accessor reflects the preserved data too.
    const snapshot = getOpencodeConfigStore(WS);
    expect(snapshot.status).toBe("error");
    expect(snapshot.config).toEqual(configDoc());
  });

  it("still degrades to emptyState on a genuine first-load failure", async () => {
    getConfigMock.mockRejectedValueOnce(new Error("no server"));
    listProviderStatusesMock.mockResolvedValueOnce([]);
    listMcpStatusesMock.mockResolvedValueOnce([]);
    listAgentDetailsMock.mockResolvedValueOnce([]);
    listSkillsMock.mockResolvedValueOnce([]);

    const result = await loadOpencodeConfigStore(WS);
    expect(result.status).toBe("error");
    expect(result.lastErrorMessage).toBe("no server");
    expect(result.config).toBeNull();
    expect(result.providers).toEqual([]);
    expect(result.mcpServers).toEqual([]);
    expect(result.agents).toEqual([]);
    expect(result.skills).toEqual([]);
  });

  it("loads the full config view on success", async () => {
    mockSuccessLoad();
    const result = await loadOpencodeConfigStore(WS);
    expect(result.status).toBe("loaded");
    expect(result.config).toEqual(configDoc());
    expect(result.loadedAt).not.toBeNull();
    expect(result.lastErrorMessage).toBeNull();
  });
});
