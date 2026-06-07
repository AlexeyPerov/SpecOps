import { marked } from "marked";
import type { DocumentState } from "../domain/contracts";
import { normalizePathSync } from "./diskFingerprint";
import { formatStatusPath } from "./appShellHelpers";
import { DEFAULT_UNTITLED_TITLE } from "./untitledTitle";

export interface AppShellDocumentView {
  isImageDocument: boolean;
  isBinaryDocument: boolean;
  isLargePendingDocument: boolean;
  isTextEditorDocument: boolean;
  previewFileSizeBytes: number;
  isMarkdownDocument: boolean;
  markdownHtml: string;
  statusPath: string;
  activeDocumentPath: string | null;
}

export function deriveAppShellDocumentView(
  activeDocument: DocumentState | undefined,
): AppShellDocumentView {
  const isImageDocument = activeDocument?.contentKind === "image";
  const isBinaryDocument = activeDocument?.contentKind === "binary";
  const isLargePendingDocument = activeDocument?.contentKind === "large_pending";
  const isTextEditorDocument =
    !isImageDocument &&
    !isBinaryDocument &&
    !isLargePendingDocument &&
    activeDocument !== undefined;
  const previewFileSizeBytes = activeDocument?.diskFingerprint?.sizeBytes ?? 0;
  const isMarkdownDocument = isTextEditorDocument && activeDocument?.language === "markdown";
  const markdownHtml =
    isMarkdownDocument && activeDocument ? (marked.parse(activeDocument.content) as string) : "";
  const statusPath = formatStatusPath(
    activeDocument?.filePath ?? null,
    activeDocument?.title,
    DEFAULT_UNTITLED_TITLE,
  );
  const activeDocumentPath = activeDocument?.filePath
    ? normalizePathSync(activeDocument.filePath)
    : null;

  return {
    isImageDocument,
    isBinaryDocument,
    isLargePendingDocument,
    isTextEditorDocument,
    previewFileSizeBytes,
    isMarkdownDocument,
    markdownHtml,
    statusPath,
    activeDocumentPath,
  };
}
