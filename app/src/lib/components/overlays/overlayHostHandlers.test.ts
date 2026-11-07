import { describe, expect, it, vi } from "vitest";
import {
  computeProjectSearchQueryError,
  createOverlayHostHandlers,
  type OverlayHostHandlersDeps,
} from "./overlayHostHandlers";
import { searchInProject, type ProjectSearchResult } from "../../services/projectSearch";

vi.mock("../../services/confirmDialogUi", () => ({
  requestConfirm: vi.fn(async () => true),
}));

vi.mock("../../services/projectSearch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/projectSearch")>();
  return {
    ...actual,
    searchInProject: vi.fn(),
  };
});

vi.mock("../../services/projectFileOps", () => ({
  replaceInProjectFile: vi.fn(async () => ({
    ok: true,
    count: 1,
    content: "replaced",
    fingerprint: { mtimeMs: 0, size: 8 },
    lineEnding: "lf",
    hasBom: false,
  })),
}));

vi.mock("../../services/projectReplaceSync", () => ({
  decideReplaceAllForPath: () => ({ kind: "replace" }),
  syncOpenDocumentAfterReplace: vi.fn(),
}));

vi.mock("../../services/fileSystem", () => ({
  openFolderDialog: vi.fn(async () => "/tmp/parent"),
}));

vi.mock("../../services/workspaceLifecycle", () => ({
  markWorkspaceLifecycleActive: vi.fn(),
}));

vi.mock("../../state/appState", () => ({
  appState: { addWorkspace: vi.fn(() => true) },
}));

function makeDeps(overrides: Partial<OverlayHostHandlersDeps> = {}): OverlayHostHandlersDeps {
  return {
    notify: vi.fn(),
    getActiveWorkspaceRoot: () => "/tmp/ws",
    getCurrentWindowId: () => "main",
    getEditorLayoutActivePaneId: () => "pane-1",
    getEditorWorkbench: () =>
      ({
        getActiveHost: () => null,
        getActiveRunner: () => null,
      }) as never,
    getEditorTools: () => ({}) as never,
    getWorkspaceFileCatalogRegistry: () =>
      ({
        getActive: () => null,
        ensureReady: vi.fn(),
        waitForReady: vi.fn(async () => {}),
      }) as never,
    getActiveDocumentMarkdownViewMode: () => undefined,
    setMarkdownViewMode: vi.fn(),
    openAndActivatePath: vi.fn(async () => {}),
    setProjectSearchResults: vi.fn(),
    setProjectSearchStatus: vi.fn(),
    setProjectSearchRunning: vi.fn(),
    bumpProjectSearchGeneration: () => 1,
    getProjectSearchGeneration: () => 1,
    setAddMultipleOpen: vi.fn(),
    setAddMultipleLoading: vi.fn(),
    setAddMultipleError: vi.fn(),
    setAddMultipleParentPath: vi.fn(),
    setAddMultipleEntries: vi.fn(),
    setAddMultipleSelected: vi.fn(),
    getWorkspaceRoots: () => [],
    getQuickOpenOpenerPaneId: () => null,
    setQuickOpenOpen: vi.fn(),
    getSnippetInsertHostIdentity: () => null,
    setSnippetInsertOpen: vi.fn(),
    setSnippetInsertHostIdentity: vi.fn(),
    setHeadingJumpOpen: vi.fn(),
    setBookmarkListOpen: vi.fn(),
    ...overrides,
  };
}

describe("computeProjectSearchQueryError", () => {
  it("returns empty when regex is off", () => {
    expect(computeProjectSearchQueryError("(unclosed", false)).toBe("");
  });

  it("returns empty when the query is blank", () => {
    expect(computeProjectSearchQueryError("", true)).toBe("");
    expect(computeProjectSearchQueryError("   ", true)).toBe("");
  });

  it("returns empty for a valid regex", () => {
    expect(computeProjectSearchQueryError("foo.*bar", true)).toBe("");
  });

  it("returns the underlying error message for an invalid regex", () => {
    const msg = computeProjectSearchQueryError("(unclosed", true);
    expect(msg.length).toBeGreaterThan(0);
    expect(msg.toLowerCase()).toContain("group");
  });
});

describe("createOverlayHostHandlers.toggleAddMultipleEntry", () => {
  it("adds the path when checked=true", () => {
    const handlers = createOverlayHostHandlers(makeDeps());
    const next = handlers.toggleAddMultipleEntry("/tmp/a", true, new Set());
    expect([...next]).toEqual(["/tmp/a"]);
  });

  it("removes the path when checked=false", () => {
    const handlers = createOverlayHostHandlers(makeDeps());
    const next = handlers.toggleAddMultipleEntry("/tmp/a", false, new Set(["/tmp/a", "/tmp/b"]));
    expect([...next]).toEqual(["/tmp/b"]);
  });

  it("does not mutate the input set", () => {
    const handlers = createOverlayHostHandlers(makeDeps());
    const input = new Set(["/tmp/a"]);
    handlers.toggleAddMultipleEntry("/tmp/a", false, input);
    expect([...input]).toEqual(["/tmp/a"]);
  });
});

describe("createOverlayHostHandlers.cancelAddMultiple", () => {
  it("resets every add-multiple field", () => {
    const setAddMultipleOpen = vi.fn();
    const setAddMultipleEntries = vi.fn();
    const setAddMultipleSelected = vi.fn();
    const setAddMultipleError = vi.fn();
    const setAddMultipleParentPath = vi.fn();
    const handlers = createOverlayHostHandlers(
      makeDeps({
        setAddMultipleOpen,
        setAddMultipleEntries,
        setAddMultipleSelected,
        setAddMultipleError,
        setAddMultipleParentPath,
      }),
    );
    handlers.cancelAddMultiple();
    expect(setAddMultipleOpen).toHaveBeenCalledWith(false);
    expect(setAddMultipleEntries).toHaveBeenCalledWith([]);
    expect(setAddMultipleSelected).toHaveBeenCalledWith(new Set());
    expect(setAddMultipleError).toHaveBeenCalledWith(null);
    expect(setAddMultipleParentPath).toHaveBeenCalledWith(null);
  });
});

describe("createOverlayHostHandlers.runProjectSearch", () => {
  const QUERY = { text: "foo", replacement: "", caseSensitive: false, wholeWord: false, regex: false };
  const searchInProjectMock = vi.mocked(searchInProject);

  it("aborts before scanning when the generation moves during the catalog wait", async () => {
    searchInProjectMock.mockReset();
    const setProjectSearchRunning = vi.fn();
    const setProjectSearchResults = vi.fn();
    // bump returns the run's own generation (1); a close/workspace-switch
    // bumped it to 2 while waitForReady was pending.
    const handlers = createOverlayHostHandlers(
      makeDeps({
        setProjectSearchRunning,
        setProjectSearchResults,
        bumpProjectSearchGeneration: () => 1,
        getProjectSearchGeneration: () => 2,
      }),
    );
    await handlers.runProjectSearch(QUERY);
    expect(searchInProjectMock).not.toHaveBeenCalled();
    // Clear the old results, but leave the newer generation in control.
    expect(setProjectSearchRunning.mock.calls).toEqual([[false], [true]]);
    expect(setProjectSearchResults.mock.calls).toEqual([[[]]]);
  });

  it("reports scanned/unreadable counts when the search finds nothing", async () => {
    searchInProjectMock.mockReset();
    searchInProjectMock.mockResolvedValue({
      ok: true,
      results: [],
      truncated: false,
      scannedFiles: 7,
      unreadableFiles: 2,
    });
    const setProjectSearchStatus = vi.fn();
    const setProjectSearchResults = vi.fn();
    const setProjectSearchRunning = vi.fn();
    const handlers = createOverlayHostHandlers(
      makeDeps({ setProjectSearchStatus, setProjectSearchResults, setProjectSearchRunning }),
    );
    await handlers.runProjectSearch(QUERY);
    expect(searchInProjectMock).toHaveBeenCalledTimes(1);
    expect(setProjectSearchResults).toHaveBeenCalledWith([]);
    expect(setProjectSearchStatus.mock.calls.at(-1)).toEqual([
      "No results (7 files scanned, 2 unreadable)",
    ]);
    expect(setProjectSearchRunning.mock.calls.at(-1)).toEqual([false]);
  });

  it("appends the unreadable suffix to a match summary too", async () => {
    searchInProjectMock.mockReset();
    searchInProjectMock.mockResolvedValue({
      ok: true,
      results: [
        {
          path: "/ws/a.ts",
          matches: [
            { line: 1, column: 1, lineText: "foo", from: 0, to: 3, length: 3 },
          ],
        },
      ],
      truncated: false,
      scannedFiles: 3,
      unreadableFiles: 1,
    });
    const setProjectSearchStatus = vi.fn();
    const handlers = createOverlayHostHandlers(makeDeps({ setProjectSearchStatus }));
    await handlers.runProjectSearch(QUERY);
    expect(setProjectSearchStatus.mock.calls.at(-1)).toEqual([
      "1 result in 1 file, 1 unreadable",
    ]);
  });

  it("updates the status with progress every 200 files via onProgress", async () => {
    searchInProjectMock.mockReset();
    searchInProjectMock.mockImplementation(async (_root, _query, options) => {
      for (let i = 0; i < 400; i += 1) {
        options?.onProgress?.("/ws/f.ts");
      }
      return { ok: true, results: [], truncated: false, scannedFiles: 400, unreadableFiles: 0 };
    });
    const setProjectSearchStatus = vi.fn();
    const handlers = createOverlayHostHandlers(makeDeps({ setProjectSearchStatus }));
    await handlers.runProjectSearch(QUERY);
    const statuses = setProjectSearchStatus.mock.calls.map((call) => call[0]);
    expect(statuses).toContain("Searching… 200 files");
    expect(statuses).toContain("Searching… 400 files");
  });
});

describe("createOverlayHostHandlers.openProjectSearchResult", () => {
  it("opens the path and jumps to the line after a Svelte tick", async () => {
    const openAndActivatePath = vi.fn(async () => {});
    const goToLine = vi.fn();
    const handlers = createOverlayHostHandlers(
      makeDeps({
        openAndActivatePath,
        getEditorWorkbench: () =>
          ({
            getActiveHost: () => null,
            getActiveRunner: () => ({ goToLine }),
          }) as never,
      }),
    );
    await handlers.openProjectSearchResult("/tmp/ws/a.ts", 12);
    expect(openAndActivatePath).toHaveBeenCalledWith("/tmp/ws/a.ts");
    expect(goToLine).toHaveBeenCalledWith(12);
  });

  it("skips goToLine when line is not positive", async () => {
    const goToLine = vi.fn();
    const handlers = createOverlayHostHandlers(
      makeDeps({
        getEditorWorkbench: () =>
          ({
            getActiveHost: () => null,
            getActiveRunner: () => ({ goToLine }),
          }) as never,
      }),
    );
    await handlers.openProjectSearchResult("/tmp/ws/a.ts", 0);
    expect(goToLine).not.toHaveBeenCalled();
  });
});

describe("createOverlayHostHandlers.replaceAllInProjectWithResults", () => {
  it("notifies and bails when there are no results", async () => {
    const notify = vi.fn();
    const handlers = createOverlayHostHandlers(makeDeps({ notify }));
    await handlers.replaceAllInProjectWithResults(
      { text: "foo", replacement: "", caseSensitive: false, wholeWord: false, regex: false },
      [],
      async () => {},
    );
    expect(notify).toHaveBeenCalledWith("Nothing to replace.");
  });

  it("notifies when no workspace root is set", async () => {
    const notify = vi.fn();
    const handlers = createOverlayHostHandlers(
      makeDeps({ notify, getActiveWorkspaceRoot: () => null }),
    );
    const results: ProjectSearchResult[] = [
      {
        path: "/tmp/ws/a.ts",
        matches: [{ line: 1, column: 1, length: 3, preview: "foo" }],
      } as never,
    ];
    await handlers.replaceAllInProjectWithResults(
      { text: "foo", replacement: "bar", caseSensitive: false, wholeWord: false, regex: false },
      results,
      async () => {},
    );
    expect(notify).toHaveBeenCalledWith("Nothing to replace.");
  });

  it("cancels the replace loop when the search generation changes (P03-08-31)", async () => {
    // bump returns 1 (the replace's own generation); get returns 2, so the
    // cancel check fires before any file is written.
    const handlers = createOverlayHostHandlers(
      makeDeps({
        bumpProjectSearchGeneration: () => 1,
        getProjectSearchGeneration: () => 2,
      }),
    );
    const results: ProjectSearchResult[] = [
      {
        path: "/tmp/ws/a.ts",
        matches: [{ line: 1, column: 1, length: 3, lineText: "foo", from: 0, to: 3 }],
      } as never,
    ];
    await handlers.replaceAllInProjectWithResults(
      { text: "foo", replacement: "bar", caseSensitive: false, wholeWord: false, regex: false },
      results,
      async () => {},
    );
    // Replace cancelled before writing; the projectFileOps mock should not run.
    const { replaceInProjectFile } = await import("../../services/projectFileOps");
    expect(vi.mocked(replaceInProjectFile)).not.toHaveBeenCalled();
  });
});


describe("search failure recovery", () => {
  const query = { text: "foo", replacement: "", caseSensitive: false, wholeWord: false, regex: false };
  it("clears running when preparing the catalog throws", async () => {
    const deps = makeDeps({ getWorkspaceFileCatalogRegistry: () => { throw new Error("catalog unavailable"); } });
    await createOverlayHostHandlers(deps).runProjectSearch(query);
    expect(deps.setProjectSearchStatus).toHaveBeenLastCalledWith("Search failed: catalog unavailable");
    expect(deps.setProjectSearchRunning).toHaveBeenLastCalledWith(false);
  });
  it("times out a stuck catalog and allows retry", async () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps({ getWorkspaceFileCatalogRegistry: () => ({
        getActive: () => null, ensureReady: () => {}, waitForReady: () => new Promise(() => {}),
      }) as never });
      const pending = createOverlayHostHandlers(deps).runProjectSearch(query);
      await vi.advanceTimersByTimeAsync(30_000);
      await pending;
      expect(deps.setProjectSearchStatus).toHaveBeenLastCalledWith(expect.stringContaining("timed out"));
      expect(deps.setProjectSearchRunning).toHaveBeenLastCalledWith(false);
    } finally { vi.useRealTimers(); }
  });
  it("rejects expressions that are invalid in Unicode mode", () => {
    expect(computeProjectSearchQueryError("\\q", true)).not.toBe("");
  });
  it("does not publish progress from a cancelled scan", async () => {
    let generation = 0;
    const deps = makeDeps({ bumpProjectSearchGeneration: () => ++generation, getProjectSearchGeneration: () => generation });
    vi.mocked(searchInProject).mockImplementationOnce(async (_root, _query, options) => {
      generation++;
      vi.mocked(deps.setProjectSearchStatus).mockClear();
      for (let i = 0; i < 250; i++) expect(options?.onProgress?.("a")).toBe(false);
      return { ok: true, results: [], scannedFiles: 0, unreadableFiles: 0 };
    });
    await createOverlayHostHandlers(deps).runProjectSearch(query);
    expect(deps.setProjectSearchStatus).not.toHaveBeenCalled();
  });
});

it("does not replace after the workspace changes during confirmation", async () => {
  const { requestConfirm } = await import("../../services/confirmDialogUi");
  const { replaceInProjectFile } = await import("../../services/projectFileOps");
  vi.mocked(replaceInProjectFile).mockClear();
  let root = "/ws";
  vi.mocked(requestConfirm).mockImplementationOnce(async () => { root = "/other"; return true; });
  const deps = makeDeps({ getActiveWorkspaceRoot: () => root });
  await createOverlayHostHandlers(deps).replaceAllInProjectWithResults(
    { text: "foo", replacement: "bar", caseSensitive: false, wholeWord: false, regex: false },
    [{ path: "/ws/a.ts", matches: [{ from: 0, to: 3, length: 3, line: 1, column: 1, lineText: "foo" }] }],
    async () => {},
  );
  expect(replaceInProjectFile).not.toHaveBeenCalled();
  expect(deps.setProjectSearchRunning).not.toHaveBeenCalled();
});
