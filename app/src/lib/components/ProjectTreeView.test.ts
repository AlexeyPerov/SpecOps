import { flushSync, tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import ProjectTreeView from "./ProjectTreeView.svelte";
import { mountComponent } from "./_testComponentMount";

describe("project tree file symbols", () => {
  it("keeps expansion, file activation and selection working with compact row symbols", () => {
    const onToggleDirectory = vi.fn();
    const onOpenFile = vi.fn();
    const { host } = mountComponent(ProjectTreeView, {
      nodes: [
        { name: "src", path: "/project/src", kind: "directory" as const },
        { name: "empty", path: "/project/empty", kind: "directory" as const },
        { name: "README.md", path: "/project/README.md", kind: "file" as const },
      ],
      expandedPaths: new Set(["/project/src"]),
      childrenByPath: new Map([
        ["/project/src", [{ name: "main.ts", path: "/project/src/main.ts", kind: "file" as const }]],
        ["/project/empty", []],
      ]),
      activeFilePath: "/project/src/main.ts",
      onToggleDirectory,
      onOpenFile,
    });
    flushSync();
    const folder = host.querySelector<HTMLButtonElement>('[data-path="/project/src"]')!;
    const empty = host.querySelector<HTMLButtonElement>('[data-path="/project/empty"]')!;
    const file = host.querySelector<HTMLButtonElement>('[data-path="/project/src/main.ts"]')!;
    expect(folder.querySelector(".tree-chevron.expanded")).not.toBeNull();
    expect(folder.querySelector("[data-file-icon]")).toBeNull();
    expect(empty.querySelector(".tree-chevron.invisible")).not.toBeNull();
    expect(file.querySelector(".tree-chevron")).toBeNull();
    expect(file.querySelector('[data-file-icon="typescript"]')).not.toBeNull();
    expect(file.parentElement?.getAttribute("aria-selected")).toBe("true");
    folder.click();
    empty.click();
    file.click();
    expect(onToggleDirectory).toHaveBeenCalledExactlyOnceWith("/project/src");
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith("/project/src/main.ts");
  });

  it("updates the new-file symbol as the draft extension changes", async () => {
    const { host } = mountComponent(ProjectTreeView, {
      draft: { kind: "file" as const, parentDirPath: "/project", defaultValue: "note.md" },
    });
    flushSync();
    await tick();
    const input = host.querySelector<HTMLInputElement>("input")!;
    expect(host.querySelector('[data-file-icon="markdown"]')).not.toBeNull();
    input.value = "data.json";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(host.querySelector('[data-file-icon="json"]')).not.toBeNull();
  });

  it("applies monochrome to both existing files and the new-file draft", () => {
    const { host } = mountComponent(ProjectTreeView, {
      coloredFileIcons: false,
      nodes: [{ name: "main.ts", path: "/project/main.ts", kind: "file" as const }],
      draft: { kind: "file" as const, parentDirPath: "/project", defaultValue: "note.md" },
      workspaceRoot: "/project",
    });
    flushSync();
    expect(host.querySelectorAll(".project-file-icon")).toHaveLength(2);
    expect(host.querySelectorAll(".project-file-icon.monochrome")).toHaveLength(2);
  });
});
