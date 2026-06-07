export interface DiskFingerprint {
  mtimeMs: number;
  sizeBytes: number;
}

export interface DocumentIdentity {
  id: string;
  filePath: string | null;
}

export type MarkdownViewMode = "edit" | "split" | "preview";

export type DocumentContentKind = "text" | "image" | "binary" | "large_pending";

export interface DocumentState extends DocumentIdentity {
  title: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
  contentKind: DocumentContentKind;
  language: string;
  encoding: "utf-8";
  lineEnding: "lf" | "crlf";
  diskFingerprint: DiskFingerprint | null;
  dismissedFingerprint: DiskFingerprint | null;
  fileMissing: boolean;
  scrollTop: number;
  markdownViewMode: MarkdownViewMode;
}

export interface FileTabState {
  id: string;
  kind: "file";
  documentId: string;
  pinned: boolean;
}

export interface AgentTabState {
  id: string;
  kind: "agent";
  agentId: string;
  pinned: boolean;
}

export type TabState = FileTabState | AgentTabState;

export function isFileTab(tab: TabState): tab is FileTabState {
  return tab.kind === "file";
}

export function isAgentTab(tab: TabState): tab is AgentTabState {
  return tab.kind === "agent";
}

export function createFileTab(id: string, documentId: string, pinned = false): FileTabState {
  return { id, kind: "file", documentId, pinned };
}

export function createAgentTab(id: string, agentId: string, pinned = false): AgentTabState {
  return { id, kind: "agent", agentId, pinned };
}

/** Restores legacy session tabs that omit `kind`. */
export function normalizeTabState(
  tab: TabState | (Omit<FileTabState, "kind"> & { kind?: unknown; agentId?: unknown }),
): TabState {
  if (tab.kind === "agent" && typeof tab.agentId === "string") {
    return {
      id: tab.id,
      kind: "agent",
      agentId: tab.agentId,
      pinned: tab.pinned ?? false,
    };
  }
  if ("documentId" in tab && typeof tab.documentId === "string") {
    return createFileTab(tab.id, tab.documentId, tab.pinned ?? false);
  }
  throw new Error(`Invalid tab state: ${tab.id}`);
}

export function tabDocumentId(
  tab: TabState | (Omit<FileTabState, "kind"> & { kind?: unknown; agentId?: unknown }) | undefined,
): string | null {
  if (!tab) {
    return null;
  }
  const normalized = normalizeTabState(tab);
  return isFileTab(normalized) ? normalized.documentId : null;
}
