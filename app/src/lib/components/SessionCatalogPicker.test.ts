import type { SessionCatalogSnapshot } from "../services/agentHostRuntime";
import { expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { mountComponent } from './_testComponentMount';
import SessionCatalogPicker from './SessionCatalogPicker.svelte';
it('native settings show automatic execution limits and selected-model enums; unsupported model options stay disabled',async()=>{
 const onSettingsChange=vi.fn(),description='File tools run without approval. Native workspace sandbox policy may apply. No verified read-only guarantee.';
 const {host}=mountComponent(SessionCatalogPicker,{runtimeId:'cursor',runtimeLabel:'Cursor',activeModelId:'selected',activeModeId:'agent',runtimeMetadata:{},onSettingsChange,catalog:{status:'ready' as const,models:[{id:'selected'},{id:'other'}],modes:[{id:'agent'}],configuration:{schemaVersion:1 as const,scope:'session' as const,description,fields:[{id:'toolset',label:'Native file tools',kind:'select' as const,default:'none',options:['none','files-read','files-write']},{id:'modelParameter:effort',label:'effort',kind:'select' as const,default:'',optionsByModel:{selected:['','small','large']}},{id:'modelParameter:other',label:'other',kind:'select' as const,optionsByModel:{other:['','high']}}]}} as SessionCatalogSnapshot});await tick();
 expect(host.textContent).toContain(description);expect(host.textContent).toContain('Native default');
 const selects=[...host.querySelectorAll('select')];expect(selects).toHaveLength(4);expect(selects[3].disabled).toBe(true);expect(selects[2].textContent).not.toContain('high');
 selects[1].value='files-write';selects[1].dispatchEvent(new Event('change',{bubbles:true}));await tick();expect(onSettingsChange).toHaveBeenCalledWith({toolset:'files-write'});
 expect([...host.querySelectorAll('button')]).toHaveLength(0);
});
