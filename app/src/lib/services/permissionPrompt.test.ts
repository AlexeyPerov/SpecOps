import { afterEach, describe, expect, it, vi } from "vitest";
import {
  promptPermission,
  registerPermissionPromptRunner,
  type PermissionPromptResult,
} from "./permissionPrompt";

function mockRunner(
  result: PermissionPromptResult,
): (request: { permissionId: string; label: string; payload: unknown }) => Promise<PermissionPromptResult> {
  return vi.fn().mockResolvedValue(result);
}

describe("permissionPrompt", () => {
  afterEach(() => {
    registerPermissionPromptRunner(null);
  });

  it("rejects by default when no runner is registered", async () => {
    const result = await promptPermission({
      permissionId: "p-1",
      label: "Run shell command",
      payload: null,
    });
    expect(result).toEqual({ reply: "reject" });
  });

  it("delegates to the registered runner", async () => {
    const runner = mockRunner({ reply: "once" });
    registerPermissionPromptRunner(runner);

    const result = await promptPermission({
      permissionId: "p-2",
      label: "Write file",
      payload: { path: "/tmp/test.txt" },
    });

    expect(result).toEqual({ reply: "once" });
    expect(runner).toHaveBeenCalledWith({
      permissionId: "p-2",
      label: "Write file",
      payload: { path: "/tmp/test.txt" },
    });
  });

  it("unregistering the runner causes prompts to reject by default", async () => {
    const runner = mockRunner({ reply: "once" });
    registerPermissionPromptRunner(runner);

    const result1 = await promptPermission({
      permissionId: "p-3",
      label: "Before unregister",
      payload: null,
    });
    expect(result1).toEqual({ reply: "once" });

    registerPermissionPromptRunner(null);

    const result2 = await promptPermission({
      permissionId: "p-4",
      label: "After unregister",
      payload: null,
    });
    expect(result2).toEqual({ reply: "reject" });
  });

  it("supports registering a new runner replacing the old one", async () => {
    const runner1 = mockRunner({ reply: "once" });
    const runner2 = mockRunner({ reply: "always" });
    registerPermissionPromptRunner(runner1);

    const result1 = await promptPermission({
      permissionId: "p-5",
      label: "First runner",
      payload: null,
    });
    expect(result1).toEqual({ reply: "once" });
    expect(runner1).toHaveBeenCalledTimes(1);

    registerPermissionPromptRunner(runner2);

    const result2 = await promptPermission({
      permissionId: "p-6",
      label: "Second runner",
      payload: null,
    });
    expect(result2).toEqual({ reply: "always" });
    expect(runner2).toHaveBeenCalledTimes(1);
  });
});
