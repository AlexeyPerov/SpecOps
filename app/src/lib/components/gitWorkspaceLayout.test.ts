import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import VersionControlView, { clearVersionControlProbeCache } from "./VersionControlView.svelte";
import { mountComponent } from "./_testComponentMount";
import { probeVersionControlContext } from "../git/versionControlProbe";
import { queryBranches, checkoutBranch, queryCommits } from "../git/gitService";

vi.mock("../git/versionControlProbe", async (original) => ({
  ...await original<typeof import("../git/versionControlProbe")>(),
  probeVersionControlContext: vi.fn(),
}));
vi.mock("../git/versionControlHistoryFilter", async (original) => ({
  ...await original<typeof import("../git/versionControlHistoryFilter")>(),
  readPersistedHistoryFilterMode: vi.fn().mockResolvedValue(null),
}));
vi.mock("../git/versionControlRemoteSelection", async (original) => ({
  ...await original<typeof import("../git/versionControlRemoteSelection")>(),
  readPersistedRemoteSelection: vi.fn().mockResolvedValue({ remoteName: null, remoteBranch: null }),
}));
vi.mock("../git/versionControlRemotesCache", () => ({ loadRemotes: vi.fn().mockResolvedValue([]) }));
vi.mock("../git/gitNavigationTree", async (original) => ({ ...await original<typeof import("../git/gitNavigationTree")>(), queryRemoteTrackingRefs: vi.fn().mockResolvedValue([]) }));
vi.mock("../git/gitService", async (original) => ({
  ...await original<typeof import("../git/gitService")>(),
  queryBranches: vi.fn().mockResolvedValue([{ name: "feature/navigation", head: "b".repeat(40), isCurrent: false, upstream: null, upstreamTrack: null, subject: "Navigation" }]),
  queryTags: vi.fn().mockResolvedValue([]),
  queryStashes: vi.fn().mockResolvedValue([]),
  checkoutBranch: vi.fn(),
  queryCurrentBranch: vi.fn().mockResolvedValue({ name: "master", isDetached: false, upstream: null }),
  queryCommits: vi.fn().mockResolvedValue([]),
  queryCommitDetail: vi.fn().mockResolvedValue({ sha: "a".repeat(40), parents: [], message: "Workspace layout", authorName: "SpecOps User", authorEmail: "", authorTime: 1700000000, committerName: "SpecOps User", committerEmail: "", committerTime: 1700000000, files: [{ path: "src/workspace.ts", status: "M" }] }),
  queryCommitFileDiff: vi.fn().mockResolvedValue(null),
}));
async function settle() { for (let i = 0; i < 40; i++) { await Promise.resolve(); flushSync(); } }
beforeEach(() => {
  clearVersionControlProbeCache(); localStorage.clear();
  vi.mocked(probeVersionControlContext).mockReset();
  vi.mocked(probeVersionControlContext).mockResolvedValue({ kind: "ready", repoRoot: "/workspace", workspaceRootPath: "/workspace", isBareRepository: false });
  vi.mocked(queryCommits).mockResolvedValue([]);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("mounted Git workspace composition", () => {
  it("views a ref without checkout, preserves it on refresh, and reports external deletion", async () => {
    const view = mountComponent(VersionControlView, { workspaceRootPath: "/workspace" }); await settle();
    view.host.querySelector<HTMLButtonElement>('[title="refs/heads/feature/navigation"]')!.click(); await settle();
    expect(vi.mocked(queryCommits).mock.calls.at(-1)?.[1]?.revision).toBe("refs/heads/feature/navigation");
    expect(checkoutBranch).not.toHaveBeenCalled();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const refresh = async () => {
      view.host.querySelector<HTMLButtonElement>('[aria-label="More version control actions"]')!.click(); flushSync();
      Array.from(view.host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(b => b.textContent?.includes("Refresh"))!.click(); await settle();
    };
    await refresh();
    expect(view.host.querySelector('[title="refs/heads/feature/navigation"][aria-selected="true"]')).not.toBeNull();
    expect(vi.mocked(queryCommits).mock.calls.at(-1)?.[1]?.revision).toBe("refs/heads/feature/navigation");
    now.mockReturnValue(2000);
    vi.mocked(queryBranches).mockResolvedValueOnce([]);
    await refresh();
    expect(view.host.textContent).toContain("selected reference is no longer available");
  });
  it("keeps history above the inspector, exposes all four dividers, and collapses navigation and metadata independently", async () => {
    vi.mocked(queryCommits).mockResolvedValue([{ sha: "a".repeat(40), parents: [], refs: [], subject: "Workspace layout", authorName: "SpecOps User", authorEmail: "", authorTime: 1700000000, committerName: "SpecOps User", committerEmail: "", committerTime: 1700000000 }]);
    const view = mountComponent(VersionControlView, { workspaceRootPath: "/workspace" });
    await settle();
    const row = view.host.querySelector<HTMLElement>('[role="option"]');
    expect(row, view.host.textContent ?? "").not.toBeNull(); row!.click(); await settle();
    const history = view.host.querySelector('[aria-label="Resize history and inspector"]')!;
    expect(history.getAttribute("aria-orientation")).toBe("horizontal");
    expect(view.host.querySelectorAll('[role="separator"][tabindex="0"]')).toHaveLength(4);
    const files = view.host.querySelector('[aria-label="Resize files and metadata"]')!.parentElement!;
    expect(files.children[0].querySelector('[aria-label="Changed files"]')).not.toBeNull();
    expect(files.children[2].querySelector('[aria-label="Commit message"]')).not.toBeNull();
    view.host.querySelector<HTMLButtonElement>('.git-metadata-toggle')!.click(); flushSync();
    expect((files.children[2] as HTMLElement).hidden).toBe(true);
    expect((files.children[0] as HTMLElement).hidden).toBe(false);
    const navigation = Array.from(view.host.querySelectorAll('button')).find(button => button.textContent === "Navigation")!;
    navigation.click(); flushSync();
    expect(view.host.querySelector<HTMLElement>('[aria-label="Resize navigation"]')!.hidden).toBe(true);
    expect(view.host.querySelector('[aria-label="Resize files and diff"]')).not.toBeNull();
  });
  it.each(["notARepository", "gitUnavailable"] as const)("retains the %s state", async (kind) => {
    vi.mocked(probeVersionControlContext).mockResolvedValue(kind === "notARepository" ? { kind, workspaceRootPath: "/workspace" } : { kind, error: "Git is unavailable" });
    const view = mountComponent(VersionControlView, { workspaceRootPath: "/workspace" });
    await settle();
    expect(view.host.querySelector('[role="status"]')).not.toBeNull();
    expect(view.host.querySelector('[aria-label="Resize navigation"]')).toBeNull();
  });
  it("retains loading, no-workspace and probe error states", async () => {
    vi.mocked(probeVersionControlContext).mockImplementationOnce(() => new Promise(() => {}));
    const loading = mountComponent(VersionControlView, { workspaceRootPath: "/loading" });
    flushSync();
    expect(loading.host.textContent).toContain("Checking git repository");
    loading.unmount();
    const empty = mountComponent(VersionControlView, { workspaceRootPath: null });
    await settle();
    expect(empty.host.textContent).toContain("No workspace selected");
    vi.mocked(probeVersionControlContext).mockRejectedValueOnce(new Error("Probe failed"));
    const error = mountComponent(VersionControlView, { workspaceRootPath: "/failed" });
    await settle();
    expect(error.host.querySelector('[role="alert"]')?.textContent).toContain("Could not check repository");
  });
  it("retains bare repository notice and history", async () => {
    vi.mocked(probeVersionControlContext).mockResolvedValue({ kind: "ready", workspaceRootPath: "/workspace", repoRoot: "/workspace", isBareRepository: true });
    const view = mountComponent(VersionControlView, { workspaceRootPath: "/workspace" }); await settle();
    expect(view.host.textContent).toContain("bare repository");
    expect(view.host.querySelector('[aria-label="Resize history and inspector"]')).not.toBeNull();
  });
});
