// AS09 selected release gate; historical AS08 records remain independently valid.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
export const pins = {node:'24.15.0',codex:'0.160.0',opencode:'1.17.4',claude:'0.3.289',cursor:'1.0.35'};
export const gates = {
 'source-regression':'source', 'native-install-managed-controls':'source', 'lean-base-inventory':'source',
 'bootstrap-security':'source', 'maintenance-security':'source', 'subset-recovery-handoff-fixtures':'source',
 'trusted-production-catalog':'distribution', 'artifact-hosting':'distribution', 'distribution-clearance':'distribution',
 'signed-notarized-app':'distribution', 'component-signing-quarantine':'distribution', 'component-notices':'distribution',
 'installed-editor-offline':'installed', 'installed-subsets-concurrency-recovery':'installed',
 'installed-handoff-16-pairs':'account', 'actual-two-codex-accounts':'account', 'native-store-update-rollback':'installed',
 'quit-crash-descendant-cleanup':'process', 'baseline-size-startup-memory-budgets':'installed', 'selected-platform':'platform',
 ...Object.fromEntries(['codex','opencode','claude','cursor'].flatMap(id=>[[`${id}-installed-lifecycle`,'installed'],[`${id}-account-lifecycle`,'account']]))
};
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validateComponentRecord(r) {
 const errors=[];
 if (!r || r.schemaVersion!==2 || r.selectedScope!=='optional-agent-components') return ['Unknown selected component release schema'];
 if (!/^\d{4}-\d{2}-\d{2}T/.test(r.recordedAt??'') || !Number.isFinite(Date.parse(r.recordedAt)) || !/^[a-f0-9]{40}$/.test(r.source?.baseCommit??'') || typeof r.source?.dirty!=='boolean' || !hash(r.source?.snapshotSha256)) errors.push('Missing exact source snapshot identity');
 if (r.platform?.os!=='darwin' || r.platform?.arch!=='arm64' || !r.platform?.osVersion || !r.platform?.osBuild) errors.push('Unsupported selected platform');
 if (r.app?.version!=='0.3.0' || r.host?.version!=='0.1.0' || !hash(r.host?.sha256)) errors.push('Missing app/host identity');
 if (!['blocked','ready'].includes(r.recommendation) || !Array.isArray(r.gates) || !Array.isArray(r.components)) return [...errors,'Malformed decision or collections'];
 if (r.components.length!==5 || new Set(r.components.map(c=>c?.id)).size!==5) errors.push('Must identify all five components');
 for(const c of r.components) if(!c || pins[c.id]!==c.version || c.target!=='darwin-arm64' || !hash(c.archiveSha256) || !Number.isSafeInteger(c.compressedBytes) || c.compressedBytes<=0 || !Number.isSafeInteger(c.unpackedBytes) || c.unpackedBytes<=0) errors.push('Invalid component identity/cost');
 const seen=new Set();
 for(const g of r.gates){
  if(!g || seen.has(g.id) || !Object.hasOwn(gates,g.id) || gates[g.id]!==g.scope || g.required!==true || !['pass','fail','not-run','unavailable'].includes(g.status) || typeof g.evidence!=='string' || !g.evidence.trim()) errors.push('Invalid or duplicate gate');
  seen.add(g?.id);
 }
 for(const id of Object.keys(gates)) if(!seen.has(id)) errors.push(`Missing gate ${id}`);
 const blocked=r.gates.some(g=>g?.status!=='pass');
 if(r.recommendation==='ready'){
  if(blocked) errors.push('Ready has unresolved gates');
  if(r.source?.dirty) errors.push('Ready source must be committed');
  if(!hash(r.app?.sha256) || !r.app.signingTeam || !r.app.notarizationId || !hash(r.catalog?.sha256) || !Number.isSafeInteger(r.catalog?.revision) || r.catalog.revision<1 || !r.catalog?.keyId || !/^https:\/\//.test(r.catalog?.url??'')) errors.push('Ready needs production app/catalog identities');
  for(const c of r.components) if(!hash(c.manifestSha256) || !c.signingIdentity || c.distribution!=='approved' || !/^https:\/\//.test(c.url??'') || !c.noticeEvidence) errors.push('Ready needs accepted component delivery identities');
  const delivery=JSON.stringify({app:r.app,catalog:r.catalog,components:r.components});
  if(delivery.includes('fixture-v1') || delivery.includes('.invalid')) errors.push('Fixture identity cannot authorize release');
  if(!Array.isArray(r.advertisedTargets) || JSON.stringify(r.advertisedTargets)!=='["darwin-arm64"]') errors.push('Untested advertised platform');
 }
 if(r.recommendation==='blocked' && !blocked) errors.push('Blocked without unresolved gates');
 if(r.roadmapComplete!== (r.recommendation==='ready')) errors.push('Milestone decision inconsistent');
 return errors;
}
export function validateCurrentSource(r,current){
 return current.baseCommit!==r.source?.baseCommit || current.snapshotSha256!==r.source?.snapshotSha256 || current.dirty || r.source?.dirty ? ['Selected evidence does not match clean current source'] : [];
}
export function currentSourceIdentity(root=resolve(fileURLToPath(new URL('../..',import.meta.url)))) {
 const excluded=new Set(['specs/ops/09-plugin-based-usage/lean-base-candidate.json','specs/ops/08-release-gates/release-2026-10-11-components.json']);
 const names=[...new Set(execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd:root}).toString().split('\0').filter(Boolean))].sort();
 const digest=createHash('sha256');
 for(const name of names){if(excluded.has(name))continue;digest.update(name+'\0');try{digest.update(readFileSync(resolve(root,name)));}catch{digest.update('<missing>');}}
 return {baseCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()),snapshotSha256:digest.digest('hex')};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const r=JSON.parse(readFileSync(process.argv[2],'utf8'));const errors=validateComponentRecord(r);if(process.argv.includes('--require-current-source')){errors.push(...validateCurrentSource(r,currentSourceIdentity()));}if(errors.length) throw Error(errors.join('\n'));console.log(JSON.stringify({valid:true,recommendation:r.recommendation,blockers:r.gates.filter(g=>g.status!=='pass').map(g=>g.id)},null,2));if(process.argv.includes('--decision') && r.recommendation!=='ready') process.exitCode=2;}catch(e){console.error(e.message);process.exitCode=1;}
}
