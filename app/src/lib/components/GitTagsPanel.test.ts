import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import { fromStore, writable } from "svelte/store";
import GitTagsPanel from "./GitTagsPanel.svelte";
import { mountComponent } from "./_testComponentMount";
import { deleteTag, queryRemoteTags, queryTags } from "../git/gitService";
import { promptTagDelete } from "../services/tagDeletePrompt";

vi.mock("../git/gitService", async (original) => ({
  ...(await original<typeof import("../git/gitService")>()),
  queryTags: vi.fn(),
  queryRemoteTags: vi.fn(),
  deleteTag: vi.fn(),
}));
vi.mock("../git/versionControlRemotesCache", () => ({
  loadRemotes: vi.fn().mockResolvedValue([{ name: "origin", fetchUrl: "/origin", pushUrl: null }]),
}));
vi.mock("../services/tagDeletePrompt", () => ({ promptTagDelete: vi.fn() }));
vi.mock("../services/logging", () => ({ logDiagnostic: vi.fn().mockResolvedValue(undefined) }));

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    flushSync();
  }
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  return Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;
}

beforeEach(() => {
  vi.mocked(queryTags).mockReset().mockResolvedValue(["v1", "v2"]);
  vi.mocked(queryRemoteTags).mockReset().mockResolvedValue(["v1"]);
  vi.mocked(deleteTag).mockReset().mockResolvedValue(undefined);
  vi.mocked(promptTagDelete).mockReset();
});

describe("GitTagsPanel", () => {
  it("checking the remote in create mode does not select a tag", async () => {
    const view = mountComponent(GitTagsPanel, { repoRoot: "/repo", compact: true, initialSelection: null });
    await settle();
    expect(button(view.host, "Delete tag").disabled).toBe(true);
    button(view.host, "Check remote").click();
    await settle();
    expect(queryRemoteTags).toHaveBeenCalled();
    expect(button(view.host, "Delete tag").disabled).toBe(true);
    expect(button(view.host, "Push tag").disabled).toBe(true);
  });

  it("disables Create while checking and drops a probe that started before a reload", async () => {
    let resolveProbe!: (names: string[]) => void;
    vi.mocked(queryRemoteTags).mockReturnValueOnce(new Promise((resolve) => (resolveProbe = resolve)));
    const token = writable(0);
    const tokenState = fromStore(token);
    const view = mountComponent(GitTagsPanel, {
      repoRoot: "/repo",
      get refreshToken() {
        return tokenState.current;
      },
    });
    await settle();
    button(view.host, "Check remote").click();
    flushSync();
    expect(button(view.host, "Checking…")).toBeDefined();
    expect(button(view.host, "Create tag").disabled).toBe(true);

    vi.mocked(queryTags).mockResolvedValue(["v1", "v2", "v3"]);
    token.set(1);
    await settle();
    resolveProbe(["v1"]);
    await settle();

    const names = Array.from(view.host.querySelectorAll(".git-tags-name")).map((n) => n.textContent);
    expect(names).toEqual(["v1", "v2", "v3"]);
    expect(button(view.host, "Check remote").disabled).toBe(false);
    expect(button(view.host, "Create tag").disabled).toBe(false);
  });

  it("deletes and reports the tag the user confirmed", async () => {
    vi.mocked(promptTagDelete).mockResolvedValue({ type: "confirm", remoteNames: [] });
    const notify = vi.fn();
    const view = mountComponent(GitTagsPanel, {
      repoRoot: "/repo",
      compact: true,
      initialSelection: "refs/tags/v2",
      notify,
    });
    await settle();
    vi.mocked(queryTags).mockResolvedValue(["v1"]);
    button(view.host, "Delete tag").click();
    await settle();
    expect(deleteTag).toHaveBeenCalledWith("/repo", "v2", expect.anything());
    expect(notify).toHaveBeenCalledWith('Deleted tag "v2".');
  });

  it("blocks Create and Delete while another remote operation runs", async () => {
    const view = mountComponent(GitTagsPanel, {
      repoRoot: "/repo",
      compact: true,
      initialSelection: "refs/tags/v1",
      remoteOpBusy: true,
    });
    await settle();
    expect(button(view.host, "Create tag").disabled).toBe(true);
    expect(button(view.host, "Delete tag").disabled).toBe(true);
  });
});
