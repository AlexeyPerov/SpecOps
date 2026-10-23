import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GlobalDocument, ProjectCatalog } from "../domain/projectCatalog";
const store = vi.hoisted(() => ({ catalog: null as unknown as ProjectCatalog, update: vi.fn() }));
vi.mock("./workspaceCatalog", () => ({
  getProjectCatalog: () => store.catalog,
  updateProjectCatalog: (mutations: unknown) => store.update(mutations),
}));
vi.mock("./workspaceDocuments", () => ({ discardGlobalDocument: vi.fn().mockResolvedValue(undefined) }));
import { appState } from "../state/appState";
import { allTabs, isViewTab } from "../domain/contracts";
import { discardGlobalDocument } from "./workspaceDocuments";
import {
  createGlobalDocument,
  deleteGlobalDocument,
  globalDocumentsOfKind,
  moveGlobalDocument,
  nextGlobalDocumentName,
  openGlobalDocument,
  pruneDeletedGlobalDocuments,
} from "./globalDocuments";

const doc = (id: string, kind: GlobalDocument["kind"], name: string, order: number): GlobalDocument => ({ id, kind, name, order });
function catalogWith(...documents: GlobalDocument[]): ProjectCatalog {
  return { version: 1, revision: 1, projects: {}, folders: {}, savedContexts: {}, documents: Object.fromEntries(documents.map((entry) => [entry.id, entry])) };
}
const documentTabs = () => allTabs(appState.getActiveSession().editorLayout).filter(isViewTab).map((tab) => tab.globalDocumentId);

describe("global documents", () => {
  beforeEach(() => {
    appState.resetAppState();
    store.catalog = catalogWith(doc("b", "tasks", "Tasks", 1), doc("a", "tasks", "Tasks 2", 0), doc("n", "notes", "Notes", 0));
    store.update.mockReset().mockImplementation(async () => store.catalog);
    vi.mocked(discardGlobalDocument).mockClear();
  });

  it("orders documents per kind and picks the first unused default name", () => {
    expect(globalDocumentsOfKind(store.catalog, "tasks").map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(nextGlobalDocumentName(store.catalog, "tasks")).toBe("Tasks 3");
    expect(nextGlobalDocumentName(store.catalog, "notes")).toBe("Notes 2");
  });

  it("creates documents with a fresh id and a trimmed or default name", async () => {
    await createGlobalDocument("notes", "  Ideas ");
    await createGlobalDocument("notes");
    const [[first], [second]] = store.update.mock.calls as [[{ document: GlobalDocument }[]], [{ document: GlobalDocument }[]]];
    expect(first[0]).toMatchObject({ type: "putDocument", document: { kind: "notes", name: "Ideas" } });
    expect(second[0].document.name).toBe("Notes 2");
    expect(first[0].document.id).not.toBe(second[0].document.id);
  });

  it("moves a document one step with the right successor and ignores moves past the ends", async () => {
    store.catalog = catalogWith(doc("x", "tasks", "X", 0), doc("y", "tasks", "Y", 1), doc("z", "tasks", "Z", 2));
    await moveGlobalDocument("z", -1);
    await moveGlobalDocument("x", 1);
    await moveGlobalDocument("x", -1);
    await moveGlobalDocument("y", 1);
    expect(store.update.mock.calls).toEqual([
      [[{ type: "moveDocument", id: "z", beforeId: "y" }]],
      [[{ type: "moveDocument", id: "x", beforeId: "z" }]],
      [[{ type: "moveDocument", id: "y", beforeId: null }]],
    ]);
  });

  it("opens documents in the last used tab group while a workspace is active", () => {
    const drafts = appState.createTabGroup("Drafts");
    appState.addWorkspace("/tmp/ws");
    expect(openGlobalDocument("n")).toBe(true);
    expect(appState.getSnapshot().contexts.activeContextId).toBe(drafts);
    expect(documentTabs()).toEqual(["n"]);
    expect(openGlobalDocument("missing")).toBe(false);
  });

  it("deletes documents after settling their buffers and closes their tabs", async () => {
    openGlobalDocument("a");
    openGlobalDocument("n");
    await deleteGlobalDocument("a");
    expect(discardGlobalDocument).toHaveBeenCalledWith("a");
    expect(store.update).toHaveBeenCalledWith([{ type: "removeDocument", id: "a" }]);
    expect(documentTabs()).toEqual(["n"]);
  });

  it("closes tabs of documents another window deleted", () => {
    openGlobalDocument("a");
    openGlobalDocument("n");
    pruneDeletedGlobalDocuments(catalogWith(doc("n", "notes", "Notes", 0)));
    expect(documentTabs()).toEqual(["n"]);
    expect(discardGlobalDocument).toHaveBeenCalledWith("a");
  });
});
