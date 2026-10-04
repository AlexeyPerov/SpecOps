import { expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { loadClaudeSdk, resolveClaudeAssets } from "./runtime";
import { ClaudeInteractions } from "./interactions";
import { ClaudeTurn } from "./turn";
import { ClaudeProcessOwner } from "./session";
import { asNativeSessionId, asSpecOpsTurnId } from "../../../src/lib/session/ids";
it("roundtrips native control wire through the actual pinned SDK callback dispatcher without an account", async () => {
  const root = mkdtempSync(join(tmpdir(), "specops-sdk-wire-"));
  const fixture = join(root, "wire.mjs");
  writeFileSync(fixture, `import {createInterface} from 'node:readline'; let responses=0; const send=x=>process.stdout.write(JSON.stringify(x)+'\\n'); createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line); if(m.type==='control_request'&&m.request.subtype==='initialize'){send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{commands:[],models:[{value:'fixture-model',displayName:'Fixture'}],agents:[]}}});send({type:'control_request',request_id:'wire-permission',request:{subtype:'can_use_tool',tool_name:'Write',tool_use_id:'wire-tool',input:{file_path:'file',content:'text'},suppress_always_allow_rule:true}});} else if(m.type==='control_response'){send({type:'system',subtype:'wire_response',session_id:'wire-session',uuid:'wire-result',response:m.response.response}); if(++responses===1)send({type:'control_request',request_id:'wire-dialog',request:{subtype:'request_user_dialog',dialog_kind:'future-dialog',payload:{prompt:'Unknown'}}});}});`);
  const owner = new ClaudeProcessOwner();
  const turn = new ClaudeTurn({native: {runtimeId: "claude", nativeSessionId: asNativeSessionId("wire-session"), connectionProfileId: "wire-profile"}, turnId: asSpecOpsTurnId("wire-turn"), workspaceRootPath: root, prompt: ""}, "wire-user", 1, "wire-secret-canary", owner, () => 1, () => true, x => x, 5000);
  const interaction = new ClaudeInteractions(turn);
  const abort = new AbortController();
  const sdk = await loadClaudeSdk(resolveClaudeAssets());
  async function* idle() { await new Promise<void>(resolve => abort.signal.addEventListener("abort", () => resolve(), {once: true})); }
  const q = sdk.query({prompt: idle(), options: {cwd: root, env: {HOME:root, CLAUDE_CONFIG_DIR:root}, pathToClaudeCodeExecutable: fixture, abortController:abort, tools: [], settingSources:[], canUseTool:interaction.canUseTool, onUserDialog:interaction.onUserDialog, supportedDialogKinds:[], spawnClaudeCodeProcess: () => { const child = spawn(process.execPath, [fixture], {cwd:root, env:{}, stdio:["pipe", "pipe", "pipe"]}); owner.own(child); child.stderr!.resume(); return child as any; }}});
  try {
    expect(await q.supportedModels()).toMatchObject([{value:"fixture-model"}]);
    const events = turn.events()[Symbol.asyncIterator]();
    await events.next();
    const event = (await events.next()).value as any;
    expect(event.request.payload.allowAlways).toBe(false);
    interaction.reply(event.request.permissionId, "permission", "once");
    const iterator = q[Symbol.asyncIterator]();
    const result = await iterator.next();
    expect((result.value as any).response).toMatchObject({behavior:"allow", updatedInput:{file_path:"file",content:"text"}, toolUseID:"wire-tool"});
    const cancelled = await iterator.next();
    expect((cancelled.value as any).response).toEqual({behavior:"cancelled"});
  } finally { abort.abort(); q.close(); await turn.stop(); rmSync(root, {recursive:true,force:true}); }
}, 10000);
