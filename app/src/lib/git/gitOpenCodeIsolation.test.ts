import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const OPEN_CODE_MODULE = ["open", "code"].join("");

const FORBIDDEN_IMPORT_PATTERNS = [
  new RegExp(`from\\s+["'][^"']*${OPEN_CODE_MODULE}[^"']*["']`, "i"),
  /from\s+["'][^"']*workspaceAgentBackend[^"']*["']/i,
  /from\s+["'][^"']*fileStatusTracker[^"']*["']/i,
  new RegExp(`import\\s*\\(\\s*["'][^"']*${OPEN_CODE_MODULE}[^"']*["']`, "i"),
];

function collectSourceFiles(rootDir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(rootDir)) {
    const path = join(rootDir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (entry === "fixtures" || entry === "test") {
        continue;
      }
      files.push(...collectSourceFiles(path));
      continue;
    }

    if (/\.(ts|svelte)$/.test(entry) && !/\.test\.(ts|svelte)$/.test(entry)) {
      files.push(path);
    }
  }

  return files;
}

function assertNoForbiddenImports(label: string, files: string[]): void {
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      expect(content, `${label}: ${file} must not import OpenCode modules`).not.toMatch(pattern);
    }
  }
}

describe("OpenCode isolation (version control module)", () => {
  const gitDir = dirname(fileURLToPath(import.meta.url));
  const componentsDir = join(gitDir, "../components");

  it("app/src/lib/git/** has no OpenCode imports", () => {
    assertNoForbiddenImports("git module", collectSourceFiles(gitDir));
  });

  it("Version Control UI components have no OpenCode imports", () => {
    const vcFiles = [
      join(componentsDir, "VersionControlView.svelte"),
      ...readdirSync(componentsDir)
        .filter((name) => name.startsWith("Git") && name.endsWith(".svelte"))
        .map((name) => join(componentsDir, name)),
    ];

    assertNoForbiddenImports("version control UI", vcFiles);
  });
});
