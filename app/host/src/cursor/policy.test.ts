import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CursorRuntimeAdapter } from "./adapter";
import { CursorFixtureDriver } from "./fixtures";
import { CURSOR_SDK_VERSION, resolveCursorAssets } from "./runtime";
import { cursorParameters, cursorPolicy } from "./policy";
import { nativeCursorDriver } from "./session";
import { asSpecOpsTurnId } from "../../../src/lib/session/ids";
const roots: string[] = [], adapters: CursorRuntimeAdapter[] = [];
const key = "cursor-config-private-canary";
function root() { const r = mkdtempSync(join(tmpdir(),"specops-cursor-policy-")); roots.push(r); return r; }
afterEach(async()=>{await Promise.all(adapters.splice(0).map(a=>a.close()));for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
async function connected() {
  const path=root(), workspace=root(), driver=new CursorFixtureDriver(join(path,"fixture.json")); let controls=0;
  const a=new CursorRuntimeAdapter({profileRoot:path,assets:()=>({root:"fixture",sdk:"fixture",worker:"fixture",sdkVersion:CURSOR_SDK_VERSION}),driver:()=>driver,control:async(_a,_e,action)=>{controls++;return action==="probe"?{ok:true,probe:{durableAgent:true,nativeId:true,store:"jsonl",node:process.version}}:{ok:true,models:[{id:"native-model",displayName:"Native",parameters:[{id:"effort",values:[{value:"small"},{value:"large"}]},{id:key,values:[{value:"leak"}]}]},{id:"other",displayName:"Other",parameters:[{id:"effort",values:[{value:"other"}]}]}]};}});
  adapters.push(a);const p=a.store.list()[0] ?? a.store.create("Policy");a.store.saveKey(p.id,key);await a.refresh(p.id);
  return {a,p,path,workspace,driver,controls:()=>controls};
}
it("selected-profile catalog controls expose safe model enums and explicit native tool/sandbox limitations",async()=>{
 const {a,p}=await connected();const schema=await a.describeSessionConfiguration({connectionProfileId:p.id});
 expect(schema.fields.find(f=>f.id==="modelParameter:effort")).toMatchObject({optionsByModel:{"native-model":["","small","large"],other:["","other"]}});
 expect(JSON.stringify(schema)).not.toContain(key);expect(schema.description).toContain("without approval");
 const caps=await a.describeCapabilities();expect(caps.details.permissions.supported).toBe(false);expect(caps.details.questions.supported).toBe(false);expect(caps.details.cloudExecution.supported).toBe(false);expect(caps.details.nativeConfiguration.supported).toBe(true);
 expect(caps.supported).not.toContain("fork");expect(caps.supported).not.toContain("mcp");
});
it.each([{toolset:"all"},{sandbox:"read-only"},{autoReview:true},{hooks:[]},{mcpServers:{}},{settingSources:["project"]},{"modelParameter:effort":"other"},{"modelParameter:unknown":"large"}])("unsupported native settings fail before any SDK operation %j",async(runtimeMetadata)=>{
 const {a,p,workspace,driver,controls}=await connected();const calls=controls();await expect(a.createSession({runtimeId:"cursor",connectionProfileId:p.id,workspaceRootPath:workspace,modelId:"native-model",runtimeMetadata})).rejects.toThrow();expect(driver.calls).toHaveLength(0);expect(controls()).toBe(calls);
});
it("immutable native policy persists, resumes and follows up; changing it or native store binding fails",async()=>{
 const {a,p,path,workspace,driver}=await connected();
 const native=await a.createSession({runtimeId:"cursor",connectionProfileId:p.id,workspaceRootPath:workspace,modelId:"native-model",runtimeMetadata:{toolset:"files-write",sandbox:"enabled","modelParameter:effort":"large"}});
 expect(native.runtimeMetadata).toMatchObject({tools:["read","grep","glob","ls","readLints","edit","delete"],modelParams:[{id:"effort",value:"large"}],writeCapability:"possible",settingSources:[]});
 expect(driver.calls[0].binding).toMatchObject(native.runtimeMetadata!);
 const file=join(path,p.id,`session-${native.nativeSessionId}.json`);expect(readFileSync(file,"utf8")).not.toContain(key);
 const resumed=await a.resumeSession({native,workspaceRootPath:workspace});expect(resumed.nativeSessionId).toBe(native.nativeSessionId);
 const events=[];for await(const e of a.send({native,workspaceRootPath:workspace,prompt:"followup",turnId:asSpecOpsTurnId("turn"),context:{clientUserMessageId:"user"}}))events.push(e);expect(events.at(-1)?.type).toBe("turn.finished");
 const calls=driver.calls.length;await expect(a.resumeSession({native:{...native,runtimeMetadata:{...native.runtimeMetadata,toolset:"none"}},workspaceRootPath:workspace})).rejects.toThrow();expect(driver.calls).toHaveLength(calls);
 const stored=JSON.parse(readFileSync(file,"utf8"));stored.native.runtimeMetadata.tools.push("task");writeFileSync(file,JSON.stringify(stored),{mode:0o600});await expect(a.resumeSession({native,workspaceRootPath:workspace})).rejects.toThrow();expect(driver.calls).toHaveLength(calls);
});
it("bounded catalog drops duplicate, malformed and secret-shaped enum metadata",()=>{
 expect(cursorParameters([{id:"x",values:[{value:"ok"}]},{id:"x",values:[{value:"other"}]},{id:key,values:[{value:"ok"}]},{id:"y",values:[{value:key}]},{id:"z",values:[{value:"x"},{value:"x"}]}],key)).toEqual([{id:"x",values:["ok"]}]);
 expect(cursorParameters(Array(17).fill({id:"x",values:[]}),key)).toEqual([]);
 expect(cursorPolicy({toolset:"files-read"}).writeCapability).toBe("unknown");expect(cursorPolicy().tools).toEqual([]);
});
it.each(["none","files-read","files-write"])("actual SDK accepts selected %s tool/sandbox options and same native binding on resume without inference",async(toolset)=>{
 const assets=resolveCursorAssets(),home=root(),store=root(),cwd=realpathSync(root()),policy=cursorPolicy({toolset,sandbox:"enabled"});
 const driver=nativeCursorDriver(assets,{HOME:home,USERPROFILE:home,PATH:"/usr/bin:/bin"},15000);const abort=new AbortController();
 const request={store,cwd,key:"specops-no-account-probe",binding:{...policy,workspaceRootPath:cwd}};
 const frames=[];for await(const f of driver.operation({...request,action:"create"},abort.signal))frames.push(f);
 expect(frames).toHaveLength(1);expect(frames[0].type).toBe("created");
 const history=[];for await(const f of driver.operation({...request,action:"history",agentId:frames[0].agentId},abort.signal))history.push(f);expect(history.at(-1)?.type).toBe("historyDone");
});

it("production worker forwards exact native model/tool/sandbox contract on create and resume without enabling other tool families",async()=>{
 const assets=resolveCursorAssets(),home=root(),store=root(),cwd=root(),capture=join(home,"captured.json"),sdk=join(home,"fixture.mjs"),policy=cursorPolicy({toolset:"files-write",sandbox:"disabled","modelParameter:effort":"large"},[{id:"effort",values:["large"]}]);
 writeFileSync(sdk,`import {writeFileSync} from "node:fs"; let row={sdkMetadata:{}}; export class JsonlLocalAgentStore {constructor(){this.agents={get:async()=>row,update:async({agent})=>{row=agent}};this.runs={list:async()=>({items:[]})};}}; const record=options=>{writeFileSync(${JSON.stringify(capture)},JSON.stringify({...options,local:{...options.local,store:"native-store"}}));return {agentId:"agent-fixture",[Symbol.asyncDispose]:async()=>{}}}; export const Agent={create:async options=>record(options),resume:async(_id,options)=>record(options)};`);
 const driver=nativeCursorDriver({...assets,sdk},{HOME:home,PATH:"/usr/bin:/bin"},5000),abort=new AbortController();
 const binding={...policy,workspaceRootPath:cwd},request={store,cwd,key,modelId:"native-model",binding};
 const frames=[];for await(const f of driver.operation({...request,action:"create"},abort.signal))frames.push(f);expect(frames[0].type).toBe("created");
 const captured=JSON.parse(readFileSync(capture,"utf8"));expect(captured).toEqual({apiKey:key,model:{id:"native-model",params:[{id:"effort",value:"large"}]},mode:"agent",tools:policy.tools,mcpServers:{},local:{cwd,store:"native-store",settingSources:[],sandboxOptions:{enabled:false},autoReview:false,enableAgentRetries:false}});
 expect(JSON.stringify(frames)).not.toContain(key);
});
it("production dispatcher returns native settings and rejects unsupported interactions/actions without native work",async()=>{
 const {HostDispatcher}=await import("../dispatch"),{AdapterRegistry}=await import("../registry"),{FakeStdout,FakeStderr}=await import("../testing"),{buildInfo}=await import("../version"),{RequestMethod}=await import("../protocol");
 const {a,p,workspace,driver,controls}=await connected(),registry=new AdapterRegistry();registry.register(a);const stdout=new FakeStdout(),dispatcher=new HostDispatcher({registry,stdout,stderr:new FakeStderr(),buildInfo:buildInfo()});
 const call=async(id:string,method:string,params:unknown)=>{await dispatcher.handle({jsonrpc:"2.0",id,method,params});return (stdout.messages as any[]).find(message=>message.id===id);};
 await call("init",RequestMethod.Initialize,{protocolVersion:1});const catalog=await call("catalog",RequestMethod.CatalogModels,{runtimeId:"cursor",connectionProfileId:p.id});expect(catalog.result.configuration.fields[0].id).toBe("toolset");expect(JSON.stringify(catalog)).not.toContain(key);
 const created=await call("create",RequestMethod.SessionCreate,{runtimeId:"cursor",connectionProfileId:p.id,workspaceRootPath:workspace,modelId:"native-model",runtimeMetadata:{toolset:"files-read",sandbox:"enabled"}});expect(created.result.runtimeMetadata.toolset).toBe("files-read");
 const native=created.result,calls=driver.calls.length,count=controls();
 for(const [id,method,params] of [["fork",RequestMethod.NativeAction,{native,workspaceRootPath:workspace,action:"fork"}],["restore",RequestMethod.NativeAction,{native,workspaceRootPath:workspace,action:"restore"}],["approval",RequestMethod.PermissionReply,{native,turnId:"turn",permissionId:"permission",reply:"once"}],["question",RequestMethod.QuestionReply,{native,turnId:"turn",questionId:"question",answer:"yes"}]] as const){const response=await call(id,method,params);expect(response.error.data.adapterCode).toBe("capability-not-supported");}
 expect(driver.calls).toHaveLength(calls);expect(controls()).toBe(count);expect(JSON.stringify(stdout.messages)).not.toContain(key);
});
