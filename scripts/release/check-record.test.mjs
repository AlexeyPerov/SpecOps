import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRecord } from './check-record.mjs';
const record=JSON.parse(readFileSync(new URL('../../specs/ops/08-release-gates/release-2026-10-05.json',import.meta.url),'utf8'));
test('complete source evidence retains explicit external release blockers',()=>assert.deepEqual(validateRecord(record),[]));
test('source passes cannot fabricate ready decision',()=>assert.match(validateRecord({...record,recommendation:'ready'}).join('\n'),/unresolved/));
test('required acceptance cannot be silently excluded',()=>{const r=structuredClone(record);r.gates.find(g=>g.scope==='installed').status='excluded';assert.match(validateRecord(r).join('\n'),/Required gate excluded/);});
test('invalid and duplicate status records fail closed',()=>{const r=structuredClone(record);r.gates[0].status='done';r.gates.push(r.gates[0]);assert.equal(validateRecord(r).length>=2,true);});
test('missing account scope and false roadmap closure fail closed',()=>{const r=structuredClone(record);r.gates=r.gates.filter(g=>g.scope!=='account');r.roadmapComplete=true;assert.equal(validateRecord(r).length>=2,true);});

test('deleting an individual required lifecycle gate fails closed',()=>{const r=structuredClone(record);r.gates=r.gates.filter(g=>g.id!=='cursor-live-lifecycle');assert.match(validateRecord(r).join('\n'),/cursor-live-lifecycle/);});
test('changed pin, unknown runtime and changed support identity fail closed',()=>{for(const mutate of [r=>r.runtimes[0].version='next',r=>r.runtimes[0].id='other',r=>r.platform.arch='x64',r=>r.distribution='signed installed']){const r=structuredClone(record);mutate(r);assert.notDeepEqual(validateRecord(r),[]);}});

test('relabeling account/installed gates as source cannot bypass acceptance',()=>{const r=structuredClone(record);r.gates.find(g=>g.id==='cursor-installed-lifecycle').scope='source';assert.match(validateRecord(r).join('\n'),/Changed gate scope/);});

test('all statuses pass cannot accept this source-only distribution',()=>{const r=structuredClone(record);for(const g of r.gates)if(g.required)g.status='pass';r.recommendation='ready';assert.match(validateRecord(r).join('\n'),/Source-only distribution/);});
test('malformed collection and invalid timestamp fail closed',()=>{assert.notDeepEqual(validateRecord({gates:{},runtimes:[]}),[]);assert.notDeepEqual(validateRecord(null),[]);const r=structuredClone(record);r.recordedAt='2026-99-99T99:99:99Z';assert.notDeepEqual(validateRecord(r),[]);});
