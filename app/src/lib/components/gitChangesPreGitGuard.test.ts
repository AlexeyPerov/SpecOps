import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKING_TREE_MUTATION_HANDLERS = [
  "handleStageSelected",
  "handleStageAll",
  "handleUnstageSelected",
  "handleCommit",
] as const;

describe("FIX-01 GitChangesPanel pre-git guard call sites", () => {
  const panelSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "GitChangesPanel.svelte"),
    "utf8",
  );

  it("imports prepareWorkspaceForGitOperation", () => {
    expect(panelSource).toContain('from "../services/preGitOperationGuard"');
    expect(panelSource).toContain("prepareWorkspaceForGitOperation");
  });

  it("accepts workspaceRootPath and preGitSaveDeps props", () => {
    expect(panelSource).toContain("workspaceRootPath: string");
    expect(panelSource).toContain("preGitSaveDeps?: SaveDocumentDeps | null");
  });

  it.each(WORKING_TREE_MUTATION_HANDLERS)(
    "invokes the guard and aborts when canProceed is false in %s",
    (handler) => {
      const fnStart = panelSource.indexOf(`async function ${handler}`);
      expect(fnStart, `${handler} should exist`).toBeGreaterThan(-1);

      const fnBody = panelSource.slice(fnStart, fnStart + 900);
      expect(fnBody).toContain("prepareWorkspaceForGitOperation(workspaceRootPath");
      expect(fnBody).toContain("deps: preGitSaveDeps");
      expect(fnBody).toMatch(/if \(!canProceed\)\s*\{\s*return;\s*\}/);
    },
  );
});
