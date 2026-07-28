import { describe, expect, it } from "vitest";
import { validateGitRefName } from "./gitRefName";

describe("validateGitRefName", () => {
  it("accepts common branch names", () => {
    expect(validateGitRefName("main")).toEqual({ ok: true });
    expect(validateGitRefName("feature/login")).toEqual({ ok: true });
    expect(validateGitRefName("release-1.2")).toEqual({ ok: true });
  });

  it("rejects empty and invalid branch names before git is invoked", () => {
    expect(validateGitRefName("")).toEqual({
      ok: false,
      message: "Branch name cannot be empty.",
    });
    expect(validateGitRefName("bad name")).toEqual({
      ok: false,
      message: "Branch name contains invalid characters (spaces, ~, ^, :, ?, *, [, \\).",
    });
    expect(validateGitRefName("bad..name")).toEqual({
      ok: false,
      message: "Branch name cannot contain '..' or '@{'.",
    });
    expect(validateGitRefName(".hidden")).toEqual({
      ok: false,
      message: "Branch name cannot start with '.' or end with '.' or '/'.",
    });
    expect(validateGitRefName("@")).toEqual({
      ok: false,
      message: "Branch name cannot be '@'.",
    });
  });

  it("rejects a leading dash so the name cannot be parsed as a flag", () => {
    expect(validateGitRefName("-d")).toEqual({
      ok: false,
      message: "Branch name cannot start with '-'.",
    });
    expect(validateGitRefName("--delete")).toEqual({
      ok: false,
      message: "Branch name cannot start with '-'.",
    });
  });
});
