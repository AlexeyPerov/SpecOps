import { writable } from 'svelte/store';
export const workspaceTransferBusy = writable(false);
let busy = false;
workspaceTransferBusy.subscribe(value => { busy = value; });
export function isWorkspaceTransferBusy(): boolean { return busy; }
