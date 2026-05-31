import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceAccessReason,
  type CapabilityCheckInput,
  type CapabilityCheckResult,
} from "./capabilities";
import { streamProviderMessage } from "./chatSend";
import {
  buildProviderRequest,
  type ChatProvider,
  type ProviderSendRequest,
  type ProviderSendResponse,
  type ProviderStreamChunk,
} from "./providers/types";

class StreamingTestProvider implements ChatProvider {
  readonly id = "debug" as const;

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

  async sendMessage(_request: ProviderSendRequest): Promise<ProviderSendResponse> {
    throw new Error("sendMessage should not be called when streamMessage is available");
  }

  async *streamMessage(_request: ProviderSendRequest): AsyncIterable<ProviderStreamChunk> {
    yield { delta: "Hello" };
    yield { delta: " " };
    yield { delta: "world" };
  }
}

class BufferedOnlyTestProvider implements ChatProvider {
  readonly id = "glm" as const;

  sendMessage = vi.fn(async (request: ProviderSendRequest): Promise<ProviderSendResponse> => ({
    content: `buffered:${request.payload.mode}`,
  }));

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
}

function sampleRequest(mode: "ask" | "review" = "ask"): ProviderSendRequest {
  return {
    payload: buildProviderRequest({
      mode,
      provider: "debug",
      workspaceRootPath: "/work/a",
      recentMessages: [],
    }),
    modelId: "debug-simulator",
  };
}

describe("streamProviderMessage", () => {
  it("accumulates streaming chunks and invokes onChunk for each delta", async () => {
    const provider = new StreamingTestProvider();
    const onChunk = vi.fn();

    const content = await streamProviderMessage(provider, sampleRequest(), onChunk);

    expect(content).toBe("Hello world");
    expect(onChunk).toHaveBeenCalledTimes(3);
    expect(onChunk).toHaveBeenNthCalledWith(1, "Hello", "Hello");
    expect(onChunk).toHaveBeenNthCalledWith(2, " ", "Hello ");
    expect(onChunk).toHaveBeenNthCalledWith(3, "world", "Hello world");
  });

  it("falls back to buffered sendMessage when streamMessage is unavailable", async () => {
    const provider = new BufferedOnlyTestProvider();
    const onChunk = vi.fn();

    const content = await streamProviderMessage(provider, sampleRequest("review"), onChunk);

    expect(content).toBe("buffered:review");
    expect(provider.sendMessage).toHaveBeenCalledOnce();
    expect(onChunk).toHaveBeenCalledOnce();
    expect(onChunk).toHaveBeenCalledWith("buffered:review", "buffered:review");
  });

  it("works without an onChunk callback", async () => {
    const provider = new StreamingTestProvider();
    await expect(streamProviderMessage(provider, sampleRequest())).resolves.toBe("Hello world");
  });
});
