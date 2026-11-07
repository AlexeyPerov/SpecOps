import { describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import ProjectSearchPanel from "./ProjectSearchPanel.svelte";
import { mountComponent } from "./_testComponentMount";

describe("workspace search panel", () => {
  it("shows one progress label and an enabled Stop action", async () => {
    const onRunSearch = vi.fn();
    const { host } = mountComponent(ProjectSearchPanel, { query: "foo", running: true, status: "Searching… 1 files", onRunSearch });
    await tick();
    expect(host.textContent?.match(/Searching/g)).toHaveLength(1);
    const stop = [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === "Stop")!;
    expect(stop.disabled).toBe(false);
    stop.click();
    expect(onRunSearch).toHaveBeenCalledOnce();
    host.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onRunSearch).toHaveBeenCalledOnce();
  });
  it("explains submission and scope before the first search", () => {
    const { host } = mountComponent(ProjectSearchPanel, { workspaceRoot: "/ws" });
    expect(host.textContent).toContain("press Enter or Search");
    expect(host.textContent).toContain("Saved text files");
  });
  it("highlights a match far into a long line and displays a relative file path", () => {
    const { host } = mountComponent(ProjectSearchPanel, {
      workspaceRoot: "/ws", query: "needle", results: [{ path: "/ws/src/a.ts", matches: [{
        from: 2000, to: 2006, column: 2001, line: 1, length: 6, lineText: "x".repeat(2000) + "needle suffix",
      }] }],
    });
    expect(host.querySelector(".ps-file-path")?.textContent).toBe("src/a.ts");
    expect(host.querySelector("mark")?.textContent).toBe("needle");
    expect(host.querySelector(".ps-match-text")!.textContent!.length).toBeLessThan(200);
  });
});
