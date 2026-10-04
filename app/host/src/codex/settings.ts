import type { ReasoningEffort } from './generated/ReasoningEffort';
import type { SandboxMode } from './generated/v2/SandboxMode';
import type { AskForApproval } from './generated/v2/AskForApproval';
import type { Model } from './generated/v2/Model';
import { object } from './transport';
export interface NativeSettings { effort: ReasoningEffort; sandbox: SandboxMode; approvalPolicy: Extract<AskForApproval, string>; collaborationMode: 'default' | 'plan' }
export function settings(raw: unknown): NativeSettings {
  const value = object(raw) ? raw : {};
  const result = { effort: value.effort ?? 'medium', sandbox: value.sandbox ?? 'workspace-write', approvalPolicy: value.approvalPolicy ?? 'on-request', collaborationMode: value.collaborationMode ?? 'default' };
  if (!['none','minimal','low','medium','high','xhigh','max','ultra'].includes(String(result.effort)) || !['read-only','workspace-write','danger-full-access'].includes(String(result.sandbox)) || !['untrusted','on-failure','on-request','never'].includes(String(result.approvalPolicy)) || !['default','plan'].includes(String(result.collaborationMode))) throw new Error('Unsupported native session settings');
  return result as NativeSettings;
}
export function validateModel(models: readonly Model[], modelId: string | undefined, config: NativeSettings): Model {
  const model = modelId ? models.find(m => m.id === modelId || m.model === modelId) : models.find(m => m.isDefault) ?? models[0];
  if (!model) throw new Error('Selected model is absent from this profile catalog');
  if (!model.supportedReasoningEfforts.some(e => e.reasoningEffort === config.effort)) throw new Error('Selected model does not support this reasoning effort');
  return model;
}
