import { beforeEach, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { mountComponent } from "../_testComponentMount";
import WorkspaceAppearanceSettings from "./WorkspaceAppearanceSettings.svelte";
import { updateCatalogProject, subscribeProjectCatalog } from "../../services/workspaceCatalog";
vi.mock("../../services/workspaceCatalog", () => ({
  getProjectCatalog: () => ({ projects: {} }), projectIdentity: (root: string) => root,
  subscribeProjectCatalog: vi.fn(() => () => {}), updateCatalogProject: vi.fn(),
}));
beforeEach(() => { vi.mocked(updateCatalogProject).mockReset(); vi.mocked(subscribeProjectCatalog).mockClear(); });
it("saves optional local appearance to the catalog and clears it with null", async () => {
  const { host } = mountComponent(WorkspaceAppearanceSettings, { root: "/one/app" }); await tick();
  const [color, icon] = host.querySelectorAll("select");
  color.value = "#65a3ff"; color.dispatchEvent(new Event("change", { bubbles: true })); await tick();
  expect(updateCatalogProject).toHaveBeenLastCalledWith("/one/app", { color: "#65a3ff" });
  icon.value = "★"; icon.dispatchEvent(new Event("change", { bubbles: true })); await tick();
  expect(updateCatalogProject).toHaveBeenLastCalledWith("/one/app", { icon: "★" });
  icon.value = ""; icon.dispatchEvent(new Event("change", { bubbles: true })); await tick();
  expect(updateCatalogProject).toHaveBeenLastCalledWith("/one/app", { icon: null });
});
it("shows persistence failures without falsely applying unsaved appearance", async () => {
  vi.mocked(updateCatalogProject).mockRejectedValueOnce(new Error("Disk full"));
  const { host } = mountComponent(WorkspaceAppearanceSettings, { root: "/one/app" }); await tick();
  const color = host.querySelector("select")!;
  color.value = "#65a3ff"; color.dispatchEvent(new Event("change", { bubbles: true })); await tick();
  await vi.waitFor(() => expect(host.querySelector("[role=alert]")?.textContent).toBe("Disk full"));
  expect(color.value).toBe("");
  expect(color.disabled).toBe(false);
});
