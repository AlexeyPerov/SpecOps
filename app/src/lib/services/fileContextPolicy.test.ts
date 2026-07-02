import { beforeEach, describe, expect, it } from "vitest";
import { appState } from "../state/appState";
import { isFileContextRestricted, runOpenInActiveContext } from "./fileContextPolicy";

describe("isFileContextRestricted", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("defaults to unrestricted", () => {
    expect(isFileContextRestricted()).toBe(false);
  });

  it("reflects the persisted setting", () => {
    appState.setRestrictFilesToContext(true);
    expect(isFileContextRestricted()).toBe(true);
  });
});

describe("runOpenInActiveContext", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("runs in the active workspace when unrestricted", async () => {
    appState.addWorkspace("/tmp/workspace");
    let ran = false;
    await runOpenInActiveContext(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(appState.isNotepadActive()).toBe(false);
  });

  it("switches to notepad when restricted", async () => {
    appState.addWorkspace("/tmp/workspace");
    appState.setRestrictFilesToContext(true);
    await runOpenInActiveContext(async () => {});
    expect(appState.isNotepadActive()).toBe(true);
  });
});
