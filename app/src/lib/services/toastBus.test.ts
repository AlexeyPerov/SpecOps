import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissToast, showErrorToast, showToast, toasts } from "./toastBus";

function currentToasts(): { id: number; kind: string; message: string }[] {
  let snapshot: { id: number; kind: string; message: string }[] = [];
  const unsubscribe = toasts.subscribe((value) => {
    snapshot = value;
  });
  unsubscribe();
  return snapshot;
}

describe("toastBus", () => {
  afterEach(() => {
    for (const toast of currentToasts()) {
      dismissToast(toast.id);
    }
    vi.restoreAllMocks();
  });

  it("appends messages to the stack", () => {
    showToast("hello", "info");
    const [first] = currentToasts();
    expect(first).toMatchObject({ kind: "info", message: "hello" });

    showErrorToast("boom");
    const toastsNow = currentToasts();
    expect(toastsNow).toHaveLength(2);
    expect(toastsNow[1]).toMatchObject({ kind: "error", message: "boom" });
  });

  it("auto-dismisses after the ttl", () => {
    vi.useFakeTimers();
    showToast("fleeting", "info", 100);
    expect(currentToasts()).toHaveLength(1);

    vi.advanceTimersByTime(150);
    expect(currentToasts()).toHaveLength(0);
    vi.useRealTimers();
  });

  it("caps the visible stack", () => {
    for (let index = 0; index < 6; index += 1) {
      showToast(`message-${index}`, "info", 60_000);
    }
    const visible = currentToasts();
    expect(visible).toHaveLength(4);
    expect(visible[0]!.message).toBe("message-2");
    expect(visible[3]!.message).toBe("message-5");
  });

  it("dismissToast removes only the targeted message", () => {
    showToast("keep", "info", 60_000);
    showToast("drop", "info", 60_000);
    const [, second] = currentToasts();

    dismissToast(second!.id);

    const remaining = currentToasts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.message).toBe("keep");
  });
});
