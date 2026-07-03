import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../git/gitDiffParse";
import GitTextDiffView from "./GitTextDiffView.svelte";
import { mountComponent } from "./_testComponentMount";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../git/fixtures");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("GitTextDiffView.svelte", () => {
  it("renders fixture diff with line numbers and change summary", () => {
    const diff = parseUnifiedDiff(readFixture("git-diff-unified-single-file.txt"))[0]!;
    const { host } = mountComponent(GitTextDiffView, { diff, title: diff.path });

    expect(host.querySelector(".git-text-diff-added")?.textContent).toBe("+2");
    expect(host.querySelector(".git-text-diff-deleted")?.textContent).toBe("−1");
    expect(host.querySelectorAll(".git-text-diff-line-added").length).toBe(2);
    expect(host.querySelectorAll(".git-text-diff-line-deleted").length).toBe(1);
    expect(host.querySelector(".git-text-diff-line-hunk .git-text-diff-content")?.textContent).toBe(
      "@@ -1,3 +1,4 @@",
    );
    expect(host.querySelector(".git-text-diff-line-added .git-text-diff-gutter-new")?.textContent).toBe(
      "2",
    );
  });

  it("shows binary placeholder instead of garbled patch text", () => {
    const diff = parseUnifiedDiff(readFixture("git-diff-binary.txt"))[0]!;
    const { host } = mountComponent(GitTextDiffView, { diff, title: diff.path });

    expect(host.querySelector(".git-text-diff-state-title")?.textContent).toBe(
      "Binary file — diff not shown",
    );
    expect(host.querySelector(".git-text-diff-table")).toBeNull();
  });

  it("shows empty state when diff is null", () => {
    const { host } = mountComponent(GitTextDiffView, { diff: null });

    expect(host.querySelector(".git-text-diff-state-title")?.textContent).toBe(
      "Select a file to view changes",
    );
  });

  it("shows loading and error states without diff table", () => {
    const loadingHost = mountComponent(GitTextDiffView, {
      diff: null,
      loading: true,
      title: "file.txt",
    }).host;
    expect(loadingHost.querySelector(".git-text-diff-state-title")?.textContent).toBe(
      "Loading diff…",
    );
    expect(loadingHost.querySelector(".git-text-diff-table")).toBeNull();

    const errorHost = mountComponent(GitTextDiffView, {
      diff: null,
      error: "Network failure",
      title: "file.txt",
    }).host;
    expect(errorHost.querySelector(".git-text-diff-state-title")?.textContent).toBe(
      "Could not load diff",
    );
    expect(errorHost.querySelector(".git-text-diff-state-detail")?.textContent).toBe(
      "Network failure",
    );
  });

  it("exposes an accessible diff region label including the file path", () => {
    const diff = parseUnifiedDiff(readFixture("git-diff-unified-single-file.txt"))[0]!;
    const { host } = mountComponent(GitTextDiffView, { diff, title: "src/file.txt" });

    expect(host.querySelector('[role="region"]')?.getAttribute("aria-label")).toBe(
      "Diff for src/file.txt",
    );
  });
});
