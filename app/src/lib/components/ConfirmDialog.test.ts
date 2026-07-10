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
});
