import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consoleLogs, resetConsoleForTests } from "../services/appConsole";
import {
  logChatConnectionSwitch,
  logChatHttpRequest,
  logChatSendStart,
} from "./chatDiagnostics";

vi.mock("../services/logging", () => ({
  logDiagnostic: vi.fn(async (event: Parameters<typeof import("../services/logging").logDiagnostic>[0]) => {
    const { appendConsoleLog } = await import("../services/appConsole");
    appendConsoleLog(event);
  }),
}));

describe("chatDiagnostics", () => {
  beforeEach(() => {
    resetConsoleForTests();
  });

  it("writes structured chat send metadata to the app console", async () => {
    logChatSendStart({
      agentId: "agent-1",
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
      agentId: "agent-1",
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
});
