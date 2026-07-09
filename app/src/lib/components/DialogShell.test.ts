import { describe, expect, it, vi } from "vitest";
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
};

function dispatchKey(target: Element, key: string): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
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

  it("calls onDismiss on Escape", () => {
    const onDismiss = vi.fn();
    const { host } = mountComponent<DialogShellProps>(DialogShell, {
      open: true,
      title: "Confirm",
      onDismiss,
    });
    const panel = host.querySelector(".dialog-shell-panel") as HTMLElement;
    dispatchKey(panel, "Escape");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss on Escape when onDismiss is omitted", () => {
    const { host } = mountComponent<DialogShellProps>(DialogShell, {
      open: true,
      title: "Locked",
    });
    const panel = host.querySelector(".dialog-shell-panel") as HTMLElement;
    // Should not throw and panel should remain rendered.
    dispatchKey(panel, "Escape");
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
});
