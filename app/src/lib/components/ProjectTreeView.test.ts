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
      selectedPaths: new Set(["/project/src/main.ts"]),
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

it("decorates closed ancestors and keeps favorites visible alongside Git status", () => {
  const { host } = mountComponent(ProjectTreeView, {
    nodes: [{ name: "docs", path: "/repo/docs", kind: "directory" as const }, { name: "note.md", path: "/repo/note.md", kind: "file" as const }],
    statusByPath: new Map([["/repo/docs/deep/a.md", "conflicted" as const], ["/repo/note.md", "modified" as const]]),
    favoritePaths: new Set(["/repo/note.md"]),
  });
  flushSync();
  expect(host.querySelector('[data-path="/repo/docs"] .project-tree-label-conflicted')).not.toBeNull();
  const file = host.querySelector('[data-path="/repo/note.md"]')!;
  expect(file.querySelector(".project-tree-label-pending")).not.toBeNull();
  expect(file.querySelector(".project-tree-star")).not.toBeNull();
  expect(file.querySelector(".project-tree-status-badge")?.textContent).toBe("M");
});

it("requests viewport metadata rather than every expanded file", async () => {
  const visible = vi.fn();
  const overflow = document.body.style.overflowY;
  document.body.style.overflowY = "auto";
  const { host } = mountComponent(ProjectTreeView, {
    workspaceRoot: "/project", sizeMode: "files" as const,
    nodes: Array.from({ length: 10_000 }, (_, n) => ({ name: `${n}.dds`, path: `/project/${n}.dds`, kind: "file" as const })),
    onVisibleFiles: visible,
  });
  flushSync(); await tick();
  const requested = visible.mock.calls.at(-1)![0] as string[];
  expect(requested.length).toBeGreaterThan(0);
  expect(requested.length).toBeLessThan(100);
  expect(host.querySelectorAll(".project-tree-size").length).toBeGreaterThan(0);
  expect(host.querySelectorAll("[data-path]").length).toBeLessThan(100);
  document.body.style.overflowY = overflow;
});

describe("project tree inline rename", () => {
  const nodes = [{ name: "notes.md", path: "/project/notes.md", kind: "file" as const }];

  function keydown(input: HTMLInputElement, key: string): void {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }

  it("edits the row in place with the name selected up to its extension", async () => {
    const onCommitRename = vi.fn(async () => true);
    const { host } = mountComponent(ProjectTreeView, { nodes, renamingPath: "/project/notes.md", onCommitRename });
    flushSync();
    await Promise.resolve();
    const input = host.querySelector<HTMLInputElement>("input")!;
    expect(host.querySelector('[data-path="/project/notes.md"]')).toBeNull();
    expect(input.value).toBe("notes.md");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
    input.value = "todo.md";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    keydown(input, "Enter");
    await tick();
    expect(onCommitRename).toHaveBeenCalledExactlyOnceWith("todo.md");
  });

  it("cancels on Escape without committing", async () => {
    const onCommitRename = vi.fn(async () => true);
    const onCancelRename = vi.fn();
    const { host } = mountComponent(ProjectTreeView, { nodes, renamingPath: "/project/notes.md", onCommitRename, onCancelRename });
    flushSync();
    keydown(host.querySelector<HTMLInputElement>("input")!, "Escape");
    expect(onCancelRename).toHaveBeenCalledOnce();
    expect(onCommitRename).not.toHaveBeenCalled();
  });
});
