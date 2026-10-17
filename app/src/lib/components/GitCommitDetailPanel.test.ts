import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import { fromStore, writable } from "svelte/store";
import { mountComponent } from "./_testComponentMount";
import GitCommitDetailPanel from "./GitCommitDetailPanel.svelte";
import { GitDiffTooLargeError, queryCommitDetail, queryCommitFileDiff } from "../git/gitService";
import { parseUnifiedDiff } from "../git/gitDiffParse";
import type { CommitDetail, ParsedTextDiff } from "../git/types";
vi.mock("../git/gitService", async original => ({
  ...await original<typeof import("../git/gitService")>(),
  queryCommitDetail: vi.fn(), queryCommitFileDiff: vi.fn(),
}));
vi.mock("../git/gitErrorUi", () => ({ reportGitError: (error: Error) => error.message }));
const commit = (sha: string): CommitDetail => ({ sha, parents: ["parent"], authorName: "Inspector Author", authorEmail: "author@example.test", authorTime: 1700000000, committerName: "Inspector Author", committerEmail: "author@example.test", committerTime: 1700000000, message: `Message ${sha}`, files: [{path:"z.txt",status:"D"},{path:"src/a.ts",status:"R",previousPath:"old/a.ts"}] });
const patch = (path = "src/a.ts", content = "current content"): ParsedTextDiff => parseUnifiedDiff(`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old content\n+${content}\n`)[0]!;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
async function settle() { for (let i=0; i<15; i++) { await Promise.resolve(); flushSync(); } }
const fileButton = (host: HTMLElement, path: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("[role=option]")).find(button => button.dataset.path === path)!;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.mocked(queryCommitDetail).mockReset().mockImplementation(async (_root, sha) => commit(sha));
  vi.mocked(queryCommitFileDiff).mockReset().mockImplementation(async (_root, _sha, path) => patch(path));
});
describe("mounted commit inspector", () => {
  it("sorts, filters rename paths, groups tree rows and keeps selection on refresh and splitter use", async () => {
    const token = writable(0), state = fromStore(token);
    const view = mountComponent(GitCommitDetailPanel, {repoRoot:"/repo",sha:"one",get refreshToken() { return state.current; }}); await settle();
    expect(Array.from(view.host.querySelectorAll<HTMLElement>("[role=option]")).map(el => el.dataset.path)).toEqual(["src/a.ts","z.txt"]);
    expect(fileButton(view.host,"src/a.ts").textContent).toContain("old/a.ts → src/a.ts");
    view.host.querySelector<HTMLButtonElement>('[aria-label="Tree view"]')!.click(); flushSync(); expect(view.host.querySelector(".directory-label")?.textContent).toBe("src/");
    const filter = view.host.querySelector<HTMLInputElement>('[aria-label="Filter changed files"]')!;
    filter.value="old/"; filter.dispatchEvent(new Event("input",{bubbles:true})); flushSync(); expect(view.host.querySelectorAll("[role=option]")).toHaveLength(1);
    filter.value=""; filter.dispatchEvent(new Event("input",{bubbles:true})); flushSync();
    fileButton(view.host,"z.txt").click(); await settle(); expect(view.host.querySelector(".git-text-diff-subtitle")?.textContent).toBe("Deleted file");
    const diffPane = view.host.querySelector(".git-commit-detail-diff-pane");
    view.host.querySelector<HTMLButtonElement>('[aria-label="Resize files and metadata"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}));
    flushSync(); expect(view.host.querySelector(".git-commit-detail-diff-pane")).toBe(diffPane);
    token.set(1); await settle(); expect(fileButton(view.host,"z.txt").getAttribute("aria-selected")).toBe("true");
    expect(queryCommitFileDiff).toHaveBeenLastCalledWith("/repo","one","z.txt","parent");
    vi.mocked(queryCommitDetail).mockResolvedValue({...commit("one"),files:[{path:"next.txt",status:"A"}]}); token.set(2); await settle();
    expect(fileButton(view.host,"next.txt").getAttribute("aria-selected")).toBe("true");
  });
  it("rejects late commit successes and errors across commit and repository changes", async () => {
    const first = deferred<CommitDetail>(), second = deferred<CommitDetail>();
    vi.mocked(queryCommitDetail).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const sha = writable("one"), shas = fromStore(sha), root = writable("/repo"), roots = fromStore(root);
    const view = mountComponent(GitCommitDetailPanel,{get repoRoot(){return roots.current;},get sha(){return shas.current;}}); await settle();
    sha.set("two"); await settle(); root.set("/new"); await settle();
    expect(view.host.textContent).toContain("Message two");
    first.resolve(commit("stale-one")); second.reject(new Error("stale error")); await settle();
    expect(view.host.textContent).not.toContain("stale"); expect(view.host.textContent).toContain("Message two");
    expect(queryCommitFileDiff).toHaveBeenLastCalledWith("/new","two","src/a.ts","parent");
  });
  it("rejects late file results and errors; file changes do not reload commit metadata", async () => {
    const old = deferred<ParsedTextDiff>();
    vi.mocked(queryCommitFileDiff).mockImplementationOnce(() => old.promise);
    const view = mountComponent(GitCommitDetailPanel,{repoRoot:"/repo",sha:"one"}); await settle();
    fileButton(view.host,"z.txt").click(); await settle(); old.resolve(patch("src/a.ts","stale patch")); await settle();
    expect(view.host.querySelector(".git-text-diff-title")?.textContent).toBe("z.txt"); expect(view.host.textContent).not.toContain("stale patch");
    expect(queryCommitDetail).toHaveBeenCalledTimes(1);
    const pending = deferred<ParsedTextDiff>(); vi.mocked(queryCommitFileDiff).mockImplementationOnce(() => pending.promise);
    fileButton(view.host,"src/a.ts").click(); await settle(); fileButton(view.host,"z.txt").click(); await settle();
    pending.reject(new Error("stale file error")); await settle(); expect(view.host.textContent).not.toContain("stale file error");
  });
  it("rejects a late diff across commit and repo changes", async () => {
    const old = deferred<ParsedTextDiff>(), middle = deferred<ParsedTextDiff>();
    vi.mocked(queryCommitFileDiff).mockImplementationOnce(() => old.promise).mockImplementationOnce(() => middle.promise);
    const sha = writable("one"), shas = fromStore(sha), root = writable("/repo"), roots = fromStore(root);
    const view = mountComponent(GitCommitDetailPanel,{get repoRoot(){return roots.current;},get sha(){return shas.current;}}); await settle();
    sha.set("two"); await settle(); root.set("/new"); await settle();
    old.resolve(patch("src/a.ts","stale success")); middle.reject(new Error("stale failure")); await settle();
    expect(view.host.textContent).not.toContain("stale"); expect(view.host.textContent).toContain("current content");
  });
  it("keeps sibling panes for diff errors, size limit, binary, empty and deleted content; uses first parent for merge", async () => {
    const token=writable(0), state=fromStore(token);
    vi.mocked(queryCommitDetail).mockResolvedValue({...commit("merge"),parents:["first-parent","second-parent"]});
    vi.mocked(queryCommitFileDiff).mockRejectedValueOnce(new Error("diff unavailable"));
    const view=mountComponent(GitCommitDetailPanel,{repoRoot:"/repo",sha:"merge",get refreshToken(){return state.current;}}); await settle();
    expect(view.host.textContent).toContain("diff unavailable"); expect(view.host.textContent).toContain("Message merge"); expect(view.host.querySelector('[role=listbox]')).not.toBeNull();
    expect(view.host.textContent).toContain("Merge comparison: first parent first-p");
    expect(queryCommitFileDiff).toHaveBeenLastCalledWith("/repo","merge","src/a.ts","first-parent");
    vi.mocked(queryCommitFileDiff).mockRejectedValueOnce(new GitDiffTooLargeError("src/a.ts",100,50)); token.set(1); await settle(); expect(view.host.textContent).toContain("exceeds the inline display limit"); expect(view.host.textContent).not.toContain("external diff tool");
    vi.mocked(queryCommitFileDiff).mockResolvedValueOnce({...patch(),isBinary:true,hunks:[]}); token.set(2); await settle(); expect(view.host.textContent).toContain("Binary file");
    vi.mocked(queryCommitFileDiff).mockResolvedValueOnce({...patch(),hunks:[]}); token.set(3); await settle(); expect(view.host.textContent).toContain("No diff content");
    fileButton(view.host,"z.txt").click(); await settle(); expect(view.host.textContent).toContain("Deleted file"); expect(view.host.querySelector('.git-text-diff-line-deleted .git-text-diff-gutter-old')?.textContent).toBe("1");
  });
  it("retains all regions for detail errors, loading, no selection and commits without files", async () => {
    const pending=deferred<CommitDetail>(); vi.mocked(queryCommitDetail).mockImplementationOnce(()=>pending.promise);
    const sha=writable<string|null>("one"), state=fromStore(sha);
    const view=mountComponent(GitCommitDetailPanel,{repoRoot:"/repo",get sha(){return state.current;}}); await settle();
    const diffPane=view.host.querySelector(".git-commit-detail-diff-pane"); expect(view.host.textContent).toContain("Loading commit");
    pending.reject(new Error("commit unavailable")); await settle(); expect(view.host.textContent).toContain("commit unavailable"); expect(view.host.querySelector(".git-commit-detail-diff-pane")).toBe(diffPane);
    sha.set(null); await settle(); expect(view.host.textContent).toContain("Select a commit");
    vi.mocked(queryCommitDetail).mockResolvedValue({...commit("empty"),files:[]}); sha.set("empty"); await settle(); expect(view.host.textContent).toContain("No file changes"); expect(view.host.textContent).toContain("Message empty");
  });
  it("copies full SHA and renders references; parent clicks use history navigation callback", async () => {
    const writeText=vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
    const onNavigate=vi.fn(); const view=mountComponent(GitCommitDetailPanel,{repoRoot:"/repo",sha:"full-commit-sha",refs:[{type:"tag" as const,name:"release-next"}],onNavigate}); await settle();
    view.host.querySelector<HTMLButtonElement>(".git-commit-detail-sha")!.click(); await settle(); expect(writeText).toHaveBeenCalledWith("full-commit-sha");
    expect(view.host.querySelector('[aria-label="Commit references"]')?.textContent).toContain("release-next");
    view.host.querySelector<HTMLButtonElement>(".git-commit-detail-parent")!.click(); expect(onNavigate).toHaveBeenCalledWith("parent");
  });
});
