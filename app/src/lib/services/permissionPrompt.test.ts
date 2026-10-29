import { afterEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import {
  answerPermissionPrompt,
  pendingPermissionPrompts,
  promptPermission,
} from "./permissionPrompt";
import { sessionPromptKey } from "./sessionPromptQueue";

const ROOT = "/work/permission";

describe("permissionPrompt", () => {
  afterEach(() => {
    pendingPermissionPrompts.rejectAll();
  });

  it("keeps the request pending for its session until it is answered", async () => {
    const pending = promptPermission({
      sessionId: "session-1",
      root: ROOT,
      permissionId: "p-1",
      label: "Write file",
      payload: { path: "/tmp/test.txt" },
    });
    const entry = get(pendingPermissionPrompts.forSession(ROOT, "session-1"));
    expect(entry).toMatchObject({
      key: sessionPromptKey(ROOT, "session-1"),
      sessionId: "session-1",
      root: ROOT,
      request: { permissionId: "p-1", label: "Write file", payload: { path: "/tmp/test.txt" } },
    });
    expect(get(pendingPermissionPrompts.forSession(ROOT, "session-2"))).toBeNull();
    expect(get(pendingPermissionPrompts.forSession("/work/other", "session-1"))).toBeNull();

    expect(answerPermissionPrompt(entry!, { reply: "once" })).toBe(true);
    await expect(pending).resolves.toEqual({ reply: "once" });
    expect(get(pendingPermissionPrompts.forSession(ROOT, "session-1"))).toBeNull();
    expect(answerPermissionPrompt(entry!, { reply: "always" })).toBe(false);
  });

  it("does not reject while no chat is showing the request", async () => {
    let settled = false;
    const pending = promptPermission({ sessionId: "hidden", root: ROOT, permissionId: "p-2", label: "Run", payload: null })
      .then((result) => { settled = true; return result; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    const entry = get(pendingPermissionPrompts.forSession(ROOT, "hidden"))!;
    answerPermissionPrompt(entry, { reply: "always" });
    await expect(pending).resolves.toEqual({ reply: "always" });
  });

  it("rejects and removes the request when its signal aborts", async () => {
    const controller = new AbortController();
    const pending = promptPermission({ sessionId: "s", root: ROOT, permissionId: "p-3", label: "Run", payload: null, signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toEqual({ reply: "reject" });
    expect(get(pendingPermissionPrompts)).toEqual({});
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      promptPermission({ sessionId: "s", root: ROOT, permissionId: "p-4", label: "Run", payload: null, signal: controller.signal }),
    ).resolves.toEqual({ reply: "reject" });
    expect(get(pendingPermissionPrompts)).toEqual({});
  });

  it("a newer request for the same session supersedes the pending one", async () => {
    const first = promptPermission({ sessionId: "s", root: ROOT, permissionId: "p-5", label: "First", payload: null });
    const firstEntry = get(pendingPermissionPrompts.forSession(ROOT, "s"))!;
    const other = promptPermission({ sessionId: "other", root: ROOT, permissionId: "p-6", label: "Other", payload: null });
    const second = promptPermission({ sessionId: "s", root: ROOT, permissionId: "p-7", label: "Second", payload: null });
    await expect(first).resolves.toEqual({ reply: "reject" });

    const secondEntry = get(pendingPermissionPrompts.forSession(ROOT, "s"))!;
    expect(secondEntry.request.label).toBe("Second");
    expect(answerPermissionPrompt(firstEntry, { reply: "once" })).toBe(false);
    answerPermissionPrompt(secondEntry, { reply: "once" });
    await expect(second).resolves.toEqual({ reply: "once" });

    const otherEntry = get(pendingPermissionPrompts.forSession(ROOT, "other"))!;
    expect(otherEntry.request.label).toBe("Other");
    answerPermissionPrompt(otherEntry, { reply: "reject" });
    await expect(other).resolves.toEqual({ reply: "reject" });
  });
});
