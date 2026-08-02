import { readTextFile, remove } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type {
  AppDomainState,
  ContextId,
  ContextSnapshot,
  DocumentState,
  WindowSessionSnapshot,
} from "../domain/contracts";
import { ensureSpecOpsDataDir } from "./appDataDir";
import { atomicWriteTextFile } from "./atomicWrite";
import { toWindowSnapshot } from "./sessionSnapshotCodec";
import { withSessionWriteLock } from "./sessionWriteLock";

const NAVIGATION_VERSION = 1;
const BUFFER_VERSION = 1;

type NavigationRecord = {
  version: typeof NAVIGATION_VERSION;
  windowId: string;
  updatedAt: string;
  snapshot: WindowSessionSnapshot;
};

type BufferRecord = {
  version: typeof BUFFER_VERSION;
  windowId: string;
  contextId: ContextId;
  documentId: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
};

type ContextEntry = {
  contextId: ContextId;
  snapshot: ContextSnapshot;
};

const navigationFingerprintByWindow = new Map<string, string>();
const bufferFingerprintByKey = new Map<string, string>();

function safeFilePart(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

async function navigationPath(windowId: string): Promise<string> {
  return join(await ensureSpecOpsDataDir(), `session-navigation.${safeFilePart(windowId)}.json`);
}

async function bufferPath(
  windowId: string,
  contextId: ContextId,
  documentId: string,
): Promise<string> {
  return join(
    await ensureSpecOpsDataDir(),
    `session-buffer.${safeFilePart(windowId)}.${safeFilePart(contextId)}.${safeFilePart(documentId)}.json`,
  );
}

function contextEntries(snapshot: WindowSessionSnapshot): ContextEntry[] {
  return [
    { contextId: "notepad", snapshot: snapshot.notepad },
    { contextId: "chat-http", snapshot: snapshot.chatHttp ?? snapshot.notepad },
    ...(snapshot.chatCloud
      ? [{ contextId: "chat-cloud" as const, snapshot: snapshot.chatCloud }]
      : []),
    ...snapshot.workspaces.map((workspace) => ({
      contextId: workspace.id,
      snapshot: workspace.snapshot,
    })),
  ];
}

function stripBufferPayload(snapshot: WindowSessionSnapshot): WindowSessionSnapshot {
  const stripContext = (context: ContextSnapshot): ContextSnapshot => ({
    ...context,
    documents: context.documents.map((documentState) => ({
      ...documentState,
      content: "",
      savedContent: "",
    })),
  });
  return {
    ...snapshot,
    notepad: stripContext(snapshot.notepad),
    chatHttp: stripContext(snapshot.chatHttp ?? snapshot.notepad),
    ...(snapshot.chatCloud ? { chatCloud: stripContext(snapshot.chatCloud) } : {}),
    workspaces: snapshot.workspaces.map((workspace) => ({
      ...workspace,
      snapshot: stripContext(workspace.snapshot),
    })),
  };
}

function bufferKey(windowId: string, contextId: ContextId, documentId: string): string {
  return `${windowId}\0${contextId}\0${documentId}`;
}

function bufferRecord(
  windowId: string,
  contextId: ContextId,
  documentState: DocumentState,
): BufferRecord {
  return {
    version: BUFFER_VERSION,
    windowId,
    contextId,
    documentId: documentState.id,
    content: documentState.content,
    savedContent: documentState.savedContent,
    isDirty: documentState.isDirty,
  };
}

/**
 * Persist lightweight topology and only document buffers whose payload changed.
 * Buffer files are written first, so a navigation record never points at a
 * revision that was not durably written yet.
 */
export async function persistIncrementalWindowSession(
  state: AppDomainState,
  windowId: string,
): Promise<void> {
  const fullSnapshot = toWindowSnapshot(state);
  const navigationSnapshot = stripBufferPayload(fullSnapshot);
  const navigationFingerprint = JSON.stringify(navigationSnapshot);
  const changedBuffers: Array<{ record: BufferRecord; fingerprint: string }> = [];
  for (const context of contextEntries(fullSnapshot)) {
    for (const documentState of context.snapshot.documents) {
      const record = bufferRecord(windowId, context.contextId, documentState);
      const fingerprint = JSON.stringify(record);
      const key = bufferKey(windowId, context.contextId, documentState.id);
      if (bufferFingerprintByKey.get(key) !== fingerprint) {
        changedBuffers.push({ record, fingerprint });
      }
    }
  }
  const navigationChanged =
    navigationFingerprintByWindow.get(windowId) !== navigationFingerprint;
  if (!navigationChanged && changedBuffers.length === 0) {
    return;
  }

  await withSessionWriteLock(async () => {
    for (const { record, fingerprint } of changedBuffers) {
      await atomicWriteTextFile(
        await bufferPath(windowId, record.contextId, record.documentId),
        JSON.stringify(record),
      );
      bufferFingerprintByKey.set(
        bufferKey(windowId, record.contextId, record.documentId),
        fingerprint,
      );
    }
    const navigation: NavigationRecord = {
      version: NAVIGATION_VERSION,
      windowId,
      updatedAt: new Date().toISOString(),
      snapshot: navigationSnapshot,
    };
    await atomicWriteTextFile(await navigationPath(windowId), JSON.stringify(navigation));
    navigationFingerprintByWindow.set(windowId, navigationFingerprint);
  });
}

function fallbackDocumentsByContext(
  fallback: WindowSessionSnapshot | null,
): Map<ContextId, Map<string, DocumentState>> {
  const result = new Map<ContextId, Map<string, DocumentState>>();
  if (!fallback) {
    return result;
  }
  for (const context of contextEntries(fallback)) {
    result.set(
      context.contextId,
      new Map(context.snapshot.documents.map((documentState) => [documentState.id, documentState])),
    );
  }
  return result;
}

async function hydrateContextBuffers(
  windowId: string,
  contextId: ContextId,
  context: ContextSnapshot,
  fallback: Map<string, DocumentState> | undefined,
): Promise<ContextSnapshot> {
  const documents = await Promise.all(
    context.documents.map(async (documentState) => {
      try {
        const raw = await readTextFile(await bufferPath(windowId, contextId, documentState.id));
        const parsed = JSON.parse(raw) as Partial<BufferRecord>;
        if (
          parsed.version === BUFFER_VERSION &&
          parsed.windowId === windowId &&
          parsed.contextId === contextId &&
          parsed.documentId === documentState.id &&
          typeof parsed.content === "string" &&
          typeof parsed.savedContent === "string" &&
          typeof parsed.isDirty === "boolean"
        ) {
          return {
            ...documentState,
            content: parsed.content,
            savedContent: parsed.savedContent,
            isDirty: parsed.isDirty,
          };
        }
      } catch {
        // A checkpoint document is the safe fallback for a missing/corrupt buffer record.
      }
      return fallback?.get(documentState.id) ?? documentState;
    }),
  );
  return { ...context, documents };
}

/** Read the authoritative navigation record and join it with per-document buffers. */
export async function readIncrementalWindowSession(
  windowId: string,
  checkpoint: WindowSessionSnapshot | null,
): Promise<WindowSessionSnapshot | null> {
  let navigation: NavigationRecord;
  try {
    navigation = JSON.parse(await readTextFile(await navigationPath(windowId))) as NavigationRecord;
  } catch {
    return checkpoint;
  }
  if (
    navigation.version !== NAVIGATION_VERSION ||
    navigation.windowId !== windowId ||
    !navigation.snapshot?.notepad ||
    !Array.isArray(navigation.snapshot.workspaces)
  ) {
    return checkpoint;
  }
  const fallback = fallbackDocumentsByContext(checkpoint);
  const snapshot = navigation.snapshot;
  const notepad = await hydrateContextBuffers(
    windowId,
    "notepad",
    snapshot.notepad,
    fallback.get("notepad"),
  );
  const chatHttp = await hydrateContextBuffers(
    windowId,
    "chat-http",
    snapshot.chatHttp ?? snapshot.notepad,
    fallback.get("chat-http"),
  );
  const chatCloud = snapshot.chatCloud
    ? await hydrateContextBuffers(
        windowId,
        "chat-cloud",
        snapshot.chatCloud,
        fallback.get("chat-cloud"),
      )
    : undefined;
  const workspaces = await Promise.all(
    snapshot.workspaces.map(async (workspace) => ({
      ...workspace,
      snapshot: await hydrateContextBuffers(
        windowId,
        workspace.id,
        workspace.snapshot,
        fallback.get(workspace.id),
      ),
    })),
  );
  return {
    ...snapshot,
    notepad,
    chatHttp,
    ...(chatCloud ? { chatCloud } : {}),
    workspaces,
  };
}

export async function removeIncrementalWindowSession(windowId: string): Promise<void> {
  try {
    const parsed = JSON.parse(
      await readTextFile(await navigationPath(windowId)),
    ) as Partial<NavigationRecord>;
    if (parsed.version === NAVIGATION_VERSION && parsed.snapshot) {
      for (const context of contextEntries(parsed.snapshot)) {
        for (const documentState of context.snapshot.documents) {
          try {
            await remove(await bufferPath(windowId, context.contextId, documentState.id));
          } catch {
            // Missing buffer record is already removed.
          }
        }
      }
    }
  } catch {
    // Missing/corrupt navigation cannot enumerate buffer records; ids are not reused.
  }
  try {
    await remove(await navigationPath(windowId));
  } catch {
    // Missing navigation record is already removed.
  }
  navigationFingerprintByWindow.delete(windowId);
  for (const key of bufferFingerprintByKey.keys()) {
    if (key.startsWith(`${windowId}\0`)) {
      bufferFingerprintByKey.delete(key);
    }
  }
}

export function resetIncrementalSessionPersistenceForTests(): void {
  navigationFingerprintByWindow.clear();
  bufferFingerprintByKey.clear();
}
