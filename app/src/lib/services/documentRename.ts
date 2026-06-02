import { appState } from "../state/appState";
import { renameFile } from "./fileSystem";
import { renameOpenFileRegistry } from "./openFileRegistry";
import { statDiskFingerprint } from "./diskFingerprint";

export async function renameDocumentOnDisk(
  documentId: string,
  options: { windowId: string; notify: (message: string) => void },
): Promise<void> {
  const doc = appState.getActiveDocuments().find((document) => document.id === documentId);
  if (!doc?.filePath) {
    options.notify("Save document before renaming.");
    return;
  }
  const renamedPath = await renameFile(doc.filePath);
  if (!renamedPath) {
    return;
  }
  const title = renamedPath.replaceAll("\\", "/").split("/").pop() ?? renamedPath;
  appState.renameDocument(doc.id, renamedPath, title);
  await renameOpenFileRegistry(doc.filePath, renamedPath, options.windowId, doc.id);
  try {
    const fingerprint = await statDiskFingerprint(renamedPath);
    appState.setDocumentDiskState(doc.id, { diskFingerprint: fingerprint, fileMissing: false });
  } catch {
    appState.setDocumentDiskState(doc.id, { diskFingerprint: null, fileMissing: true });
  }
  options.notify(`Renamed to ${title}`);
}
