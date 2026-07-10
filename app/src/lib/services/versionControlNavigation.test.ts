import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionTabs, isViewTab } from "../domain/contracts";
import { appState } from "../state/appState";
import {
  GIT_INTEGRATION_DISABLED_NOTIFY,
  NO_WORKSPACE_FOR_VERSION_CONTROL_NOTIFY,
  openVersionControlForActiveContext,
  openVersionControlForWorkspace,
} from "./versionControlNavigation";

describe("versionControlNavigation", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("opens version-control for a workspace when git integration is enabled", () => {
    const workspaceId = appState.addWorkspace("/tmp/ws-vc");
    expect(workspaceId).not.toBeNull();

    const opened = openVersionControlForWorkspace(workspaceId!);

    expect(opened).toBe(true);
    expect(appState.getActiveContext().id).toBe(workspaceId);
    const tabs = getSessionTabs(appState.getActiveSession()).filter(
      (tab) => isViewTab(tab) && tab.view === "version-control",
    );
    expect(tabs).toHaveLength(1);
  });

  it("notifies and does not open when git integration is disabled", () => {
    const workspaceId = appState.addWorkspace("/tmp/ws-vc-off");
    expect(workspaceId).not.toBeNull();
    appState.switchContext(workspaceId!);
    appState.setGitIntegrationEnabled(false);
    const notify = vi.fn();

    const opened = openVersionControlForWorkspace(workspaceId!, notify);

    expect(opened).toBe(false);
    expect(notify).toHaveBeenCalledWith(GIT_INTEGRATION_DISABLED_NOTIFY);
    const tabs = getSessionTabs(appState.getActiveSession()).filter(
      (tab) => isViewTab(tab) && tab.view === "version-control",
    );
    expect(tabs).toHaveLength(0);
  });

  it("notifies and does not open for non-workspace contexts", () => {
    const notify = vi.fn();

    const opened = openVersionControlForActiveContext(notify);

    expect(opened).toBe(false);
    expect(notify).toHaveBeenCalledWith(NO_WORKSPACE_FOR_VERSION_CONTROL_NOTIFY);
    const tabs = getSessionTabs(appState.getActiveSession()).filter(
      (tab) => isViewTab(tab) && tab.view === "version-control",
    );
    expect(tabs).toHaveLength(0);
  });
});
