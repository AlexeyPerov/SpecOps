import { describe, expect, it } from "vitest";
import { sanitizeGitStderrForDiagnosticLog } from "./gitDiagnosticSanitize";

describe("sanitizeGitStderrForDiagnosticLog", () => {
  it("redacts password and token assignments", () => {
    expect(
      sanitizeGitStderrForDiagnosticLog(
        "fatal: Authentication failed for 'https://example.com': password=secret123 token: abcdef",
      ),
    ).toBe(
      "fatal: Authentication failed for 'https://example.com': password=*** token: ***",
    );
  });

  it("redacts credentials embedded in remote URLs", () => {
    expect(
      sanitizeGitStderrForDiagnosticLog("fatal: unable to access https://user:pass@github.com/x.git/"),
    ).toBe("fatal: unable to access ***/github.com/x.git/");
  });

  it("leaves non-sensitive stderr unchanged", () => {
    const stderr = "fatal: not a git repository (or any of the parent directories): .git";
    expect(sanitizeGitStderrForDiagnosticLog(stderr)).toBe(stderr);
  });
});
