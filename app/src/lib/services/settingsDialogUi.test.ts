import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSettingsSidebar,
  OPENCODE_GATED_TABS,
  filterSettingsSidebar,
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
  it("groups sidebar entries into top-level tabs and sectioned tabs (opencode off)", () => {
    const sidebar = buildSettingsSidebar(OPENCODE_OFF);
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
    const onSidebar = buildSettingsSidebar(OPENCODE_ON);
    const offSidebar = buildSettingsSidebar(OPENCODE_OFF);
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

  it("registers opencode gated tabs by id", () => {
    expect(isOpencodeGatedTab("opencode")).toBe(true);
    expect(isOpencodeGatedTab("openCodeConfig")).toBe(true);
    expect(isOpencodeGatedTab("providers")).toBe(true);
    expect(isOpencodeGatedTab("mcp")).toBe(true);
    expect(isOpencodeGatedTab("agents")).toBe(true);
    expect(isOpencodeGatedTab("permissions")).toBe(true);
    expect(isOpencodeGatedTab("commands")).toBe(true);
    expect(isOpencodeGatedTab("instructions")).toBe(true);
    expect(OPENCODE_GATED_TABS.map((tab) => tab.id)).toEqual([
      "opencode",
      "openCodeConfig",
      "providers",
      "mcp",
      "agents",
      "permissions",
      "commands",
      "instructions",
    ]);
  });

  it("exposes all tabs in SETTINGS_TABS", () => {
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual([
      "editor",
      "shortcuts",
      "appearance",
      "versionControl",
      "dev",
      "opencode",
      "openCodeConfig",
      "providers",
      "mcp",
      "agents",
      "permissions",
      "commands",
      "instructions",
      "logs",
    ]);
  });

  it("no-ops when opener is null", () => {
    registerSettingsDialogOpener(null);
    expect(() => openSettingsDialog()).not.toThrow();
    expect(() => openSettingsDialog("editor")).not.toThrow();
  });

  it("calls registered opener with default editor tab", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);

    openSettingsDialog();

    expect(opener).toHaveBeenCalledWith("editor");
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
    appState.setOpencodeEnabled(true);

    openSettingsDialog("opencode");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("opencode");
  });

  it("redirects opencode gated tabs to Dev when the beta is disabled", () => {
    expect(resolveOpenSettingsDialogTab("opencode", OPENCODE_OFF)).toBe("dev");
    expect(resolveOpenSettingsDialogTab("agents", OPENCODE_OFF)).toBe("dev");
    expect(resolveOpenSettingsDialogTab("mcp", OPENCODE_OFF)).toBe("dev");
  });

  it("passes through opencode gated tabs when the beta is enabled", () => {
    expect(resolveOpenSettingsDialogTab("opencode", OPENCODE_ON)).toBe("opencode");
    expect(resolveOpenSettingsDialogTab("agents", OPENCODE_ON)).toBe("agents");
    expect(resolveOpenSettingsDialogTab("mcp", OPENCODE_ON)).toBe("mcp");
  });

  it("passes through genuinely non-gated tabs regardless of beta state", () => {
    expect(resolveOpenSettingsDialogTab("editor", OPENCODE_OFF)).toBe("editor");
    expect(resolveOpenSettingsDialogTab("logs", OPENCODE_ON)).toBe("logs");
    expect(resolveOpenSettingsDialogTab("versionControl", OPENCODE_OFF)).toBe("versionControl");
  });

  it("treats missing settings as the default (opencode disabled)", () => {
    expect(resolveOpenSettingsDialogTab("opencode", null)).toBe("dev");
    expect(resolveOpenSettingsDialogTab("opencode", undefined)).toBe("dev");
  });

  it("filterSettingsSidebar returns all entries for an empty query", () => {
    const sidebar = buildSettingsSidebar(OPENCODE_ON);
    expect(filterSettingsSidebar(sidebar, "")).toEqual(sidebar);
    expect(filterSettingsSidebar(sidebar, "   ")).toEqual(sidebar);
  });

  it("filterSettingsSidebar matches tab labels case-insensitively and keeps section headers", () => {
    const sidebar = buildSettingsSidebar(OPENCODE_ON);
    const filtered = filterSettingsSidebar(sidebar, "prov");

    expect(filtered).toEqual([
      {
        kind: "section",
        label: "Workspaces",
        tabs: [
          expect.objectContaining({ id: "providers", label: "Providers" }),
        ],
      },
    ]);
  });

  it("filterSettingsSidebar omits sections with no matching tabs", () => {
    const sidebar = buildSettingsSidebar(OPENCODE_OFF);
    const filtered = filterSettingsSidebar(sidebar, "shortcuts");

    expect(filtered).toEqual([
      { kind: "tab", tab: expect.objectContaining({ id: "shortcuts", label: "Shortcuts" }) },
    ]);
  });
});
