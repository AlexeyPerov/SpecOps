import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe } from "vitest";

let gitAvailable: boolean | null = null;

/** Whether `git` is on PATH and responds to `--version`. */
export function isGitInstalled(): boolean {
  if (gitAvailable !== null) {
    return gitAvailable;
  }

  try {
    const result = spawnSync("git", ["--version"], { encoding: "utf8" });
    gitAvailable = result.status === 0;
  } catch {
    gitAvailable = false;
  }

  return gitAvailable;
}

/**
 * Vitest helper: run the suite when git is installed; otherwise register a skipped suite.
 *
 * CI environments without git should skip integration tests rather than fail the job.
 */
export function describeIfGitInstalled(name: string, fn: () => void): void {
  if (isGitInstalled()) {
    describe(name, fn);
  } else {
    describe.skip(`${name} (skipped: git not installed)`, fn);
  }
}

export interface TempGitRepo {
  dir: string;
  run(args: string[], options?: { encoding?: BufferEncoding }): string | Buffer;
  writeFile(relativePath: string, contents: string): void;
  cleanup(): void;
}

function runGitInRepo(
  cwd: string,
  args: string[],
  encoding: BufferEncoding = "utf8",
): string | Buffer {
  return execFileSync("git", args, { cwd, encoding, stdio: "pipe" });
}

/** Create an initialized temp repo with local user.name/email configured. */
export function createTempGitRepo(prefix = "specops-git-"): TempGitRepo {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  runGitInRepo(dir, ["init"]);
  runGitInRepo(dir, ["config", "user.email", "test@example.com"]);
  runGitInRepo(dir, ["config", "user.name", "Test User"]);

  return {
    dir,
    run(args, options) {
      return runGitInRepo(dir, args, options?.encoding ?? "utf8");
    },
    writeFile(relativePath, contents) {
      writeFileSync(join(dir, relativePath), contents);
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Run a callback against a temp repo and always clean up afterward. */
export function withTempGitRepo<T>(prefix: string, fn: (repo: TempGitRepo) => T): T {
  const repo = createTempGitRepo(prefix);
  try {
    return fn(repo);
  } finally {
    repo.cleanup();
  }
}
