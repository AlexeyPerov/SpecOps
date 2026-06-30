import { readTextFile } from "@tauri-apps/plugin-fs";
import type {
  DocumentState,
  EditorLayout,
  EditorPane,
  FileTabState,
  TabState,
  WindowSessionSnapshot,
} from "../domain/contracts";
import {
  allTabs,
  createFileTab,
  isFileTab,
  isSessionTab,
  isViewTab,
  layoutFromFlatTabs,
  nextPaneId,
  normalizeTabState,
  restructureEditorLayout,
  totalTabCount,
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

  // Restore the editor layout, preserving multi-pane structure. New snapshots
  // carry an `editorLayout`; pre-split-view snapshots carried a flat
  // `openTabs` list which is re-seeded into a single pane (no persisted
  // migration — AGENTS.md; the restore path re-shapes on read).
  const incomingLayout = readIncomingLayout(context);

  // File tabs whose document has gone missing on disk are kept (and flagged
  // `fileMissing`), but file tabs whose document isn't in the snapshot at all
  // are pruned. View tabs (Settings/Themes) are ephemeral and never restored.
  const retainTab = (tab: TabState): boolean => {
    if (isSessionTab(tab)) {
      return true;
    }
    if (isViewTab(tab)) {
      return false;
    }
    return isFileTab(tab) && documentsById.has(tab.documentId);
  };

  if (incomingLayout) {
    // Normalize each tab (legacy kind/shape) before pruning so the predicate
    // and downstream consumers see well-formed entries.
    const normalizedLayout: EditorLayout = {
      ...incomingLayout,
      panes: incomingLayout.panes.map((pane) => normalizePane(pane)),
    };

    // Flag file-missing documents for retained file tabs before pruning, so the
    // in-memory document map reflects on-disk state.
    for (const tab of allTabs(normalizedLayout)) {
      if (!isFileTab(tab)) {
        continue;
      }
      const linkedDocument = documentsById.get(tab.documentId);
      if (linkedDocument?.filePath) {
        const exists = await fileStillExists(linkedDocument.filePath);
        if (!exists) {
          documentsById.set(tab.documentId, { ...linkedDocument, fileMissing: true });
        }
      }
    }

    const pruned = restructureEditorLayout(normalizedLayout, retainTab);

    if (totalTabCount(pruned) > 0) {
      const referencedDocIds = new Set(
        allTabs(pruned).filter(isFileTab).map((tab) => (tab as FileTabState).documentId),
      );
      const documents = [...documentsById.values()].filter((documentState) =>
        referencedDocIds.has(documentState.id),
      );
      return {
        documents,
        session: normalizeSessionState({
          ...context.session,
          editorLayout: pruned,
          windowBounds: context.session.windowBounds ?? null,
        }),
      };
    }
    // Every tab was pruned — fall through to the fallback-document path.
    return buildFallbackContext(context, normalizedLayout);
  }

  // Legacy flat-list shape: re-seed into a single pane.
  const incomingTabs = readIncomingTabs(context);
  const openTabs: TabState[] = [];
  for (const rawTab of incomingTabs) {
    const tab = normalizeTabState(rawTab);
    if (isSessionTab(tab)) {
      openTabs.push(tab);
      continue;
    }
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
        documentsById.set(tab.documentId, { ...linkedDocument, fileMissing: true });
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
  const incomingSelectedTabId = readIncomingSelectedTabId(context);
  const selectedTabId = openTabs.some((tab) => tab.id === incomingSelectedTabId)
    ? incomingSelectedTabId
    : (openTabs[0]?.id ?? null);

  return {
    documents,
    session: normalizeSessionState({
      ...context.session,
      editorLayout: layoutFromFlatTabs(openTabs, selectedTabId),
      windowBounds: context.session.windowBounds ?? null,
    }),
  };
}

/** Build a single-empty-document fallback context when no tabs survive pruning. */
function buildFallbackContext(
  context: WindowSessionSnapshot["notepad"],
  layout: EditorLayout,
): WindowSessionSnapshot["notepad"] {
  const docId = nextNumericId(
    "doc",
    context.documents.map((documentState) => documentState.id),
  );
  const tabId = nextNumericId(
    "tab",
    allTabs(layout).map((tab) => tab.id),
  );
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

/** Normalize each tab in a pane (legacy kind/shape), preserving id/selection. */
function normalizePane(pane: EditorPane): EditorPane {
  const tabs = pane.tabs.map((raw) => normalizeTabState(raw));
  const selectedTabId =
    typeof pane.selectedTabId === "string" && tabs.some((tab) => tab.id === pane.selectedTabId)
      ? pane.selectedTabId
      : (tabs[0]?.id ?? null);
  return { id: pane.id, tabs, selectedTabId };
}

/**
 * Read the editor layout from a restored context. Returns the structured
 * `editorLayout` when present and well-formed enough to restructure; returns
 * `null` for the legacy flat `openTabs` shape (caller re-seeds) and for
 * unrecognizable shapes (caller falls back to a single empty pane).
 */
function readIncomingLayout(
  context: WindowSessionSnapshot["notepad"],
): EditorLayout | null {
  const session = context.session as unknown as Record<string, unknown>;
  const layout = session.editorLayout;
  if (!layout || typeof layout !== "object") {
    return null;
  }
  const candidate = layout as { panes?: unknown };
  if (!Array.isArray(candidate.panes) || candidate.panes.length === 0) {
    return null;
  }
  // Slot reading order is reconstructed by `restructureEditorLayout`, so a stale
  // or missing `slots` is fine — we just need a valid `panes` list. Pane ids and
  // per-pane `selectedTabId` are clamped there too.
  const panes: EditorPane[] = [];
  for (const rawPane of candidate.panes) {
    if (!rawPane || typeof rawPane !== "object") {
      continue;
    }
    const pane = rawPane as { id?: unknown; tabs?: unknown; selectedTabId?: unknown };
    const id = typeof pane.id === "string" && pane.id.length > 0 ? pane.id : nextPaneId();
    const tabs = Array.isArray(pane.tabs) ? (pane.tabs as TabState[]) : [];
    const selectedTabId = typeof pane.selectedTabId === "string" ? pane.selectedTabId : null;
    panes.push({ id, tabs, selectedTabId });
  }
  if (panes.length === 0) {
    return null;
  }
  const activePaneId =
    typeof (layout as { activePaneId?: unknown }).activePaneId === "string" &&
    panes.some((pane) => pane.id === (layout as { activePaneId: string }).activePaneId)
      ? (layout as { activePaneId: string }).activePaneId
      : panes[0].id;
  return {
    kind: "custom",
    panes,
    slots: [],
    activePaneId,
  };
}

/**
 * Read the open tabs from a legacy (pre-split-view) restored context. New
 * snapshots carry a structured `editorLayout` (handled by `readIncomingLayout`);
 * this only reads the flat `openTabs` list used by the legacy re-seed path.
 */
function readIncomingTabs(context: WindowSessionSnapshot["notepad"]): TabState[] {
  const session = context.session as unknown as Record<string, unknown>;
  if (Array.isArray(session.openTabs)) {
    return session.openTabs as TabState[];
  }
  return [];
}

function readIncomingSelectedTabId(context: WindowSessionSnapshot["notepad"]): string | null {
  const session = context.session as unknown as Record<string, unknown>;
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
