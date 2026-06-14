import { beforeEach, describe, expect, it } from "vitest";
import {
  isWorkspaceLifecycleActive,
  markWorkspaceLifecycleActive,
  resetWorkspaceLifecycleForTests,
} from "./workspaceLifecycle";

describe("workspaceLifecycle", () => {
  beforeEach(() => {
    resetWorkspaceLifecycleForTests();
  });

  it("starts inactive", () => {
    expect(isWorkspaceLifecycleActive()).toBe(false);
  });

  it("becomes active after markWorkspaceLifecycleActive", () => {
    markWorkspaceLifecycleActive();
    expect(isWorkspaceLifecycleActive()).toBe(true);
  });

  it("stays active after repeated marks", () => {
    markWorkspaceLifecycleActive();
    markWorkspaceLifecycleActive();
    expect(isWorkspaceLifecycleActive()).toBe(true);
  });

  it("resets to inactive via resetWorkspaceLifecycleForTests", () => {
    markWorkspaceLifecycleActive();
    expect(isWorkspaceLifecycleActive()).toBe(true);
    resetWorkspaceLifecycleForTests();
    expect(isWorkspaceLifecycleActive()).toBe(false);
  });
});
