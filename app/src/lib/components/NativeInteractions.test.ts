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

it('hides unsupported persistent approval and shows native operation scope', async () => {
  mountComponent(PermissionPrompt, {}); await tick();
  const pending = promptPermission({permissionId:'limited', label:'Write fixture', payload:{allowAlways:false,input:{file_path:'fixture-file'}}});
  await tick(); expect(document.querySelector('.permission-always')).toBeNull(); expect(document.body.textContent).toContain('fixture-file');
  (document.querySelector('.permission-once') as HTMLButtonElement).click();
  await expect(pending).resolves.toEqual({reply:'once'});
});
it('native single and multiple selections return labels and other answers without losing format', async () => {
  mountComponent(QuestionPrompt, {}); await tick();
  const single = promptQuestion({questionId:'single',prompt:'Choose',choices:['A','B'],payload:{multiSelect:false,allowFreeText:true}}); await tick();
  const radios = [...document.querySelectorAll<HTMLInputElement>('input[type=radio]')]; radios[0].click(); radios[1].click(); await tick();
  (document.querySelector('.question-submit') as HTMLButtonElement).click(); await expect(single).resolves.toEqual({type:'reply',answers:[['B']]});
  const multi = promptQuestion({questionId:'multi',prompt:'Choose several',choices:['A','B'],payload:{multiSelect:true,allowFreeText:true}}); await tick();
  const checks = [...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]; checks[0].click(); checks[1].click(); await tick();
  (document.querySelector('.question-submit') as HTMLButtonElement).click(); await expect(multi).resolves.toEqual({type:'reply',answers:[['A','B']]});
  const other = promptQuestion({questionId:'other',prompt:'Choose or explain',choices:['A'],payload:{multiSelect:false,allowFreeText:true}}); await tick();
  const textarea = document.querySelector('textarea')!; textarea.value='Custom'; textarea.dispatchEvent(new Event('input',{bubbles:true})); await tick();
  (document.querySelector('.question-submit') as HTMLButtonElement).click(); await expect(other).resolves.toEqual({type:'reply',answers:[['Custom']]});
});
it('neutral controls preserve typed number and string settings and allow clearing optional budget', async () => {
 const changes: unknown[]=[];
 mountComponent(SessionCatalogPicker,{runtimeId:'fake',runtimeLabel:'Fixture',activeModelId:'model',activeModeId:'',runtimeMetadata:{maxBudgetUsd:1},onSettingsChange:(values:Readonly<Record<string,unknown>>)=>changes.push(values),catalog:{status:'ready' as const,models:[{id:'model'}],modes:[],configuration:{schemaVersion:1 as const,scope:'session' as const,description:'Native settings',fields:[{id:'maxBudgetUsd',label:'Budget USD',kind:'number' as const},{id:'allowedTools',label:'Allow tools',kind:'string' as const}]}}}); await tick();
 const number=document.querySelector<HTMLInputElement>('input[type=number]')!; number.value='0.5'; number.dispatchEvent(new Event('change',{bubbles:true})); await tick(); expect(changes.at(-1)).toEqual({maxBudgetUsd:.5});
 number.value=''; number.dispatchEvent(new Event('change',{bubbles:true})); await tick(); expect(changes.at(-1)).toEqual({});
 const text=document.querySelector<HTMLInputElement>('input[type=text]')!; text.value='Read'; text.dispatchEvent(new Event('change',{bubbles:true})); await tick(); expect(changes.at(-1)).toEqual({maxBudgetUsd:1,allowedTools:'Read'});
});
