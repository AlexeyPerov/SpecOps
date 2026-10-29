import { afterEach, describe, expect, it } from "vitest";
import { tick } from "svelte";
import ConfirmDialog from "./ConfirmDialog.svelte";
import { mountComponent } from "./_testComponentMount";
import { registerConfirmRunner, requestConfirm } from "../services/confirmDialogUi";

function getActionButtons(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(".dialog-shell-actions button"),
  );
}

describe("ConfirmDialog", () => {
  afterEach(() => {
    registerConfirmRunner(null);
  });

  it("resolves true when the confirm button is clicked", async () => {
    mountComponent(ConfirmDialog, {});
    // Let the mount $effect register the runner before prompting.
    await tick();

    const promise = requestConfirm({ message: "Save?" });
    // Let the open=true state flush to the DOM.
    await tick();

    const buttons = getActionButtons();
    const confirmButton = buttons[buttons.length - 1];
    expect(confirmButton).toBeTruthy();
    confirmButton.click();

    await expect(promise).resolves.toBe(true);
  });

  it("resolves false when the cancel button is clicked", async () => {
    mountComponent(ConfirmDialog, {});
    await tick();

    const promise = requestConfirm({ message: "Save?" });
    await tick();

    const cancelButton = document.querySelector<HTMLButtonElement>(
      ".dialog-shell-actions button.btn-secondary",
    );
    expect(cancelButton).toBeTruthy();
    cancelButton!.click();

    await expect(promise).resolves.toBe(false);
  });

  it("uses danger styling on the confirm button when danger is true", async () => {
    mountComponent(ConfirmDialog, {});
    await tick();

    const promise = requestConfirm({ message: "Discard?", danger: true });
    await tick();

    const dangerButton = document.querySelector<HTMLButtonElement>(
      ".dialog-shell-actions button.btn-danger",
    );
    expect(dangerButton).toBeTruthy();
    dangerButton!.click();
    await promise;
  });

  it("single-flight: a pending request resolves false when a new request arrives", async () => {
    mountComponent(ConfirmDialog, {});
    await tick();

    const first = requestConfirm({ message: "first" });
    await tick();

    // A second request displaces the first before the user answers it.
    const second = requestConfirm({ message: "second" });
    await tick();

    // The first should now be resolved with false (cancelled) by the host.
    await expect(first).resolves.toBe(false);

    // Answer the second to settle it.
    const buttons = getActionButtons();
    const confirmButton = buttons[buttons.length - 1];
    confirmButton.click();
    await expect(second).resolves.toBe(true);
  });
  it("opens an anchored request as a bubble without the dimmed backdrop", async () => {
    mountComponent(ConfirmDialog, {});
    await tick();

    const anchor = { left: 0, top: 100, right: 240, bottom: 122 };
    const confirmed = requestConfirm({ message: "Delete?", confirmLabel: "Delete", danger: true, anchor });
    await tick();

    expect(document.querySelector(".dialog-shell-backdrop")).toBeNull();
    const confirmButton = document.querySelector<HTMLButtonElement>(".dialog-shell-anchored button.btn-danger");
    expect(confirmButton?.textContent?.trim()).toBe("Delete");
    confirmButton!.click();
    await expect(confirmed).resolves.toBe(true);

    const dismissed = requestConfirm({ message: "Delete?", anchor });
    await tick();
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await expect(dismissed).resolves.toBe(false);

    const escaped = requestConfirm({ message: "Delete?", anchor });
    await tick();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect(escaped).resolves.toBe(false);
    await tick();
    expect(document.querySelector(".dialog-shell-anchored")).toBeNull();
  });
});
