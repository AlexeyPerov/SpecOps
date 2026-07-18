/**
 * Generation-aware binding for markdown outline publishes.
 * Callers must ignore host snapshots whose identity no longer matches the
 * active pane/document generation (rapid tab switches).
 */
import type { EditorHostIdentity } from "../types/editor";

export function outlineHostBindingsEqual(
  a: EditorHostIdentity | null | undefined,
  b: EditorHostIdentity | null | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  return (
    a.contextId === b.contextId &&
    a.paneId === b.paneId &&
    a.documentId === b.documentId &&
    a.generation === b.generation
  );
}

/**
 * True when a snapshot captured from `hostIdentity` may still be published
 * against the currently expected active binding.
 */
export function shouldPublishOutlineSnapshot(
  expected: EditorHostIdentity | null | undefined,
  hostIdentity: EditorHostIdentity | null | undefined,
): boolean {
  return outlineHostBindingsEqual(expected, hostIdentity);
}

/**
 * Resolve the binding the outline should track for the active editor host.
 * Returns null when there is no host or the host document does not match the
 * pane's selected document (stale workbench entry during tab switch).
 */
export function resolveOutlineHostBinding(
  hostIdentity: EditorHostIdentity | null | undefined,
  activeDocumentId: string | null,
  activePaneId: string,
): EditorHostIdentity | null {
  if (!hostIdentity) {
    return null;
  }
  if (hostIdentity.paneId !== activePaneId) {
    return null;
  }
  if (hostIdentity.documentId !== activeDocumentId) {
    return null;
  }
  return hostIdentity;
}
