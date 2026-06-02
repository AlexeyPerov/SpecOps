import { describe, expect, it } from "vitest";
import { appState } from "../state/appState";
import { shouldCloseWindowAfterTabTransfer } from "./emptyWindowLifecycle";

describe("shouldCloseWindowAfterTabTransfer", () => {
  it("returns true when no tabs remain", () => {
    appState.resetAppState();
    appState.removeTransferredTab(appState.getActiveSession().selectedTabId!);
    expect(shouldCloseWindowAfterTabTransfer(appState.getSnapshot())).toBe(true);
  });

  it("returns true for a lone empty untitled tab", () => {
    appState.resetAppState();
    expect(shouldCloseWindowAfterTabTransfer(appState.getSnapshot())).toBe(true);
  });

  it("returns false when a real file tab remains", () => {
    appState.resetAppState();
    appState.openFileInTab("/tmp/a.txt", "hello");
    expect(shouldCloseWindowAfterTabTransfer(appState.getSnapshot())).toBe(false);
  });
});
