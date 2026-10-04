// Release decisions require explicit evidence; source checks cannot accept an installed build.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const requiredGates = ['full-regression', 'shared-workspace', 'runtime-failure-isolation', 'handoff-16-pairs', 'secret-bounded-protocol', 'copied-assets', 'actual-two-codex-accounts', 'actual-handoff-16-pairs', 'native-policy-and-extensions', 'distribution-clearance', 'selected-platform', 'manual-descendant-cleanup', ...['codex', 'opencode', 'claude', 'cursor'].flatMap(r => ['source-lifecycle', 'live-lifecycle', 'installed-lifecycle'].map(s => `${r}-${s}`))];
export const statuses = new Set(['pass', 'fail', 'not-run', 'excluded']);
export function validateRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || !Array.isArray(record.runtimes) || !Array.isArray(record.gates) || record.runtimes.some(r => !r || typeof r !== 'object') || record.gates.some(g => !g || typeof g !== 'object')) return ['Malformed release record'];
  if (record.schemaVersion !== 1 || (!/^\d{4}-\d{2}-\d{2}T/.test(record.recordedAt ?? '') || !Number.isFinite(Date.parse(record.recordedAt))) || !/^[a-f0-9]{40}$/.test(record.sourceCommit ?? '')) errors.push('Invalid record identity');
  if (!['blocked', 'ready'].includes(record.recommendation)) errors.push('Invalid recommendation');
  const pins = {codex:'0.160.0',opencode:'1.17.4',claude:'0.3.289',cursor:'1.0.35'};
  if (record.platform?.os !== 'darwin' || record.platform?.arch !== 'arm64' || record.platform?.node !== '24.15.0' || record.platform?.osVersion !== '14.4' || record.platform?.osBuild !== '23E214' || record.distribution !== 'source checkout and copied adjacent no-account payload; signed installed app not accepted') errors.push('Changed selected platform/distribution contract');
  for (const path of ['app/host/dist/claude/assets.json','app/host/dist/cursor/assets.json','app/host/dist/index.js','app/src-tauri/binaries/opencode-aarch64-apple-darwin']) if (!/^[a-f0-9]{64}$/.test(record.assetSha256?.[path] ?? '')) errors.push(`Missing asset identity ${path}`);
  if (!Array.isArray(record.runtimes) || record.runtimes.length !== 4 || new Set(record.runtimes.map(r => r.id)).size !== 4) errors.push('Record must identify all four selected runtimes');
  for (const runtime of record.runtimes ?? []) {
    if (!['codex', 'opencode', 'claude', 'cursor'].includes(runtime.id) || runtime.version !== pins[runtime.id] || !Array.isArray(runtime.constraints) || !runtime.constraints.length) errors.push('Invalid runtime contract');
  }
  if (!Array.isArray(record.gates) || !record.gates.length) errors.push('Missing gates');
  const ids = new Set();
  for (const gate of record.gates ?? []) {
    if (!gate.id || ids.has(gate.id)) errors.push('Duplicate/missing gate ID');
    ids.add(gate.id);
    if (!statuses.has(gate.status) || typeof gate.required !== 'boolean' || typeof gate.evidence !== 'string' || !gate.evidence.trim() || !['source', 'installed', 'account', 'distribution', 'platform', 'process'].includes(gate.scope)) errors.push(`Invalid gate ${gate.id}`);
    if (gate.required && gate.status === 'excluded') errors.push(`Required gate excluded: ${gate.id}`);
  }
  for (const scope of ['source', 'installed', 'account', 'distribution', 'platform', 'process']) if (!(record.gates ?? []).some(g => g.scope === scope && g.required)) errors.push(`Missing required ${scope} gate`);
  for (const id of requiredGates) if (!(record.gates ?? []).some(g => g.id === id && g.required)) errors.push(`Missing required gate ${id}`);
  const blockers = (record.gates ?? []).filter(g => g.required && g.status !== 'pass');
  for (const gate of record.gates ?? []) {
    const expectedScope = gate.id.endsWith('-source-lifecycle') || ['full-regression','shared-workspace','runtime-failure-isolation','handoff-16-pairs','secret-bounded-protocol','copied-assets'].includes(gate.id) ? 'source' : gate.id.endsWith('-live-lifecycle') || ['actual-two-codex-accounts','actual-handoff-16-pairs','native-policy-and-extensions'].includes(gate.id) ? 'account' : gate.id.endsWith('-installed-lifecycle') ? 'installed' : gate.id === 'distribution-clearance' ? 'distribution' : gate.id === 'selected-platform' ? 'platform' : gate.id === 'manual-descendant-cleanup' ? 'process' : undefined;
    if (expectedScope && gate.scope !== expectedScope) errors.push(`Changed gate scope ${gate.id}`);
  }
  if (record.recommendation === 'ready' && record.distribution.includes('not accepted')) errors.push('Source-only distribution cannot advertise ready');
  if (record.recommendation === 'ready' && blockers.length) errors.push('Ready recommendation has unresolved required gates');
  if (record.recommendation === 'blocked' && !blockers.length) errors.push('Blocked recommendation has no blockers');
  if (record.roadmapComplete !== false) errors.push('This expanded source record cannot close the active roadmap');
  return errors;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const record = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const errors = validateRecord(record);
    if (errors.length) throw new Error(errors.join('\n'));
    const blockers = record.gates.filter(g => g.required && g.status !== 'pass').map(g => g.id);
    console.log(JSON.stringify({valid:true,recommendation:record.recommendation,blockers},null,2));
    if (process.argv.includes('--decision') && record.recommendation !== 'ready') process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
