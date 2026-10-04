import type { ChatStoreState } from '../state/chatStore/types';
import { chatStore } from '../state/chatStore';
import { appState } from '../state/appState';
import { requestConfirm } from './confirmDialogUi';
export interface SessionActivity {
  sessionId: string; title: string; runtimeId: string; profileId?: string; modelId?: string;
  action: 'running' | 'permission' | 'question';
  writeCapability: 'read-only' | 'possible' | 'unknown';
  changedPaths: readonly string[]; overlaps: readonly string[];
}
/** Native write policy is authoritative; absence of a guarantee remains unknown. */
export function workspaceActivity(state: ChatStoreState, root: string): SessionActivity[] {
  const workspace = state.workspaces[root];
  if (!workspace) return [];
  const activities: SessionActivity[] = workspace.sessionIndex.flatMap(entry => {
    const runtime = workspace.runtimeBySessionId[entry.id];
    if (!runtime?.isGenerating) return [];
    const metadata = workspace.threadsBySessionId[entry.id]?.metadata;
    const runtimeId = entry.runtimeId ?? metadata?.runtimeId ?? 'unknown';
    const settings = entry.runtimeMetadata ?? metadata?.runtimeMetadata;
    const sandbox = settings?.sandbox;
    const writeCapability = runtimeId === 'codex' && sandbox === 'read-only' ? 'read-only' : runtimeId === 'codex' && (sandbox === 'workspace-write' || sandbox === 'danger-full-access') ? 'possible' : 'unknown';
    const changedPaths = [...new Set(workspace.threadsBySessionId[entry.id]?.messages.find(message => message.id === `assistant-${runtime.activeTurnId}`)?.parts?.flatMap(part => part.type === 'diff' ? part.files ?? [] : []) ?? [])].slice(0, 256);
    return [{ changedPaths, overlaps: [], sessionId: entry.id, title: entry.title, runtimeId, profileId: entry.connectionProfileId ?? metadata?.connectionProfileId, modelId: entry.modelId ?? metadata?.selectedModelId, action: runtime.isWaitingForPermission ? 'permission' : runtime.isWaitingForQuestion ? 'question' : 'running', writeCapability }];
  });
  const owners = new Map<string, number>();
  for (const activity of activities) for (const path of activity.changedPaths) owners.set(path, (owners.get(path) ?? 0) + 1);
  return activities.map(activity => ({ ...activity, overlaps: activity.changedPaths.filter(path => (owners.get(path) ?? 0) > 1) }));
}
/** Advisory only: Continue preserves each runtime, profile and shared cwd. */
export async function confirmConcurrentWorkspaceWork(root: string, sessionId: string): Promise<boolean> {
  if (!appState.getSnapshot().settings.warnConcurrentWriters) return true;
  const writers = workspaceActivity(chatStore.getSnapshot(), root).filter(activity => activity.sessionId !== sessionId && activity.writeCapability !== 'read-only');
  if (!writers.length) return true;
  return requestConfirm({ title: 'Concurrent workspace activity', message: writers.map(writer => `${writer.title}: ${writer.runtimeId}, profile ${writer.profileId ?? 'unknown'}, ${writer.writeCapability === 'unknown' ? 'write capability unknown' : 'may write files'}`).join('\n') + '\nThese sessions share workspace files. Continue allows concurrent execution. Stop does not roll back file changes; use your normal git or manual recovery.', confirmLabel: 'Continue', cancelLabel: 'Cancel this send' });
}
