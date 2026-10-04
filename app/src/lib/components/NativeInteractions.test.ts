import { afterEach, expect, it } from 'vitest';
import { tick } from 'svelte';
import PermissionPrompt from './PermissionPrompt.svelte';
import QuestionPrompt from './QuestionPrompt.svelte';
import SessionCatalogPicker from './SessionCatalogPicker.svelte';
import { mountComponent } from './_testComponentMount';
import { promptPermission, registerPermissionPromptRunner } from '../services/permissionPrompt';
import { promptQuestion, registerQuestionPromptRunner } from '../services/questionPrompt';
afterEach(() => { registerPermissionPromptRunner(null); registerQuestionPromptRunner(null); });
it('pending native approval remains visible after prompt component remount, then abort closes and resolves once', async () => {
  const first = mountComponent(PermissionPrompt, {}); await tick(); const controller = new AbortController();
  const pending = promptPermission({ permissionId: 'native-approval', label: 'Run fixture command', payload: {}, signal: controller.signal }); await tick(); expect(document.querySelector('[role=dialog]')?.textContent).toContain('Run fixture command');
  first.unmount(); mountComponent(PermissionPrompt, {}); await tick(); expect(document.querySelector('[role=dialog]')?.textContent).toContain('Run fixture command');
  controller.abort(); await expect(pending).resolves.toEqual({ reply: 'reject' }); await tick(); expect(document.querySelector('[role=dialog]')).toBeNull();
});
it('question input appears and native interruption dismisses without leaving an unanswered UI promise', async () => {
  mountComponent(QuestionPrompt, {}); await tick(); const controller = new AbortController(); const pending = promptQuestion({ questionId: 'native-question', prompt: 'Which?', choices: ['One'], payload: {}, signal: controller.signal }); await tick(); expect(document.querySelector('[role=dialog]')?.textContent).toContain('Which?'); controller.abort(); await expect(pending).resolves.toEqual({ type: 'reject' }); await tick(); expect(document.querySelector('[role=dialog]')).toBeNull();
});
it('optional session controls render without vendor UI branches and absence hides unsupported fields', async () => {
  const props = { runtimeId: 'fake', runtimeLabel: 'Fixture', catalog: { status: 'ready' as const, models: [{ id: 'model' }], modes: [{ id: 'default' }] }, activeModelId: 'model', activeModeId: 'default' };
  const first = mountComponent(SessionCatalogPicker, props); await tick(); expect(document.body.textContent).not.toContain('Sandbox'); first.unmount();
  const changes: unknown[] = [];
  mountComponent(SessionCatalogPicker, { ...props, onSettingsChange: (value: Readonly<Record<string, unknown>>) => changes.push(value), catalog: { ...props.catalog, configuration: { schemaVersion: 1 as const, scope: 'session' as const, description: 'Session values override profile/workspace defaults. Experimental opt-in is profile-scoped.', fields: [
    { id: 'effort', label: 'Effort', kind: 'select' as const, optionsByModel: { model: ['medium', 'high'] }, default: 'medium' },
    { id: 'sandbox', label: 'Sandbox', kind: 'select' as const, options: ['read-only', 'workspace-write'], default: 'workspace-write' },
    { id: 'approvalPolicy', label: 'Approval', kind: 'select' as const, options: ['on-request', 'never'], default: 'on-request' },
  ] } } }); await tick(); expect(document.body.textContent).toContain('Effort'); expect(document.body.textContent).toContain('Sandbox'); expect(document.body.textContent).toContain('Approval');
  const selects = [...document.querySelectorAll('select')]; const effort = selects.find(s => [...s.options].some(o => o.value === 'high'))!;
  effort.value = 'high'; effort.dispatchEvent(new Event('change', { bubbles: true })); await tick(); expect(changes).toEqual([{ effort: 'high' }]); expect(document.querySelector('[title*="profile-scoped"]')).toBeTruthy();
});

it('model-specific default effort is shown with no persisted setting', async () => {
  mountComponent(SessionCatalogPicker, { runtimeId: 'fake', runtimeLabel: 'Fixture', catalog: { status: 'ready' as const, models: [{ id: 'high-model' }], modes: [{ id: 'default' }], configuration: { schemaVersion: 1 as const, scope: 'session' as const, description: 'Session defaults', fields: [{ id: 'effort', label: 'Effort', kind: 'select' as const, default: 'medium', optionsByModel: { 'high-model': ['high'] }, defaultsByModel: { 'high-model': 'high' } }] } }, activeModelId: 'high-model', activeModeId: 'default' });
  await tick(); const select = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'high'))!; expect(select.value).toBe('high');
});
