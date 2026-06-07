/**
 * Phase 2 validation — chat-http context ship gate.
 *
 * Automated invariants covered here:
 * - Chat rail gating state can expose chat-http when HTTP settings, API key, and model catalog are valid.
 * - chat-http sends are scoped to `chat-http`, skip workspace file access preflight, and normalize to ask-only.
 * - HTTP provider uses OpenAI-compatible SSE streaming with token deltas rendered into one assistant message.
 * - Workspace HTTP chat still works through the shared streaming send path.
 *
 * Manual smoke (workspace UI; not covered here):
 * - Complete Settings -> Connections setup and verify Chat appears on the rail.
 * - Open Chat, create a chat, send an ask message, and watch assistant text stream chunk by chunk.
 * - Enable Debug provider and verify Debug can send from Chat.
 * - Switch to Notepad and verify no AI/chat entry points appear.
 * - Switch to a workspace agent tab and verify HTTP ask/review still sends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendChatMessage } from "../ai/sendChatMessage";
import { createRegistryCapabilityChecker } from "../ai/providers/capabilityChecker";
import { registerTestDebugWorkspaceProvider, createTestCapabilityChecker } from "../ai/providers/debugProviderTestHelpers";
import { defaultDebugProviderSettings } from "../ai/providers/debugProviderSettings";
import { DEFAULT_HTTP_CONNECTION_ID } from "../ai/providers/httpConnectionSettings";
import { createOpenAiCompatibleChatProvider } from "../ai/providers/openAiCompatibleChatProvider";
import {
  registerChatProvider,
  resetChatProviderRegistryForTests,
} from "../ai/providers/registry";
import { resetChatProvidersForTests } from "../ai/providers/bootstrap";
import { isChatHttpRailVisible } from "../ai/providers/chatHttpRailGating";
import { scheduleAgentThreadFilePersistence } from "../services/chatPersistence";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";
import { CHAT_HTTP_CONTEXT_ID } from "../domain/contracts";
import { appState } from "./appState";
import { chatStore } from "./chatStore";

vi.mock("../services/chatPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/chatPersistence")>();
  return {
    ...actual,
    scheduleAgentThreadFilePersistence: vi.fn(),
  };
});

vi.mock("../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn(),
}));

const schedulePersistMock = vi.mocked(scheduleAgentThreadFilePersistence);
const ensureWorkspaceReadAccessMock = vi.mocked(ensureWorkspaceReadAccess);

function sseStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
}

function sseDelta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function registerPhase2Providers(fetchFn: typeof fetch): void {
  resetChatProviderRegistryForTests();
  registerTestDebugWorkspaceProvider();
  registerChatProvider(
    createOpenAiCompatibleChatProvider(
      () => ({
        settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
        apiKey:
          appState.getSnapshot().settings.providerApiKeys[DEFAULT_HTTP_CONNECTION_ID] ??
          "http-test-key",
      }),
      fetchFn,
    ),
  );
  chatStore.setCapabilityChecker(
    createRegistryCapabilityChecker(
        () => appState.getSnapshot().settings.providerSettings,
        () => ({
        settings: { ...appState.getSnapshot().settings.providerSettings.http, enabled: true },
        apiKey: "http-test-key",
      }),
    ),
  );
}

describe("Phase 2 validation — chat-http SSE streaming", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    chatStore.reset();
    resetChatProvidersForTests();
    schedulePersistMock.mockReset();
    ensureWorkspaceReadAccessMock.mockReset();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    appState.updateDebugWorkspaceProviderSettings({
      ...defaultDebugProviderSettings,
      enabled: true,
      simulationSeed: 42,
      delayMsMin: 0,
      delayMsMax: 0,
      chunkCharsMin: 4,
      chunkCharsMax: 4,
      failureProbability: 0,
      includeDiagnostics: false,
    });
    appState.updateHttpConnectionSettings({ enabled: true });
    appState.setProviderApiKey("http", "http-test-key");
    chatStore.setDefaultChatProviderResolver(() => "http");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes chat-http gating when HTTP connection settings and catalog are valid", () => {
    expect(
      isChatHttpRailVisible(
        appState.getSnapshot().settings.providerSettings,
        { [DEFAULT_HTTP_CONNECTION_ID]: "http-test-key" },
        appState.getSnapshot().settings.providerSettings.debugChat,
      ),
    ).toBe(true);
  });

  it("streams chat-http HTTP SSE deltas without workspace preflight or review mode", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      sseStreamResponse([sseDelta("Hel"), sseDelta("lo "), sseDelta("chat."), "data: [DONE]\n\n"]),
    );
    registerPhase2Providers(fetchFn as typeof fetch);
    chatStore.setActiveChatScope(CHAT_HTTP_CONTEXT_ID);
    chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "http", mode: "review" });
    ensureWorkspaceReadAccessMock.mockResolvedValue("blocked");

    const observedContents: string[] = [];
    const unsubscribe = chatStore.subscribe(() => {
      const assistant = chatStore.getMessages().find((message) => message.role === "assistant");
      if (assistant) {
        observedContents.push(assistant.content);
      }
    });

    const result = await sendChatMessage("stream in chat-http", undefined, {
      chatContextKind: "chat-http",
    });
    unsubscribe();

    expect(result.ok).toBe(true);
    expect(ensureWorkspaceReadAccessMock).not.toHaveBeenCalled();
    expect(chatStore.getMetadata()?.mode).toBe("ask");
    expect(observedContents).toEqual(expect.arrayContaining(["", "Hel", "Hello ", "Hello chat."]));
    expect(chatStore.getMessages().filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(chatStore.getMessages().at(-1)?.content).toBe("Hello chat.");
    expect(schedulePersistMock.mock.calls.at(-1)?.[0]).toBe(CHAT_HTTP_CONTEXT_ID);

    const requestInit = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(fetchFn.mock.calls[0]?.[0]).toBe("http://localhost:11434/v1/chat/completions");
    expect(requestInit.headers).toEqual(
      expect.objectContaining({
        Accept: "text/event-stream",
        Authorization: "Bearer http-test-key",
      }),
    );
    expect(JSON.parse(requestInit.body as string)).toMatchObject({
      stream: true,
      messages: expect.arrayContaining([{ role: "user", content: "stream in chat-http" }]),
    });
  });

  it("keeps workspace HTTP chat working through the shared streaming path", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      sseStreamResponse([sseDelta("Workspace "), sseDelta("HTTP works."), "data: [DONE]\n\n"]),
    );
    registerPhase2Providers(fetchFn as typeof fetch);
    chatStore.setActiveWorkspaceRoot("/work/a");
    chatStore.createDraftAgent();
    chatStore.updateThreadMetadata({ provider: "http", mode: "ask" });

    const result = await sendChatMessage("workspace http still sends");

    expect(result.ok).toBe(true);
    expect(ensureWorkspaceReadAccessMock).toHaveBeenCalledWith("/work/a");
    expect(chatStore.getMessages().at(-1)?.content).toBe("Workspace HTTP works.");
    expect(schedulePersistMock.mock.calls.at(-1)?.[0]).toBe("/work/a");
    expect(JSON.parse((fetchFn.mock.calls[0]?.[1] as RequestInit).body as string)).toMatchObject({
      stream: true,
    });
  });
});
