import { afterEach, describe, expect, it, vi } from "vitest";
import { openSettingsDialog, registerSettingsDialogOpener } from "./settingsDialogUi";

afterEach(() => {
  registerSettingsDialogOpener(null);
});

describe("settingsDialogUi", () => {
  it("no-ops when opener is null", () => {
    registerSettingsDialogOpener(null);
    expect(() => openSettingsDialog()).not.toThrow();
    expect(() => openSettingsDialog("glm")).not.toThrow();
  });

  it("calls registered opener with default editor tab", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);

    openSettingsDialog();

    expect(opener).toHaveBeenCalledWith("editor");
  });

  it("calls registered opener with explicit glm tab", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);

    openSettingsDialog("glm");

    expect(opener).toHaveBeenCalledWith("glm");
  });

  it("calls registered opener with explicit debugAi tab", () => {
    const opener = vi.fn();
    registerSettingsDialogOpener(opener);

    openSettingsDialog("debugAi");

    expect(opener).toHaveBeenCalledWith("debugAi");
  });

  it("re-register replaces previous opener", () => {
    const first = vi.fn();
    const second = vi.fn();
    registerSettingsDialogOpener(first);
    registerSettingsDialogOpener(second);

    openSettingsDialog("glm");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("glm");
  });
});
