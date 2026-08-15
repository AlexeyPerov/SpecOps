import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentHostBindings,
  AgentHostClient,
  AgentHostStatus,
} from "../services/agentHostRuntime";

vi.mock("../services/fileSystem", async () => {
  const actual = await vi.importActual("../services/fileSystem");
  return {
    ...actual,
    ensureWorkspaceReadAccess: vi.fn(async () => "ready"),
  };
});
import {
  bindAgentHostClientForTests,
  DEFAULT_SESSION_RUNTIME_ID,
} from "../services/agentHostRuntime";
import { chatStore } from "../state/chatStore";
import type { NativeSessionRef } from "../session/adapter";
import type { SessionEvent } from "../session/events";
import type { SpecOpsTurnId } from "../session";
import {
  executeProviderTurn,
  validateAgentHostSend,
  abortTurn,
} from "./chatSendPipeline";
import { registerPermissionPromptRunner } from "../services/permissionPrompt";

interface FakeHostHarness {
  client: AgentHostClient;
  start: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
  resumeSession: ReturnType<typeof vi.fn>;
  replyPermission: ReturnType<typeof vi.fn>;
  replyQuestion: ReturnType<typeof vi.fn>;
  cancelTurn: ReturnType<typeof vi.fn>;
  /** Queue of turn event batches, drained per sendTurn call. */
  nextTurnEvents: SessionEvent[][];
}

function nativeRef(id = "fake-native-1"): NativeSessionRef {
  return { runtimeId: DEFAULT_SESSION_RUNTIME_ID, nativeSessionId: id as never };
}

function event(partial: Record<string, unknown> & { type: SessionEvent["type"] }): SessionEvent {
  return {
    nativeSessionId: "fake-native-1",
    seq: 1,
    at: "1970-01-01T00:00:00.000Z",
    ...partial,
  } as SessionEvent;
}

function createFakeHostHarness(): FakeHostHarness {
  const start = vi.fn(async () => ({ running: true, health: "healthy" }) as unknown as AgentHostStatus);
  const createSession = vi.fn(async () => nativeRef());
  const resumeSession = vi.fn(async (request: { native: NativeSessionRef }) => request.native);
  const replyPermission = vi.fn(async () => {});
  const replyQuestion = vi.fn(async () => {});
  const cancelTurn = vi.fn(async () => {});
  const harness: FakeHostHarness = {
    start,
    createSession,
    resumeSession,
    replyPermission,
    replyQuestion,
    cancelTurn,
    nextTurnEvents: [],
    client: {
      status: null,
      start,
      stop: vi.fn(),
      restart: vi.fn(),
      getStatus: vi.fn(),
      discover: vi.fn(),
      authenticate: vi.fn(),
      catalogModels: vi.fn(async () => ({ models: [] })),
      catalogModes: vi.fn(async () => ({ modes: [] })),
      createSession,
      resumeSession,
      health: vi.fn(),
      replyPermission,
      replyQuestion,
      cancelTurn,
      async *sendTurn(request) {
        const events = harness.nextTurnEvents.shift() ?? [
          event({ type: "text.finished", turnId: request.turnId, text: "pong" }),
          event({ type: "turn.finished", turnId: request.turnId }),
        ];
        for (const item of events) {
          yield item;
        }
      },
    } satisfies AgentHostClient,
  };
  return harness;
}

describe("chatSendPipeline (host-backed turns)", () => {
  let harness: FakeHostHarness;

  beforeEach(() => {
    registerPermissionPromptRunner(null);
    chatStore.reset();
    chatStore.setActiveWorkspaceRoot("/work/host-pipeline");
    harness = createFakeHostHarness();
    bindAgentHostClientForTests(() => harness.client);
  });

  afterEach(() => {
    bindAgentHostClientForTests(null);
  });

  async function seedThreadWithUserMessage(): Promise<string> {
    chatStore.createDraftSession();
    const sessionId = chatStore.getActiveSessionId();
    if (!sessionId) {
      throw new Error("no active session");
    }
    chatStore.appendMessage(
      {
        id: "msg-user-1",
        role: "user",
        content: "ping",
        createdAt: "1970-01-01T00:00:00.000Z",
      },
      { sessionId },
    );
    chatStore.beginTurn("turn-test-1", sessionId);
    return sessionId;
  }

  it("creates a native binding on first send and streams folded content", async () => {
    const sessionId = await seedThreadWithUserMessage();
    harness.nextTurnEvents.push([
      event({ type: "text.delta", turnId: "turn-test-1" as SpecOpsTurnId, delta: "po" }),
      event({ type: "text.delta", turnId: "turn-test-1" as SpecOpsTurnId, delta: "ng" }),
      event({ type: "turn.finished", turnId: "turn-test-1" as SpecOpsTurnId }),
    ]);

    const result = await executeProviderTurn({
      root: "/work/host-pipeline",
      activeSessionId: sessionId,
      turnId: "turn-test-1",
    });

    expect(result.ok).toBe(true);
    expect(harness.start).toHaveBeenCalledTimes(1);
    expect(harness.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeId: DEFAULT_SESSION_RUNTIME_ID,
        workspaceRootPath: "/work/host-pipeline",
      }),
    );
    expect(harness.resumeSession).not.toHaveBeenCalled();
    expect(chatStore.getSessionLink(sessionId, "/work/host-pipeline")).toMatchObject({
      runtimeId: "fake",
      nativeSessionId: "fake-native-1",
    });
    const messages = chatStore.getMessages(sessionId);
    const assistant = messages.find((message) => message.role === "assistant");
    expect(assistant?.content).toBe("pong");
    expect(chatStore.getRuntimeState(sessionId).isGenerating).toBe(false);
  });

  it("resumes the existing native binding instead of creating a session", async () => {
    const sessionId = await seedThreadWithUserMessage();
    chatStore.setSessionLink(
      sessionId,
      { runtimeId: "fake", nativeSessionId: "fake-native-9" },
      "/work/host-pipeline",
    );

    const result = await executeProviderTurn({
      root: "/work/host-pipeline",
      activeSessionId: sessionId,
      turnId: "turn-test-1",
    });

    expect(result.ok).toBe(true);
    expect(harness.createSession).not.toHaveBeenCalled();
    expect(harness.resumeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        native: expect.objectContaining({ nativeSessionId: "fake-native-9" }),
        workspaceRootPath: "/work/host-pipeline",
      }),
    );
  });

  it("replies to permission requests through the host client", async () => {
    const sessionId = await seedThreadWithUserMessage();
    harness.nextTurnEvents.push([
      event({
        type: "permission.requested",
        turnId: "turn-test-1" as SpecOpsTurnId,
        request: { permissionId: "perm-1", label: "Run command" },
      }),
      event({ type: "turn.finished", turnId: "turn-test-1" as SpecOpsTurnId }),
    ]);
    registerPermissionPromptRunner(async () => ({ reply: "once" }));

    try {
      const result = await executeProviderTurn({
        root: "/work/host-pipeline",
        activeSessionId: sessionId,
        turnId: "turn-test-1",
      });

      expect(result.ok).toBe(true);
      expect(harness.replyPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          permissionId: "perm-1",
          reply: "once",
          native: expect.objectContaining({ runtimeId: "fake" }),
        }),
      );
    } finally {
      registerPermissionPromptRunner(null);
    }
  });

  it("fails the turn with a user-facing message on turn.failed", async () => {
    const sessionId = await seedThreadWithUserMessage();
    harness.nextTurnEvents.push([
      event({
        type: "turn.failed",
        turnId: "turn-test-1" as SpecOpsTurnId,
        message: "runtime exploded",
      }),
    ]);

    const result = await executeProviderTurn({
      root: "/work/host-pipeline",
      activeSessionId: sessionId,
      turnId: "turn-test-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("provider_error");
      expect(result.message).toContain("runtime exploded");
    }
    expect(chatStore.getRuntimeState(sessionId).lastError?.message).toContain("runtime exploded");
  });

  it("cancels the native turn when the store turn is cancelled", async () => {
    const sessionId = await seedThreadWithUserMessage();
    harness.nextTurnEvents.push([
      event({
        type: "text.delta",
        turnId: "turn-test-1" as SpecOpsTurnId,
        delta: "…",
      }),
      event({ type: "turn.cancelled", turnId: "turn-test-1" as SpecOpsTurnId }),
    ]);

    const result = await executeProviderTurn({
      root: "/work/host-pipeline",
      activeSessionId: sessionId,
      turnId: "turn-test-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Response was cancelled.");
    }
  });

  it("abortTurn cancels the active native turn through the host", async () => {
    const sessionId = await seedThreadWithUserMessage();
    chatStore.setSessionLink(
      sessionId,
      { runtimeId: "fake", nativeSessionId: "fake-native-3" },
      "/work/host-pipeline",
    );

    abortTurn(sessionId, "/work/host-pipeline");

    expect(harness.cancelTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        native: expect.objectContaining({ nativeSessionId: "fake-native-3" }),
        reason: "user",
      }),
    );
    expect(chatStore.getRuntimeState(sessionId).isGenerating).toBe(false);
  });

  it("validateAgentHostSend resolves model/mode from thread metadata", async () => {
    const sessionId = await seedThreadWithUserMessage();
    chatStore.updateThreadMetadata({ selectedModelId: "fake-model", selectedModeId: "plan" }, undefined, sessionId);

    const validation = await validateAgentHostSend("/work/host-pipeline", sessionId);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.modelId).toBe("fake-model");
      expect(validation.modeId).toBe("plan");
    }
  });
});
