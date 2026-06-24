import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_HTTP_CONTEXT_ID } from "../../domain/contracts";
import { chatStore, formatCompactionNotice, resetSessionIdCounterForTests } from "../chatStore";
import { DRAFT_SESSION_TITLE } from "../../services/chatSessions";
import type { ChatThreadSnapshot } from "../../domain/contracts";
import { WorkspaceAccessReason, type CapabilityChecker } from "../../ai/capabilities";
import {
  WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
  WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
} from "../../ai/chatErrorCopy";
import {
  deleteSessionPersistence,
  readSessionThreadFileSnapshot,
  readWorkspaceSessionsIndexSnapshot,
} from "../../services/chatPersistence";
import { setChatRetentionMaxTurnsForTests } from "../../services/chatRetention";
import { ensureWorkspaceReadAccess } from "../../services/fileSystem";
import { defaultAppProviderSettings } from "../../ai/providers/appProviderSettings";
import {
  createTestCapabilityChecker,
  registerTestDebugWorkspaceProvider,
} from "../../ai/providers/debugProviderTestHelpers";
import { appState } from "../appState";
import { defaultDebugProviderSettings } from "../../ai/providers/debugProviderSettings";
import { defaultHttpConnectionSettings, DEFAULT_HTTP_CONNECTION_ID } from "../../ai/providers/httpConnectionSettings";
import { defaultProviderModelCatalogs } from "../../ai/providers/providerModelCatalog";
import {
  registerChatProvider,
  resetChatProviderRegistryForTests,
} from "../../ai/providers/registry";

vi.mock("../../services/chatPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/chatPersistence")>();
  return {
    ...actual,
    readSessionThreadFileSnapshot: vi.fn(),
    readWorkspaceSessionsIndexSnapshot: vi.fn(),
    deleteSessionPersistence: vi.fn(),
  };
});

vi.mock("../../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn(),
}));

const readSessionThreadFileSnapshotMock = vi.mocked(readSessionThreadFileSnapshot);
const readWorkspaceSessionsIndexSnapshotMock = vi.mocked(readWorkspaceSessionsIndexSnapshot);
const deleteSessionPersistenceMock = vi.mocked(deleteSessionPersistence);
const ensureWorkspaceReadAccessMock = vi.mocked(ensureWorkspaceReadAccess);

function providerSwitchOptions() {
  return {
    providerSettings: appState.getSnapshot().settings.providerSettings,
    providerModelCatalogs: defaultProviderModelCatalogs,
  };
}

describe("chatStore active provider resolution", () => {
  beforeEach(() => {
    chatStore.reset();
    resetChatProviderRegistryForTests();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ready");
    registerTestDebugWorkspaceProvider(() => ({
      ...defaultDebugProviderSettings,
      enabled: true,
    }));
    chatStore.setCapabilityChecker(createTestCapabilityChecker());
    chatStore.setDefaultChatProviderResolver(() => "debug-workspace");
    chatStore.setActiveWorkspaceRoot("/work/a");
  });

  it("uses default provider resolver when thread metadata is missing", () => {
    expect(chatStore.getMetadata()).toBeNull();
    expect(chatStore.getActiveChatProvider()).toBe("debug-workspace");
  });

  it("preflights workspace readiness when no thread exists yet", async () => {
    const result = await chatStore.runAccessPreflight();

    expect(result.status).toBe("ready");
  });

  it("checks workspace readiness without persisted thread metadata", async () => {
    const result = await chatStore.checkActiveWorkspaceCapabilities();

    expect(result.status).toBe("ready");
  });

  it("uses HTTP capability checker when thread has explicit provider", async () => {
    chatStore.updateThreadMetadata({ provider: "debug-workspace" });
    const result = await chatStore.checkActiveWorkspaceCapabilities();

    expect(result.status).toBe("ready");
    expect(result.capabilities?.supportedModes).toContain("ask");
    expect(result.capabilities?.supportedModes).toContain("review");
  });
});