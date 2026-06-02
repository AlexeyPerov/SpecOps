import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";

vi.mock("./openFileRegistry", () => ({
  renameOpenFileRegistry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./diskFingerprint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./diskFingerprint")>();
  return {
    ...actual,
    statDiskFingerprint: vi.fn().mockResolvedValue({ mtimeMs: 1, sizeBytes: 2 }),
  };
});

import { renameOpenFileRegistry } from "./openFileRegistry";
import { markDocumentsMissingUnderPath, syncDocumentsAfterPathRelocation } from "./relocateWorkspacePaths";

describe("syncDocumentsAfterPathRelocation", () => {
  beforeEach(() => {
    vi.mocked(renameOpenFileRegistry).mockClear();
    const workspaceId = appState.addWorkspace("/tmp/ws-reloc");
    expect(workspaceId).not.toBeNull();
    appState.switchContext(workspaceId!);
    appState.openFileInTab("/tmp/ws-reloc/sibling.txt", "content");
    appState.openFileInTab("/tmp/ws-reloc/old/nested.ts", "nested");
  });

  it("rewrites document paths under a relocated directory prefix", async () => {
    await syncDocumentsAfterPathRelocation(
      "/tmp/ws-reloc",
      "/tmp/ws-reloc/old",
      "/tmp/ws-reloc/new",
      "main",
    );

    const docs = appState.getActiveDocuments();
    const paths = docs.map((doc) => doc.filePath).filter(Boolean).sort();
    expect(paths).toEqual(["/tmp/ws-reloc/new/nested.ts", "/tmp/ws-reloc/sibling.txt"]);
    expect(renameOpenFileRegistry).toHaveBeenCalled();
  });
});

describe("markDocumentsMissingUnderPath", () => {
  beforeEach(() => {
    const workspaceId = appState.addWorkspace("/tmp/ws-del");
    expect(workspaceId).not.toBeNull();
    appState.switchContext(workspaceId!);
    appState.openFileInTab("/tmp/ws-del/old/nested.ts", "nested");
  });

  it("marks documents missing when a path prefix is deleted", () => {
    const docId = appState.getActiveDocuments().find((doc) => doc.filePath?.includes("nested.ts"))?.id;
    markDocumentsMissingUnderPath("/tmp/ws-del", "/tmp/ws-del/old");
    const nested = appState.getActiveDocuments().find((doc) => doc.id === docId);
    expect(nested?.fileMissing).toBe(true);
  });
});
