import type { PreGitAutosaveFailure } from "./preGitAutosave";

export type PreGitAutosavePromptChoice =
  | { type: "cancel" }
  | { type: "continue-anyway" };

export interface PreGitAutosavePromptRequest {
  failures: PreGitAutosaveFailure[];
}

type PreGitAutosavePromptRunner = (
  request: PreGitAutosavePromptRequest,
) => Promise<PreGitAutosavePromptChoice | null>;

let runner: PreGitAutosavePromptRunner | null = null;

export function registerPreGitAutosavePromptRunner(next: PreGitAutosavePromptRunner | null): void {
  runner = next;
}

export function promptPreGitAutosaveFailures(
  request: PreGitAutosavePromptRequest,
): Promise<PreGitAutosavePromptChoice | null> {
  if (!runner) {
    return Promise.resolve(null);
  }
  return runner(request);
}

/** Short-form labels for failed autosave rows (title, then file name). */
export function formatPreGitAutosaveFailureLabels(
  failures: PreGitAutosaveFailure[],
  maxListed = 3,
): string[] {
  const labels = failures.map((failure) => {
    if (failure.filePath) {
      const normalized = failure.filePath.replaceAll("\\", "/");
      const parts = normalized.split("/").filter(Boolean);
      const fileName = parts[parts.length - 1] ?? failure.title;
      return failure.title === fileName ? fileName : `${failure.title} (${fileName})`;
    }
    return failure.title;
  });

  if (labels.length <= maxListed) {
    return labels;
  }

  const listed = labels.slice(0, maxListed);
  listed.push(`+ ${labels.length - maxListed} more`);
  return listed;
}
