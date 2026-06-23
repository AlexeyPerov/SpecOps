import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSettingsSidebar,
  CHAT_HTTP_GATED_TABS,
  isChatHttpGatedTab,
  openSettingsDialog,
  registerSettingsDialogOpener,
  resolveOpenSettingsDialogTab,
  SETTINGS_TABS,
} from "./settingsDialogUi";
import { appState } from "../state/appState";

afterEach(() => {
  registerSettingsDialogOpener(null);
  appState.resetAppState();
});

describe("settingsDialogUi", () => {
  it("groups sidebar entries into top-level tabs and sectioned tabs (chat-http off)", () => {
    const sidebar = buildSettingsSidebar({ enabled: false });
    const topLevelLabels = sidebar.filter((entry) => entry.kind === "tab").map(
      (entry) => entry.tab.label,
    );
    const sectionLabels = sidebar.filter((entry) => entry.kind === "section").map(
      (entry) => entry.label,
    );
    const sectionTabLabels = sidebar.flatMap((entry) =>
      entry.kind === "section" ? entry.tabs.map((tab) => tab.label) : [],
    );

    expect(topLevelLabels).toEqual(["Editor", "Shortcuts", "Appearance"]);
    expect(sectionLabels).toEqual(["Dev", "Workspaces"]);
    expect(sectionTabLabels).toEqual([
      "Dev",
      "Logs",
      "OpenCode",
      "Config",
      "Providers",
      "MCP servers",
      "Agents",
      "Permissions",
      "Commands",
      "Instructions",
      "Debug Provider",
    ]);
  });

  it("exposes chat-http subtabs only when chatHttp.enabled is true", () => {
    const onSidebar = buildSettingsSidebar({ enabled: true });
    const offSidebar = buildSettingsSidebar({ enabled: false });
    const flatLabels = (sidebar: ReturnType<typeof buildSettingsSidebar>): string[] =>
      sidebar.flatMap((entry) =>
        entry.kind === "tab"
          ? [entry.tab.label]
          : entry.tabs.map((tab) => tab.label),
      );

    expect(flatLabels(onSidebar)).toEqual(
      expect.arrayContaining(["Providers", "Chat modes", "Debug Provider"]),
    );
    expect(flatLabels(offSidebar)).not.toEqual(
      expect.arrayContaining(["Providers", "Chat modes", "Debug Provider"]),
    );
    expect(flatLabels(offSidebar)).toEqual(
      expect.arrayContaining(["Dev", "Logs"]),
    );
  });

  it("registers chat-http gated tabs by id", () => {
    expect(isChatHttpGatedTab("connections")).toBe(true);
    expect(isChatHttpGatedTab("chatModes")).toBe(true);
    expect(isChatHttpGatedTab("debugAi")).toBe(true);
    expect(CHAT_HTTP_GATED_TABS.map((tab) => tab.id)).toEqual([
      "connections",
      "chatModes",
      "debugAi",
    ]);
  });

  it("exposes the new Dev tab in SETTINGS_TABS", () => {
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual([
      "editor",
      "shortcuts",
      "appearance",
      "dev",
      "connections",
      "chatModes",
      "debugAi",
      "opencode",
      "openCodeConfig",
      "providers",
      "mcp",
      "agents",
      "permissions",
      "commands",
      "instructions",
      "debugAgent",
      "logs",
    ]);
  });

  it("no-ops when opener is null", () => {
    registerSettingsDialogOpener(null);
    expect(() => openSettingsDialog()).not.toThrow();
    expect(() => openSettingsDialog("connections")).not.toThrow();
  });

  it("calls registered opener with default editor tab", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);

    openSettingsDialog();

    expect(opener).toHaveBeenCalledWith("editor");
  });

  it("redirects gated tabs to dev when chat-http beta is off", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);
    appState.setChatHttpEnabled(false);

    openSettingsDialog("connections");
    openSettingsDialog("chatModes");
    openSettingsDialog("debugAi");

    expect(opener).toHaveBeenNthCalledWith(1, "dev");
    expect(opener).toHaveBeenNthCalledWith(2, "dev");
    expect(opener).toHaveBeenNthCalledWith(3, "dev");
  });

  it("passes gated tabs through when chat-http beta is enabled", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);
    appState.setChatHttpEnabled(true);

    openSettingsDialog("connections");
    openSettingsDialog("chatModes");
    openSettingsDialog("debugAi");

    expect(opener).toHaveBeenNthCalledWith(1, "connections");
    expect(opener).toHaveBeenNthCalledWith(2, "chatModes");
    expect(opener).toHaveBeenNthCalledWith(3, "debugAi");
  });

  it("passes through non-gated tabs regardless of beta state", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);

    appState.setChatHttpEnabled(false);
    openSettingsDialog("opencode");
    expect(opener).toHaveBeenLastCalledWith("opencode");

    appState.setChatHttpEnabled(true);
    openSettingsDialog("opencode");
    expect(opener).toHaveBeenLastCalledWith("opencode");

    appState.setChatHttpEnabled(false);
    openSettingsDialog("logs");
    expect(opener).toHaveBeenLastCalledWith("logs");
  });

  it("calls registered opener with explicit opencode tab", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);

    openSettingsDialog("opencode");

    expect(opener).toHaveBeenCalledWith("opencode");
  });

  it("calls registered opener with explicit debugAgent tab", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);

    openSettingsDialog("debugAgent");

    expect(opener).toHaveBeenCalledWith("debugAgent");
  });

  it("re-register replaces previous opener", () => {
    const first = vi.fn();
    const second = vi.fn();
    registerSettingsDialogOpener(first);
    registerSettingsDialogOpener(second);
    appState.setChatHttpEnabled(true);

    openSettingsDialog("connections");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("connections");
  });

  it("redirects chat-http gated tabs to Dev when the beta is disabled", () => {
    expect(
      resolveOpenSettingsDialogTab("connections", { enabled: false }),
    ).toBe("dev");
    expect(
      resolveOpenSettingsDialogTab("chatModes", { enabled: false }),
    ).toBe("dev");
    expect(
      resolveOpenSettingsDialogTab("debugAi", { enabled: false }),
    ).toBe("dev");
  });

  it("passes through chat-http gated tabs when the beta is enabled", () => {
    expect(
      resolveOpenSettingsDialogTab("connections", { enabled: true }),
    ).toBe("connections");
    expect(
      resolveOpenSettingsDialogTab("chatModes", { enabled: true }),
    ).toBe("chatModes");
    expect(
      resolveOpenSettingsDialogTab("debugAi", { enabled: true }),
    ).toBe("debugAi");
  });

  it("passes through non-gated tabs regardless of beta state", () => {
    expect(
      resolveOpenSettingsDialogTab("opencode", { enabled: false }),
    ).toBe("opencode");
    expect(
      resolveOpenSettingsDialogTab("opencode", { enabled: true }),
    ).toBe("opencode");
    expect(
      resolveOpenSettingsDialogTab("logs", { enabled: false }),
    ).toBe("logs");
  });

  it("treats missing chatHttp settings as the default (beta disabled)", () => {
    expect(resolveOpenSettingsDialogTab("connections", null)).toBe("dev");
    expect(resolveOpenSettingsDialogTab("connections", undefined)).toBe("dev");
  });
});