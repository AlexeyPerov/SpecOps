import { invoke } from '@tauri-apps/api/core';
import { chatStore } from '../state/chatStore';
import { appState } from '../state/appState';
import { ensureAgentHostStarted, getAgentHostClient, loadSessionCatalogs } from './agentHostRuntime';
import { flushSessionIndexPersistence, persistSessionThreadSnapshot } from './chatPersistence';
import { beginTurn, createUserMessage, executeProviderTurn } from '../ai/chatSendPipeline';
import { handoffJournalWriter, mintHandoffSendPermit, revokeHandoffSendPermit } from './handoffPersistence';
import { buildHandoffDraft, executeHandoff, isHandoffPathAllowed, handoffSettingsMatch, type HandoffAttempt, type HandoffTarget } from './sessionHandoff';
import { queryWorkingTreeStatus } from '../git/gitWorkingTree';
import { runGit } from '../git/gitRun';
import { reconcileNativeHistory } from '../session/history';
import { isAgentRuntimeId } from '../session';

export async function collectHandoffDraft(root: string, sourceSessionId: string, selectedPaths: readonly string[] = []) {
  const source = chatStore.getSessionLink(sourceSessionId, root);
  const thread = chatStore.getWorkspaceSessionsState(root)?.threadsBySessionId[sourceSessionId];
  if (!source || !thread) throw new Error('Select a bound source session with common history.');
  if (chatStore.getRuntimeState(sourceSessionId, root).nativeOperation) throw new Error('Wait for native context compaction or Stop before reviewing a handoff.');
  let changedPaths: string[] = []; let diff = ''; let evidence = 'Workspace change evidence unavailable';
  try {
    const status = await queryWorkingTreeStatus(root);
    const all = [...status.staged, ...status.unstaged];
    changedPaths = [...new Set(all.map(e => e.path))].filter(isHandoffPathAllowed).sort();
    const tracked = changedPaths.filter(path => all.some(e => e.path === path && e.statusCode !== '??')).slice(0, 8);
    if (tracked.length) {
      const result = await runGit(root, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', 'HEAD', '--', ...tracked.map(p => `:(literal)${p}`)], 'background');
      if (result.exitCode === 0) { diff = result.stdout; evidence = 'Tracked patch evidence available'; }
      else evidence = 'Native git diff unavailable (including repositories without HEAD)';
    }
    if (!tracked.length) evidence = 'Changed-file list available; no tracked patch selected';
    evidence = `${changedPaths.length} safe changed paths; ${all.length - all.filter(e => isHandoffPathAllowed(e.path)).length} private/unsafe entries excluded; first ${tracked.length} tracked patches against HEAD; untracked file diffs unavailable; ${evidence}`;
    diff = `${changedPaths.slice(0, 32).join('\n')}\n\n${diff}`;
  } catch { /* No git evidence is an explicit review state. */ }
  const paths = [...new Set(selectedPaths)].filter(isHandoffPathAllowed).sort().slice(0, 32);
  let excerpts: { path: string; text?: string; state: string }[] = [];
  if (paths.length) {
    try { excerpts = await invoke('handoff_workspace_excerpts', { workspaceRoot: root, paths }); }
    catch { excerpts = paths.map(path => ({ path, state: 'unavailable' })); }
  }
  evidence += `; ${selectedPaths.length - paths.length} selected private/unsafe/excess excerpt paths excluded`;
  return buildHandoffDraft({ sourceConnectionProfileId: source.connectionProfileId, sourceSessionId, sourceRuntimeId: source.runtimeId, workspaceRootPath: root, messages: thread.messages, summary: thread.metadata.summary, changedPaths, diff, evidence, excerpts });
}

export async function validateHandoffTarget(target: HandoffTarget, root: string): Promise<void> {
  if (!appState.getSnapshot().settings.sessionsEnabled) throw new Error('Enable Sessions before confirming a handoff.');
  if (!isAgentRuntimeId(target.runtimeId) || target.runtimeId === 'fake') throw new Error('This target runtime has no accepted handoff source adapter.');
  if (!target.connectionProfileId) throw new Error('Select an explicit target account profile.');
  await ensureAgentHostStarted();
  const client = getAgentHostClient();
  const discovery = await client.discover();
  const runtime = discovery.runtimes.find(r => r.id === target.runtimeId);
  if (!runtime?.capabilities.details.nativeTurns?.supported) throw new Error('Native target turns are unavailable.');
  const auth = await client.authenticate({ runtimeId: target.runtimeId, connectionProfileId: target.connectionProfileId, workspaceRootPath: root, options: { action: 'read' } });
  if (auth.profile?.id !== target.connectionProfileId || auth.profile.state !== 'authenticated') throw new Error('The selected target profile is unavailable or requires authentication.');
  if (target.runtimeId === 'codex' && !auth.profile.experimental) throw new Error('This source baseline requires explicit target-profile experimental opt-in.');
  const catalog = await loadSessionCatalogs(target.runtimeId, target.connectionProfileId);
  if (catalog.status !== 'ready' || !catalog.models.some(m => m.id === target.modelId)) throw new Error('The approved target model is unavailable.');
  if (target.modeId && !catalog.modes.some(m => m.id === target.modeId)) throw new Error('The approved target mode is unavailable.');
  for (const [key, value] of Object.entries(target.runtimeMetadata ?? {})) {
    const field = catalog.configuration?.fields.find(f => f.id === key);
    const options = field?.optionsByModel?.[target.modelId] ?? field?.options;
    if (!field || field.secret || (field.kind === 'select' && !options?.includes(String(value))) || (field.kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) || (field.kind === 'string' && typeof value !== 'string') || (field.kind === 'boolean' && typeof value !== 'boolean')) throw new Error('Unsupported target session settings.');
  }
}

async function bindKnownTarget(attempt: HandoffAttempt): Promise<void> {
  if (!attempt.native) throw new Error('Target creation outcome is unknown.');
  if (chatStore.getActiveChatScopeKey() !== attempt.workspaceRootPath) throw new Error('Return to the approved workspace to open the target.');
  const existing = chatStore.getSessionLink(attempt.targetSessionId, attempt.workspaceRootPath);
  if (existing && (existing.runtimeId !== attempt.native.runtimeId || existing.nativeSessionId !== attempt.native.nativeSessionId || existing.connectionProfileId !== attempt.native.connectionProfileId || existing.modelId !== (attempt.native.modelId ?? attempt.target.modelId) || existing.modeId !== (attempt.native.modeId ?? attempt.target.modeId) || !handoffSettingsMatch(attempt.target.runtimeId, existing.runtimeMetadata, attempt.target.runtimeMetadata))) throw new Error('Known target binding differs from storage. Inspect before continuing.');
  if (!chatStore.getSessionIndex().some(e => e.id === attempt.targetSessionId)) {
    // A journal target can be recovered after a crash before its local tab save.
    chatStore.setWorkspaceThread(attempt.workspaceRootPath, { metadata: { sessionId: attempt.targetSessionId, threadId: `thread-${attempt.targetSessionId}`, createdAt: attempt.approvedAt, updatedAt: attempt.approvedAt }, messages: [] });
  }
  const initialMessageId = `handoff-message-${attempt.id}`;
  chatStore.updateThreadMetadata({ runtimeId: attempt.target.runtimeId, connectionProfileId: attempt.target.connectionProfileId, selectedModelId: attempt.target.modelId, selectedModeId: attempt.target.modeId, runtimeMetadata: attempt.native.runtimeMetadata ?? attempt.target.runtimeMetadata,
    handoff: { attemptId: attempt.id, sourceSessionId: attempt.sourceSessionId, targetSessionId: attempt.targetSessionId, targetProfileId: attempt.target.connectionProfileId, initialMessageId } }, attempt.approvedAt, attempt.targetSessionId);
  chatStore.setSessionLink(attempt.targetSessionId, { runtimeId: attempt.native.runtimeId, nativeSessionId: attempt.native.nativeSessionId, connectionProfileId: attempt.native.connectionProfileId, modelId: attempt.native.modelId ?? attempt.target.modelId, modeId: attempt.native.modeId ?? attempt.target.modeId, runtimeMetadata: attempt.native.runtimeMetadata ?? attempt.target.runtimeMetadata, parentSessionId: attempt.sourceSessionId, handoff: { attemptId: attempt.id, sourceSessionId: attempt.sourceSessionId, targetSessionId: attempt.targetSessionId, targetProfileId: attempt.target.connectionProfileId, initialMessageId } }, attempt.workspaceRootPath);
  if (!chatStore.getMessages(attempt.targetSessionId).some(m => m.id === initialMessageId)) chatStore.appendMessage({ ...createUserMessage(attempt.approvedPrompt), id: initialMessageId }, { sessionId: attempt.targetSessionId, skipCompaction: true });
  await flushSessionIndexPersistence(attempt.workspaceRootPath);
  const thread = chatStore.getActiveThreadSnapshot(attempt.targetSessionId);
  if (!thread) throw new Error('Target local thread unavailable.');
  await persistSessionThreadSnapshot(attempt.workspaceRootPath, attempt.targetSessionId, thread);
  chatStore.setActiveSessionId(attempt.targetSessionId);
}

const inFlight = new Set<string>();
export async function confirmHandoff(approved: HandoffAttempt): Promise<HandoffAttempt> {
  const key = `${approved.workspaceRootPath}\0${approved.id}`;
  if (inFlight.has(key)) throw new Error('This handoff is already being confirmed.');
  inFlight.add(key);
  try {
    const journal = await handoffJournalWriter(approved.workspaceRootPath);
    const saved = journal.attempts.find(a => a.id === approved.id);
    const reviewed = saved ?? approved;
    const assertWorkspace = () => {
      if (chatStore.getRuntimeState(reviewed.sourceSessionId, reviewed.workspaceRootPath).nativeOperation) throw new Error('Wait for native context compaction or Stop before continuing this handoff.');
      if (chatStore.getActiveChatScopeKey() !== reviewed.workspaceRootPath || !chatStore.getSessionLink(reviewed.sourceSessionId, reviewed.workspaceRootPath)) throw new Error('Return to the approved workspace and source session before creating a target.');
    };
    return await executeHandoff(saved ?? approved, {
      save: journal.save,
      validate: async target => { assertWorkspace(); await validateHandoffTarget(target, reviewed.workspaceRootPath); assertWorkspace(); },
      create: (target, workspaceRootPath) => { assertWorkspace(); return getAgentHostClient().createSession({ ...target, workspaceRootPath }); },
      bind: bindKnownTarget,
      send: async attempt => {
        assertWorkspace();
        if (chatStore.getActiveChatScopeKey() !== attempt.workspaceRootPath) throw new Error('Workspace changed before native dispatch.');
        const turnId = beginTurn(attempt.targetSessionId);
        if (!turnId) throw new Error('Target is already running. Initial prompt will not be retried.');
        const permit = mintHandoffSendPermit(attempt);
        try { return (await executeProviderTurn({ root: attempt.workspaceRootPath, activeSessionId: attempt.targetSessionId, turnId, handoffPermit: permit })).ok; }
        finally { revokeHandoffSendPermit(permit); }
      },
    });
  } finally { inFlight.delete(key); }
}
export async function openKnownHandoffTarget(attempt: HandoffAttempt): Promise<void> {
  await bindKnownTarget(attempt);
  await ensureAgentHostStarted();
  const native = await getAgentHostClient().resumeSession({ native: attempt.native!, workspaceRootPath: attempt.workspaceRootPath });
  if (native.nativeSessionId !== attempt.native!.nativeSessionId || native.runtimeId !== attempt.native!.runtimeId || native.connectionProfileId !== attempt.native!.connectionProfileId) throw new Error('Resume returned another target. Nothing was sent.');
  if (native.history !== undefined) {
    chatStore.setThreadMessages(reconcileNativeHistory(chatStore.getMessages(attempt.targetSessionId), native.history, []), attempt.targetSessionId, attempt.workspaceRootPath);
    const thread = chatStore.getActiveThreadSnapshot(attempt.targetSessionId);
    if (thread) await persistSessionThreadSnapshot(attempt.workspaceRootPath, attempt.targetSessionId, thread);
  }
}
