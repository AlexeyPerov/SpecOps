/** Account-free native control-plane fixture. All values are synthetic canaries. */
export const controlPlaneFixture = `#!/usr/bin/env node
if (process.argv.includes('--version')) { const version = 'codex-cli ' + (process.env.SPECOPS_FIXTURE_VERSION || '0.160.0'); if (process.env.SPECOPS_FIXTURE_SLOW_VERSION) setTimeout(() => { console.log(version); process.exit(0); }, 150); else { console.log(version); process.exit(0); } }
const readline = require('node:readline');
let account = null; let login = 0;
readline.createInterface({ input: process.stdin }).on('line', line => {
 const req = JSON.parse(line);
 if (req.id === undefined) return;
 let result = {};
 if (req.method === 'initialize') result = process.env.SPECOPS_FIXTURE_BAD_INIT ? { invalid: true } : { userAgent: 'fixture', codexHome: process.env.CODEX_HOME, platformFamily: 'unix', platformOs: 'macos' };
 if (req.method === 'account/read') result = { account, requiresOpenaiAuth: true };
 if (req.method === 'model/list') result = { data: [{ id: 'fixture-model', model: 'fixture-model', displayName: 'Fixture model', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }], defaultReasoningEffort: 'medium', isDefault: true }], nextCursor: null };
 if (req.method === 'collaborationMode/list') result = { data: [{ name: 'Default', mode: 'default' }, { name: 'Plan', mode: 'plan' }] };
 if (req.method === 'thread/start') result = { thread: { id: 'same-native-id', historyMode: 'legacy' }, model: 'fixture-model' };
 if (req.method === 'account/logout') account = null;
 if (req.method === 'account/login/start') {
   if (req.params.type === 'apiKey') { account = { type: 'apiKey' }; result = { type: 'apiKey' }; }
   else if (req.params.type === 'chatgptDeviceCode') result = { type: 'chatgptDeviceCode', loginId: 'login-' + (++login), verificationUrl: 'https://auth.openai.com/device', userCode: 'DEVICE-CANARY' };
   else result = { type: 'chatgpt', loginId: 'login-' + (++login), authUrl: 'https://auth.openai.com/authorize?code=AUTH-URL-CANARY' };
 }
 if (req.method === 'fixture/complete') { account = { type: 'chatgpt', email: 'profile@example.test', planType: 'plus' }; process.stdout.write(JSON.stringify({ method: 'account/login/completed', params: { loginId: req.params.loginId, success: true, error: null, onboardingEntrypoint: null } }) + '\\n'); }
 if (req.method === 'fixture/descendant') { const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); result = { pid: child.pid }; }
 if (req.method === 'fixture/notify') process.stdout.write(JSON.stringify({ method: req.params.method, params: req.params.params }) + '\\n');
 if (req.method === 'fixture/env') result = { CODEX_HOME: process.env.CODEX_HOME, OPENAI_API_KEY: process.env.OPENAI_API_KEY || null, CODEX_API_KEY: process.env.CODEX_API_KEY || null, PATH: process.env.PATH, WORKSPACE_FIXTURE: process.env.WORKSPACE_FIXTURE };
 process.stdout.write(JSON.stringify({ id: req.id, result }) + '\\n');
});
`;
