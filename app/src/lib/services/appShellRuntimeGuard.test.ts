import { describe, expect, it, vi } from "vitest";
import { handoffAppShellRuntimeCleanup } from "./appShellRuntime";

describe("handoffAppShellRuntimeCleanup", () => {
  it("disposes the prior runtime cleanup before registering the next", () => {
    const first = vi.fn();
    const second = vi.fn();

    handoffAppShellRuntimeCleanup(first);
    handoffAppShellRuntimeCleanup(second);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
