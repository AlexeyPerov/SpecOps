import { describe, expect, it } from "vitest";
import { gitInstallHint } from "./gitInstallHints";
import { mockNavigatorPlatform } from "../test/helpers";

describe("gitInstallHint", () => {
  it("returns macOS install guidance on Mac", () => {
    const restore = mockNavigatorPlatform("MacIntel");
    try {
      const hint = gitInstallHint();
      expect(hint.title).toBe("Git not found");
      expect(hint.installUrl).toBe("https://git-scm.com/download/mac");
      expect(hint.installLinkLabel).toContain("macOS");
    } finally {
      restore();
    }
  });

  it("returns Windows install guidance on Windows", () => {
    const restore = mockNavigatorPlatform("Win32");
    try {
      const hint = gitInstallHint();
      expect(hint.installUrl).toBe("https://git-scm.com/download/win");
      expect(hint.installLinkLabel).toContain("Windows");
    } finally {
      restore();
    }
  });

  it("returns generic install guidance on other platforms", () => {
    const restore = mockNavigatorPlatform("Linux x86_64");
    try {
      const hint = gitInstallHint();
      expect(hint.installUrl).toBe("https://git-scm.com/downloads");
      expect(hint.installLinkLabel).toBe("Download Git");
    } finally {
      restore();
    }
  });
});
