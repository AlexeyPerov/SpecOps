import { componentManager, listenComponentJobs } from './componentManager';
import { ensureAgentHostStarted, getAgentHostClient } from './agentHostRuntime';
import { PRODUCT_RUNTIME_IDS } from '../session/runtime';

/** Observe usable account profiles without starting a host on a fresh installation. */
export function observeReadyAgents(onChange: (ready: boolean) => void): () => void {
  let disposed = false;
  let revision = 0;
  const cleanups: (() => void)[] = [];
  const keep = (cleanup: () => void) => { if (disposed) cleanup(); else cleanups.push(cleanup); };
  async function refresh(): Promise<void> {
    const current = ++revision;
    try {
      const installed = await componentManager.list();
      const runtimes = PRODUCT_RUNTIME_IDS.filter(id => installed.some(component => component.id === id && component.active && component.verified));
      if (!runtimes.length) {
        if (!disposed && current === revision) onChange(false);
        return;
      }
      if (disposed || current !== revision) return;
      await ensureAgentHostStarted();
      if (disposed || current !== revision) return;
      const results = await Promise.allSettled(runtimes.map(runtimeId => getAgentHostClient().authenticate({ runtimeId, workspaceRootPath: '', options: { action: 'list-profiles' } })));
      const ready = results.some(result => result.status === 'fulfilled' && result.value.profiles?.some(profile => profile.state === 'authenticated'));
      if (!disposed && current === revision) onChange(ready);
    } catch {
      if (!disposed && current === revision) onChange(false);
    }
  }
  const update = () => { void refresh(); };
  window.addEventListener('focus', update);
  void listenComponentJobs(update).then(keep).catch(() => {});
  void getAgentHostClient().subscribeProfiles(update).then(keep).catch(() => {});
  update();
  return () => { disposed = true; revision++; window.removeEventListener('focus', update); cleanups.forEach(cleanup => cleanup()); };
}
