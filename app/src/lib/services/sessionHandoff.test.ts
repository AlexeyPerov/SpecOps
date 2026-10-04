import { describe, expect, it, vi } from 'vitest';
import { buildHandoffDraft, executeHandoff, handoffFirstPrompt, isHandoffPathAllowed, type HandoffAttempt, type HandoffExecutor } from './sessionHandoff';
const approved = (): HandoffAttempt => ({ version: 1, id: 'handoff-test', sourceSessionId: 'source', targetSessionId: 'target', workspaceRootPath: '/workspace', approvedAt: '2026-10-04T00:00:00Z', stage: 'approved', target: { runtimeId: 'claude', connectionProfileId: 'later-profile', modelId: 'native-model', runtimeMetadata: { permissionMode: 'default' } }, approvedPrompt: 'Exactly reviewed\ncontext' });
function fixture() {
  let saved: HandoffAttempt | undefined;
  const deps: HandoffExecutor = {
    save: vi.fn(async a => { saved = structuredClone(a); }), validate: vi.fn(async () => {}),
    create: vi.fn(async t => ({ ...t, nativeSessionId: 'fresh-target-native' as never })),
    bind: vi.fn(async () => {}), send: vi.fn(async () => true),
  };
  return { deps, saved: () => saved! };
}
describe('reviewed handoff packet', () => {
  it('bounds common text, excludes raw payload/native IDs/private paths and marks missing/truncated evidence', () => {
    const draft = buildHandoffDraft({ sourceSessionId: 'source', sourceRuntimeId: 'codex', workspaceRootPath: '/workspace', messages: [{ id: 'u', role: 'user', content: 'goal api_key=CANARY_SECRET', createdAt: 't', nativeTurnId: 'CANARY_NATIVE_ID', toolCalls: [{callId:'call',toolName:'tool',status:'success',output:'CANARY_RAW_OUTPUT'}] }, { id: 'a', role: 'assistant', content: 'x'.repeat(20_000) + '\n-----BEGIN PRIVATE KEY-----\nCANARY_PEM\n-----END PRIVATE KEY-----', createdAt: 't', parts: [{type:'reasoning',text:'CANARY_REASONING'}] }], changedPaths: ['z.ts', '.env', 'a.ts', '../escape', 'auth.json', 'keys/private.key'], excerpts: [{path:'missing.ts',state:'unavailable'}, {path:'.env',state:'included',text:'CANARY_FILE'}] });
    const prompt = handoffFirstPrompt(draft, approved().target, 'target');
    for (const canary of ['CANARY_SECRET','CANARY_NATIVE_ID','CANARY_RAW_OUTPUT','CANARY_PEM','CANARY_REASONING','CANARY_FILE']) expect(prompt).not.toContain(canary);
    expect(draft.sections.find(s => s.id === 'paths')?.text).toBe('a.ts\nz.ts');
    expect(prompt).toContain('truncated'); expect(prompt).toContain('content unavailable'); expect(prompt).toContain('later-profile');
    const goal = draft.sections[0]; goal.text = 'Edited goal'; draft.sections.find(s => s.id === 'summary')!.included = false;
    expect(handoffFirstPrompt(draft, approved().target, 'target')).toContain('Edited goal'); expect(handoffFirstPrompt(draft, approved().target, 'target')).not.toContain('assistant:');
  });
  it.each(['.env','x/.auth/a','x/credential.json','id_rsa','a.pem','/absolute','../escape','x/../a','x\\a','x\nfile'])('excludes %s before read', path => expect(isHandoffPathAllowed(path)).toBe(false));
});
describe('durable intent boundaries', () => {
  it('creates fresh binding and sends the exact approval once; settled retry only opens known target', async () => {
    const {deps,saved} = fixture(); const result = await executeHandoff(approved(), deps);
    expect(result.stage).toBe('settled'); expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({approvedPrompt:approved().approvedPrompt,stage:'send-intent'}));
    expect((deps.save as ReturnType<typeof vi.fn>).mock.calls.map(([a]) => a.stage)).toEqual(['approved','create-intent','created','send-intent','settled']);
    await executeHandoff(saved(), deps); expect(deps.create).toHaveBeenCalledTimes(1); expect(deps.send).toHaveBeenCalledTimes(1);
  });
  it.each(['approved','create-intent','created','send-intent','settled'] as const)('storage failure at %s never crosses unsaved intent', async stage => {
    const {deps,saved} = fixture(); const original = deps.save;
    deps.save = vi.fn(async a => { if (a.stage === stage) throw new Error('disk full'); await original(a); });
    await expect(executeHandoff(approved(), deps)).rejects.toThrow('disk full');
    expect(deps.create).toHaveBeenCalledTimes(['approved','create-intent'].includes(stage) ? 0 : 1);
    expect(deps.send).toHaveBeenCalledTimes(stage === 'settled' ? 1 : 0);
    if (stage === 'created') await expect(executeHandoff(saved(), deps)).rejects.toThrow('unknown');
    if (stage === 'settled') { await executeHandoff(saved(), deps); expect(deps.send).toHaveBeenCalledTimes(1); }
  });
  it('unknown create failure blocks recreate; lost send acknowledgement blocks resubmission', async () => {
    const f = fixture(); f.deps.create = vi.fn(async () => { throw new Error('lost create ack'); });
    await expect(executeHandoff(approved(), f.deps)).rejects.toThrow(); await expect(executeHandoff(f.saved(), f.deps)).rejects.toThrow('unknown'); expect(f.deps.create).toHaveBeenCalledTimes(1);
    const s = fixture(); s.deps.send = vi.fn(async () => { throw new Error('lost send ack'); });
    await expect(executeHandoff(approved(), s.deps)).rejects.toThrow(); await executeHandoff(s.saved(), s.deps); expect(s.deps.send).toHaveBeenCalledTimes(1);
  });
  it('known created target can continue after local bind failure without another create', async () => {
    const f = fixture(); f.deps.bind = vi.fn().mockRejectedValueOnce(new Error('local save failed')).mockResolvedValue(undefined);
    await expect(executeHandoff(approved(), f.deps)).rejects.toThrow(); await executeHandoff(f.saved(), f.deps); expect(f.deps.create).toHaveBeenCalledTimes(1); expect(f.deps.send).toHaveBeenCalledTimes(1);
  });
  it.each(['model','profile','settings'] as const)('rejects mismatched native %s acknowledgement without dispatch', async mismatch => {
    const f = fixture(); f.deps.create = vi.fn(async t => ({ ...t, nativeSessionId:'new' as never, ...(mismatch === 'model' ? {modelId:'other'} : mismatch === 'profile' ? {connectionProfileId:'other'} : {runtimeMetadata:{permissionMode:'plan'}}) }));
    await expect(executeHandoff(approved(), f.deps)).rejects.toThrow('differs'); expect(f.saved().stage).toBe('create-intent'); expect(f.deps.send).not.toHaveBeenCalled();
  });
  it('unavailable auth/settings fails before creation or intent', async () => { const f=fixture(); f.deps.validate=vi.fn(async()=>{throw new Error('auth unavailable');}); await expect(executeHandoff(approved(),f.deps)).rejects.toThrow(); expect(f.deps.create).not.toHaveBeenCalled(); expect(f.deps.save).not.toHaveBeenCalled(); });
  it('cancelled draft has no execution side effects', () => { const f=fixture(); buildHandoffDraft({sourceSessionId:'source',sourceRuntimeId:'codex',workspaceRootPath:'/workspace',messages:[]}); expect(f.deps.create).not.toHaveBeenCalled(); expect(f.deps.send).not.toHaveBeenCalled(); });
});
