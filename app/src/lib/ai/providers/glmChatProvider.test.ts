import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessReason } from "../capabilities";
import { isChatProviderError } from "../chatSend";
import { defaultGlmProviderSettings } from "./glmProviderSettings";
import {
  createGlmChatProvider,
  resolveGlmChatCompletionsUrl,
} from "./glmChatProvider";
import { buildGlmChatMessages } from "./glmPrompt";
import type { ProviderRequestPayload, ProviderSendRequest } from "./types";

function samplePayload(mode: ProviderRequestPayload["mode"] = "ask"): ProviderRequestPayload {
  return {
    mode,
    provider: "glm",
    workspace: {
      rootPath: "/work/spec-ops",
      name: "spec-ops",
    },
    history: [{ role: "user", content: "How does retention work?" }],
    systemPrompt: "Ask prompt",
  };
}

function sampleRequest(mode: ProviderRequestPayload["mode"] = "ask"): ProviderSendRequest {
  return {
    payload: samplePayload(mode),
    modelId: "glm-4-flash",
    turnKey: "turn-1",
    accessStatus: "ready",
  };
}

function glmSuccessResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("buildGlmChatMessages", () => {
  it("includes mode system prompt, workspace metadata, summary, and history", () => {
    const messages = buildGlmChatMessages({
      ...samplePayload(),
      summary: "Earlier turns compacted",
      history: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "third" },
      ],
    });

    expect(messages).toEqual([
      {
        role: "system",
        content: [
          "Ask prompt",
          "Workspace: spec-ops (/work/spec-ops)",
          "Earlier conversation summary:\nEarlier turns compacted",
        ].join("\n\n"),
      },
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ]);
  });
});

describe("resolveGlmChatCompletionsUrl", () => {
  it("appends chat/completions to the configured base URL", () => {
    expect(resolveGlmChatCompletionsUrl("https://open.bigmodel.cn/api/paas/v4")).toBe(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    );
    expect(resolveGlmChatCompletionsUrl("https://open.bigmodel.cn/api/paas/v4/")).toBe(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    );
  });
});

describe("GlmChatProvider", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("blocks capability checks when GLM credentials are missing", async () => {
    const provider = createGlmChatProvider(
      () => ({ settings: defaultGlmProviderSettings, apiKey: "" }),
      fetchMock,
    );

    const result = await provider.checkCapabilities({
      provider: "glm",
      mode: "ask",
      workspaceRootPath: "/work/a",
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe(WorkspaceAccessReason.MissingProviderConfig);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns ready capabilities for configured GLM with ask and review modes", async () => {
    const provider = createGlmChatProvider(
      () => ({ settings: defaultGlmProviderSettings, apiKey: "test-key" }),
      fetchMock,
    );

    const result = await provider.checkCapabilities({
      provider: "glm",
      mode: "review",
      workspaceRootPath: "/work/a",
    });

    expect(result.status).toBe("ready");
    expect(result.capabilities).toEqual({
      canReadWorkspaceFiles: true,
      supportedModes: ["ask", "review"],
    });
  });

  it("sends buffered chat completions requests with shared prompt payload", async () => {
    fetchMock.mockResolvedValueOnce(glmSuccessResponse("GLM answer about retention."));

    const provider = createGlmChatProvider(
      () => ({
        settings: defaultGlmProviderSettings,
        apiKey: "secret-key",
      }),
      fetchMock,
    );

    const response = await provider.sendMessage({
      ...sampleRequest("ask"),
      modelId: "glm-4-plus",
    });

    expect(response.content).toBe("GLM answer about retention.");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer secret-key",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(init?.body)) as {
      model: string;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("glm-4-plus");
    expect(body.stream).toBe(false);
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toContain("Workspace: spec-ops (/work/spec-ops)");
    expect(body.messages.at(-1)).toEqual({
      role: "user",
      content: "How does retention work?",
    });
  });

  it("maps invalid model HTTP errors to user-facing ChatProviderError", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Model not found: glm-unknown" } }), {
        status: 404,
      }),
    );

    const provider = createGlmChatProvider(
      () => ({ settings: defaultGlmProviderSettings, apiKey: "test-key" }),
      fetchMock,
    );

    await expect(
      provider.sendMessage({ ...sampleRequest(), modelId: "glm-unknown" }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(isChatProviderError(error)).toBe(true);
      if (isChatProviderError(error)) {
        expect(error.userMessage).toContain('glm-unknown');
        expect(error.userMessage).toContain("Settings");
      }
      return true;
    });
  });

  it("maps HTTP 401 errors to user-facing ChatProviderError", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }),
    );

    const provider = createGlmChatProvider(
      () => ({ settings: defaultGlmProviderSettings, apiKey: "bad-key" }),
      fetchMock,
    );

    await expect(provider.sendMessage(sampleRequest())).rejects.toSatisfy((error: unknown) => {
      expect(isChatProviderError(error)).toBe(true);
      if (isChatProviderError(error)) {
        expect(error.userMessage).toBe("Invalid GLM API key. Check Settings → GLM.");
      }
      return true;
    });
  });

  it("maps network failures to user-facing ChatProviderError", async () => {
    fetchMock.mockRejectedValueOnce(new Error("fetch failed"));

    const provider = createGlmChatProvider(
      () => ({ settings: defaultGlmProviderSettings, apiKey: "test-key" }),
      fetchMock,
    );

    await expect(provider.sendMessage(sampleRequest())).rejects.toSatisfy((error: unknown) => {
      expect(isChatProviderError(error)).toBe(true);
      if (isChatProviderError(error)) {
        expect(error.userMessage).toContain("Could not reach the GLM API");
      }
      return true;
    });
  });

  it("throws when GLM returns an empty assistant message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "   " } }] }), { status: 200 }),
    );

    const provider = createGlmChatProvider(
      () => ({ settings: defaultGlmProviderSettings, apiKey: "test-key" }),
      fetchMock,
    );

    await expect(provider.sendMessage(sampleRequest())).rejects.toSatisfy((error: unknown) => {
      expect(isChatProviderError(error)).toBe(true);
      if (isChatProviderError(error)) {
        expect(error.userMessage).toBe("GLM returned an empty response. Try again.");
      }
      return true;
    });
  });
});
