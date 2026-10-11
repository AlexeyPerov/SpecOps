import { beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ storage: "app" as "app" | "project", files: new Map<string, string>(), fail: false }));
vi.mock("./workspacePreferences", () => ({ getWorkspaceDocumentStorage: () => io.storage, setWorkspaceDocumentStorage: async (_root: string, storage: "app" | "project") => { io.storage = storage; } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command: string, args: { root: string; kind: string; storage: string; content: string; expected: string | null }) => {
  const key = `${args.root}/${args.storage}/${args.kind}`;
  if (command === "workspace_document_read") return { path: key, content: io.files.get(key) ?? null };
  if (command === "workspace_document_save") {
    if (io.fail) throw new Error("Disk full");
    if ((io.files.get(key) ?? null) !== args.expected) throw new Error("Changed on disk");
    io.files.set(key, args.content);
  }
}) }));
import { createWorkspaceDocument, editWorkspaceDocument, flushWorkspaceDocuments, loadWorkspaceDocument, reloadWorkspaceDocument } from "./workspaceDocuments";
beforeEach(() => { io.fail = false; io.storage = "app"; io.files.clear(); });
describe("workspace document storage", () => {
  it("does not create files on inspection and creates separate Markdown only on request", async () => {
    const record = await loadWorkspaceDocument("/lazy", "tasks");
    expect(record.content).toBeNull(); expect(io.files.size).toBe(0);
    await createWorkspaceDocument("/lazy", "tasks");
    expect(io.files.get("/lazy/app/tasks")).toBe("# Tasks\n\n");
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
    await createWorkspaceDocument("/conflict", "tasks");
    const record = await loadWorkspaceDocument("/conflict", "tasks");
    editWorkspaceDocument(record, "local"); io.files.set("/conflict/app/tasks", "external");
    await expect(flushWorkspaceDocuments("/conflict")).rejects.toThrow("Changed on disk");
    expect(record.content).toBe("local"); expect(io.files.get("/conflict/app/tasks")).toBe("external");
    await reloadWorkspaceDocument(record, false);
    expect(io.files.get("/conflict/app/tasks")).toBe("local");
  });
});
