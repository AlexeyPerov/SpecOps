import { describe, expect, it } from "vitest";
import { buildNonInteractiveRemoteEnv, mergeRemoteGitEnv } from "./gitRemoteEnv";

describe("buildNonInteractiveRemoteEnv", () => {
  it("disables terminal prompts and uses SSH batch mode", () => {
    expect(buildNonInteractiveRemoteEnv()).toEqual({
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
    });
  });
});

describe("mergeRemoteGitEnv", () => {
  it("returns a shallow copy when overrides are absent", () => {
    const base = buildNonInteractiveRemoteEnv();
    const merged = mergeRemoteGitEnv(base);
    expect(merged).toEqual(base);
    expect(merged).not.toBe(base);
  });

  it("merges askpass overrides without mutating the base map", () => {
    const base = buildNonInteractiveRemoteEnv();
    const merged = mergeRemoteGitEnv(base, { GIT_ASKPASS: "/tmp/askpass.sh" });
    expect(merged.GIT_ASKPASS).toBe("/tmp/askpass.sh");
    expect(base.GIT_ASKPASS).toBeUndefined();
  });
});
