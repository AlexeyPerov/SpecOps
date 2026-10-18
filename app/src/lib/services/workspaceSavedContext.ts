import { invoke } from '@tauri-apps/api/core';
import type { ContextSnapshot, DocumentState } from '../domain/contracts';
import type { ProjectRecoveryBuffers, SavedProjectContext, SavedProjectContextWrite } from '../domain/projectCatalog';
import { getProjectCatalog, projectIdentity, saveCatalogProjectContext } from './workspaceCatalog';
import { openPath } from './fileSystem';
import { documentWithOpenedFilePayload } from '../state/appState/documentHelpers';
import { applyLargeFileConfirmGateOnRestore } from './sessionDocumentPersistence';
import { appState } from '../state/appState';

export function savedProjectContext(snapshot: ContextSnapshot, mode: 'close' | 'discard' | 'window'): SavedProjectContextWrite {
  const recoveryBuffers: ProjectRecoveryBuffers = {};
  const documents = snapshot.documents.map(doc => {
    const { content, savedContent, isDirty, ...metadata } = doc;
    if (mode !== 'discard' && (!doc.filePath || (mode === 'window' && isDirty))) {
      recoveryBuffers[doc.id] = { content, savedContent, isDirty };
    }
    return metadata;
  });
  return { savedAt: new Date().toISOString(), snapshot: { documents,
    session: structuredClone(snapshot.session) },
    ...(Object.keys(recoveryBuffers).length ? { recoveryBuffers } : {}) };
}

export async function checkpointWorkspaceContexts(): Promise<void> {
  for (const workspace of appState.getSnapshot().contexts.workspaces) {
    await saveCatalogProjectContext(workspace.rootPath, savedProjectContext(workspace.snapshot, 'window'));
  }
}

export async function restoreSavedProjectContext(root: string): Promise<ContextSnapshot | null> {
  const saved: SavedProjectContext | undefined = getProjectCatalog().savedContexts[projectIdentity(root)];
  if (!saved) return null;
  const recovery = saved.recoveryRef
    ? await invoke<ProjectRecoveryBuffers>('project_catalog_read_recovery', { id: projectIdentity(root), reference: saved.recoveryRef }) : {};
  const missing = (error: unknown) => /no such file|not found|os error 2|cannot find the path/i.test(String(error));
  const documents: DocumentState[] = [];
  for (const metadata of saved.snapshot.documents) {
    let doc: DocumentState = { ...metadata, content: '', savedContent: '', isDirty: false };
    const buffer = recovery[metadata.id];
    if (buffer) doc = { ...doc, ...buffer };
    if (doc.filePath) {
      doc = await applyLargeFileConfirmGateOnRestore(doc, appState.getSnapshot().settings.externalFiles.maxOpenWithoutConfirmBytes, missing, !!buffer);
      if (!buffer && doc.contentKind !== 'large_pending') {
        try {
          const opened = await openPath(metadata.filePath!);
          doc = documentWithOpenedFilePayload(doc, opened.path, opened.content, opened.contentKind,
            { lineEnding: opened.lineEnding, hasBom: opened.hasBom });
          doc = { ...doc, diskFingerprint: opened.fingerprint, fileMissing: false,
            lineEnding: opened.lineEnding ?? "lf", hasBom: opened.hasBom ?? false };
        } catch (error) {
          if (!missing(error)) throw error;
          doc = { ...doc, fileMissing: true };
        }
      }
    }
    documents.push(doc);
  }
  return { documents, session: structuredClone(saved.snapshot.session) };
}
