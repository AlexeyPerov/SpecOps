import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatStore, resetAgentIdCounterForTests } from "./chatStore";
import {
  WorkspaceAccessReason,
  type CapabilityChecker,
  type WorkspaceReadinessChecker,
} from "../ai/capabilities";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";

vi.mock("../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn(),
}));

const ensureWorkspaceReadAccessMock = vi.mocked(ensureWorkspaceReadAccess);

describe("Task 5: workspace agent metadata isolation and preflight separation", () => {
  beforeEach(() => {
    chatStore.reset();
    resetAgentIdCounterForTests();
    chatStore.setCapabilityChecker(null);
    chatStore.setWorkspaceReadinessChecker(null);
    ensureWorkspaceReadAccessMock.mockReset();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
  });

  afterEach(() => {
    chatStore.setWorkspaceReadinessChecker(null);
  });

  describe("workspace thread metadata isolation", () => {
    it("does not default to HTTP provider for new workspace threads", () => {
      chatStore.setActiveWorkspaceRoot("/work/a");
      chatStore.appendMessage({
        id: "m-1",
        role: "user",
        content: "hello",
        createdAt: "2026-06-14T00:00:00.000Z",
      });

      const metadata = chatStore.getMetadata();
      expect(metadata).not.toBeNull();
      expect(metadata?.provider).toBeUndefined();
      expect(metadata?.connectionId).toBeUndefined();
    });

    it("does not default to HTTP connectionId for workspace threads created via updateThreadMetadata", () => {
      chatStore.setActiveWorkspaceRoot("/work/a");
      chatStore.createDraftAgent();
      chatStore.updateThreadMetadata({ mode: "ask" });

      const metadata = chatStore.getMetadata();
      expect(metadata).not.toBeNull();
      expect(metadata?.provider).toBeUndefined();
      expect(metadata?.connectionId).toBeUndefined();
    });

    it("stores OpenCode-only fields on workspace threads", () => {
      chatStore.setActiveWorkspaceRoot("/work/a");
      chatStore.createDraftAgent();
      chatStore.updateThreadMetadata({
        opencodeAgentId: "build",
        opencodeProviderId: "anthropic",
        selectedModelId: "claude-sonnet-4",
      });

      const metadata = chatStore.getMetadata();
      expect(metadata?.opencodeAgentId).toBe("build");
      expect(metadata?.opencodeProviderId).toBe("anthropic");
      expect(metadata?.selectedModelId).toBe("claude-sonnet-4");
    });
  });

  describe("workspace preflight separation", () => {
    it("returns ready for workspace threads without HTTP provider configured", async () => {
      chatStore.setActiveWorkspaceRoot("/work/a");
      chatStore.appendMessage({
        id: "m-1",
        role: "user",
        content: "hello",
        createdAt: "2026-06-14T00:00:00.000Z",
      });

      const result = await chatStore.checkActiveWorkspaceCapabilities();

      expect(result.status).toBe("ready");
      expect(result.reason).toBe(WorkspaceAccessReason.Unknown);
    });

    it("uses workspace readiness checker for workspace threads", async () => {
      const checker: WorkspaceReadinessChecker = {
        checkReadiness: vi.fn().mockReturnValue({
          ready: false,
          message: "OpenCode server is unavailable.",
          recoveryHint: "Check OpenCode settings.",
        }),
      };
      chatStore.setWorkspaceReadinessChecker(checker);
      chatStore.setActiveWorkspaceRoot("/work/a");
      chatStore.appendMessage({
        id: "m-1",
        role: "user",
        content: "hello",
        createdAt: "2026-06-14T00:00:00.000Z",
      });

      const result = await chatStore.checkActiveWorkspaceCapabilities();

      expect(checker.checkReadiness).toHaveBeenCalledWith("/work/a");
      expect(result.status).toBe("blocked");
      expect(result.reason).toBe(WorkspaceAccessReason.MissingProviderConfig);
      expect(result.message).toBe("OpenCode server is unavailable.");
      expect(result.recoveryHint).toBe("Check OpenCode settings.");
    });

    it("does not call HTTP capability checker for workspace threads without provider", async () => {
      const httpChecker: CapabilityChecker = {
        checkCapabilities: vi.fn().mockResolvedValue({
          status: "ready",
          reason: WorkspaceAccessReason.Unknown,
          capabilities: { canReadWorkspaceFiles: true, supportedModes: [] },
          message: "",
        }),
      };
      chatStore.setCapabilityChecker(httpChecker);
      chatStore.setActiveWorkspaceRoot("/work/a");
      chatStore.appendMessage({
        id: "m-1",
        role: "user",
        content: "hello",
        createdAt: "2026-06-14T00:00:00.000Z",
      });

      await chatStore.checkActiveWorkspaceCapabilities();

      expect(httpChecker.checkCapabilities).not.toHaveBeenCalled();
    });

    it("still uses HTTP capability checker when workspace thread has explicit provider", async () => {
      const httpChecker: CapabilityChecker = {
        checkCapabilities: vi.fn().mockResolvedValue({
          status: "ready",
          reason: WorkspaceAccessReason.Unknown,
          capabilities: { canReadWorkspaceFiles: true, supportedModes: ["ask"] },
          message: "ready",
        }),
      };
      chatStore.setCapabilityChecker(httpChecker);
      chatStore.setActiveWorkspaceRoot("/work/a");
      chatStore.appendMessage({
        id: "m-1",
        role: "user",
        content: "hello",
        createdAt: "2026-06-14T00:00:00.000Z",
      });
      chatStore.updateThreadMetadata({ provider: "http" });

      const result = await chatStore.checkActiveWorkspaceCapabilities();

      expect(httpChecker.checkCapabilities).toHaveBeenCalledWith({
        provider: "http",
        mode: "ask",
        workspaceRootPath: "/work/a",
        connectionId: undefined,
      });
      expect(result.status).toBe("ready");
    });
  });

  describe("workspace send passes OpenCode provider", () => {
    it("uses thread opencodeProviderId for session link instead of hardcoded value", () => {
      chatStore.setActiveWorkspaceRoot("/work/a");
      chatStore.createDraftAgent();
      chatStore.updateThreadMetadata({ opencodeProviderId: "anthropic" });

      expect(chatStore.getMetadata()?.opencodeProviderId).toBe("anthropic");
    });
  });

  describe("composer selection actions for workspace", () => {
    it("selectModel updates selectedModelId directly for workspace context", () => {
      chatStore.setActiveWorkspaceRoot("/work/a");
      chatStore.createDraftAgent();
      chatStore.updateThreadMetadata({ selectedModelId: "model-a" });

      // Direct metadata update (simulating what composerSelectionActions does)
      chatStore.updateThreadMetadata({ selectedModelId: "model-b" });

      expect(chatStore.getMetadata()?.selectedModelId).toBe("model-b");
      expect(chatStore.getMetadata()?.provider).toBeUndefined();
    });
  });
});
