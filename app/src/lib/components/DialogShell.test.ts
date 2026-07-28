import { describe, expect, it, vi } from "vitest";
import { createRawSnippet, tick } from "svelte";
import DialogShell from "./DialogShell.svelte";
import { mountComponent } from "./_testComponentMount";

type DialogShellProps = {
  open: boolean;
  title: string;
  onDismiss?: () => void;
  dismissOnBackdrop?: boolean;
  width?: number;
  panelClass?: string;
  titleId?: string;
  children?: ReturnType<typeof createRawSnippet>;
  actions?: ReturnType<typeof createRawSnippet>;
};

function dispatchKey(target: EventTarget, key: string, options?: { shiftKey?: boolean }): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      shiftKey: options?.shiftKey ?? false,
    }),
  );
}

describe("DialogShell", () => {
  it("renders nothing when closed", () => {
    const { host } = mountComponent<DialogShellProps>(DialogShell, {
      open: false,
      title: "Hidden",
    });
    expect(host.querySelector(".dialog-shell-panel")).toBeNull();
  });

  it("renders title, body slot, and actions slot when open", () => {
    const { host } = mountComponent<DialogShellProps>(DialogShell, {
      open: true,
      title: "Delete tag",
    });
    const panel = host.querySelector(".dialog-shell-panel");
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute("role")).toBe("dialog");
    expect(panel?.getAttribute("aria-modal")).toBe("true");
    expect(host.querySelector(".dialog-shell-title")?.textContent).toBe("Delete tag");
    // aria-labelledby points at the title id.
    const labelledBy = panel?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(host.querySelector(`#${labelledBy}`)).toBeTruthy();
  });

  it("calls onDismiss on Escape from the panel", async () => {
    const onDismiss = vi.fn();
    const { host } = mountComponent<DialogShellProps>(DialogShell, {
      open: true,
      title: "Confirm",
      onDismiss,
    });
    await tick();
    const panel = host.querySelector(".dialog-shell-panel") as HTMLElement;
    dispatchKey(panel, "Escape");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss on Escape from the window (capture)", async () => {
    const onDismiss = vi.fn();
    mountComponent<DialogShellProps>(DialogShell, {
      open: true,
      title: "Confirm",
      onDismiss,
    });
    await tick();
    dispatchKey(window, "Escape");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss on Escape when onDismiss is omitted", async () => {
    const { host } = mountComponent<DialogShellProps>(DialogShell, {
      open: true,
      title: "Locked",
    });
    await tick();
    const panel = host.querySelector(".dialog-shell-panel") as HTMLElement;
    // Should not throw and panel should remain rendered.
    dispatchKey(panel, "Escape");
    dispatchKey(window, "Escape");
    expect(host.querySelector(".dialog-shell-panel")).toBeTruthy();
  });

  it("dismisses on backdrop click when dismissOnBackdrop is true", () => {
    const onDismiss = vi.fn();
    const { host } = mountComponent<DialogShellProps>(DialogShell, {
      open: true,
      title: "Confirm",
      onDismiss,
    });
    const backdrop = host.querySelector(".dialog-shell-backdrop") as HTMLElement;
    backdrop.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss on backdrop click when dismissOnBackdrop is false", () => {
    const onDismiss = vi.fn();
    const { host } = mountComponent<DialogShellProps>(DialogShell, {
      open: true,
      title: "Busy",
      onDismiss,
      dismissOnBackdrop: false,
    });
    const backdrop = host.querySelector(".dialog-shell-backdrop") as HTMLElement;
    backdrop.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("applies a custom width and panel class", () => {
    const { host } = mountComponent<DialogShellProps>(DialogShell, {
      open: true,
      title: "Wide",
      width: 640,
      panelClass: "session-list-panel",
    });
    const panel = host.querySelector(".dialog-shell-panel") as HTMLElement;
    expect(panel.classList.contains("session-list-panel")).toBe(true);
    expect(panel.style.getPropertyValue("--dialog-shell-width")).toContain("640px");
  });

  it("traps Tab / Shift+Tab within focusable panel controls", async () => {
    const children = createRawSnippet(() => ({
      render: () =>
        `<div><button type="button" data-first>First</button><button type="button" data-last>Last</button></div>`,
    }));
    const { host } = mountComponent<DialogShellProps>(DialogShell, {
      open: true,
      title: "Trap",
      children,
    });
    await tick();

    const first = host.querySelector("[data-first]") as HTMLButtonElement;
    const last = host.querySelector("[data-last]") as HTMLButtonElement;
    expect(first).toBeTruthy();
    expect(last).toBeTruthy();

    last.focus();
    dispatchKey(window, "Tab");
    expect(document.activeElement).toBe(first);

    first.focus();
    dispatchKey(window, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("restores previously focused element when unmounted while open", async () => {
    const outside = document.createElement("button");
    outside.type = "button";
    outside.textContent = "Outside";
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    const { unmount } = mountComponent<DialogShellProps>(DialogShell, {
      open: true,
      title: "Open",
    });
    await tick();

    unmount();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
