import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSettingsSidebar,
  CHAT_HTTP_GATED_TABS,
  OPENCODE_GATED_TABS,
  filterSettingsSidebar,
  isChatHttpGatedTab,
  isOpencodeGatedTab,
  openSettingsDialog,
  registerSettingsDialogOpener,
  resolveOpenSettingsDialogTab,
  SETTINGS_TABS,
} from "./settingsDialogUi";
import type { OpencodeSettings } from "../domain/contracts";
import { appState } from "../state/appState";

const OPENCODE_OFF: OpencodeSettings = {
  enabled: false,
  mode: "sidecar",
  baseUrl: "http://127.0.0.1:4096",
  sidecarPort: 4096,
};
const OPENCODE_ON: OpencodeSettings = { ...OPENCODE_OFF, enabled: true };

afterEach(() => {
  registerSettingsDialogOpener(null);
  appState.resetAppState();
});

describe("settingsDialogUi", () => {
  it("groups sidebar entries into top-level tabs and sectioned tabs (both betas off)", () => {
    const sidebar = buildSettingsSidebar({ enabled: false }, OPENCODE_OFF);
    const topLevelLabels = sidebar.filter((entry) => entry.kind === "tab").map(
      (entry) => entry.tab.label,
    );
    const sectionLabels = sidebar.filter((entry) => entry.kind === "section").map(
      (entry) => entry.label,
    );
    const sectionTabLabels = sidebar.flatMap((entry) =>
      entry.kind === "section" ? entry.tabs.map((tab) => tab.label) : [],
    );

    expect(topLevelLabels).toEqual(["Editor", "Shortcuts", "Appearance", "Version Control"]);
    // Workspaces section is omitted entirely when OpenCode beta is off.
    expect(sectionLabels).toEqual(["Dev"]);
    expect(sectionTabLabels).toEqual(["Dev", "Logs"]);
  });

  it("exposes Workspaces section only when opencode.enabled is true", () => {
    const onSidebar = buildSettingsSidebar({ enabled: false }, OPENCODE_ON);
    const offSidebar = buildSettingsSidebar({ enabled: false }, OPENCODE_OFF);
    const flatLabels = (sidebar: ReturnType<typeof buildSettingsSidebar>): string[] =>
      sidebar.flatMap((entry) =>
        entry.kind === "tab" ? [entry.tab.label] : entry.tabs.map((tab) => tab.label),
      );

    expect(onSidebar.some((entry) => entry.kind === "section" && entry.label === "Workspaces")).toBe(true);
    expect(flatLabels(onSidebar)).toEqual(
      expect.arrayContaining([
        "OpenCode",
        "Config",
        "Providers",
        "MCP servers",
        "Agents",
        "Permissions",
        "Commands",
        "Instructions",
      ]),
    );
    expect(offSidebar.some((entry) => entry.kind === "section" && entry.label === "Workspaces")).toBe(false);
    expect(flatLabels(offSidebar)).not.toEqual(
      expect.arrayContaining(["OpenCode", "Agents", "MCP servers"]),
    );
  });

  it("exposes chat-http subtabs only when chatHttp.enabled is true", () => {
    const onSidebar = buildSettingsSidebar({ enabled: true }, OPENCODE_OFF);
    const offSidebar = buildSettingsSidebar({ enabled: false }, OPENCODE_OFF);
    const flatLabels = (sidebar: ReturnType<typeof buildSettingsSidebar>): string[] =>
      sidebar.flatMap((entry) =>
        entry.kind === "tab" ? [entry.tab.label] : entry.tabs.map((tab) => tab.label),
      );

    expect(flatLabels(onSidebar)).toEqual(
      expect.arrayContaining(["Providers", "Chat modes", "Debug Provider"]),
    );
    expect(flatLabels(offSidebar)).not.toEqual(
      expect.arrayContaining(["Providers", "Chat modes", "Debug Provider"]),
    );
    expect(flatLabels(offSidebar)).toEqual(expect.arrayContaining(["Dev", "Logs"]));
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

  it("registers opencode gated tabs by id", () => {
    expect(isOpencodeGatedTab("opencode")).toBe(true);
    expect(isOpencodeGatedTab("openCodeConfig")).toBe(true);
    expect(isOpencodeGatedTab("providers")).toBe(true);
    expect(isOpencodeGatedTab("mcp")).toBe(true);
    expect(isOpencodeGatedTab("agents")).toBe(true);
    expect(isOpencodeGatedTab("permissions")).toBe(true);
    expect(isOpencodeGatedTab("commands")).toBe(true);
    expect(isOpencodeGatedTab("instructions")).toBe(true);
    expect(isOpencodeGatedTab("debugAgent")).toBe(true);
    // Chat-http tabs are NOT opencode-gated.
    expect(isOpencodeGatedTab("connections")).toBe(false);
    expect(OPENCODE_GATED_TABS.map((tab) => tab.id)).toEqual([
      "opencode",
      "openCodeConfig",
      "providers",
      "mcp",
      "agents",
      "permissions",
      "commands",
      "instructions",
      "debugAgent",
    ]);
  });

  it("exposes all tabs in SETTINGS_TABS", () => {
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual([
      "editor",
      "shortcuts",
      "appearance",
      "versionControl",
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

  it("redirects chat-http gated tabs to dev when chat-http beta is off", () => {
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

  it("passes chat-http gated tabs through when chat-http beta is enabled", () => {
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

  it("redirects opencode gated tabs to dev when opencode beta is off", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);
    appState.setOpencodeEnabled(false);

    openSettingsDialog("opencode");
    openSettingsDialog("agents");
    openSettingsDialog("mcp");

    expect(opener).toHaveBeenNthCalledWith(1, "dev");
    expect(opener).toHaveBeenNthCalledWith(2, "dev");
    expect(opener).toHaveBeenNthCalledWith(3, "dev");
  });

  it("passes opencode gated tabs through when opencode beta is enabled", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);
    appState.setOpencodeEnabled(true);

    openSettingsDialog("opencode");
    openSettingsDialog("agents");
    openSettingsDialog("mcp");

    expect(opener).toHaveBeenNthCalledWith(1, "opencode");
    expect(opener).toHaveBeenNthCalledWith(2, "agents");
    expect(opener).toHaveBeenNthCalledWith(3, "mcp");
  });

  it("passes through non-gated tabs regardless of beta state", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);

    appState.setChatHttpEnabled(false);
    appState.setOpencodeEnabled(false);
    openSettingsDialog("editor");
    expect(opener).toHaveBeenLastCalledWith("editor");

    openSettingsDialog("logs");
    expect(opener).toHaveBeenLastCalledWith("logs");

    openSettingsDialog("versionControl");
    expect(opener).toHaveBeenLastCalledWith("versionControl");
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
    expect(resolveOpenSettingsDialogTab("connections", { enabled: false }, OPENCODE_ON)).toBe(
      "dev",
    );
    expect(resolveOpenSettingsDialogTab("chatModes", { enabled: false }, OPENCODE_ON)).toBe("dev");
    expect(resolveOpenSettingsDialogTab("debugAi", { enabled: false }, OPENCODE_ON)).toBe("dev");
  });

  it("passes through chat-http gated tabs when the beta is enabled", () => {
    expect(resolveOpenSettingsDialogTab("connections", { enabled: true }, OPENCODE_ON)).toBe(
      "connections",
    );
    expect(resolveOpenSettingsDialogTab("chatModes", { enabled: true }, OPENCODE_ON)).toBe(
      "chatModes",
    );
    expect(resolveOpenSettingsDialogTab("debugAi", { enabled: true }, OPENCODE_ON)).toBe("debugAi");
  });

  it("redirects opencode gated tabs to Dev when the beta is disabled", () => {
    expect(resolveOpenSettingsDialogTab("opencode", { enabled: true }, OPENCODE_OFF)).toBe("dev");
    expect(resolveOpenSettingsDialogTab("agents", { enabled: true }, OPENCODE_OFF)).toBe("dev");
    expect(resolveOpenSettingsDialogTab("mcp", { enabled: true }, OPENCODE_OFF)).toBe("dev");
    expect(resolveOpenSettingsDialogTab("debugAgent", { enabled: true }, OPENCODE_OFF)).toBe("dev");
  });

  it("passes through opencode gated tabs when the beta is enabled", () => {
    expect(resolveOpenSettingsDialogTab("opencode", { enabled: false }, OPENCODE_ON)).toBe(
      "opencode",
    );
    expect(resolveOpenSettingsDialogTab("agents", { enabled: false }, OPENCODE_ON)).toBe("agents");
    expect(resolveOpenSettingsDialogTab("mcp", { enabled: false }, OPENCODE_ON)).toBe("mcp");
  });

  it("passes through genuinely non-gated tabs regardless of either beta state", () => {
    expect(resolveOpenSettingsDialogTab("editor", { enabled: false }, OPENCODE_OFF)).toBe("editor");
    expect(resolveOpenSettingsDialogTab("logs", { enabled: true }, OPENCODE_ON)).toBe("logs");
    expect(resolveOpenSettingsDialogTab("versionControl", { enabled: false }, OPENCODE_OFF)).toBe(
      "versionControl",
    );
  });

  it("treats missing settings as the default (both betas disabled)", () => {
    expect(resolveOpenSettingsDialogTab("connections", null, null)).toBe("dev");
    expect(resolveOpenSettingsDialogTab("connections", undefined, undefined)).toBe("dev");
    expect(resolveOpenSettingsDialogTab("opencode", null, null)).toBe("dev");
    expect(resolveOpenSettingsDialogTab("opencode", undefined, undefined)).toBe("dev");
  });

  it("filterSettingsSidebar returns all entries for an empty query", () => {
    const sidebar = buildSettingsSidebar({ enabled: true }, OPENCODE_ON);
    expect(filterSettingsSidebar(sidebar, "")).toEqual(sidebar);
    expect(filterSettingsSidebar(sidebar, "   ")).toEqual(sidebar);
  });

  it("filterSettingsSidebar matches tab labels case-insensitively and keeps section headers", () => {
    const sidebar = buildSettingsSidebar({ enabled: true }, OPENCODE_ON);
    const filtered = filterSettingsSidebar(sidebar, "prov");

    expect(filtered).toEqual([
      {
        kind: "section",
        label: "Dev",
        tabs: [
          expect.objectContaining({ id: "connections", label: "Providers" }),
          expect.objectContaining({ id: "debugAi", label: "Debug Provider" }),
        ],
      },
      {
        kind: "section",
        label: "Workspaces",
        tabs: [
          expect.objectContaining({ id: "providers", label: "Providers" }),
          expect.objectContaining({ id: "debugAgent", label: "Debug Provider" }),
        ],
      },
    ]);
  });

  it("filterSettingsSidebar omits sections with no matching tabs", () => {
    const sidebar = buildSettingsSidebar({ enabled: false }, OPENCODE_OFF);
    const filtered = filterSettingsSidebar(sidebar, "shortcuts");

    expect(filtered).toEqual([
      { kind: "tab", tab: expect.objectContaining({ id: "shortcuts", label: "Shortcuts" }) },
    ]);
  });
});
