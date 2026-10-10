import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateComponentRecord, validateCurrentSource } from './check-component-record.mjs';
const record=()=>JSON.parse(readFileSync(new URL('../../specs/ops/08-release-gates/release-2026-10-11-components.json',import.meta.url)));
test('selected blocked record remains coherent',()=>assert.deepEqual(validateComponentRecord(record()),[]));
test('missing, excluded, rescoped, duplicate, false-ready and unsupported gates fail closed',()=>{
 for(const change of [r=>r.gates.pop(),r=>r.gates[0].status='excluded',r=>r.gates[0].scope='installed',r=>r.gates.push(r.gates[0]),r=>{r.recommendation='ready';r.roadmapComplete=true;},r=>r.platform.arch='x64',r=>r.components[0].archiveSha256='0',r=>r.source.snapshotSha256=null]){const r=record();change(r);assert.ok(validateComponentRecord(r).length);}
});
test('all-pass source fixture cannot become a published release',()=>{const r=record();r.gates.forEach(g=>g.status='pass');r.recommendation='ready';r.roadmapComplete=true;assert.ok(validateComponentRecord(r).length);});

test('publication source check rejects wrong commit, digest and dirty source',()=>{
 const r=record();r.source.dirty=false;const current={...r.source};assert.deepEqual(validateCurrentSource(r,current),[]);
 for(const mutate of [s=>s.baseCommit='f'.repeat(40),s=>s.snapshotSha256='f'.repeat(64),s=>s.dirty=true]){const wrong={...current};mutate(wrong);assert.ok(validateCurrentSource(r,wrong).length);}
 r.source.dirty=true;assert.ok(validateCurrentSource(r,current).length);
});
test('coherent blocked CLI decision exits 2; wrong current source exits 1',()=>{
 const checker=fileURLToPath(new URL('./check-component-record.mjs',import.meta.url));const selected=fileURLToPath(new URL('../../specs/ops/08-release-gates/release-2026-10-11-components.json',import.meta.url));
 assert.equal(spawnSync(process.execPath,[checker,selected,'--decision']).status,2);
 assert.equal(spawnSync(process.execPath,[checker,selected,'--decision','--require-current-source']).status,1);
});
