import { beforeEach, describe, expect, it, vi } from "vitest";
import { message } from "@tauri-apps/plugin-dialog";
import type { AppDomainState, DocumentState } from "../domain/contracts";
import { appState } from "../state/appState";
import { buildDocument } from "../state/appState/documentHelpers";
import {
  assertNoUnsavedDocuments,
  collectDirtyDocumentsForWorkspace,
} from "./unsavedDocumentGuard";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn(),
}));

const messageMock = vi.mocked(message);

function workspaceWithDocuments(
  rootPath: string,
  documents: DocumentState[],
): AppDomainState {
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
        {
          id: "ws-2",
          rootPath: "/tmp/other-workspace",
          snapshot: {
            documents: [
              buildDocument({ id: "doc-other", filePath: "/tmp/other-workspace/dirty.txt" }, "x", "dirty.txt"),
            ],
            session: base.contexts.notepad.session,
          },
        },
      ],
    },
  };
}

describe("collectDirtyDocumentsForWorkspace", () => {
  beforeEach(() => {
    messageMock.mockReset();
  });

  it("returns dirty documents only for the matching workspace", () => {
    const dirtyDoc = buildDocument(
      { id: "doc-dirty", filePath: "/tmp/ws-one/readme.md" },
      "changed",
      "readme.md",
    );
    dirtyDoc.isDirty = true;

    const cleanDoc = buildDocument(
      { id: "doc-clean", filePath: "/tmp/ws-one/clean.md" },
      "same",
      "clean.md",
    );

    const otherDirty = buildDocument(
      { id: "doc-other", filePath: "/tmp/other-workspace/dirty.txt" },
      "x",
      "dirty.txt",
    );
    otherDirty.isDirty = true;

    vi.spyOn(appState, "getSnapshot").mockReturnValue(
      workspaceWithDocuments("/tmp/ws-one", [dirtyDoc, cleanDoc]),
    );

    expect(collectDirtyDocumentsForWorkspace("/tmp/ws-one")).toEqual([dirtyDoc]);
    expect(collectDirtyDocumentsForWorkspace("/tmp/missing")).toEqual([]);
  });
});

describe("assertNoUnsavedDocuments", () => {
  beforeEach(() => {
    messageMock.mockReset();
    messageMock.mockResolvedValue(undefined as never);
  });

  it("returns true when workspace has no dirty documents", async () => {
    vi.spyOn(appState, "getSnapshot").mockReturnValue(
      workspaceWithDocuments("/tmp/ws-one", [
        buildDocument({ id: "doc-clean", filePath: null }, "", "Untitled"),
      ]),
    );

    await expect(assertNoUnsavedDocuments("/tmp/ws-one")).resolves.toBe(true);
    expect(messageMock).not.toHaveBeenCalled();
  });

  it("shows a cancel-only dialog and returns false when dirty documents exist", async () => {
    const dirtyDoc = buildDocument({ id: "doc-dirty", filePath: null }, "draft", "Untitled");
    dirtyDoc.isDirty = true;

    vi.spyOn(appState, "getSnapshot").mockReturnValue(
      workspaceWithDocuments("/tmp/ws-one", [dirtyDoc]),
    );

    await expect(assertNoUnsavedDocuments("/tmp/ws-one")).resolves.toBe(false);
    expect(messageMock).toHaveBeenCalledWith(
      "1 unsaved file. Save or discard your editor changes before continuing.",
      expect.objectContaining({ title: "Unsaved changes", kind: "warning" }),
    );
  });
});
