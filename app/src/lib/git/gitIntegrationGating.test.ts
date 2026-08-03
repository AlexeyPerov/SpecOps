import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appState } from "../state/appState";
import {
  isVersionControlViewActiveInAnyPane,
  shouldRunGitForCallerScope,
  shouldRunGitForScope,
  type GitCallScope,
} from "./gitIntegrationGating";
import type { GitIntegrationScope } from "../domain/contracts";

describe("gitIntegrationGating — shouldRunGitForScope", () => {
  it.each([
    ["always", "versionControl", true],
    ["always", "background", true],
    ["versionControlOnly", "versionControl", true],
    ["off", "versionControl", false],
    ["off", "background", false],
  ] as const)(
    "scope %s + caller %s -> %s (VC-active-independent branches)",
    (scope, callerScope, expected) => {
      // For "always" and "off" the VC-active predicate is not consulted, so the
      // result is deterministic without appState setup.
      if (scope === "versionControlOnly") {
        // Covered by the VC-active aware tests below; skip the appState-less
        // assertion here since it depends on appState contents.
        return;
      }
      expect(shouldRunGitForScope(scope, callerScope as GitCallScope)).toBe(expected);
    },
  );
});

describe("gitIntegrationGating — isVersionControlViewActiveInAnyPane", () => {
  beforeEach(() => {
    appState.resetAppState();
    appState.setGitIntegrationEnabled(true);
  });

  afterEach(() => {
    appState.resetAppState();
    appState.updateGitIntegrationSettings({ scope: "always" });
  });

  it("returns false when no VC view tab is active", () => {
    expect(isVersionControlViewActiveInAnyPane()).toBe(false);
  });

  it("returns true when a VC view tab is active in the active context", () => {
    appState.openOrFocusViewTab("version-control");
    expect(isVersionControlViewActiveInAnyPane()).toBe(true);
  });

  it("returns true when a VC view tab is active in a non-active workspace", () => {
    const workspaceId = appState.addWorkspace("/tmp/ws-vc");
    expect(workspaceId).not.toBeNull();
    appState.switchContext(workspaceId!);
    appState.openOrFocusViewTab("version-control");

    // Switch away to notepad; the VC tab is still open in the workspace pane.
    appState.switchContext("notepad");
    expect(isVersionControlViewActiveInAnyPane()).toBe(true);
  });
});

describe("gitIntegrationGating — shouldRunGitForCallerScope (integration with appState)", () => {
  afterEach(() => {
    appState.resetAppState();
    appState.updateGitIntegrationSettings({ scope: "always" });
  });

  function setScope(scope: GitIntegrationScope): void {
    appState.setGitIntegrationEnabled(true);
    appState.updateGitIntegrationSettings({ scope });
  }

  it("allows background calls under scope 'always'", () => {
    setScope("always");
    expect(shouldRunGitForCallerScope("background")).toBe(true);
  });

  it("blocks background calls under scope 'versionControlOnly' when no VC tab is active", () => {
    setScope("versionControlOnly");
    appState.resetAppState();
    appState.setGitIntegrationEnabled(true);
    appState.updateGitIntegrationSettings({ scope: "versionControlOnly" });
    expect(shouldRunGitForCallerScope("background")).toBe(false);
  });

  it("allows VC-initiated calls regardless of scope (when enabled)", () => {
    setScope("versionControlOnly");
    expect(shouldRunGitForCallerScope("versionControl")).toBe(true);
  });

  it("blocks all calls when scope is 'off'", () => {
    setScope("off");
    expect(shouldRunGitForCallerScope("versionControl")).toBe(false);
    expect(shouldRunGitForCallerScope("background")).toBe(false);
  });
});
