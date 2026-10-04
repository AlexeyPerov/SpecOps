import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Query, Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeRuntimeAdapter } from "./adapter";
import { ClaudeFixtureDriver, fixturePath } from "./fixtures";
import { CLAUDE_NATIVE_VERSION, CLAUDE_SDK_VERSION } from "./runtime";
import { collectContractEvents } from "../../../src/lib/session/adapter/adapter.contract";
import { asSpecOpsTurnId } from "../../../src/lib/session/ids";
const roots: string[] = [], adapters: ClaudeRuntimeAdapter[] = [];
const key = "fixture-private-key-canary";
afterEach(() => { adapters.splice(0).forEach(a => a.close()); roots.splice(0).forEach(p => rmSync(p, {recursive:true,force:true})); });
class FaultDriver extends ClaudeFixtureDriver {
  fault?: string;
  override async query(input: {prompt: AsyncIterable<SDKUserMessage>; options: Options}): Promise<Query> {
    const original = await super.query(input), fault = this.fault;
    if (!fault) return original;
    return {supportedModels: () => original.supportedModels(), close: () => original.close(), async *[Symbol.asyncIterator]() {
      for await (const event of original) {
        if (event.type === "system" && event.subtype === "init") {
          yield event;
          if (fault === "disconnect") return;
          if (fault === "exception") throw new Error(key);
          if (fault.startsWith("result:")) yield {type:"result", subtype:fault.slice(7), is_error:true,total_cost_usd:0,usage:{input_tokens:0,output_tokens:0},session_id:event.session_id,uuid:"fault",errors:[key]} as never;
          else yield {type:"assistant",error:fault,session_id:event.session_id,uuid:"fault",message:{content:[{type:"text",text:key}]}} as never;
          return;
        }
      }
    }} as unknown as Query;
  }
}
async function setup() {
  const path = mkdtempSync(join(tmpdir(),"specops-hardening-")); roots.push(path);
  const driver = new FaultDriver(fixturePath(path));
  const adapter = new ClaudeRuntimeAdapter({profileRoot:path,assets:()=>({sdk:"fixture",executable:"fixture",sdkVersion:CLAUDE_SDK_VERSION,nativeVersion:CLAUDE_NATIVE_VERSION}),verifyKey:async()=>{},probe:async()=>[{value:"native-model",displayName:"Native model"}],sessionDriver:()=>driver}); adapters.push(adapter);
  const p=adapter.store.create("First"), second=adapter.store.create("Second");
  adapter.store.saveKey(p.id,key);adapter.store.saveKey(second.id,"second-profile-canary");
  const create=(id:string)=>adapter.createSession({runtimeId:"claude",connectionProfileId:id,workspaceRootPath:path,modelId:"native-model"});
  const a=await create(p.id),b=await create(second.id);
  return {adapter,driver,path,p,second,a,b};
}
it.each([
 ["authentication_failed","API key"], ["account_on_hold","on hold"], ["verification_required","verification"], ["billing_error","billing or quota"], ["rate_limit","rate limited"], ["overloaded","overloaded"], ["server_error","connectivity"], ["model_not_found","model is unavailable"], ["invalid_request","request was rejected"], ["max_output_tokens","output limit"], ["result:error_max_turns","turn limit"], ["result:error_max_budget_usd","query budget"], ["disconnect","resume explicitly"], ["exception","resume explicitly"], [key,"resume explicitly"],
])("scopes native %s failure without raw errors, replay, new binding or account rotation", async(fault,recovery)=>{
 const {adapter,driver,path,p,second,a,b}=await setup();const generation=adapter.snapshot(p).generation;
 const request=(native:typeof a)=>({native,workspaceRootPath:path,prompt:"hello",turnId:asSpecOpsTurnId("fault"),context:{clientUserMessageId:"stable-user"}});
 driver.fault=fault;const events=await collectContractEvents(adapter.send(request(a)));
 expect(events.filter(e=>e.type==="turn.failed")).toHaveLength(1);expect(events.at(-1)).toMatchObject({type:"turn.failed",message:expect.stringContaining(recovery)});
 expect(JSON.stringify(events)).not.toContain(key);expect(JSON.stringify(adapter.snapshot(p))).not.toContain(key);
 expect(adapter.snapshot(p).generation).toBe(generation);expect(adapter.store.readKey(p.id)).toBe(key);expect(adapter.store.readKey(second.id)).toBe("second-profile-canary");
 const calls=driver.calls.length;await new Promise(resolve=>setTimeout(resolve,20));expect(driver.calls).toHaveLength(calls);
 driver.fault=undefined;expect((await collectContractEvents(adapter.send(request(b)))).at(-1)?.type).toBe("turn.finished");
 const resumed=await adapter.resumeSession({native:a,workspaceRootPath:path});expect(resumed.nativeSessionId).toBe(a.nativeSessionId);expect(resumed.history?.filter(m=>m.role==="user")).toHaveLength(1);
 expect(JSON.stringify(resumed)).not.toContain(key);
 const binding=readFileSync(join(path,p.id,`session-${a.nativeSessionId}.json`),"utf8");expect(binding).not.toContain(key);
});
it("redacts native history, normalized cache and diagnostic metadata while native credential storage stays private",async()=>{
 const {adapter,path,p,a}=await setup();const events=await collectContractEvents(adapter.send({native:a,workspaceRootPath:path,prompt:"secret",turnId:asSpecOpsTurnId("secret")}));
 const resumed=await adapter.resumeSession({native:a,workspaceRootPath:path});const common=JSON.stringify({events,resumed,profile:adapter.snapshot(p)});
 for(const canary of [key,"contract-token-canary","contract-bearer-canary","contract-secret-canary"])expect(common).not.toContain(canary);
 // Native transcript ownership is private: common hydration must redact what the native runtime retained.
 expect(readFileSync(fixturePath(path),"utf8")).toContain(key);
 expect(readFileSync(join(adapter.store.home(p.id),"credential"),"utf8")).toBe(key);
});
it("actual pinned SDK child death settles the adapter once and suppresses native stderr credentials",async()=>{
 const {writeFileSync}=await import("node:fs");const {loadClaudeSdk,resolveClaudeAssets}=await import("./runtime");
 const path=mkdtempSync(join(tmpdir(),"specops-sdk-death-"));roots.push(path);
 const executable=join(path,"native.mjs");
 writeFileSync(executable,`#!/usr/bin/env node\nimport {createInterface} from 'node:readline';createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='control_request'&&m.request.subtype==='initialize')process.stdout.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{commands:[],models:[{value:'native-model',displayName:'Native model'}],agents:[]}}})+'\\n');if(m.type==='user'){process.stderr.write(process.env.ANTHROPIC_API_KEY);process.exit(7);}});`,{mode:0o700});
 const sdk=await loadClaudeSdk(resolveClaudeAssets());
 const adapter=new ClaudeRuntimeAdapter({profileRoot:path,assets:()=>({...resolveClaudeAssets(),executable}),probe:async()=>[{value:"native-model",displayName:"Native model"}],verifyKey:async()=>{},sessionDriver:()=>({query:async input=>sdk.query(input),history:async()=>({exists:false,messages:[]})})});adapters.push(adapter);
 const profile=adapter.store.create("Child fault");adapter.store.saveKey(profile.id,key);
 const native=await adapter.createSession({runtimeId:"claude",workspaceRootPath:path,connectionProfileId:profile.id,modelId:"native-model"});
 const events=await collectContractEvents(adapter.send({native,workspaceRootPath:path,prompt:"hello",turnId:asSpecOpsTurnId("child-death")}));
 expect(events.filter(e=>e.type==="turn.failed")).toHaveLength(1);expect(JSON.stringify(events)).not.toContain(key);
 expect(adapter.store.readKey(profile.id)).toBe(key);await expect(adapter.resumeSession({native,workspaceRootPath:path})).rejects.toMatchObject({code:"session-not-found"});
},15000);

it("redacts credential canaries in native transcript identities and normalized envelopes",async()=>{
 const {writeFileSync}=await import("node:fs");const {adapter,driver,path,a}=await setup();
 await collectContractEvents(adapter.send({native:a,workspaceRootPath:path,prompt:"hello",turnId:asSpecOpsTurnId("identity")}));
 const db=JSON.parse(readFileSync(fixturePath(path),"utf8"));
 const assistant=db[a.nativeSessionId].find((m:any)=>m.type==="assistant");assistant.uuid=`identity-${key}`;assistant.message.id=`item-${key}`;assistant.message.content.push({type:"tool_use",id:`tool-${key}`,name:"Read",input:{[key]:key}});
 writeFileSync(fixturePath(path),JSON.stringify(db));const calls=driver.calls.length;
 const history=await adapter.resumeSession({native:a,workspaceRootPath:path});expect(JSON.stringify(history)).not.toContain(key);expect(driver.calls).toHaveLength(calls);expect(history.nativeSessionId).toBe(a.nativeSessionId);
});
