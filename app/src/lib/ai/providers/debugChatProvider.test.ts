import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVIEW_REQUIRED_SECTIONS } from "../modes/builtins";
import { isChatProviderError, streamProviderMessage } from "../chatSend";
import { chatStore } from "../../state/chatStore";
import type { DebugProviderSettings } from "../../domain/contracts";
import { defaultDebugProviderSettings } from "./debugProviderSettings";
import { createDebugChatProvider } from "./debugChatProvider";

function createWorkspaceTestProvider(getSettings: () => DebugProviderSettings) {
  return createDebugChatProvider({
    id: "debug-workspace",
    getSettings,
    getSupportedModes: () => ["ask", "review", "raw", "custom-ideation"],
    canReadWorkspaceFiles: true,
    readyMessage: "Debug Agent provider is ready for workspace chat.",
  });
}
import { deriveDebugTurnSimulation } from "./debugSimulation";
import { buildDebugResponseBody } from "./debugResponses";
import type { ProviderRequestPayload, ProviderSendRequest } from "./types";

function samplePayload(mode: ProviderRequestPayload["mode"] = "ask"): ProviderRequestPayload {
  return {
    mode,
    provider: "debug-workspace",
    workspace: {
      rootPath: "/work/spec-ops",
      name: "spec-ops",
    },
    history: [{ role: "user", content: "How does retention work?" }],
    systemPrompt: "Ask prompt",
  };
}

function sampleRequest(
  mode: ProviderRequestPayload["mode"] = "ask",
  turnKey = "turn-1",
): ProviderSendRequest {
  return {
    payload: samplePayload(mode),
    modelId: "debug-simulator",
    turnKey,
    accessStatus: "ready",
  };
}

describe("debug turn simulation", () => {
  it("is deterministic for a fixed seed and turn key", () => {
    const settings = {
      ...defaultDebugProviderSettings,
      simulationSeed: 42,
      delayMsMin: 200,
      delayMsMax: 1200,
      chunkCharsMin: 8,
      chunkCharsMax: 48,
      failureProbability: 0.5,
    };
    const bodyLength = buildDebugResponseBody("ask", samplePayload()).length;

    const first = deriveDebugTurnSimulation(settings, "turn-1", bodyLength);
    const second = deriveDebugTurnSimulation(settings, "turn-1", bodyLength);

    expect(second).toEqual(first);
    expect(first.delayMs).toBeGreaterThanOrEqual(200);
    expect(first.delayMs).toBeLessThanOrEqual(1200);
    expect(first.chunkSizes.length).toBeGreaterThan(0);
  });

  it("changes simulation output for different turn keys with the same seed", () => {
    const settings = {
      ...defaultDebugProviderSettings,
      simulationSeed: 99,
      failureProbability: 0.5,
    };
    const bodyLength = 120;
    const turnA = deriveDebugTurnSimulation(settings, "turn-a", bodyLength);
    const turnB = deriveDebugTurnSimulation(settings, "turn-b", bodyLength);

    expect(turnA).not.toEqual(turnB);
  });
});

describe("DebugChatProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chatStore.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks capability checks when Debug is disabled", async () => {
    const provider = createWorkspaceTestProvider(() => ({
      ...defaultDebugProviderSettings,
      enabled: false,
    }));

    const result = await provider.checkCapabilities({
      provider: "debug-workspace",
      mode: "ask",
      workspaceRootPath: "/work/a",
    });

    expect(result.status).toBe("blocked");
    expect(result.capabilities?.supportedModes).toEqual([]);
    expect(result.recoveryHint).toContain("Debug Provider");
  });

  it("returns ready capabilities with both modes when Debug is enabled", async () => {
    const provider = createWorkspaceTestProvider(() => ({
      ...defaultDebugProviderSettings,
      enabled: true,
    }));

    const result = await provider.checkCapabilities({
      provider: "debug-workspace",
      mode: "review",
      workspaceRootPath: "/work/a",
    });

    expect(result.status).toBe("ready");
    expect(result.capabilities).toEqual({
      canReadWorkspaceFiles: true,
      supportedModes: ["ask", "review", "raw", "custom-ideation"],
    });
  });

  it("produces ask and review responses without network calls", async () => {
    const provider = createWorkspaceTestProvider(() => ({
      ...defaultDebugProviderSettings,
      enabled: true,
      delayMsMin: 0,
      delayMsMax: 0,
      includeDiagnostics: false,
    }));

    const ask = await provider.sendMessage(sampleRequest("ask"));
    expect(ask.content).toContain("simulated answer");
    expect(ask.content).not.toContain("Debug diagnostics");

    const review = await provider.sendMessage(sampleRequest("review"));
    for (const section of REVIEW_REQUIRED_SECTIONS) {
      expect(review.content).toContain(section);
    }
    expect(review.content).toMatch(/T-shirt size/i);
    expect(review.content).toMatch(/Confidence/i);
  });

  it("omits diagnostics appendix when includeDiagnostics is false", async () => {
    const provider = createWorkspaceTestProvider(() => ({
      ...defaultDebugProviderSettings,
      enabled: true,
      delayMsMin: 0,
      delayMsMax: 0,
      includeDiagnostics: false,
    }));

    const response = await provider.sendMessage(sampleRequest("ask"));
    expect(response.content).not.toContain("Debug diagnostics");
    expect(response.content).not.toContain("Prompt preview:");
  });

  it("includes diagnostics appendix when includeDiagnostics is true", async () => {
    const provider = createWorkspaceTestProvider(() => ({
      ...defaultDebugProviderSettings,
      enabled: true,
      delayMsMin: 0,
      delayMsMax: 0,
      includeDiagnostics: true,
    }));

    const response = await provider.sendMessage(sampleRequest("ask"));
    expect(response.content).toContain("Debug diagnostics");
    expect(response.content).toContain("Mode: ask");
    expect(response.content).toContain("Workspace: /work/spec-ops (spec-ops)");
    expect(response.content).toContain("Access: ready");
    expect(response.content).toContain("Prompt preview:");
    expect(response.content).toMatch(/Simulation: delay=\d+ms, chunks=\d+, failRoll=/);
  });

  it("streams partial content updates in configured chunks", async () => {
    const provider = createWorkspaceTestProvider(() => ({
      ...defaultDebugProviderSettings,
      enabled: true,
      simulationSeed: 7,
      delayMsMin: 0,
      delayMsMax: 0,
      chunkCharsMin: 4,
      chunkCharsMax: 4,
      includeDiagnostics: false,
    }));

    const request = sampleRequest("ask", "stream-turn");
    const chunks: string[] = [];
    const streamPromise = (async () => {
      for await (const chunk of provider.streamMessage!(request)) {
        chunks.push(chunk.delta);
      }
    })();

    await vi.runAllTimersAsync();
    await streamPromise;

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toContain("simulated answer");
  });

  it("throws simulated failures that map to failTurn scaffolding", async () => {
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.updateThreadMetadata({ provider: "debug-workspace", mode: "ask" });

    const provider = createWorkspaceTestProvider(() => ({
      ...defaultDebugProviderSettings,
      enabled: true,
      simulationSeed: 42,
      delayMsMin: 0,
      delayMsMax: 0,
      failureProbability: 1,
      failureMessage: "Simulated provider failure",
    }));

    chatStore.beginTurn("turn-fail");
    const request = sampleRequest("ask", "turn-fail");

    try {
      await streamProviderMessage(provider, request);
      expect.unreachable("Expected simulated provider failure");
    } catch (error) {
      if (!isChatProviderError(error)) {
        throw error;
      }
      chatStore.failTurn({ message: error.userMessage }, "turn-fail");
    }

    expect(chatStore.getRuntimeState().lastFailedTurnId).toBe("turn-fail");
    expect(chatStore.getRuntimeState().lastError?.message).toBe("Simulated provider failure");
  });

  it("waits for seeded delay before streaming content", async () => {
    const settings = {
      ...defaultDebugProviderSettings,
      enabled: true,
      simulationSeed: 42,
      delayMsMin: 200,
      delayMsMax: 1200,
      includeDiagnostics: false,
    };
    const provider = createWorkspaceTestProvider(() => settings);
    const request = sampleRequest("ask", "delay-turn");
    const simulation = deriveDebugTurnSimulation(
      settings,
      "delay-turn",
      buildDebugResponseBody("ask", request.payload).length,
    );

    let streamed = false;
    const streamPromise = (async () => {
      for await (const chunk of provider.streamMessage!(request)) {
        streamed ||= chunk.delta.length > 0;
      }
    })();

    await vi.advanceTimersByTimeAsync(simulation.delayMs - 1);
    expect(streamed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await streamPromise;
    expect(streamed).toBe(true);
  });
});
