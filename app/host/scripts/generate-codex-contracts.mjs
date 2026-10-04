import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.SPECOPS_CODEX_EXECUTABLE ?? 'codex';
const temporary = mkdtempSync(join(tmpdir(), 'specops-contracts-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CODEX_|OPENAI_|CHATGPT_|AZURE_OPENAI_)/.test(key)));
env.CODEX_HOME = join(temporary, 'home'); mkdirSync(env.CODEX_HOME, { mode: 0o700 });
const contracts = [
  'InitializeParams', 'InitializeResponse',
  'v2/LoginAccountParams', 'v2/LoginAccountResponse', 'v2/GetAccountParams', 'v2/GetAccountResponse',
  'v2/CancelLoginAccountParams', 'v2/CancelLoginAccountResponse', 'v2/LogoutAccountResponse',
  'v2/AccountLoginCompletedNotification', 'v2/AccountUpdatedNotification',
  'v2/ModelListParams', 'v2/ModelListResponse',
];
try {
  if (execFileSync(executable, ['--version'], { env, timeout: 5000, encoding: 'utf8' }).trim() !== 'codex-cli 0.160.0') throw new Error('Codex 0.160.0 required');
  for (const format of ['ts', 'json-schema']) execFileSync(executable, ['app-server', `generate-${format}`, '--out', join(temporary, format)], { env, timeout: 30000, stdio: 'pipe' });
  const destination = join(root, 'src/codex/generated'); rmSync(destination, { recursive: true, force: true }); mkdirSync(destination, { recursive: true });
  const copied = new Set();
  function copy(name) {
    if (copied.has(name)) return; copied.add(name);
    const source = readFileSync(join(temporary, 'ts', `${name}.ts`), 'utf8');
    const target = join(destination, `${name}.ts`); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, source);
    for (const match of source.matchAll(/from "([^"]+)"/g)) copy(join(dirname(name), match[1]));
  }
  for (const name of contracts) copy(name);
  const schemas = Object.fromEntries(contracts.map(name => [name, JSON.parse(readFileSync(join(temporary, 'json-schema', `${name.includes('/') ? name : 'v1/' + name}.json`), 'utf8'))]));
  writeFileSync(join(destination, 'control-plane.schema.json'), JSON.stringify(schemas, null, 2) + '\n');
  writeFileSync(join(destination, 'manifest.json'), JSON.stringify({ version: '0.160.0', experimental: false, contracts, license: 'Apache-2.0', documentation: 'https://learn.chatgpt.com/docs/app-server' }, null, 2) + '\n');
  console.log(`Generated ${copied.size} TypeScript contracts and ${contracts.length} schema contracts.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
