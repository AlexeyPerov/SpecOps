import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatStore, resetAgentIdCounterForTests } from "../chatStore";
import { appState } from "../appState";
import { DEFAULT_HTTP_CONNECTION_ID } from "../../ai/providers/httpConnectionSettings";
import { defaultProviderModelCatalogs } from "../../ai/providers/providerModelCatalog";

vi.mock("../../services/chatPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/chatPersistence")>();
  return {
    ...actual,
    readAgentThreadFileSnapshot: vi.fn(),
    readWorkspaceAgentsIndexSnapshot: vi.fn(),
    deleteAgentPersistence: vi.fn(),
  };
});

vi.mock("../../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn(),
}));

function providerSwitchOptions() {
  return {
    providerSettings: appState.getSnapshot().settings.providerSettings,
    providerModelCatalogs: defaultProviderModelCatalogs,
  };
}

describe("chatStore switchThreadConnection", () => {
  beforeEach(() => {
    chatStore.reset();
    appState.resetAppState();
    resetAgentIdCounterForTests();
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.updateThreadMetadata({
      provider: "http",
      mode: "ask",
      connectionId: DEFAULT_HTTP_CONNECTION_ID,
    });
  });

  it("updates connectionId and model for a valid HTTP connection", () => {
    appState.addHttpConnection({
      id: "remote",
      label: "Remote",
      baseUrl: "http://remote/v1",
      modelCatalog: {
        modelIds: ["remote-model"],
        defaultModelId: "remote-model",
      },
    });

    const result = chatStore.switchThreadConnection("remote", providerSwitchOptions());

    expect(result).toEqual({ switched: true });
    expect(chatStore.getMetadata()?.connectionId).toBe("remote");
    expect(chatStore.getMetadata()?.selectedModelId).toBe("remote-model");
  });

  it("rejects unknown connections", () => {
    const result = chatStore.switchThreadConnection("missing-connection", providerSwitchOptions());

    expect(result).toEqual({
      switched: false,
      message: "That connection is no longer available.",
    });
    expect(chatStore.getMetadata()?.connectionId).toBe(DEFAULT_HTTP_CONNECTION_ID);
  });

  it("blocks connection changes while generating", () => {
    appState.addHttpConnection({
      id: "remote",
      label: "Remote",
      baseUrl: "http://remote/v1",
    });
    chatStore.beginTurn("turn-1");

    const result = chatStore.switchThreadConnection("remote", providerSwitchOptions());

    expect(result).toEqual({
      switched: false,
      message: "Connection cannot be changed while a response is generating.",
    });
    expect(chatStore.getMetadata()?.connectionId).toBe(DEFAULT_HTTP_CONNECTION_ID);
  });

  it("rejects connection switching for non-HTTP providers", () => {
    chatStore.updateThreadMetadata({ provider: "debug-workspace" });

    const result = chatStore.switchThreadConnection("remote", providerSwitchOptions());

    expect(result).toEqual({
      switched: false,
      message: "Connection switching is available only for HTTP chats.",
    });
  });

  it("no-ops when switching to the active connection", () => {
    const result = chatStore.switchThreadConnection(DEFAULT_HTTP_CONNECTION_ID, providerSwitchOptions());

    expect(result).toEqual({ switched: false });
    expect(chatStore.getMetadata()?.connectionId).toBe(DEFAULT_HTTP_CONNECTION_ID);
  });
});
