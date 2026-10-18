import { beforeEach, describe, expect, it, vi } from "vitest";
const events = vi.hoisted(() => ({ handler: null as null | ((event: { payload: { path: string } }) => void) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (_name, handler) => { events.handler = handler; return () => {}; }) }));
import { invoke } from "@tauri-apps/api/core";
import { emptyTaskBook, serializeTaskBook } from "./workspaceTasks";
const io = vi.hoisted(() => ({ storage: "app" as "app" | "project", files: new Map<string, string>(), fail: false }));
vi.mock("./workspacePreferences", () => ({ getWorkspaceDocumentStorage: () => io.storage, setWorkspaceDocumentStorage: async (_root: string, storage: "app" | "project") => { io.storage = storage; } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command: string, args: { root: string | null; kind: string; storage: string; content: string; expected: string | null }) => {
  const key = `${args.root}/${args.storage}/${args.kind}`;
  if (command === "workspace_document_read") return { path: key, content: io.files.get(key) ?? null };
  if (command === "workspace_document_save") {
    if (io.fail) throw new Error("Disk full");
    if ((io.files.get(key) ?? null) !== args.expected) throw new Error("Changed on disk");
    io.files.set(key, args.content);
  }
}) }));
import { createWorkspaceDocument, editWorkspaceDocument, flushWorkspaceDocuments, loadWorkspaceDocument, reloadWorkspaceDocument, refreshDocument, workspaceDocumentSnapshot } from "./workspaceDocuments";
beforeEach(() => { io.fail = false; io.storage = "app"; io.files.clear(); });
describe("workspace document storage", () => {
  it("does not create files on inspection and creates separate JSON tasks only on request", async () => {
    const record = await loadWorkspaceDocument("/lazy", "tasks");
    expect(record.content).toBeNull(); expect(io.files.size).toBe(0);
    await createWorkspaceDocument("/lazy", "tasks");
    expect(io.files.get("/lazy/app/tasks")).toBe(serializeTaskBook(emptyTaskBook()));
    expect(io.files.has("/lazy/app/notes")).toBe(false);
  });
  it("preserves edits after save failures and retries during an awaited flush", async () => {
    await createWorkspaceDocument("/failure", "notes");
    const record = await loadWorkspaceDocument("/failure", "notes");
    editWorkspaceDocument(record, "edited"); io.fail = true;
    await expect(flushWorkspaceDocuments("/failure")).rejects.toThrow("Disk full");
    expect(record.content).toBe("edited"); expect(record.saved).toBe("# Notes\n\n");
    io.fail = false; await flushWorkspaceDocuments("/failure");
    expect(io.files.get("/failure/app/notes")).toBe("edited");
  });
  it("switches the source without implicitly transferring files", async () => {
    await createWorkspaceDocument("/switch", "notes"); io.storage = "project";
    const record = await loadWorkspaceDocument("/switch", "notes");
    expect(record.content).toBeNull(); expect(io.files.get("/switch/app/notes")).toBe("# Notes\n\n");
  });
  it("refuses external overwrites and preserves local contents until explicit resolution", async () => {
    await createWorkspaceDocument("/conflict", "notes");
    const record = await loadWorkspaceDocument("/conflict", "notes");
    editWorkspaceDocument(record, "local"); io.files.set("/conflict/app/notes", "external");
    await expect(flushWorkspaceDocuments("/conflict")).rejects.toThrow("Changed on disk");
    expect(record.content).toBe("local"); expect(io.files.get("/conflict/app/notes")).toBe("external");
    await reloadWorkspaceDocument(record, false);
    expect(io.files.get("/conflict/app/notes")).toBe("local");
  });
  it("keeps global documents in app storage and separate from project documents", async () => {
    io.storage = "project";
    await createWorkspaceDocument(null, "notes");
    expect(io.files.get("null/app/notes")).toBe("# Notes\n\n");
    expect(workspaceDocumentSnapshot(null, "notes")?.storage).toBe("app");
    await createWorkspaceDocument("/global-separation", "notes");
    expect(io.files.get("/global-separation/project/notes")).toBe("# Notes\n\n");
  });
  it("refreshes clean copies and protects dirty edits from another window", async () => {
    await createWorkspaceDocument("/remote", "notes");
    const record = await loadWorkspaceDocument("/remote", "notes");
    io.files.set("/remote/app/notes", "another window");
    await refreshDocument(record);
    expect(record.content).toBe("another window");
    editWorkspaceDocument(record, "local draft");
    io.files.set("/remote/app/notes", "new remote text");
    await refreshDocument(record);
    expect(record.content).toBe("local draft"); expect(record.saved).toBe("another window");
    expect(record.error).toContain("changed on disk"); expect(record.timer).toBeUndefined();
    await reloadWorkspaceDocument(record, true);
    expect(record.content).toBe("new remote text");
  });
  it("does not publish malformed task JSON", async () => {
    await createWorkspaceDocument("/invalid", "tasks");
    const record = await loadWorkspaceDocument("/invalid", "tasks");
    expect(() => editWorkspaceDocument(record, "bad JSON")).toThrow();
    expect(record.content).toBe(serializeTaskBook(emptyTaskBook()));
  });
  it("receives native change events for cached documents", async () => {
    await createWorkspaceDocument("/event", "notes");
    const record = await loadWorkspaceDocument("/event", "notes");
    io.files.set("/event/app/notes", "committed in another window");
    events.handler!({ payload: { path: record.path } });
    await vi.waitFor(() => expect(record.content).toBe("committed in another window"));
  });
  it("does not let an outstanding read overwrite a newer local save", async () => {
    await createWorkspaceDocument("/read-race", "notes");
    const record = await loadWorkspaceDocument("/read-race", "notes");
    let finish!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refresh = refreshDocument(record);
    editWorkspaceDocument(record, "new local text");
    await flushWorkspaceDocuments("/read-race");
    finish({ path: record.path, content: "stale read" });
    await refresh;
    expect(record.content).toBe("new local text"); expect(record.saved).toBe("new local text");
  });
  it("reports refresh read failures while preserving the current buffer", async () => {
    await createWorkspaceDocument("/read-error", "notes");
    const record = await loadWorkspaceDocument("/read-error", "notes");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Read unavailable"));
    await expect(refreshDocument(record)).rejects.toThrow("Read unavailable");
    expect(record.content).toBe("# Notes\n\n"); expect(record.error).toContain("Read unavailable");
  });

});
