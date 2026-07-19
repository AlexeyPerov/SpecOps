import { describe, expect, it, vi } from "vitest";
import {
  computeProjectSearchQueryError,
  createOverlayHostHandlers,
  type OverlayHostHandlersDeps,
} from "./overlayHostHandlers";
import type { ProjectSearchResult } from "../../services/projectSearch";

vi.mock("../../services/confirmDialogUi", () => ({
  requestConfirm: vi.fn(async () => true),
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
    getWorkspaceFileCatalog: () => ({ getOpenablePaths: () => null }) as never,
    getWorkspaceFileCatalogRegistry: () =>
      ({ getActive: () => null }) as never,
    getActiveDocumentMarkdownViewMode: () => undefined,
    setMarkdownViewMode: vi.fn(),
    openAndActivatePath: vi.fn(async () => {}),
    setProjectSearchResults: vi.fn(),
    setProjectSearchStatus: vi.fn(),
    setProjectSearchRunning: vi.fn(),
    bumpProjectSearchGeneration: () => 1,
    getProjectSearchGeneration: () => 1,
    setSessionListLoading: vi.fn(),
    setSessionListSessions: vi.fn(),
    getSessionListSearch: () => "",
    handleListWorkspaceSessions: vi.fn(async () => []),
    handleOpenExternalSession: vi.fn(async () => {}),
    setSessionListOpen: vi.fn(),
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

describe("createOverlayHostHandlers.openSessionListPanel", () => {
  it("opens the panel then refreshes", async () => {
    const setSessionListOpen = vi.fn();
    const setSessionListLoading = vi.fn();
    const handleListWorkspaceSessions = vi.fn(async () => []);
    const setSessionListSessions = vi.fn();
    const handlers = createOverlayHostHandlers(
      makeDeps({
        setSessionListOpen,
        setSessionListLoading,
        handleListWorkspaceSessions,
        setSessionListSessions,
      }),
    );
    await handlers.openSessionListPanel();
    expect(setSessionListOpen).toHaveBeenCalledWith(true);
    expect(setSessionListLoading.mock.calls).toEqual([[true], [false]]);
    expect(handleListWorkspaceSessions).toHaveBeenCalledWith({});
    expect(setSessionListSessions).toHaveBeenCalledWith([]);
  });

  it("forwards the trimmed search query when present", async () => {
    const handleListWorkspaceSessions = vi.fn(async () => []);
    const handlers = createOverlayHostHandlers(
      makeDeps({
        handleListWorkspaceSessions,
        getSessionListSearch: () => "  foo  ",
      }),
    );
    await handlers.refreshSessionList();
    expect(handleListWorkspaceSessions).toHaveBeenCalledWith({ search: "foo" });
  });
});

describe("createOverlayHostHandlers.closeSessionListPanel", () => {
  it("closes the panel", () => {
    const setSessionListOpen = vi.fn();
    const handlers = createOverlayHostHandlers(makeDeps({ setSessionListOpen }));
    handlers.closeSessionListPanel();
    expect(setSessionListOpen).toHaveBeenCalledWith(false);
  });
});

describe("createOverlayHostHandlers.handleOpenSessionFromList", () => {
  it("opens the external session then closes the panel", async () => {
    const handleOpenExternalSession = vi.fn(async () => {});
    const setSessionListOpen = vi.fn();
    const handlers = createOverlayHostHandlers(
      makeDeps({ handleOpenExternalSession, setSessionListOpen }),
    );
    await handlers.handleOpenSessionFromList("sess-1", "Title");
    expect(handleOpenExternalSession).toHaveBeenCalledWith("sess-1", "Title");
    expect(setSessionListOpen).toHaveBeenCalledWith(false);
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
});
