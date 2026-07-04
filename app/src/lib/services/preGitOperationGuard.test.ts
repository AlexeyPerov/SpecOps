import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDomainState, DocumentState } from "../domain/contracts";
import { appState } from "../state/appState";
import { buildDocument } from "../state/appState/documentHelpers";
import { autosaveWorkspaceDirtyDocuments } from "./preGitAutosave";
import { promptPreGitAutosaveFailures } from "./preGitAutosavePrompt";
import { prepareWorkspaceForGitOperation } from "./preGitOperationGuard";
import { assertNoUnsavedDocuments } from "./unsavedDocumentGuard";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn(),
}));

vi.mock("./preGitAutosave", () => ({
  autosaveWorkspaceDirtyDocuments: vi.fn(),
}));

vi.mock("./preGitAutosavePrompt", () => ({
  promptPreGitAutosaveFailures: vi.fn(),
}));

vi.mock("./unsavedDocumentGuard", () => ({
  assertNoUnsavedDocuments: vi.fn(),
}));

const autosaveMock = vi.mocked(autosaveWorkspaceDirtyDocuments);
const promptMock = vi.mocked(promptPreGitAutosaveFailures);
const assertMock = vi.mocked(assertNoUnsavedDocuments);

function workspaceState(rootPath: string, documents: DocumentState[] = []): AppDomainState {
  const base = appState.getSnapshot();
  return {
    ...base,
    contexts: {
      ...base.contexts,
      workspaces: [
        {
          id: "ws-1",
          rootPath,
          snapshot: {
            documents,
            session: base.contexts.notepad.session,
          },
        },
      ],
    },
  };
}

describe("prepareWorkspaceForGitOperation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertMock.mockResolvedValue(true);
    autosaveMock.mockResolvedValue({ savedCount: 0, skipped: [], failures: [] });
  });

  it("falls back to the unsaved-document guard when autosave is disabled", async () => {
    await expect(
      prepareWorkspaceForGitOperation("/tmp/ws", {
        enabled: false,
        deps: { getWindowId: () => "win-a", notify: vi.fn() },
      }),
    ).resolves.toBe(true);

    expect(assertMock).toHaveBeenCalledWith("/tmp/ws");
    expect(autosaveMock).not.toHaveBeenCalled();
  });

  it("falls back to the unsaved-document guard when save deps are missing", async () => {
    await expect(
      prepareWorkspaceForGitOperation("/tmp/ws", {
        deps: null,
      }),
    ).resolves.toBe(true);

    expect(assertMock).toHaveBeenCalledWith("/tmp/ws");
    expect(autosaveMock).not.toHaveBeenCalled();
  });

  it("continues silently when autosave succeeds and no dirty docs remain", async () => {
    vi.spyOn(appState, "getSnapshot").mockReturnValue(workspaceState("/tmp/ws"));

    await expect(
      prepareWorkspaceForGitOperation("/tmp/ws", {
        deps: { getWindowId: () => "win-a", notify: vi.fn() },
      }),
    ).resolves.toBe(true);

    expect(autosaveMock).toHaveBeenCalledWith("ws-1", expect.objectContaining({ enabled: true }));
    expect(promptMock).not.toHaveBeenCalled();
    expect(assertMock).toHaveBeenCalledWith("/tmp/ws");
  });

  it("falls back to the unsaved-document guard when the autosave prompt is unavailable", async () => {
    vi.spyOn(appState, "getSnapshot").mockReturnValue(workspaceState("/tmp/ws"));
    autosaveMock.mockResolvedValue({
      savedCount: 0,
      skipped: [],
      failures: [{ documentId: "doc-1", title: "one.txt", filePath: "/tmp/ws/one.txt", message: "fail" }],
    });
    promptMock.mockResolvedValue(null);

    await expect(
      prepareWorkspaceForGitOperation("/tmp/ws", {
        deps: { getWindowId: () => "win-a", notify: vi.fn() },
      }),
    ).resolves.toBe(true);

    expect(assertMock).toHaveBeenCalledWith("/tmp/ws");
  });

  it("blocks when autosave partially fails and the user cancels", async () => {
    vi.spyOn(appState, "getSnapshot").mockReturnValue(workspaceState("/tmp/ws"));
    autosaveMock.mockResolvedValue({
      savedCount: 1,
      skipped: [],
      failures: [{ documentId: "doc-2", title: "two.txt", filePath: "/tmp/ws/two.txt", message: "fail" }],
    });
    promptMock.mockResolvedValue({ type: "cancel" });

    await expect(
      prepareWorkspaceForGitOperation("/tmp/ws", {
        deps: { getWindowId: () => "win-a", notify: vi.fn() },
      }),
    ).resolves.toBe(false);

    expect(promptMock).toHaveBeenCalled();
    expect(assertMock).not.toHaveBeenCalled();
  });

  it("continues when autosave partially fails and the user chooses continue anyway", async () => {
    vi.spyOn(appState, "getSnapshot").mockReturnValue(workspaceState("/tmp/ws"));
    autosaveMock.mockResolvedValue({
      savedCount: 0,
      skipped: [],
      failures: [{ documentId: "doc-1", title: "one.txt", filePath: "/tmp/ws/one.txt", message: "fail" }],
    });
    promptMock.mockResolvedValue({ type: "continue-anyway" });

    await expect(
      prepareWorkspaceForGitOperation("/tmp/ws", {
        deps: { getWindowId: () => "win-a", notify: vi.fn() },
      }),
    ).resolves.toBe(true);

    expect(assertMock).not.toHaveBeenCalled();
  });

  it("falls back to the unsaved-document guard when workspace is not registered", async () => {
    vi.spyOn(appState, "getSnapshot").mockReturnValue(
      workspaceState("/tmp/other"),
    );

    await expect(
      prepareWorkspaceForGitOperation("/tmp/missing", {
        deps: { getWindowId: () => "win-a", notify: vi.fn() },
      }),
    ).resolves.toBe(true);

    expect(autosaveMock).not.toHaveBeenCalled();
    expect(assertMock).toHaveBeenCalledWith("/tmp/missing");
  });
});

describe("assertNoUnsavedDocuments integration", () => {
  it("still blocks when non-editable dirty docs remain after autosave", async () => {
    const dirtyDoc = buildDocument({ id: "doc-dirty", filePath: null }, "draft", "Untitled");
    dirtyDoc.isDirty = true;
    vi.spyOn(appState, "getSnapshot").mockReturnValue(workspaceState("/tmp/ws", [dirtyDoc]));
    autosaveMock.mockResolvedValue({ savedCount: 0, skipped: [], failures: [] });
    assertMock.mockResolvedValue(false);

    await expect(
      prepareWorkspaceForGitOperation("/tmp/ws", {
        deps: { getWindowId: () => "win-a", notify: vi.fn() },
      }),
    ).resolves.toBe(false);

    expect(assertMock).toHaveBeenCalledWith("/tmp/ws");
  });
});
