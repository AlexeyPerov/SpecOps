import { appState } from "../state/appState";
import { findDocumentContext } from "../state/appState/contextHelpers";
import { renameFile } from "./fileSystem";
import { renameOpenFileRegistry } from "./openFileRegistry";
import { statDiskFingerprint } from "./diskFingerprint";
import type { ContextId } from "../domain/contracts";

export async function renameDocumentOnDisk(
  documentId: string,
  options: { windowId: string; notify: (message: string) => void },
): Promise<void> {
  // Resolve the owning context *before* the native rename dialog await. The
  // dialog can take arbitrarily long, and if the user switches workspace
  // meanwhile, the active-context mutators (renameDocument / setDocumentDiskState)
  // would land in the wrong context or no-op, leaving the tab pointing at the
  // old path. Capturing contextId here and using the context-aware variants
  // keeps the rename attributable to the right workspace regardless of focus.
  const owner = findDocumentContext(appState.getSnapshot(), documentId);
  const filePath = owner?.document.filePath;
  if (!filePath) {
    options.notify("Save document before renaming.");
    return;
  }
  const contextId: ContextId = owner.contextId;
  const doc = owner.document;

  const renamedPath = await renameFile(filePath);
  if (!renamedPath) {
    return;
  }
  const title = renamedPath.replaceAll("\\", "/").split("/").pop() ?? renamedPath;
  appState.renameDocumentInContext(contextId, doc.id, renamedPath, title);
  await renameOpenFileRegistry(filePath, renamedPath, options.windowId, doc.id);
  try {
    const fingerprint = await statDiskFingerprint(renamedPath);
    appState.setDocumentDiskStateForContext(contextId, doc.id, {
      diskFingerprint: fingerprint,
      fileMissing: false,
    });
  } catch {
    appState.setDocumentDiskStateForContext(contextId, doc.id, {
      diskFingerprint: null,
      fileMissing: true,
    });
  }
  options.notify(`Renamed to ${title}`);
}
