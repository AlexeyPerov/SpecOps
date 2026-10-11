import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentHostBindings,
  AgentHostClient,
  AgentHostStatus,
} from "../services/agentHostRuntime";

vi.mock("../services/chatPersistence", async () => ({
  ...await vi.importActual("../services/chatPersistence"),
  persistSessionIndexEntry: vi.fn().mockResolvedValue(undefined),
  flushSessionIndexPersistence: vi.fn().mockResolvedValue(undefined),
}));

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
  detachWorkspaceTurns,
  workspaceTurnDescriptors,
  validateAgentHostSend,
  abortTurn,
} from "./chatSendPipeline";
import { registerConfirmRunner } from "../services/confirmDialogUi";
import { appState } from "../state/appState";
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
  return { runtimeId: "fake", nativeSessionId: id as never };
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
      inspectNative: vi.fn(),
      actNative: vi.fn(),
      status: null,
      subscribeSession: vi.fn(async () => () => {}),
      subscribeProfiles: vi.fn(async () => () => {}),
      start,
      stop: vi.fn(),
      restart: vi.fn(),
      getStatus: vi.fn(async () => ({ running: true, health: "healthy" }) as unknown as AgentHostStatus),
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
    registerConfirmRunner(null);
    appState.resetAppState();
    chatStore.reset();
    chatStore.setActiveWorkspaceRoot("/work/host-pipeline");
    harness = createFakeHostHarness();
    bindAgentHostClientForTests(() => harness.client);
  });

  afterEach(() => {
    bindAgentHostClientForTests(null);
    registerConfirmRunner(null);
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

  it("Stop while the writer warning is pending prevents native creation and send after Continue", async () => {
    const other = await seedThreadWithUserMessage();
    const current = await seedThreadWithUserMessage();
    let continueWarning!: (allow: boolean) => void;
    registerConfirmRunner(() => new Promise(resolve => { continueWarning = resolve; }));
    const send = vi.spyOn(harness.client, 'sendTurn');
    const pending = executeProviderTurn({ root: '/work/host-pipeline', activeSessionId: current, turnId: 'turn-test-1' });
    expect(continueWarning).toBeTypeOf('function');
    abortTurn(current, '/work/host-pipeline'); continueWarning(true);
    expect((await pending).ok).toBe(false);
    expect(harness.createSession).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
    expect(chatStore.getRuntimeState(other).isGenerating).toBe(true);
  });

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

  it("moves a streaming turn and pending permission without resending the prompt or cancelling native work", async () => {
    const root = '/work/host-pipeline';
    const sessionId = await seedThreadWithUserMessage();
    let release!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const send = vi.spyOn(harness.client, 'sendTurn').mockImplementation(async function* (request) {
      yield event({ type: 'text.delta', seq: 1, turnId: request.turnId, delta: 'before' });
      yield event({ type: 'permission.requested', seq: 2, turnId: request.turnId, request: { permissionId: 'permission-1', label: 'Read', payload: {} } });
      await paused;
    });
    registerPermissionPromptRunner(() => new Promise(() => {}));
    const source = executeProviderTurn({ root, activeSessionId: sessionId, turnId: 'turn-test-1' });
    await vi.waitFor(() => expect(chatStore.getRuntimeState(sessionId).isWaitingForPermission).toBe(true));
    expect(workspaceTurnDescriptors(root)[0].fold.content).toBe('before');
    const [checkpoint] = detachWorkspaceTurns(root);
    const adopted = structuredClone(chatStore.getWorkspaceSessionsState(root)!);
    const sourceResult = await source;
    expect(sourceResult.ok).toBe(false);
    expect(harness.cancelTurn).not.toHaveBeenCalled();
    release();
    chatStore.reset();
    chatStore.adoptWorkspaceState(root, adopted);
    chatStore.setActiveWorkspaceRoot(root);
    registerPermissionPromptRunner(async () => ({ reply: 'once' }));
    const resumed = await executeProviderTurn({ root, activeSessionId: sessionId, turnId: checkpoint.turnId,
      continuation: { checkpoint, events: { async *[Symbol.asyncIterator]() {
        yield* checkpoint.pending;
        yield event({ type: 'text.delta', seq: 3, turnId: checkpoint.turnId, delta: ' after' });
        yield event({ type: 'turn.finished', seq: 4, turnId: checkpoint.turnId });
      } } },
    });
    expect(resumed.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(harness.cancelTurn).not.toHaveBeenCalled();
    expect(harness.replyPermission).toHaveBeenCalledTimes(1);
    expect(chatStore.getMessages(sessionId).find(message => message.id === checkpoint.assistantMessageId)?.content).toBe('before after');
    expect(chatStore.getRuntimeState(sessionId).isGenerating).toBe(false);
  });

  it('does not detach in the middle of an interaction reply already sent to native', async () => {
    const root = '/work/host-pipeline'; const sessionId = await seedThreadWithUserMessage();
    let finishReply!: () => void; let finishTurn!: () => void;
    const pendingReply = new Promise<void>(resolve => { finishReply = resolve; });
    const pendingTurn = new Promise<void>(resolve => { finishTurn = resolve; });
    harness.replyPermission.mockImplementation(() => pendingReply);
    registerPermissionPromptRunner(async () => ({ reply: 'once' }));
    vi.spyOn(harness.client, 'sendTurn').mockImplementation(async function* (request) {
      yield event({ type: 'permission.requested', seq: 1, turnId: request.turnId, request: { permissionId: 'permission-reply', label: 'Read', payload: {} } });
      await pendingTurn;
      yield event({ type: 'turn.finished', seq: 2, turnId: request.turnId });
    });
    const response = executeProviderTurn({ root, activeSessionId: sessionId, turnId: 'turn-test-1' });
    await vi.waitFor(() => expect(harness.replyPermission).toHaveBeenCalled());
    expect(() => detachWorkspaceTurns(root)).toThrow('interaction reply');
    expect(harness.cancelTurn).not.toHaveBeenCalled();
    finishReply(); finishTurn();
    expect((await response).ok).toBe(true);
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

  it("missing component keeps the original runtime/profile/session and never creates or sends a replacement", async () => {
    const sessionId = await seedThreadWithUserMessage();
    const binding = { runtimeId: "codex" as const, connectionProfileId: "original-profile", nativeSessionId: "original-thread" };
    chatStore.setSessionLink(sessionId, binding, "/work/host-pipeline");
    harness.resumeSession.mockRejectedValue({ kind: "componentUnavailable", component: "codex", message: "Install or repair the component in Software, then reconnect the original profile explicitly." });
    const sending = vi.spyOn(harness.client, "sendTurn");
    const result = await executeProviderTurn({ root: "/work/host-pipeline", activeSessionId: sessionId, turnId: "turn-test-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Software");
    expect(chatStore.getSessionLink(sessionId, "/work/host-pipeline")).toMatchObject(binding);
    expect(harness.resumeSession).toHaveBeenCalledOnce();
    expect(sending).not.toHaveBeenCalled();
    expect(harness.createSession).not.toHaveBeenCalled();
  });

  it("rejects a changed native ID on resume without sending a prompt or replacing the binding", async () => {
    const sessionId = await seedThreadWithUserMessage();
    chatStore.setSessionLink(sessionId, { runtimeId: "fake", nativeSessionId: "original" }, "/work/host-pipeline");
    harness.resumeSession.mockResolvedValue(nativeRef("replacement"));
    const sending = vi.spyOn(harness.client, "sendTurn");
    const result = await executeProviderTurn({ root: "/work/host-pipeline", activeSessionId: sessionId, turnId: "turn-test-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("different native session");
    expect(sending).not.toHaveBeenCalled();
    expect(chatStore.getSessionLink(sessionId, "/work/host-pipeline")?.nativeSessionId).toBe("original");
    expect(harness.createSession).not.toHaveBeenCalled();
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
