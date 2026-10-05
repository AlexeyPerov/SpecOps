import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.SPECOPS_CODEX_EXECUTABLE ?? 'codex';
const temporary = mkdtempSync(join(tmpdir(), 'specops-contracts-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SystemRoot|WINDIR|COMSPEC|PATHEXT|TMP|TEMP|TMPDIR|LANG|LC_[A-Z_]+|TERM|COLORTERM)$/i.test(key)));
env.CODEX_HOME = join(temporary, 'home'); mkdirSync(env.CODEX_HOME, { mode: 0o700 });
env.HOME = env.CODEX_HOME; env.USERPROFILE = env.CODEX_HOME;
const contracts = [
  'InitializeParams', 'InitializeResponse',
  'v2/SkillsListParams', 'v2/SkillsListResponse', 'v2/SkillsConfigWriteParams', 'v2/SkillsConfigWriteResponse',
  'v2/ConfigReadParams', 'v2/ConfigReadResponse', 'v2/ConfigValueWriteParams', 'v2/ConfigWriteResponse',
  'v2/ListMcpServerStatusParams', 'v2/ListMcpServerStatusResponse',
  'v2/McpServerRefreshResponse',
  'v2/LoginAccountParams', 'v2/LoginAccountResponse', 'v2/GetAccountParams', 'v2/GetAccountResponse',
  'v2/CancelLoginAccountParams', 'v2/CancelLoginAccountResponse', 'v2/LogoutAccountResponse',
  'v2/GetAccountRateLimitsResponse', 'v2/AccountRateLimitsUpdatedNotification',
  'v2/AccountLoginCompletedNotification', 'v2/AccountUpdatedNotification',
  'v2/ModelListParams', 'v2/ModelListResponse',
  'v2/ThreadStartParams', 'v2/ThreadStartResponse', 'v2/ThreadReadParams', 'v2/ThreadReadResponse',
  'v2/ThreadTurnsListParams', 'v2/ThreadTurnsListResponse', 'v2/ThreadItemsListParams', 'v2/ThreadItemsListResponse',
  'v2/CollaborationModeListParams', 'v2/CollaborationModeListResponse', 'v2/ThreadResumeParams', 'v2/ThreadResumeResponse', 'v2/TurnStartParams', 'v2/TurnStartResponse',
  'v2/ThreadForkParams', 'v2/ThreadForkResponse', 'v2/ThreadRevertParams', 'v2/ThreadRevertResponse',
  'v2/ThreadCompactStartParams', 'v2/ThreadCompactStartResponse', 'v2/TurnSteerParams', 'v2/TurnSteerResponse',
  'v2/TurnInterruptParams', 'v2/TurnInterruptResponse', 'v2/TurnStartedNotification', 'v2/TurnCompletedNotification',
  'v2/ItemStartedNotification', 'v2/ItemCompletedNotification', 'v2/AgentMessageDeltaNotification',
  'v2/ReasoningSummaryTextDeltaNotification', 'v2/ReasoningTextDeltaNotification',
  'v2/CommandExecutionOutputDeltaNotification', 'v2/ThreadTokenUsageUpdatedNotification',
  'v2/CommandExecutionRequestApprovalParams', 'v2/CommandExecutionRequestApprovalResponse',
  'v2/FileChangeRequestApprovalParams', 'v2/FileChangeRequestApprovalResponse',
  'v2/ToolRequestUserInputParams', 'v2/ToolRequestUserInputResponse',
];
try {
  if (execFileSync(executable, ['--version'], { env, timeout: 5000, encoding: 'utf8' }).trim() !== 'codex-cli 0.160.0') throw new Error('Codex 0.160.0 required');
  for (const format of ['ts', 'json-schema']) execFileSync(executable, ['app-server', `generate-${format}`, '--experimental', '--out', join(temporary, format)], { env, timeout: 30000, stdio: 'pipe' });
  const destination = join(root, 'src/codex/generated'); rmSync(destination, { recursive: true, force: true }); mkdirSync(destination, { recursive: true });
  const copied = new Set();
  function copy(name) {
    if (copied.has(name)) return; copied.add(name);
    const source = readFileSync(join(temporary, 'ts', `${name}.ts`), 'utf8');
    const target = join(destination, `${name}.ts`); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, source);
    for (const match of source.matchAll(/from "([^"]+)"/g)) copy(join(dirname(name), match[1]));
  }
  for (const name of contracts) copy(name);
  const schemas = Object.fromEntries(contracts.map(name => [name, JSON.parse(readFileSync(join(temporary, 'json-schema', `${name.includes('RequestApproval') || name.includes('ToolRequestUserInput') ? name.split('/').at(-1) : name.includes('/') ? name : 'v1/' + name}.json`), 'utf8'))]));
  writeFileSync(join(destination, 'control-plane.schema.json'), JSON.stringify(schemas, null, 2) + '\n');
  writeFileSync(join(destination, 'manifest.json'), JSON.stringify({ version: '0.160.0', experimental: true, contracts, license: 'Apache-2.0', documentation: 'https://learn.chatgpt.com/docs/app-server' }, null, 2) + '\n');
  console.log(`Generated ${copied.size} TypeScript contracts and ${contracts.length} schema contracts.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
