import { appState } from "../state/appState";
import {
  findDocumentByNormalizedPathAllContexts,
} from "../state/appState/contextHelpers";
import { normalizePathSync } from "./diskFingerprint";

/**
 * Decision returned before running a project-wide Replace All on a single file
 * path. Dirty open buffers are skipped so on-disk replace never silently
 * clobbers unsaved edits.
 */
export type ReplaceAllFileDecision =
  | { kind: "proceed" }
  | { kind: "skip-dirty"; contextId: string; documentId: string };

/**
 * Inspect any open document for `filePath` across all contexts and decide
 * whether Replace All may overwrite that file on disk. When the document is
 * open and dirty the replace is skipped (the user keeps their local edits).
 */
export function decideReplaceAllForPath(filePath: string): ReplaceAllFileDecision {
  const normalized = normalizePathSync(filePath);
  const match = findDocumentByNormalizedPathAllContexts(appState.getSnapshot(), normalized);
  if (match && match.document.isDirty) {
    return { kind: "skip-dirty", contextId: match.contextId, documentId: match.documentId };
  }
  return { kind: "proceed" };
}

/**
 * After a clean on-disk replace, refresh any open document for that path so
 * the buffer picks up the new content (instead of becoming a stale, now-dirty
 * copy) and the post-write disk fingerprint is recorded. Uses the
 * context-aware APIs because the document may live in a workspace that is not
 * the active context.
 */
export function syncOpenDocumentAfterReplace(
  filePath: string,
  content: string,
  fingerprint: { mtimeMs: number; sizeBytes: number },
): void {
  const normalized = normalizePathSync(filePath);
  const match = findDocumentByNormalizedPathAllContexts(appState.getSnapshot(), normalized);
  if (!match) {
    return;
  }
  appState.applyDocumentDiskReloadForContext(
    match.contextId,
    match.documentId,
    content,
    fingerprint,
  );
}
