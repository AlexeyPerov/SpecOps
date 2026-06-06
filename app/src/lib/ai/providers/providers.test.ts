import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceAccessReason,
  type CapabilityCheckInput,
  type CapabilityCheckResult,
} from "../capabilities";
import {
  getChatProvider,
  listRegisteredChatProviders,
  registerChatProvider,
  resetChatProviderRegistryForTests,
  resolveChatProvider,
  unregisterChatProvider,
} from "./registry";
import {
  buildProviderRequest,
  buildProviderRequestFromThread,
  type ChatProvider,
  type ProviderSendRequest,
  type ProviderSendResponse,
  type ProviderStreamChunk,
} from "./types";
import type { ChatMessage, ChatThreadSnapshot } from "../../domain/contracts";

class InMemoryTestProvider implements ChatProvider {
  readonly id: ChatProvider["id"];

  constructor(id: ChatProvider["id"]) {
    this.id = id;
  }

  async checkCapabilities(_input: CapabilityCheckInput): Promise<CapabilityCheckResult> {
    return {
      status: "ready",
      reason: WorkspaceAccessReason.Unknown,
      capabilities: {
        canReadWorkspaceFiles: true,
        supportedModes: ["ask", "review"],
      },
      message: "ready",
    };
  }

  async sendMessage(request: ProviderSendRequest): Promise<ProviderSendResponse> {
    return {
      content: `buffered:${request.payload.mode}:${request.payload.history.length}`,
    };
  }

  async *streamMessage(request: ProviderSendRequest): AsyncIterable<ProviderStreamChunk> {
    yield { delta: `stream:${request.payload.mode}:` };
    yield { delta: String(request.payload.history.length) };
  }
}

function userMessage(content: string): ChatMessage {
  return {
    id: `user-${content}`,
    role: "user",
    content,
    createdAt: "2026-05-26T00:00:00.000Z",
  };
}

function assistantMessage(content: string): ChatMessage {
  return {
    id: `assistant-${content}`,
    role: "assistant",
    content,
    createdAt: "2026-05-26T00:00:01.000Z",
  };
}

function threadSnapshot(overrides?: Partial<ChatThreadSnapshot["metadata"]>): ChatThreadSnapshot {
  return {
    metadata: {
      agentId: "agent-test",
      threadId: "agent-test",
      mode: "ask",
      provider: "debug-workspace",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:01.000Z",
      ...overrides,
    },
    messages: [userMessage("hello"), assistantMessage("hi")],
  };
}

describe("buildProviderRequest", () => {
  it("assembles mode, provider, workspace metadata, summary, and history", () => {
    const payload = buildProviderRequest({
      mode: "review",
      provider: "http",
      workspaceRootPath: "/work/spec-ops",
      summary: "Earlier turns compacted",
      recentMessages: [
        userMessage("question"),
        assistantMessage("answer"),
        {
          id: "system-1",
          role: "system",
          content: "Provider switched",
          createdAt: "2026-05-26T00:00:02.000Z",
          systemEvent: {
            type: "provider-switched",
            fromProvider: "http",
            toProvider: "debug-workspace",
          },
        },
      ],
      systemPrompt: "Review critically.",
    });

    expect(payload).toEqual({
      mode: "review",
      provider: "http",
      workspace: {
        rootPath: "/work/spec-ops",
        name: "spec-ops",
      },
      summary: "Earlier turns compacted",
      history: [
        { role: "user", content: "question" },
        { role: "assistant", content: "answer" },
      ],
      systemPrompt: "Review critically.",
    });
  });

  it("omits blank summary and system prompt fields", () => {
    const payload = buildProviderRequest({
      mode: "ask",
      provider: "debug-workspace",
      workspaceRootPath: "/tmp",
      summary: "   ",
      recentMessages: [],
      systemPrompt: "",
    });

    expect(payload.summary).toBeUndefined();
    expect(payload.systemPrompt).toBeUndefined();
    expect(payload.workspace.name).toBe("tmp");
  });

  it("builds identical payloads from thread snapshots via buildProviderRequestFromThread", () => {
    const thread = threadSnapshot({ mode: "review", provider: "http", summary: "Compacted" });

    expect(buildProviderRequestFromThread(thread, "/work/spec-ops", "Ask mode")).toEqual(
      buildProviderRequest({
        mode: "review",
        provider: "http",
        workspaceRootPath: "/work/spec-ops",
        summary: "Compacted",
        recentMessages: thread.messages,
        systemPrompt: "Ask mode",
      }),
    );
  });
});

describe("chat provider registry", () => {
  it("registers, lists, and resolves providers by id", () => {
    resetChatProviderRegistryForTests();
    const provider = new InMemoryTestProvider("debug-workspace");

    registerChatProvider(provider);

    expect(listRegisteredChatProviders()).toEqual(["debug-workspace"]);
    expect(getChatProvider("debug-workspace")).toBe(provider);
    expect(resolveChatProvider("debug-workspace")).toBe(provider);
  });

  it("throws when resolving an unregistered provider", () => {
    resetChatProviderRegistryForTests();

    expect(() => resolveChatProvider("http")).toThrow(
      "No chat provider registered for id: http",
    );
  });

  it("unregisters providers", () => {
    resetChatProviderRegistryForTests();
    const provider = new InMemoryTestProvider("http");
    registerChatProvider(provider);

    unregisterChatProvider("http");

    expect(getChatProvider("http")).toBeNull();
    expect(listRegisteredChatProviders()).toEqual([]);
  });
});

describe("ChatProvider contract (in-memory test double)", () => {
  it("supports buffered sendMessage completion", async () => {
    const provider = new InMemoryTestProvider("debug-workspace");
    const request: ProviderSendRequest = {
      modelId: "debug-simulator",
      payload: buildProviderRequest({
        mode: "ask",
        provider: "debug-workspace",
        workspaceRootPath: "/work/a",
        recentMessages: [userMessage("one"), assistantMessage("two")],
      }),
    };

    await expect(provider.sendMessage(request)).resolves.toEqual({
      content: "buffered:ask:2",
    });
  });

  it("supports optional streaming completion via streamMessage", async () => {
    const provider = new InMemoryTestProvider("debug-workspace");
    const request: ProviderSendRequest = {
      modelId: "debug-simulator",
      payload: buildProviderRequest({
        mode: "review",
        provider: "debug-workspace",
        workspaceRootPath: "/work/a",
        recentMessages: [userMessage("one")],
      }),
    };

    const chunks: string[] = [];
    for await (const chunk of provider.streamMessage!(request)) {
      chunks.push(chunk.delta);
    }

    expect(chunks).toEqual(["stream:review:", "1"]);
  });

  it("includes checkCapabilities on the provider contract", async () => {
    const provider = new InMemoryTestProvider("http");
    const checkCapabilities = vi.spyOn(provider, "checkCapabilities");

    await provider.checkCapabilities({
      provider: "http",
      mode: "ask",
      workspaceRootPath: "/work/a",
    });

    expect(checkCapabilities).toHaveBeenCalledOnce();
  });
});
