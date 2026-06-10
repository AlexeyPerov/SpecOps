import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceAgentBackend } from "./backends/workspaceAgentBackend";
import {
  getOpencodeCatalog,
  isOpencodeCatalogReady,
  isOpencodeCatalogEmpty,
  listSelectableOpencodeModels,
  refreshOpencodeCatalog,
  resetOpencodeCatalogForTests,
  resolveOpencodeModelFallback,
} from "./opencodeCatalog";

const mockListModels = vi.fn();
const mockListProviders = vi.fn();
const mockListAgents = vi.fn();

vi.mock("./backends/workspaceAgentBackend", () => ({
  createWorkspaceAgentBackend: vi.fn(() => ({
    listModels: mockListModels,
    listProviders: mockListProviders,
    listAgents: mockListAgents,
  })),
}));

vi.mock("../state/appState", () => ({
  appState: {
    getSnapshot: vi.fn(() => ({
      settings: {
        opencode: { mode: "url", baseUrl: "http://localhost:4096" },
      },
    })),
  },
}));

vi.mock("../services/logging", () => ({
  logDiagnostic: vi.fn().mockResolvedValue(undefined),
}));

function setupDefaultCatalog(): void {
  mockListModels.mockResolvedValue([
    { id: "gpt-4o", name: "GPT-4o", providerId: "openai" },
    { id: "claude-3", name: "Claude 3", providerId: "anthropic" },
  ]);
  mockListProviders.mockResolvedValue([
    { id: "openai", name: "OpenAI" },
    { id: "anthropic", name: "Anthropic" },
  ]);
  mockListAgents.mockResolvedValue([
    { id: "coder", name: "Coder" },
  ]);
}

describe("opencodeCatalog", () => {
  beforeEach(() => {
    resetOpencodeCatalogForTests();
    vi.clearAllMocks();
    setupDefaultCatalog();
  });

  it("returns empty catalog before refresh", () => {
    const catalog = getOpencodeCatalog("/tmp/project");
    expect(catalog.status).toBe("idle");
    expect(catalog.models).toEqual([]);
    expect(catalog.providers).toEqual([]);
    expect(catalog.agents).toEqual([]);
  });

  it("refreshes catalog from backend", async () => {
    const state = await refreshOpencodeCatalog("/tmp/project");
    expect(state.status).toBe("loaded");
    expect(state.models).toHaveLength(2);
    expect(state.models[0]!.id).toBe("gpt-4o");
    expect(state.providers).toHaveLength(2);
    expect(state.agents).toHaveLength(1);
    expect(state.loadedAt).toBeTruthy();
    expect(state.lastErrorMessage).toBeNull();
  });

  it("caches result after refresh", async () => {
    await refreshOpencodeCatalog("/tmp/project");
    const cached = getOpencodeCatalog("/tmp/project");
    expect(cached.status).toBe("loaded");
    expect(cached.models).toHaveLength(2);
  });

  it("deduplicates concurrent refresh calls", async () => {
    const [a, b] = await Promise.all([
      refreshOpencodeCatalog("/tmp/project"),
      refreshOpencodeCatalog("/tmp/project"),
    ]);
    expect(a).toBe(b);
  });

  it("reports ready when loaded", async () => {
    expect(isOpencodeCatalogReady("/tmp/project")).toBe(false);
    await refreshOpencodeCatalog("/tmp/project");
    expect(isOpencodeCatalogReady("/tmp/project")).toBe(true);
  });

  it("reports empty when loaded with no models", async () => {
    mockListModels.mockResolvedValue([]);
    mockListProviders.mockResolvedValue([]);
    mockListAgents.mockResolvedValue([]);

    await refreshOpencodeCatalog("/tmp/empty");
    expect(isOpencodeCatalogEmpty("/tmp/empty")).toBe(true);
    expect(isOpencodeCatalogReady("/tmp/empty")).toBe(true);
  });

  it("handles refresh errors gracefully", async () => {
    mockListModels.mockRejectedValue(new Error("Connection refused"));
    mockListProviders.mockRejectedValue(new Error("Connection refused"));
    mockListAgents.mockRejectedValue(new Error("Connection refused"));

    const state = await refreshOpencodeCatalog("/tmp/error");
    expect(state.status).toBe("error");
    expect(state.lastErrorMessage).toBeTruthy();
    expect(state.models).toEqual([]);
  });

  it("lists selectable model entries", async () => {
    await refreshOpencodeCatalog("/tmp/project");
    const models = listSelectableOpencodeModels("/tmp/project");
    expect(models).toHaveLength(2);
    expect(models[0]!.id).toBe("gpt-4o");
    expect(models[1]!.id).toBe("claude-3");
  });

  it("resolves model fallback preferring selected model", async () => {
    await refreshOpencodeCatalog("/tmp/project");
    expect(resolveOpencodeModelFallback("/tmp/project", "claude-3")).toBe("claude-3");
  });

  it("resolves model fallback to first when preferred is missing", async () => {
    await refreshOpencodeCatalog("/tmp/project");
    expect(resolveOpencodeModelFallback("/tmp/project", "nonexistent")).toBe("gpt-4o");
  });

  it("resolves model fallback to first when no preference", async () => {
    await refreshOpencodeCatalog("/tmp/project");
    expect(resolveOpencodeModelFallback("/tmp/project", null)).toBe("gpt-4o");
  });

  it("resolves null when catalog is empty", () => {
    expect(resolveOpencodeModelFallback("/tmp/unknown", null)).toBeNull();
  });

  it("allows re-refresh after error", async () => {
    mockListModels.mockRejectedValueOnce(new Error("fail"));
    mockListProviders.mockRejectedValueOnce(new Error("fail"));
    mockListAgents.mockRejectedValueOnce(new Error("fail"));

    const errorState = await refreshOpencodeCatalog("/tmp/retry");
    expect(errorState.status).toBe("error");

    const okState = await refreshOpencodeCatalog("/tmp/retry");
    expect(okState.status).toBe("loaded");
    expect(okState.models).toHaveLength(2);
  });
});
