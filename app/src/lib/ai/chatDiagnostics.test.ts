import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consoleLogs, resetConsoleForTests } from "../services/appConsole";
import { setVerboseProviderLoggingReader } from "./providerVerboseLogging";
import {
  logChatConnectionSwitch,
  logChatHttpRequest,
  logChatHttpRequestBody,
  logChatProviderPayload,
  logChatSendStart,
} from "./chatDiagnostics";
import type { ProviderRequestPayload } from "./providers/types";

vi.mock("../services/logging", () => ({
  logDiagnostic: vi.fn(async (event: Parameters<typeof import("../services/logging").logDiagnostic>[0]) => {
    const { appendConsoleLog } = await import("../services/appConsole");
    appendConsoleLog(event);
  }),
}));

describe("chatDiagnostics", () => {
  beforeEach(() => {
    resetConsoleForTests();
    setVerboseProviderLoggingReader(() => true);
  });

  afterEach(() => {
    setVerboseProviderLoggingReader(null);
  });

  it("writes structured chat send metadata to the app console", async () => {
    logChatSendStart({
      sessionId: "agent-1",
      turnId: "turn-1",
      providerId: "http",
      connectionId: "conn-glm",
      modelId: "GLM-4.7",
      mode: "ask",
    });

    await vi.waitFor(() => {
      expect(get(consoleLogs).at(-1)?.message).toBe("chat send started");
    });
  });

  it("logs blocked connection switches as warnings", async () => {
    logChatConnectionSwitch({
      sessionId: "agent-1",
      fromConnectionId: "conn-a",
      toConnectionId: "conn-b",
      switched: false,
      reason: "generating",
    });

    await vi.waitFor(() => {
      expect(get(consoleLogs).at(-1)?.level).toBe("warn");
    });
  });

  it("logs http requests at debug level", async () => {
    logChatHttpRequest({
      turnId: "turn-1",
      connectionId: "conn-glm",
      url: "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
      modelId: "GLM-4.7",
      stream: true,
    });

    await vi.waitFor(() => {
      expect(get(consoleLogs).at(-1)?.message).toBe("chat http request");
    });
  });

  it("logs verbose provider payloads when enabled", async () => {
    const payload: ProviderRequestPayload = {
      mode: "ask",
      provider: "http",
      workspace: { rootPath: "/work/spec-ops", name: "spec-ops" },
      history: [{ role: "user", content: "Hello" }],
    };

    logChatProviderPayload({
      turnId: "turn-1",
      providerId: "http",
      modelId: "gpt-4o-mini",
      payload,
    });

    await vi.waitFor(() => {
      const entry = get(consoleLogs).at(-1);
      expect(entry?.message).toBe("chat provider payload");
      expect(entry?.metadata).toMatchObject({
        kind: "chat.provider.payload",
        payload,
      });
    });
  });

  it("skips verbose http bodies when disabled", async () => {
    setVerboseProviderLoggingReader(() => false);
    const beforeCount = get(consoleLogs).length;

    logChatHttpRequestBody({
      turnId: "turn-1",
      url: "https://example.test/v1/chat/completions",
      modelId: "gpt-4o-mini",
      stream: false,
      body: { model: "gpt-4o-mini", messages: [] },
    });

    expect(get(consoleLogs).length).toBe(beforeCount);
  });
});
