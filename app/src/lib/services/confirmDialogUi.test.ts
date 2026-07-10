import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmDialog,
  registerConfirmRunner,
  requestConfirm,
} from "./confirmDialogUi";

describe("confirmDialogUi", () => {
  afterEach(() => {
    registerConfirmRunner(null);
    vi.unstubAllGlobals();
  });

  it("falls back to window.confirm when no runner is registered", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("window", { confirm });

    const result = await requestConfirm({ message: "Are you sure?" });

    expect(result).toBe(true);
    expect(confirm).toHaveBeenCalledWith("Are you sure?");
  });

  it("delegates to the registered runner and resolves true on confirm", async () => {
    const runner = vi.fn().mockResolvedValue(true);
    registerConfirmRunner(runner);

    const result = await requestConfirm({
      title: "Delete",
      message: "Delete this session?",
      confirmLabel: "Delete",
      danger: true,
    });

    expect(result).toBe(true);
    expect(runner).toHaveBeenCalledWith({
      title: "Delete",
      message: "Delete this session?",
      confirmLabel: "Delete",
      danger: true,
    });
  });

  it("resolves false when the runner resolves false (cancel)", async () => {
    registerConfirmRunner(vi.fn().mockResolvedValue(false));

    const result = await requestConfirm({ message: "ok?" });

    expect(result).toBe(false);
  });

  it("passes each request straight to the current runner (single-flight is the host's concern)", async () => {
    // The service itself is a thin registry: it forwards each call to whatever
    // runner is registered. Displacing an in-flight prompt when a new request
    // arrives is the mounted dialog host's responsibility (covered by the
    // ConfirmDialog component test) — the service just resolves whatever the
    // runner returns.
    const runner = vi.fn().mockResolvedValue(true);
    registerConfirmRunner(runner);

    await requestConfirm({ message: "first" });
    await requestConfirm({ message: "second" });

    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner).toHaveBeenNthCalledWith(1, { message: "first" });
    expect(runner).toHaveBeenNthCalledWith(2, { message: "second" });
  });

  it("unregistering the runner restores the window.confirm fallback", async () => {
    registerConfirmRunner(vi.fn().mockResolvedValue(true));
    expect(await requestConfirm({ message: "via runner" })).toBe(true);

    registerConfirmRunner(null);

    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    expect(await requestConfirm({ message: "via fallback" })).toBe(false);
    expect(confirm).toHaveBeenCalledWith("via fallback");
  });

  it("confirmDialog convenience wrapper delegates with danger flag", async () => {
    const runner = vi.fn().mockResolvedValue(true);
    registerConfirmRunner(runner);

    const result = await confirmDialog("Discard?", true);

    expect(result).toBe(true);
    expect(runner).toHaveBeenCalledWith({ message: "Discard?", danger: true });
  });
});
