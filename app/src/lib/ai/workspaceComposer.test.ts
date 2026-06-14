import { describe, expect, it } from "vitest";
import type { OpencodeCatalogState } from "./opencodeCatalog";
import type {
  OpencodeAgentEntry,
  OpencodeProviderEntry,
  OpencodeModelEntry,
} from "./backends/workspaceAgentBackend";
import { listSelectableWorkspaceModels } from "./providers/selection";

function makeCatalog(overrides: Partial<OpencodeCatalogState> = {}): OpencodeCatalogState {
  return {
    status: "loaded",
    models: [],
    providers: [],
    agents: [],
    lastErrorMessage: null,
    loadedAt: "2026-06-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("workspace composer catalog separation", () => {
  it("lists workspace models from opencode catalog, not HTTP catalogs", () => {
    const models: OpencodeModelEntry[] = [
      { id: "claude-4", name: "Claude 4", providerId: "anthropic" },
      { id: "gpt-4.1", name: "GPT 4.1", providerId: "openai" },
    ];
    expect(listSelectableWorkspaceModels(models)).toEqual(["claude-4", "gpt-4.1"]);
  });

  it("surfaces opencode agents from catalog for workspace picker", () => {
    const agents: OpencodeAgentEntry[] = [
      { id: "plan", name: "Plan" },
      { id: "build", name: "Build" },
    ];
    const catalog = makeCatalog({ agents });
    expect(catalog.agents).toEqual(agents);
    expect(catalog.agents.map((a) => ({ value: a.id, label: a.name }))).toEqual([
      { value: "plan", label: "Plan" },
      { value: "build", label: "Build" },
    ]);
  });

  it("surfaces opencode providers from catalog for workspace picker", () => {
    const providers: OpencodeProviderEntry[] = [
      { id: "openai", name: "OpenAI" },
      { id: "anthropic", name: "Anthropic" },
    ];
    const catalog = makeCatalog({ providers });
    expect(catalog.providers).toEqual(providers);
    expect(catalog.providers.map((p) => ({ value: p.id, label: p.name }))).toEqual([
      { value: "openai", label: "OpenAI" },
      { value: "anthropic", label: "Anthropic" },
    ]);
  });

  it("returns empty arrays for agents/providers/models when catalog is idle", () => {
    const catalog = makeCatalog({ status: "idle" });
    expect(catalog.agents).toEqual([]);
    expect(catalog.providers).toEqual([]);
    expect(catalog.models).toEqual([]);
  });

  it("returns empty arrays when catalog is in error state", () => {
    const catalog = makeCatalog({ status: "error", lastErrorMessage: "connection refused" });
    expect(catalog.agents).toEqual([]);
    expect(catalog.providers).toEqual([]);
    expect(catalog.models).toEqual([]);
  });
});
