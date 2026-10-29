import { flushSync } from "svelte";
import { describe, expect, it, vi } from "vitest";
import SessionSidebarRow from "./SessionSidebarRow.svelte";
import { mountComponent } from "./_testComponentMount";

const session = { id: "s1", title: "Old title" } as never;

function keydown(input: HTMLInputElement, key: string): void {
  input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

describe("SessionSidebarRow inline rename", () => {
  it("commits a changed title on Enter", () => {
    const onRenameCommit = vi.fn();
    const { host } = mountComponent(SessionSidebarRow, { session, renaming: true, onRenameCommit });
    flushSync();
    const input = host.querySelector<HTMLInputElement>("input")!;
    expect(input.value).toBe("Old title");
    input.value = "  New title ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    keydown(input, "Enter");
    expect(onRenameCommit).toHaveBeenCalledExactlyOnceWith("New title");
  });

  it("cancels on Escape and when the title is unchanged", () => {
    const onRenameCommit = vi.fn();
    const onRenameCancel = vi.fn();
    const first = mountComponent(SessionSidebarRow, { session, renaming: true, onRenameCommit, onRenameCancel });
    flushSync();
    keydown(first.host.querySelector<HTMLInputElement>("input")!, "Escape");
    const second = mountComponent(SessionSidebarRow, { session, renaming: true, onRenameCommit, onRenameCancel });
    flushSync();
    keydown(second.host.querySelector<HTMLInputElement>("input")!, "Enter");
    expect(onRenameCancel).toHaveBeenCalledTimes(2);
    expect(onRenameCommit).not.toHaveBeenCalled();
  });
});
