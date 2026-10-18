import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import { fromStore, writable } from "svelte/store";
import GitChangesPanel from "./GitChangesPanel.svelte";
import { mountComponent } from "./_testComponentMount";
import { queryWorkingTreeFileDiff, queryWorkingTreeStatus } from "../git/gitService";
import type { WorkingTreeFileEntry } from "../git/types";

vi.mock("../git/gitService", async (original) => ({
  ...(await original<typeof import("../git/gitService")>()),
  queryWorkingTreeStatus: vi.fn(),
  queryWorkingTreeFileDiff: vi.fn(),
}));
vi.mock("../services/preGitOperationGuard", () => ({
  prepareWorkspaceForGitOperation: vi.fn().mockResolvedValue(true),
}));

const entry = (path: string): WorkingTreeFileEntry => ({
  path,
  indexStatus: " ",
  workTreeStatus: "M",
  statusCode: " M",
});

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    flushSync();
  }
}

function row(host: HTMLElement, path: string): HTMLElement {
  return host
    .querySelector<HTMLInputElement>(`input[aria-label="Select unstaged ${path}"]`)!
    .closest<HTMLElement>(".git-changes-row")!;
}

beforeEach(() => {
  vi.mocked(queryWorkingTreeStatus).mockReset().mockResolvedValue({
    staged: [],
    unstaged: [entry("a.md"), entry("b.md")],
  });
  vi.mocked(queryWorkingTreeFileDiff).mockReset().mockImplementation(async (_root, path) => ({
    path,
    hunks: [],
    addedLines: 0,
    deletedLines: 0,
    isBinary: false,
  }));
});

function props(extra: Record<string, unknown> = {}) {
  // Copy descriptors, not values, so reactive getters stay live.
  return Object.defineProperties(
    { repoRoot: "/repo", workspaceRootPath: "/repo" } as Record<string, unknown>,
    Object.getOwnPropertyDescriptors(extra),
  ) as { repoRoot: string; workspaceRootPath: string };
}

describe("GitChangesPanel", () => {
  it("selecting a file for diff after a refresh does not reload status or clear checkbox selections", async () => {
    const token = writable(0);
    const tokenState = fromStore(token);
    const view = mountComponent(
      GitChangesPanel,
      props({
        get refreshToken() {
          return tokenState.current;
        },
      }),
    );
    await settle();
    token.set(1);
    await settle();
    expect(queryWorkingTreeStatus).toHaveBeenCalledTimes(2);

    const checkbox = view.host.querySelector<HTMLInputElement>('input[aria-label="Select unstaged a.md"]')!;
    checkbox.click();
    flushSync();
    row(view.host, "b.md").click();
    await settle();

    expect(queryWorkingTreeStatus).toHaveBeenCalledTimes(2);
    expect(queryWorkingTreeFileDiff).toHaveBeenLastCalledWith("/repo", "b.md", "unstaged");
    expect(view.host.querySelector<HTMLInputElement>('input[aria-label="Select unstaged a.md"]')!.checked).toBe(true);
  });

  it("leaves Space and Enter on a row checkbox to the checkbox", async () => {
    const view = mountComponent(GitChangesPanel, props());
    await settle();
    const callsBefore = vi.mocked(queryWorkingTreeFileDiff).mock.calls.length;
    const checkbox = view.host.querySelector<HTMLInputElement>('input[aria-label="Select unstaged b.md"]')!;
    for (const key of [" ", "Enter"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      checkbox.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    await settle();
    expect(vi.mocked(queryWorkingTreeFileDiff).mock.calls.length).toBe(callsBefore);

    const rowEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    row(view.host, "b.md").dispatchEvent(rowEvent);
    expect(rowEvent.defaultPrevented).toBe(true);
    await settle();
    expect(queryWorkingTreeFileDiff).toHaveBeenLastCalledWith("/repo", "b.md", "unstaged");
  });

  it("focuses the message once per focus request, not again after a status reload", async () => {
    const focusToken = writable(0);
    const focusState = fromStore(focusToken);
    const refresh = writable(0);
    const refreshState = fromStore(refresh);
    const outside = document.createElement("input");
    document.body.append(outside);
    const view = mountComponent(
      GitChangesPanel,
      props({
        get focusMessageToken() {
          return focusState.current;
        },
        get refreshToken() {
          return refreshState.current;
        },
      }),
    );
    await settle();
    expect(document.activeElement).not.toBe(view.host.querySelector("textarea"));

    focusToken.set(1);
    await settle();
    expect(document.activeElement).toBe(view.host.querySelector("textarea"));

    outside.focus();
    refresh.set(1);
    await settle();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
