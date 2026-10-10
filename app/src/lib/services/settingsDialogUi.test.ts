import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSettingsSidebar, filterSettingsSidebar, openSettingsDialog, registerSettingsDialogOpener, resolveOpenSettingsDialogTab, SETTINGS_TABS } from "./settingsDialogUi";
afterEach(() => registerSettingsDialogOpener(null));
describe("neutral settings navigation", () => {
 it("exposes editor and developer settings without retired runtime controls", () => {
  expect(SETTINGS_TABS.map(tab => tab.id)).toEqual(["editor", "shortcuts", "appearance", "versionControl", "software", "dev", "logs"]);
  expect(buildSettingsSidebar().at(-1)).toMatchObject({ kind: "section", label: "Dev" });
 });
 it("routes unknown deep links to available settings", () => {
  expect(resolveOpenSettingsDialogTab("missing" as never)).toBe("dev");
  expect(resolveOpenSettingsDialogTab("editor")).toBe("editor");
 });
 it("filters labels and preserves matching section", () => {
  const sidebar = buildSettingsSidebar();
  expect(filterSettingsSidebar(sidebar, " ")).toEqual(sidebar);
  expect(filterSettingsSidebar(sidebar, "LOG")).toEqual([{ kind: "section", label: "Dev", tabs: [expect.objectContaining({ id: "logs" })] }]);
 });
 it("opens requested available panels and replaces registration", () => {
  const old = vi.fn(), next = vi.fn(); registerSettingsDialogOpener(old); registerSettingsDialogOpener(next); openSettingsDialog("dev");
  expect(old).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledWith("dev");
 });
});
