import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openSettingsDialog,
  registerSettingsDialogOpener,
  SETTINGS_SIDEBAR,
  SETTINGS_TABS,
} from "./settingsDialogUi";

afterEach(() => {
  registerSettingsDialogOpener(null);
});

describe("settingsDialogUi", () => {
  it("groups sidebar entries into top-level tabs and sectioned tabs", () => {
    const topLevelLabels = SETTINGS_SIDEBAR.filter((entry) => entry.kind === "tab").map(
      (entry) => entry.tab.label,
    );
    const sectionLabels = SETTINGS_SIDEBAR.filter((entry) => entry.kind === "section").map(
      (entry) => entry.label,
    );
    const sectionTabLabels = SETTINGS_SIDEBAR.flatMap((entry) =>
      entry.kind === "section" ? entry.tabs.map((tab) => tab.label) : [],
    );

    expect(topLevelLabels).toEqual(["Editor", "Shortcuts"]);
    expect(sectionLabels).toEqual(["Chats", "Workspaces", "Logging"]);
    expect(sectionTabLabels).toEqual([
      "Providers",
      "Chat modes",
      "Debug Provider",
      "OpenCode",
      "Debug Provider",
      "Logs",
    ]);
    expect(SETTINGS_TABS.map((tab) => tab.label)).toEqual([
      "Editor",
      "Shortcuts",
      "Providers",
      "Chat modes",
      "Debug Provider",
      "OpenCode",
      "Debug Provider",
      "Logs",
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

  it("calls registered opener with explicit connections tab", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);

    openSettingsDialog("connections");

    expect(opener).toHaveBeenCalledWith("connections");
  });

  it("calls registered opener with explicit debugAi tab", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);

    openSettingsDialog("debugAi");

    expect(opener).toHaveBeenCalledWith("debugAi");
  });

  it("calls registered opener with explicit chatModes tab", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);

    openSettingsDialog("chatModes");

    expect(opener).toHaveBeenCalledWith("chatModes");
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

    openSettingsDialog("connections");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("connections");
  });
});
