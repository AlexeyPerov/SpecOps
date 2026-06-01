import type { DocumentState } from "../domain/contracts";
import { deriveUntitledTitle } from "./untitledTitle";

export function isUnsavedDocument(documentState: DocumentState): boolean {
  return documentState.filePath === null;
}

export function isEmptyUnsavedDocument(documentState: DocumentState): boolean {
  return (
    documentState.filePath === null &&
    documentState.content === "" &&
    documentState.savedContent === ""
  );
}

export function emptyUnsavedDocumentTitle(): string {
  return deriveUntitledTitle("");
}
