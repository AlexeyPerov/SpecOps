import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionTabs, isViewTab } from "../domain/contracts";
import { appState } from "../state/appState";
import {
  GIT_INTEGRATION_DISABLED_NOTIFY,
  NO_WORKSPACE_FOR_VERSION_CONTROL_NOTIFY,
  openVersionControlAtCommit,
  openVersionControlForActiveContext,
  openVersionControlForWorkspace,
  resetPendingVersionControlCommitForTests,
  subscribeVersionControlCommitRequests,
  takePendingVersionControlCommit,
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

describe("version control commit handoff", () => {
  beforeEach(() => {
    appState.resetAppState();
    resetPendingVersionControlCommitForTests();
  });

  it("hands the commit to a view for the same repository, once", () => {
    const workspaceId = appState.addWorkspace("/tmp/ws-commit");
    expect(workspaceId).not.toBeNull();

    const opened = openVersionControlAtCommit(workspaceId!, "/tmp/ws-commit", "abc123");

    expect(opened).toBe(true);
    expect(takePendingVersionControlCommit("/tmp/ws-commit")).toBe("abc123");
    expect(takePendingVersionControlCommit("/tmp/ws-commit")).toBeNull();
  });

  it("does not hand a commit to a view for another repository", () => {
    const workspaceId = appState.addWorkspace("/tmp/ws-commit-other");
    openVersionControlAtCommit(workspaceId!, "/tmp/ws-commit-other", "abc123");

    expect(takePendingVersionControlCommit("/tmp/other-repo")).toBeNull();
    expect(takePendingVersionControlCommit("/tmp/ws-commit-other")).toBe("abc123");
  });

  it("notifies mounted views so an already-open tab still navigates", () => {
    const workspaceId = appState.addWorkspace("/tmp/ws-commit-live");
    const listener = vi.fn();
    const unsubscribe = subscribeVersionControlCommitRequests(listener);

    openVersionControlAtCommit(workspaceId!, "/tmp/ws-commit-live", "def456");

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("drops the pending commit when version control cannot be opened", () => {
    const workspaceId = appState.addWorkspace("/tmp/ws-commit-off");
    appState.switchContext(workspaceId!);
    appState.setGitIntegrationEnabled(false);

    const opened = openVersionControlAtCommit(workspaceId!, "/tmp/ws-commit-off", "abc123");

    expect(opened).toBe(false);
    expect(takePendingVersionControlCommit("/tmp/ws-commit-off")).toBeNull();
  });
});
