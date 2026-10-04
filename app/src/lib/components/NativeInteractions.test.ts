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
it('creation UI keeps effort, sandbox and approval separate, with unavailable experimental mode explained', async () => {
  mountComponent(SessionCatalogPicker, { runtimeId: 'codex', runtimeLabel: 'Codex', catalog: { status: 'ready' as const, models: [{ id: 'model', reasoningEfforts: ['medium','high'] }], modes: [{ id: 'default' }] }, activeModelId: 'model', activeModeId: 'default' }); await tick(); const labels = document.body.textContent!; expect(labels).toContain('Effort'); expect(labels).toContain('Sandbox'); expect(labels).toContain('Approval'); expect(labels).toContain('Default mode'); expect(document.querySelector('[title*="experimental"]')).toBeTruthy();
});
