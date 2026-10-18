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

describe("sanitizeGitStderrForDiagnosticLog credential patterns", () => {
  it("redacts the credential after an auth scheme word", () => {
    expect(sanitizeGitStderrForDiagnosticLog("Authorization: Bearer ghp_SECRET\n")).toBe(
      "Authorization: ***\n",
    );
    expect(sanitizeGitStderrForDiagnosticLog("Proxy-Authorization: Basic dXNlcjpwYXNz")).toBe(
      "Proxy-Authorization: ***",
    );
  });

  it("redacts a username-only token URL but keeps a plain ssh user", () => {
    expect(
      sanitizeGitStderrForDiagnosticLog("fatal: unable to access 'https://ghp_SECRET@github.com/o/r.git/'"),
    ).toBe("fatal: unable to access '***/github.com/o/r.git/'");
    expect(sanitizeGitStderrForDiagnosticLog("ssh://git@github.com/o/r.git")).toBe(
      "ssh://git@github.com/o/r.git",
    );
    expect(sanitizeGitStderrForDiagnosticLog("ssh://user:pw@host/r.git")).toBe("***/host/r.git");
  });

  it("redacts prefixed token keys in query strings parameter by parameter", () => {
    expect(
      sanitizeGitStderrForDiagnosticLog("GET https://h/x?access_token=SECRET&page=2&private_token=SEC2"),
    ).toBe("GET https://h/x?access_token=***&page=2&private_token=***");
    expect(sanitizeGitStderrForDiagnosticLog("client_secret=abc tokens: 3")).toBe(
      "client_secret=*** tokens: 3",
    );
  });
});
