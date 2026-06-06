import { normalizePathSync } from "./diskFingerprint";
import { openActivePath, type OpenActivePathResult } from "./openActivePath";
import { appState } from "../state/appState";
import { readOpenFileRegistry } from "./openFileRegistry";

export const FOLDER_OPEN_MAX_FILES = 20;

export interface OpenAllInFolderSummary {
  opened: number;
  skippedExisting: number;
  skippedTooLarge: number;
  skippedFailed: number;
  focusedExisting: boolean;
}

async function isPathOpenAnywhere(path: string): Promise<boolean> {
  if (appState.findDocumentIdByPath(path) !== null) {
    return true;
  }
  const registry = await readOpenFileRegistry();
  return registry[normalizePathSync(path)] !== undefined;
}

function countResultKind(
  result: OpenActivePathResult,
  summary: OpenAllInFolderSummary,
): "opened" | "existing" | "other" {
  switch (result.kind) {
    case "opened":
      summary.opened += 1;
      return "opened";
    case "existing":
    case "redirected":
      summary.skippedExisting += 1;
      return "existing";
    case "pending_confirm":
      summary.opened += 1;
      return "opened";
    case "missing":
    case "failed":
      summary.skippedFailed += 1;
      return "other";
    default:
      summary.skippedFailed += 1;
      return "other";
  }
}

export function formatOpenAllInFolderSummary(summary: OpenAllInFolderSummary): string {
  if (
    summary.opened === 0 &&
    summary.skippedExisting > 0 &&
    summary.skippedTooLarge === 0 &&
    summary.skippedFailed === 0
  ) {
    return summary.focusedExisting
      ? `All ${summary.skippedExisting} file(s) were already open.`
      : `All ${summary.skippedExisting} file(s) were already open.`;
  }

  const parts: string[] = [];
  if (summary.opened > 0) {
    parts.push(`Opened ${summary.opened} file(s)`);
  }
  if (summary.skippedExisting > 0) {
    parts.push(`skipped ${summary.skippedExisting} already open`);
  }
  if (summary.skippedTooLarge > 0) {
    parts.push(`skipped ${summary.skippedTooLarge} too large`);
  }
  if (summary.skippedFailed > 0) {
    parts.push(`skipped ${summary.skippedFailed} unreadable`);
  }

  if (parts.length === 0) {
    return "No files were opened.";
  }

  return `${parts[0]}${parts.length > 1 ? ` (${parts.slice(1).join(", ")})` : ""}.`;
}

export async function openAllInFolder(
  paths: string[],
  windowId: string,
): Promise<OpenAllInFolderSummary> {
  const summary: OpenAllInFolderSummary = {
    opened: 0,
    skippedExisting: 0,
    skippedTooLarge: 0,
    skippedFailed: 0,
    focusedExisting: false,
  };

  let firstExistingPath: string | null = null;

  for (const path of paths) {
    const alreadyOpen = await isPathOpenAnywhere(path);
    if (alreadyOpen) {
      if (summary.opened > 0) {
        summary.skippedExisting += 1;
        continue;
      }
      if (!firstExistingPath) {
        firstExistingPath = path;
      }
      summary.skippedExisting += 1;
      continue;
    }

    const result = await openActivePath(path, windowId);
    countResultKind(result, summary);
  }

  if (summary.opened === 0 && firstExistingPath) {
    const result = await openActivePath(firstExistingPath, windowId);
    if (result.kind === "existing" || result.kind === "redirected" || result.kind === "opened") {
      summary.focusedExisting = true;
    }
  }

  return summary;
}
