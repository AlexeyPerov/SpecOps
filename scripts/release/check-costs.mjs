// Validate externally collected installed measurements. Collection must identify its signed build.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function checkCosts(measurements,budgets){
 const errors=[];const m=measurements;
 if(!m || m.schemaVersion!==1 || m.kind!=='signed-installed' || !/^[a-f0-9]{64}$/.test(m.appSha256??'') || !m.signingTeam || !m.notarizationId || !m.workspaceIdentity || m.target!=='darwin-arm64' || !m.networkContext) return ['Missing signed installed measurement context'];
 const checks={editorStartupMs:budgets.base.editorStartupP95Ms,editorRssBytes:budgets.base.editorRssBytes,ownedAgentProcessesAtEditorIdle:budgets.base.ownedAgentProcessesAtEditorIdle,installedHostReadyMs:budgets.agent.installedHostReadyP95Ms,firstUseNativeReadyMs:budgets.agent.firstUseNativeReadyP95Ms,localRuntimeRssBytes:budgets.agent.localRuntimeRssBytes};
 if(!Array.isArray(m.runs) || m.runs.length!==budgets.measurement.repetitions) return ['Require ten same-build measurement runs'];
 for(const [key,max] of Object.entries(checks)){
  const values=m.runs.map(r=>r?.[key]);
  if(values.some(v=>!Number.isFinite(v)||v<0)){errors.push(`Missing measurement ${key}`);continue;}
  const p95=[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1];if(p95>max)errors.push(`Budget exceeded ${key}`);
 }
 for(const [key,max] of [['compressedInstallerBytes',budgets.base.compressedBytes],['unpackedBaseBytes',budgets.base.unpackedBytes],['allActiveComponentsBytes',budgets.storage.allFourActiveComponentsBytes],['cacheBytes',budgets.storage.cacheBytes]]) if(!Number.isSafeInteger(m[key]) || m[key]<0 || m[key]>max) errors.push(`Invalid or exceeded ${key}`);
 for(const id of ['node','codex','opencode','claude','cursor']){
  const c=m.componentCosts?.[id];if(!c || !Number.isSafeInteger(c.transferBytes)||c.transferBytes<=0||!Number.isSafeInteger(c.diskBytes)||c.diskBytes<=0||!Number.isFinite(c.installMs)||c.installMs<0)errors.push(`Missing first-use component cost ${id}`);
 }
 const componentDisk=Object.values(m.componentCosts??{}).reduce((sum,c)=>sum+(Number.isSafeInteger(c?.diskBytes)?c.diskBytes:0),0);
 if(componentDisk!==m.allActiveComponentsBytes)errors.push('Active disk must equal all-five component disk with shared Node counted once');
 if(!/^[a-f0-9]{64}$/.test(m.baseline?.appSha256??'') || !m.baseline?.signingTeam || !m.baseline?.comparisonEvidence)errors.push('Missing exact A baseline comparison');
 return errors;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const errors=checkCosts(JSON.parse(readFileSync(process.argv[2])),JSON.parse(readFileSync(new URL('../../specs/ops/09-plugin-based-usage/delivery-budgets.json',import.meta.url))));if(errors.length)throw Error(errors.join('\n'));console.log('Installed costs meet selected numeric budgets');}catch(e){console.error(e.message);process.exitCode=1;}}
