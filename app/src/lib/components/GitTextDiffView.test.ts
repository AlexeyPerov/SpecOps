import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import { fromStore, writable } from "svelte/store";
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

  it("renders an optional subtitle below the file path", () => {
    const diff = parseUnifiedDiff(readFixture("git-diff-unified-single-file.txt"))[0]!;
    const { host } = mountComponent(GitTextDiffView, {
      diff,
      title: "src/file.txt",
      subtitle: "Staged changes",
    });

    expect(host.querySelector(".git-text-diff-subtitle")?.textContent).toBe("Staged changes");
  });
});


describe("diff search and available actions", () => {
  it("finds all matching rows, navigates beyond the render window and resets for a different diff", async () => {
    const base = parseUnifiedDiff(readFixture("git-diff-unified-single-file.txt"))[0]!;
    const diff = {...base, hunks: [{...base.hunks[0], lines: Array.from({length:1000}, (_,index) => ({kind:"added" as const, content: index === 4 || index === 950 ? "needle" : `row ${index}`, newLineNo:index+1}))}]};
    const store=writable(diff), state=fromStore(store);
    vi.stubGlobal("ResizeObserver", class { callback: () => void; constructor(callback:()=>void){this.callback=callback;} observe(el:HTMLElement){Object.defineProperty(el,"clientHeight",{configurable:true,value:180});this.callback();} disconnect(){} });
    const {host}=mountComponent(GitTextDiffView,{get diff(){return state.current;}}); flushSync();
    const input=host.querySelector<HTMLInputElement>('[aria-label="Search displayed diff"]')!;
    input.value="NEEDLE"; input.dispatchEvent(new Event("input",{bubbles:true})); flushSync();
    expect(host.querySelector('.diff-search [role=status]')?.textContent).toBe("1/2");
    host.querySelector<HTMLButtonElement>('[aria-label="Next diff match"]')!.click(); flushSync();
    expect(host.querySelector('.diff-search [role=status]')?.textContent).toBe("2/2");
    expect(host.querySelector<HTMLDivElement>('.git-text-diff-scroll')?.scrollTop).toBe(950*18);
    expect(host.querySelector('.diff-search-current .git-text-diff-gutter-new')?.textContent).toBe("951");
    expect(host.querySelectorAll('.git-text-diff-row').length).toBeLessThan(100);
    store.set({...diff,path:"next.txt"}); flushSync(); expect(host.querySelector<HTMLInputElement>('[aria-label="Search displayed diff"]')?.value).toBe("");
    expect(host.querySelector<HTMLDivElement>('.git-text-diff-scroll')?.scrollTop).toBe(0);
  });
  it("copies path and displayed text, reports clipboard failure and offers no unimplemented mutation", async () => {
    const diff=parseUnifiedDiff(readFixture("git-diff-unified-single-file.txt"))[0]!;
    const writeText=vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
    const {host}=mountComponent(GitTextDiffView,{diff,title:"src/file.txt"}); flushSync();
    const buttons=Array.from(host.querySelectorAll<HTMLButtonElement>('.diff-action-menu button'));
    buttons[0].click(); await Promise.resolve(); expect(writeText).toHaveBeenLastCalledWith("src/file.txt");
    buttons[1].click(); await Promise.resolve(); expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("@@ -1,3 +1,4 @@"));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("+"));
    writeText.mockRejectedValueOnce(new Error("denied")); buttons[0].click(); await Promise.resolve(); await Promise.resolve(); flushSync();
    expect(host.querySelector('[role=alert]')?.textContent).toContain("Could not copy");
    expect(host.textContent).not.toMatch(/Reverse hunk|Stage hunk/);
  });
});
