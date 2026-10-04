import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let dataDir: string;
vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: (path: string) => mkdir(path, { recursive: true }),
  readTextFile: (path: string) => readFile(path, "utf8"),
  remove: (path: string) => rm(path, { force: true }),
}));
vi.mock("./appDataDir", () => ({ ensureSpecOpsDataDir: () => Promise.resolve(dataDir) }));
vi.mock("@tauri-apps/api/path", () => ({ join: (...parts: string[]) => Promise.resolve(join(...parts)) }));
vi.mock("./atomicWrite", () => ({ atomicWriteTextFile: async (path: string, text: string) => {
  await writeFile(path + ".tmp", text); await rename(path + ".tmp", path);
} }));
import { chatStore } from "../state/chatStore";
import { persistSessionThreadSnapshot, flushSessionIndexPersistence, readWorkspaceSessionsIndexSnapshot, resetChatPersistenceForTests } from "./chatPersistence";
import { createFakeRuntimeAdapter } from "../session/adapter/fake";
beforeEach(async () => { dataDir = await mkdtemp(join(tmpdir(), "specops-binding-")); chatStore.reset(); });
afterEach(async () => { resetChatPersistenceForTests(); await rm(dataDir, { recursive: true, force: true }); });
it("saves through the store/production writer, reloads disk into fresh state and resumes the same native ID", async () => {
  const root = "/workspace";
  chatStore.setActiveWorkspaceRoot(root);
  const sessionId = chatStore.createDraftSession()!;
  const firstHost = createFakeRuntimeAdapter();
  const native = await firstHost.createSession({ runtimeId: "fake", workspaceRootPath: root });
  const binding = { runtimeId: "fake" as const, nativeSessionId: native.nativeSessionId, modelId: "model", modeId: "mode", shareUrl: "https://example.test/shared", parentSessionId: "parent", runtimeMetadata: { effort: "high", access_token: "secret-canary" } };
  chatStore.setSessionLink(sessionId, binding, root);
  await flushSessionIndexPersistence(root);
  await persistSessionThreadSnapshot(root, sessionId, { metadata: { sessionId, threadId: sessionId, createdAt: "t", updatedAt: "t", summary: "" }, messages: [{ id: "u", role: "user", content: "hello", createdAt: "t" }] });
  chatStore.reset();
  chatStore.setActiveWorkspaceRoot(root);
  await chatStore.loadWorkspaceSessions(root);
  const restored = chatStore.getSessionLink(sessionId, root)!;
  expect(restored).toEqual({ ...binding, runtimeMetadata: { effort: "high", access_token: "[redacted]" } });
  expect((await readWorkspaceSessionsIndexSnapshot(root)).sessions).toHaveLength(1);
  const freshHost = createFakeRuntimeAdapter();
  const resumed = await freshHost.resumeSession({ native: { ...restored, nativeSessionId: restored.nativeSessionId as never }, workspaceRootPath: root });
  expect(resumed.nativeSessionId).toBe(native.nativeSessionId);
});
