import { describe, expect, it, vi } from "vitest";
import type { HttpConnectionSettings } from "../../domain/contracts";
import { ChatProviderError } from "./errors";
import { createOpenAiCompatibleChatProvider } from "./openAiCompatibleChatProvider";
import type { ProviderRequestPayload, ProviderSendRequest } from "./types";

const settings: HttpConnectionSettings = {
  enabled: true,
  baseUrl: "https://provider.example/v1/",
};

function samplePayload(): ProviderRequestPayload {
  return {
    mode: "ask",
    provider: "http",
    workspace: {
      rootPath: "/work/spec-ops",
      name: "spec-ops",
    },
    history: [{ role: "user", content: "Hello" }],
    systemPrompt: "Answer briefly.",
  };
}

function sampleRequest(overrides?: Partial<ProviderSendRequest>): ProviderSendRequest {
  return {
    payload: samplePayload(),
    modelId: "gpt-4o-mini",
    ...overrides,
  };
}

function sseResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    ...init,
  });
}

async function collectStream(provider: ReturnType<typeof createOpenAiCompatibleChatProvider>): Promise<string[]> {
  const deltas: string[] = [];
  for await (const chunk of provider.streamMessage!(sampleRequest())) {
    deltas.push(chunk.delta);
  }
  return deltas;
}

describe("OpenAiCompatibleChatProvider", () => {
  it("streams ordered SSE deltas and sends an OpenAI-compatible streaming request", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      sseResponse(
        [
          'data: {"choices":[{"delta":{"content":"Hel"}}]}',
          "",
          'data: {"choices":[{"delta":{"content":"lo"}}]}',
          "",
          "data: [DONE]",
          "",
        ].join("\n"),
      ),
    );
    const provider = createOpenAiCompatibleChatProvider(() => ({ settings, apiKey: "test-key" }), fetchFn);

    await expect(collectStream(provider)).resolves.toEqual(["Hel", "lo"]);

    expect(fetchFn).toHaveBeenCalledWith(
      "https://provider.example/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "text/event-stream",
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    const requestBody = JSON.parse(fetchFn.mock.calls[0]?.[1]?.body as string) as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(requestBody).toMatchObject({
      model: "gpt-4o-mini",
      stream: true,
    });
    expect(requestBody.messages[0]).toMatchObject({ role: "system" });
    expect(requestBody.messages[1]).toEqual({ role: "user", content: "Hello" });
  });

  it("maps HTTP status failures before reading the stream", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }),
    );
    const provider = createOpenAiCompatibleChatProvider(() => ({ settings, apiKey: "test-key" }), fetchFn);

    await expect(collectStream(provider)).rejects.toMatchObject({
      name: "ChatProviderError",
      userMessage: "Invalid API key for the configured HTTP provider. Check Settings → Connections.",
    });
  });

  it("maps malformed SSE JSON to a provider error", async () => {
    const fetchFn = vi.fn().mockResolvedValue(sseResponse("data: {bad-json}\n\ndata: [DONE]\n\n"));
    const provider = createOpenAiCompatibleChatProvider(() => ({ settings, apiKey: "test-key" }), fetchFn);

    await expect(collectStream(provider)).rejects.toMatchObject({
      name: "ChatProviderError",
      userMessage: "HTTP provider returned an invalid streaming response. Try again.",
    });
  });

  it("accepts truncated SSE streams when content was already streamed", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      sseResponse('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
    );
    const provider = createOpenAiCompatibleChatProvider(() => ({ settings, apiKey: "test-key" }), fetchFn);

    await expect(collectStream(provider)).resolves.toEqual(["partial"]);
  });

  it("maps empty truncated SSE streams to a provider error", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(sseResponse('data: {"choices":[{"delta":{}}]}\n\n'));
    const provider = createOpenAiCompatibleChatProvider(() => ({ settings, apiKey: "test-key" }), fetchFn);

    await expect(collectStream(provider)).rejects.toBeInstanceOf(ChatProviderError);
  });

  it("keeps buffered sendMessage available with stream disabled", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "Buffered response." } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const provider = createOpenAiCompatibleChatProvider(() => ({ settings, apiKey: "test-key" }), fetchFn);

    await expect(provider.sendMessage(sampleRequest())).resolves.toEqual({ content: "Buffered response." });
    const requestBody = JSON.parse(fetchFn.mock.calls[0]?.[1]?.body as string) as { stream: boolean };
    expect(requestBody.stream).toBe(false);
  });

  it("does not bypass capability gating when streaming is available", async () => {
    const provider = createOpenAiCompatibleChatProvider(
      () => ({
        settings: { ...settings, enabled: false },
        apiKey: "test-key",
      }),
      () => ["ask", "review", "raw", "custom-ideation"],
      vi.fn(),
    );

    await expect(provider.checkCapabilities({ provider: "http", mode: "ask", workspaceRootPath: "/work/a" }))
      .resolves.toMatchObject({ status: "blocked" });
    await expect(collectStream(provider)).rejects.toMatchObject({
      name: "ChatProviderError",
      userMessage: "Add your HTTP connection API key in Settings before sending messages.",
    });
  });

  it("supports raw and custom modes when supplied by resolver", async () => {
    const provider = createOpenAiCompatibleChatProvider(
      () => ({ settings, apiKey: "test-key" }),
      () => ["ask", "review", "raw", "custom-ideation"],
      vi.fn(),
    );

    await expect(
      provider.checkCapabilities({
        provider: "http",
        mode: "raw",
        workspaceRootPath: "/work/a",
      }),
    ).resolves.toMatchObject({
      status: "ready",
      capabilities: { supportedModes: ["ask", "review", "raw", "custom-ideation"] },
    });
    await expect(
      provider.checkCapabilities({
        provider: "http",
        mode: "custom-ideation",
        workspaceRootPath: "/work/a",
      }),
    ).resolves.toMatchObject({ status: "ready" });
  });
});
