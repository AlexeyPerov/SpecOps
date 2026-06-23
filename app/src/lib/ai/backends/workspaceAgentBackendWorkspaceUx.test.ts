import { describe, expect, it } from "vitest";
import {
  WorkspaceAgentBackendError,
  createWorkspaceAgentBackend,
} from "./workspaceAgentBackend";
import { createRawOpencodeClientStub } from "../../test/rawOpencodeClientStub";

/**
 * M5 — workspace-UX backend methods: session.todo, session.diff, file.status,
 * and lsp. Covers mapping + transport-error degradation as exercised through
 * the public backend.
 */
describe("workspaceAgentBackend — M5 workspace UX", () => {
  function createBackend(clientOverrides: Parameters<typeof createRawOpencodeClientStub>[0] = {}) {
    return createWorkspaceAgentBackend("opencode", {
      resolveRuntimeConfig: async () => ({ mode: "url", baseUrl: "http://opencode.local", sidecarPort: 4096 }),
      resolveServerPassword: async () => "",
      createOpencodeClient: () => createRawOpencodeClientStub(clientOverrides),
    });
  }

  describe("listSessionTodos", () => {
    it("maps the todo payload into normalized entries", async () => {
      const backend = createBackend({
        async listSessionTodos() {
          return {
            data: [
              { content: "Write tests", status: "in_progress", priority: "high" },
              { content: "Ship", status: "pending", priority: "medium" },
              { content: "Done", status: "completed", priority: "low" },
            ],
          };
        },
      });
      const todos = await backend.listSessionTodos({
        workspaceRootPath: "/repo",
        sessionId: "sess-1",
      });
      expect(todos).toEqual([
        { content: "Write tests", status: "in_progress", priority: "high" },
        { content: "Ship", status: "pending", priority: "medium" },
        { content: "Done", status: "completed", priority: "low" },
      ]);
    });

    it("drops entries without content and coerces unknown status/priority to defaults", async () => {
      const backend = createBackend({
        async listSessionTodos() {
          return {
            data: [
              { content: "", status: "in_progress", priority: "high" },
              { content: "Weird", status: "bogus", priority: "urgent" },
              { content: "Cancelled", status: "cancelled", priority: "low" },
            ],
          };
        },
      });
      const todos = await backend.listSessionTodos({
        workspaceRootPath: "/repo",
        sessionId: "sess-1",
      });
      expect(todos).toEqual([
        { content: "Weird", status: "pending", priority: "medium" },
        { content: "Cancelled", status: "cancelled", priority: "low" },
      ]);
    });

    it("degrades to [] on transport errors", async () => {
      const backend = createBackend({
        async listSessionTodos() {
          throw new WorkspaceAgentBackendError({
            code: "serverUnavailable",
            message: "down",
          });
        },
      });
      const todos = await backend.listSessionTodos({
        workspaceRootPath: "/repo",
        sessionId: "sess-1",
      });
      expect(todos).toEqual([]);
    });

    it("returns [] for a non-array payload", async () => {
      const backend = createBackend({
        async listSessionTodos() {
          return { data: { not: "an array" } };
        },
      });
      expect(
        await backend.listSessionTodos({ workspaceRootPath: "/repo", sessionId: "s" }),
      ).toEqual([]);
    });
  });

  describe("listSessionDiffs", () => {
    it("maps snapshot file diffs with patch + counts", async () => {
      const backend = createBackend({
        async listSessionDiffs() {
          return {
            data: [
              {
                file: "src/a.ts",
                patch: "@@ -1,2 +1,2 @@\n-old\n+new\n",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
              { file: "src/new.ts", patch: "", additions: 10, deletions: 0, status: "added" },
            ],
          };
        },
      });
      const diffs = await backend.listSessionDiffs({
        workspaceRootPath: "/repo",
        sessionId: "sess-1",
      });
      expect(diffs).toEqual([
        {
          file: "src/a.ts",
          patch: "@@ -1,2 +1,2 @@\n-old\n+new\n",
          additions: 1,
          deletions: 1,
          status: "modified",
        },
        { file: "src/new.ts", patch: "", additions: 10, deletions: 0, status: "added" },
      ]);
    });

    it("defaults missing status to modified and missing counts to 0", async () => {
      const backend = createBackend({
        async listSessionDiffs() {
          return { data: [{ file: "x" }] };
        },
      });
      const [diff] = await backend.listSessionDiffs({
        workspaceRootPath: "/repo",
        sessionId: "s",
      });
      expect(diff).toEqual({
        file: "x",
        patch: "",
        additions: 0,
        deletions: 0,
        status: "modified",
      });
    });

    it("degrades to [] on notFound", async () => {
      const backend = createBackend({
        async listSessionDiffs() {
          throw new WorkspaceAgentBackendError({ code: "notFound", message: "gone" });
        },
      });
      expect(
        await backend.listSessionDiffs({ workspaceRootPath: "/repo", sessionId: "s" }),
      ).toEqual([]);
    });
  });

  describe("listFileStatuses", () => {
    it("maps file status entries", async () => {
      const backend = createBackend({
        async listFileStatuses() {
          return {
            data: [
              { path: "src/a.ts", additions: 1, deletions: 2, status: "modified" },
              { path: "src/b.ts", additions: 5, deletions: 0, status: "added" },
              { path: "src/c.ts", additions: 0, deletions: 3, status: "deleted" },
            ],
          };
        },
      });
      const entries = await backend.listFileStatuses({ workspaceRootPath: "/repo" });
      expect(entries).toEqual([
        { path: "src/a.ts", additions: 1, deletions: 2, status: "modified" },
        { path: "src/b.ts", additions: 5, deletions: 0, status: "added" },
        { path: "src/c.ts", additions: 0, deletions: 3, status: "deleted" },
      ]);
    });

    it("tolerates added/removed aliases for additions/deletions", async () => {
      const backend = createBackend({
        async listFileStatuses() {
          return {
            data: [{ path: "x", added: 4, removed: 2, status: "modified" }],
          };
        },
      });
      const [entry] = await backend.listFileStatuses({ workspaceRootPath: "/repo" });
      expect(entry?.additions).toBe(4);
      expect(entry?.deletions).toBe(2);
    });

    it("drops entries without a path", async () => {
      const backend = createBackend({
        async listFileStatuses() {
          return { data: [{ path: "", status: "modified" }, { path: "ok", status: "added" }] };
        },
      });
      const entries = await backend.listFileStatuses({ workspaceRootPath: "/repo" });
      expect(entries).toEqual([{ path: "ok", additions: 0, deletions: 0, status: "added" }]);
    });

    it("degrades to [] on transport errors", async () => {
      const backend = createBackend({
        async listFileStatuses() {
          throw new WorkspaceAgentBackendError({ code: "transportError", message: "x" });
        },
      });
      expect(await backend.listFileStatuses({ workspaceRootPath: "/repo" })).toEqual([]);
    });
  });

  describe("listLspStatuses", () => {
    it("maps LSP server entries", async () => {
      const backend = createBackend({
        async listLspStatuses() {
          return {
            data: [
              { id: "typescript", name: "TypeScript", root: "/repo", status: "connected" },
              { id: "rust", name: "Rust", root: "/repo", status: "error" },
            ],
          };
        },
      });
      const entries = await backend.listLspStatuses({ workspaceRootPath: "/repo" });
      expect(entries).toEqual([
        { id: "typescript", name: "TypeScript", root: "/repo", status: "connected" },
        { id: "rust", name: "Rust", root: "/repo", status: "error" },
      ]);
    });

    it("drops entries without id or name", async () => {
      const backend = createBackend({
        async listLspStatuses() {
          return {
            data: [
              { id: "", name: "x", status: "connected" },
              { id: "y", name: "", status: "connected" },
              { id: "z", name: "ok", status: "weird" },
            ],
          };
        },
      });
      const entries = await backend.listLspStatuses({ workspaceRootPath: "/repo" });
      expect(entries).toEqual([{ id: "z", name: "ok", root: "", status: "error" }]);
    });

    it("degrades to [] on authFailure", async () => {
      const backend = createBackend({
        async listLspStatuses() {
          throw new WorkspaceAgentBackendError({ code: "authFailure", message: "no" });
        },
      });
      expect(await backend.listLspStatuses({ workspaceRootPath: "/repo" })).toEqual([]);
    });
  });
});
