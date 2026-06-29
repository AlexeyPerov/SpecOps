import { readTextFile } from "@tauri-apps/plugin-fs";
import type { DocumentState, TabState, WindowSessionSnapshot } from "../domain/contracts";
import {
  createFileTab,
  getSessionSelectedTabId,
  getSessionTabs,
  isFileTab,
  isSessionTab,
  isViewTab,
  layoutFromFlatTabs,
  normalizeTabState,
  setActivePaneTabs,
} from "../domain/contracts";
import { appState } from "../state/appState";
import { getErrorMessage } from "../commands/commandErrors";
import { emptyUnsavedDocumentTitle } from "./untitledDocument";
import { normalizeSessionState } from "./workspaceAgentSession";
import {
  applyLargeFileConfirmGateOnRestore,
  refreshDocumentFromDiskIfNeeded,
} from "./sessionDocumentPersistence";
import { normalizeRestoredDocument } from "./sessionSnapshotCodec";

function buildFallbackDocument(documentId: string): DocumentState {
  return {
    id: documentId,
    filePath: null,
    title: emptyUnsavedDocumentTitle(),
    content: "",
    savedContent: "",
    isDirty: false,
    contentKind: "text",
    language: "plaintext",
    encoding: "utf-8",
    lineEnding: "lf",
    diskFingerprint: null,
    dismissedFingerprint: null,
    fileMissing: false,
    scrollTop: 0,
    markdownViewMode: "edit",
  };
}

export function nextNumericId(prefix: "doc" | "tab", ids: string[]): string {
  let max = 0;
  for (const id of ids) {
    const value = Number(id.replace(`${prefix}-`, ""));
    if (Number.isFinite(value) && value > 0) {
      max = Math.max(max, value);
    }
  }
  return `${prefix}-${Math.max(1, max + 1)}`;
}

function isFileMissingError(error: unknown): boolean {
  const message = getErrorMessage(error, String(error));
  const lower = message.toLowerCase();
  return (
    lower.includes("no such file") ||
    lower.includes("not found") ||
    lower.includes("os error 2") ||
    lower.includes("cannot find the path")
  );
}

async function fileStillExists(path: string): Promise<boolean> {
  try {
    await readTextFile(path);
    return true;
  } catch (error: unknown) {
    if (isFileMissingError(error)) {
      return false;
    }
    return true;
  }
}

async function sanitizeContext(
  context: WindowSessionSnapshot["notepad"],
): Promise<WindowSessionSnapshot["notepad"]> {
  const documentsById = new Map(
    await Promise.all(
      context.documents.map(async (documentState) => {
        const normalized = normalizeRestoredDocument(documentState);
        const maxOpenWithoutConfirmBytes =
          appState.getSnapshot().settings.externalFiles.maxOpenWithoutConfirmBytes;
        const gated = await applyLargeFileConfirmGateOnRestore(
          normalized,
          maxOpenWithoutConfirmBytes,
          isFileMissingError,
        );
        const refreshed = await refreshDocumentFromDiskIfNeeded(
          gated,
          isFileMissingError,
        );
        return [documentState.id, refreshed] as const;
      }),
    ),
  );

  // Re-seed legacy flat-list snapshots (pre-split-view) into a single-pane
  // editor layout. No persisted migration (AGENTS.md); the restore path handles
  // the old shape on read. New snapshots already carry `editorLayout`.
  const incomingTabs = readIncomingTabs(context);
  const incomingSelectedTabId = readIncomingSelectedTabId(context);

  const openTabs: TabState[] = [];
  for (const rawTab of incomingTabs) {
    const tab = normalizeTabState(rawTab);
    if (isSessionTab(tab)) {
      openTabs.push(tab);
      continue;
    }
    // View tabs (Settings/Themes) are ephemeral and never restored.
    if (isViewTab(tab)) {
      continue;
    }
    const linkedDocument = documentsById.get(tab.documentId);
    if (!linkedDocument) {
      continue;
    }
    if (linkedDocument.filePath) {
      const exists = await fileStillExists(linkedDocument.filePath);
      if (!exists) {
        documentsById.set(tab.documentId, {
          ...linkedDocument,
          fileMissing: true,
        });
      }
    }
    openTabs.push(tab);
  }

  if (openTabs.length === 0) {
    const docId = nextNumericId(
      "doc",
      context.documents.map((documentState) => documentState.id),
    );
    const tabId = nextNumericId("tab", incomingTabs.map((tab) => tab.id));
    const fallbackDocument = buildFallbackDocument(docId);
    return {
      documents: [fallbackDocument],
      session: normalizeSessionState({
        ...context.session,
        editorLayout: layoutFromFlatTabs([createFileTab(tabId, docId)], tabId),
        windowBounds: context.session.windowBounds ?? null,
      }),
    };
  }

  const referencedDocIds = new Set(
    openTabs.filter(isFileTab).map((tab) => tab.documentId),
  );
  const documents = [...documentsById.values()].filter((documentState) =>
    referencedDocIds.has(documentState.id),
  );
  const selectedTabId = openTabs.some((tab) => tab.id === incomingSelectedTabId)
    ? incomingSelectedTabId
    : openTabs[0]?.id ?? null;

  return {
    documents,
    session: normalizeSessionState({
      ...context.session,
      editorLayout: layoutFromFlatTabs(openTabs, selectedTabId),
      windowBounds: context.session.windowBounds ?? null,
    }),
  };
}

/**
 * Read the open tabs from a (possibly legacy) restored context. New snapshots
 * carry `editorLayout`; pre-split-view snapshots carried a flat `openTabs` list.
 */
function readIncomingTabs(context: WindowSessionSnapshot["notepad"]): TabState[] {
  const session = context.session as unknown as Record<string, unknown>;
  if (session.editorLayout && typeof session.editorLayout === "object") {
    // New shape: flatten all panes' tabs in reading order.
    const layout = session.editorLayout as {
      panes?: { tabs?: TabState[] }[];
      slots?: number[][];
    };
    if (Array.isArray(layout.panes)) {
      const ordered: TabState[] = [];
      const seen = new Set<number>();
      for (const row of layout.slots ?? []) {
        for (const paneIndex of row) {
          if (seen.has(paneIndex)) {
            continue;
          }
          seen.add(paneIndex);
          const pane = layout.panes[paneIndex];
          if (pane?.tabs) {
            ordered.push(...pane.tabs);
          }
        }
      }
      for (let i = 0; i < layout.panes.length; i += 1) {
        if (!seen.has(i)) {
          const pane = layout.panes[i];
          if (pane?.tabs) {
            ordered.push(...pane.tabs);
          }
        }
      }
      return ordered;
    }
  }
  if (Array.isArray(session.openTabs)) {
    return session.openTabs as TabState[];
  }
  return [];
}

function readIncomingSelectedTabId(context: WindowSessionSnapshot["notepad"]): string | null {
  const session = context.session as unknown as Record<string, unknown>;
  if (session.editorLayout && typeof session.editorLayout === "object") {
    const layout = session.editorLayout as {
      panes?: { selectedTabId?: string | null; id?: string }[];
      activePaneId?: string;
    };
    const activeId = layout.activePaneId;
    const activePane = layout.panes?.find((pane) => pane.id === activeId);
    if (activePane && typeof activePane.selectedTabId === "string") {
      return activePane.selectedTabId;
    }
    const firstPane = layout.panes?.[0];
    if (firstPane && typeof firstPane.selectedTabId === "string") {
      return firstPane.selectedTabId;
    }
    return null;
  }
  if (typeof session.selectedTabId === "string") {
    return session.selectedTabId;
  }
  return null;
}

export async function sanitizeWindowSnapshot(
  snapshot: WindowSessionSnapshot,
): Promise<WindowSessionSnapshot> {
  const notepad = await sanitizeContext(snapshot.notepad);
  const chatHttp = await sanitizeContext(snapshot.chatHttp ?? snapshot.notepad);
  const workspaces = [];
  for (const workspace of snapshot.workspaces) {
    workspaces.push({
      ...workspace,
      snapshot: await sanitizeContext(workspace.snapshot),
    });
  }
  const activeContextId =
    snapshot.activeContextId === "notepad" ||
    snapshot.activeContextId === "chat-http" ||
    workspaces.some((workspace) => workspace.id === snapshot.activeContextId)
      ? snapshot.activeContextId
      : "notepad";

  return {
    ...snapshot,
    activeContextId,
    notepad,
    chatHttp,
    workspaces,
  };
}
