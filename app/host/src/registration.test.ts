import { expect, it } from 'vitest';
import { AdapterRegistry } from './registry';
import { createFakeRuntimeAdapter } from '../../src/lib/session/adapter/fake';
it('a shipped fixture factory uses the same deferred registry and deduplicated activation contract', async () => {
  const registry=new AdapterRegistry(); let constructions=0;
  registry.registerLazy('fake',async()=>{constructions++;return createFakeRuntimeAdapter({turns:{}})});
  expect(constructions).toBe(0);
  expect(registry.list()).toEqual([]);
  await Promise.all([registry.activate('fake'),registry.activate('fake')]);
  expect(constructions).toBe(1);
  expect(registry.require('fake').runtimeId).toBe('fake');
  expect((await registry.discovery())[0]?.id).toBe('fake');
  await registry.activate('https://arbitrary.invalid/adapter.mjs');
  expect(constructions).toBe(1);
  expect(()=>registry.require('https://arbitrary.invalid/adapter.mjs')).toThrow('Unknown runtime');
});
