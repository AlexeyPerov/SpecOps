/**
 * Narrow notification seam for document disk reloads → session cache invalidation.
 * Listeners are registered by the route that owns the session cache.
 */
type DocumentReloadListener = (documentId: string, contextId: string | null) => void;

const listeners = new Set<DocumentReloadListener>();

export function subscribeDocumentDiskReload(
  listener: DocumentReloadListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Notify that a document was reloaded from disk.
 *
 * `contextId` namespaces the invalidation: document ids are only unique within a
 * context, so with several contexts mounted at once (active + parked) a reload
 * in one workspace must not wipe another workspace's cached editor session for
 * the same id. Pass `null` only for legacy callers that cannot resolve the
 * context, in which case every context is invalidated (the old behavior).
 */
export function notifyDocumentDiskReload(
  documentId: string,
  contextId: string | null,
): void {
  if (!documentId) {
    return;
  }
  for (const listener of listeners) {
    listener(documentId, contextId);
  }
}
