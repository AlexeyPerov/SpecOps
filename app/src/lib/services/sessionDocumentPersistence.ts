import type { ContextSnapshot, DocumentState, WindowSessionSnapshot } from "../domain/contracts";
import { isImageFilePath } from "./fileContentKind";
import { openPath } from "./fileSystem";
import { documentWithOpenedFilePayload } from "../state/appState/documentHelpers";

export function shouldStripDocumentContentForSession(doc: DocumentState): boolean {
  if (doc.contentKind === "image" || doc.contentKind === "binary") {
    return true;
  }
  if (doc.filePath && isImageFilePath(doc.filePath) && doc.content.length > 0) {
    return true;
  }
  return false;
}

export function documentForSessionPersistence(doc: DocumentState): DocumentState {
  if (!shouldStripDocumentContentForSession(doc)) {
    return doc;
  }
  const contentKind =
    doc.contentKind === "image" || doc.contentKind === "binary"
      ? doc.contentKind
      : doc.filePath && isImageFilePath(doc.filePath)
        ? "image"
        : doc.contentKind;
  return {
    ...doc,
    content: "",
    savedContent: "",
    isDirty: false,
    contentKind,
  };
}

function stripContextSnapshot(context: ContextSnapshot): ContextSnapshot {
  return {
    ...context,
    documents: context.documents.map(documentForSessionPersistence),
  };
}

export function stripWindowSnapshotForSession(
  snapshot: WindowSessionSnapshot,
): WindowSessionSnapshot {
  return {
    ...snapshot,
    notepad: stripContextSnapshot(snapshot.notepad),
    chatHttp: stripContextSnapshot(snapshot.chatHttp ?? snapshot.notepad),
    workspaces: snapshot.workspaces.map((workspace) => ({
      ...workspace,
      snapshot: stripContextSnapshot(workspace.snapshot),
    })),
  };
}

export function needsDocumentRefreshFromDisk(doc: DocumentState): boolean {
  if (!doc.filePath) {
    return false;
  }
  if (doc.contentKind === "image" || doc.contentKind === "binary") {
    return true;
  }
  if (isImageFilePath(doc.filePath)) {
    return true;
  }
  if (doc.content.includes("\0")) {
    return true;
  }
  return false;
}

function inferredContentKindWhenDiskUnavailable(
  filePath: string,
  doc: DocumentState,
): DocumentState["contentKind"] {
  if (doc.contentKind === "image" || doc.contentKind === "binary") {
    return doc.contentKind;
  }
  if (isImageFilePath(filePath)) {
    return "image";
  }
  return "binary";
}

export async function refreshDocumentFromDiskIfNeeded(
  documentState: DocumentState,
  isFileMissingError: (error: unknown) => boolean,
): Promise<DocumentState> {
  if (!needsDocumentRefreshFromDisk(documentState)) {
    return documentState;
  }
  const filePath = documentState.filePath!;
  try {
    const opened = await openPath(filePath);
    return documentWithOpenedFilePayload(
      { ...documentState, fileMissing: false },
      opened.path,
      opened.content,
      opened.contentKind,
    );
  } catch (error: unknown) {
    if (isFileMissingError(error)) {
      return { ...documentState, fileMissing: true };
    }
    const kind = inferredContentKindWhenDiskUnavailable(filePath, documentState);
    if (kind !== "text") {
      return documentWithOpenedFilePayload(documentState, filePath, "", kind);
    }
    return documentState;
  }
}
