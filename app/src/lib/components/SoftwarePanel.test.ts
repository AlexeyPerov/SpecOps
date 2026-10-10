import { beforeEach, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { mountComponent } from './_testComponentMount';
import SoftwarePanel from './SoftwarePanel.svelte';
import { newerComponentJob } from '../services/componentManager';
const fixture = vi.hoisted(() => ({ diagnostics: vi.fn(), plan: vi.fn(), update: vi.fn(), install: vi.fn(), cancel: vi.fn(), retry: vi.fn(), select: vi.fn(), remove: vi.fn(), cleanCache: vi.fn(), event: undefined as undefined | ((job: any) => void) }));
vi.mock('../services/componentManager', async importOriginal => ({ ...(await importOriginal<object>()), componentManager: fixture, listenComponentJobs: async (fn: (job: any) => void) => { fixture.event = fn; return () => {}; } }));
const row = { id: 'codex', version: '0.160.0', state: 'missing', active: false, verified: false, target: { os: 'darwin', arch: 'arm64' }, downloadBytes: 1000, installedBytes: 2000, dependencies: [{ id: 'node', version: '24.15.0' }] };
const plan = { planId: 'p-one', digest: 'review-digest', catalogRevision: 1, expiresAt: Math.ceil(Date.now() / 1000) + 300, components: [{ id: 'node', version: '24.15.0' }, { id: 'codex', version: '0.160.0' }], downloadBytes: 12345, requiredDiskBytes: 34567 };
const job = { operationId: 'operation-one', generation: 1, sequence: 1, state: 'downloading', id: 'codex', completedBytes: 0, totalBytes: 12345, error: null };
async function settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); await tick(); } }
function button(host: HTMLElement, text: string) { return [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === text)!; }
beforeEach(() => {
 vi.clearAllMocks();fixture.event = undefined;
 fixture.diagnostics.mockResolvedValue({ target: { os: 'darwin', arch: 'arm64' }, catalogRevision: 1, components: [row], jobs: [] });
 fixture.plan.mockResolvedValue(plan); fixture.update.mockResolvedValue(plan); fixture.install.mockResolvedValue(job); fixture.retry.mockResolvedValue({ ...job, operationId: 'operation-two' });
 fixture.cancel.mockResolvedValue({ ...job, sequence: 2 }); fixture.select.mockResolvedValue(undefined); fixture.remove.mockResolvedValue(undefined);fixture.cleanCache.mockResolvedValue(undefined);
});
it('opening, dismissing and unavailable distribution never download or install', async () => {
 const { host } = mountComponent(SoftwarePanel, {}); await settle();expect(fixture.plan).not.toHaveBeenCalled(); expect(fixture.install).not.toHaveBeenCalled();
 button(host, 'Review installation').focus(); button(host, 'Review installation').click(); await settle(); expect(fixture.plan).toHaveBeenCalledWith({ id: 'codex', version: '0.160.0' });
 expect(host.textContent).toContain('24.15.0');expect(host.textContent).toContain('12,345 bytes');expect(host.textContent).toContain('34,567 bytes');
 expect(document.activeElement).toBe(button(host, 'Install reviewed components'));
 window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));await settle();expect(fixture.install).not.toHaveBeenCalled(); expect(document.activeElement).toBe(button(host, 'Review installation'));
 fixture.diagnostics.mockResolvedValue({ target: { os: 'darwin', arch: 'arm64' }, components: [{ ...row, state: 'unavailable' }], jobs: [] });
 button(host, 'Refresh software').click();await settle();expect(button(host, 'Install unavailable').disabled).toBe(true);expect(host.textContent).toContain('No approved download');
});
it('exact explicit confirmation, real cancellation, monotonic progress and reviewed retry preserve profile intent', async () => {
 const ready = vi.fn();const {host} = mountComponent(SoftwarePanel, {runtimeId: 'codex',profileId: 'saved-profile',onReady: ready});await settle();
 button(host,'Review installation').click();await settle();button(host,'Install reviewed components').click();await settle();
 expect(fixture.install).toHaveBeenCalledWith({planId:'p-one',digest:'review-digest',confirmed:true});expect(ready).not.toHaveBeenCalled();
 button(host,'Cancel installation').click();await settle();expect(button(host,'Cancellation requested…').disabled).toBe(true);
 fixture.event?.({...job,sequence:3,state:'failed',error:'low-disk'});await settle();expect(host.textContent).toContain('Insufficient disk space');
 fixture.event?.({...job,sequence:2,state:'installed'});await settle();expect(host.textContent).not.toContain('Software ready');
 button(host,'Review retry').click();await settle();expect(fixture.retry).not.toHaveBeenCalled();button(host,'Install reviewed components').click();await settle();expect(fixture.retry).toHaveBeenCalledWith('operation-one',1,{planId:'p-one',digest:'review-digest',confirmed:true});
 fixture.event?.({...job,operationId:'operation-two',sequence:2,state:'installed'});await settle();expect(ready).not.toHaveBeenCalled();expect(host.textContent).toContain('saved-profile');button(host,'Continue connection review').click();expect(ready).toHaveBeenCalledOnce();
});
it('reopening another window restores actual jobs; foreign cancellation is actionable', async () => {
 fixture.diagnostics.mockResolvedValue({ target:{os:'darwin',arch:'arm64'},components:[row],jobs:[job] });
 const first = mountComponent(SoftwarePanel, {});await settle();first.unmount();const {host}=mountComponent(SoftwarePanel, {});await settle();expect(host.textContent).toContain('downloading');
 fixture.cancel.mockRejectedValue('foreign');button(host,'Cancel installation').click();await settle();expect(host.textContent).toContain('original window');expect(button(host,'Cancel installation').disabled).toBe(false);
});
it('tested update review, retained version selection and removal require explicit actions and show blockers',async()=>{
 fixture.diagnostics.mockResolvedValue({target:{os:'darwin',arch:'arm64'},components:[{...row,verified:true,state:'update-available'}],jobs:[]});const {host}=mountComponent(SoftwarePanel,{});await settle();
 button(host,'Review tested update').click();await settle();expect(fixture.update).toHaveBeenCalledWith({id:'codex',version:'0.160.0'});button(host,'Dismiss installation review').click();await settle();
 fixture.select.mockRejectedValue('in-use');button(host,'Select compatible version').click();await settle();expect(host.textContent).toContain('Stop its sessions explicitly');
 button(host,'Review removal').click();await settle();expect(fixture.remove).not.toHaveBeenCalled();expect(host.textContent).toContain('credentials');expect(document.activeElement).toBe(button(host,'Remove reviewed software'));
 button(host,'Remove reviewed software').click();await settle();expect(fixture.remove).toHaveBeenCalledWith({id:'codex',version:'0.160.0'});
 button(host,'Reclaim downloaded cache').click();await settle();expect(fixture.cleanCache).toHaveBeenCalledOnce();
});
it.each(['network','integrity','target','probe','unavailable','busy'])('finite %s failure preserves reviewed versions and permits deliberate refresh', async code => {
 fixture.plan.mockRejectedValue(code);const {host}=mountComponent(SoftwarePanel,{});await settle();button(host,'Review installation').click();await settle();expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(fixture.install).not.toHaveBeenCalled();expect(host.textContent).toContain('0.160.0');
});
it('unknown totals are indeterminate and expired review cannot authorize installation',async()=>{
 fixture.diagnostics.mockResolvedValue({target:{os:'darwin',arch:'arm64'},components:[row],jobs:[{...job,totalBytes:0}]});const {host}=mountComponent(SoftwarePanel,{});await settle();expect(host.querySelector('progress')?.hasAttribute('value')).toBe(false);expect(host.textContent).toContain('total unknown');
 expect(newerComponentJob(undefined,{...job,totalBytes:0} as any)).toBe(true);
});
it('expired review refuses confirmation and offline missing components keep the editor usable',async()=>{
 fixture.plan.mockResolvedValue({...plan,expiresAt:1});const {host}=mountComponent(SoftwarePanel,{});await settle();button(host,'Review installation').click();await settle();button(host,'Install reviewed components').click();await settle();expect(fixture.install).not.toHaveBeenCalled();expect(host.textContent).toContain('expired');
 Object.defineProperty(navigator,'onLine',{value:false,configurable:true});window.dispatchEvent(new Event('offline'));await settle();expect(button(host,'Review installation').disabled).toBe(true);expect(host.textContent).toContain('editor and installed software remain available');Object.defineProperty(navigator,'onLine',{value:true,configurable:true});window.dispatchEvent(new Event('online'));
});
