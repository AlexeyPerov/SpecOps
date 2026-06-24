import { describe, expect, it } from "vitest";
import {
  CHAT_HTTP_CONTEXT_ID,
  createFileTab,
  createSessionTab,
  isDebugChatProviderId,
  isFileTab,
  isSessionTab,
  normalizeTabState,
  PRODUCT_CHAT_PROVIDER_IDS,
  tabDocumentId,
} from "./contracts";
import type {
  AppCommandId,
  AppDomainState,
  AppSessionSnapshot,
  AppSettingsState,
  ChatMessage,
  ChatProviderId,
  CommandDefinition,
  ContextId,
  DocumentState,
  TabState,
} from "./contracts";

describe("domain/contracts barrel", () => {
  it("re-exports document tab helpers", () => {
    const tab = createFileTab("tab-1", "doc-1");
    expect(isFileTab(tab)).toBe(true);
    expect(isSessionTab(tab)).toBe(false);
    expect(tabDocumentId(tab)).toBe("doc-1");

    const sessionTab = createSessionTab("tab-2", "session-1");
    expect(isSessionTab(sessionTab)).toBe(true);
    expect(tabDocumentId(sessionTab)).toBeNull();

    const legacy = normalizeTabState({ id: "tab-3", documentId: "doc-2", pinned: true });
    expect(legacy).toEqual(createFileTab("tab-3", "doc-2", true));
  });

  it("re-exports workspace and chat constants", () => {
    const contextId: ContextId = CHAT_HTTP_CONTEXT_ID;
    expect(contextId).toBe("chat-http");
    expect(PRODUCT_CHAT_PROVIDER_IDS).toContain("http");
    expect(isDebugChatProviderId("debug-chat")).toBe(true);
    expect(isDebugChatProviderId("http" satisfies ChatProviderId)).toBe(false);
  });

  it("re-exports representative type-only symbols", () => {
    const command: AppCommandId = "file.save";
    const definition: CommandDefinition = {
      id: command,
      label: "Save",
      menuPath: "File/Save",
    };
    const document: DocumentState = {
      id: "doc-1",
      filePath: null,
      title: "Untitled",
      content: "",
      savedContent: "",
      isDirty: false,
      contentKind: "text",
      language: "plaintext",
      encoding: "utf-8",
      lineEnding: "lf",
      diskFingerprint: null,
      dismissedFingerprint: null,
      fileMissing: false,
      scrollTop: 0,
      markdownViewMode: "edit",
    };
    const tab: TabState = createFileTab("tab-1", document.id);
    const message: ChatMessage = {
      id: "msg-1",
      role: "user",
      content: "hello",
      createdAt: new Date(0).toISOString(),
    };
    const settingsKeys: (keyof AppSettingsState)[] = ["statusBarVisible", "externalFiles"];
    const domainKeys: (keyof AppDomainState)[] = ["contexts", "settings", "theme"];
    const snapshotKeys: (keyof AppSessionSnapshot)[] = ["version", "windows"];

    expect(definition.id).toBe(command);
    expect(tab.kind).toBe("file");
    expect(message.role).toBe("user");
    expect(settingsKeys).toHaveLength(2);
    expect(domainKeys).toHaveLength(3);
    expect(snapshotKeys).toHaveLength(2);
  });
});
