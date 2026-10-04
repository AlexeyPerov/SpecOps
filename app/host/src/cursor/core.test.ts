import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, realpathSync, unlinkSync, mkdirSync, chmodSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CursorRuntimeAdapter, type CursorAdapterOptions } from "./adapter";
import { CursorFixtureDriver } from "./fixtures";
import { CURSOR_SDK_VERSION, resolveCursorAssets } from "./runtime";
import { nativeCursorDriver } from "./session";
import { collectContractEvents, runAdapterContractSuite } from "../../../src/lib/session/adapter/adapter.contract";
import { asSpecOpsTurnId } from "../../../src/lib/session/ids";
import type { NativeSessionRef } from "../../../src/lib/session/adapter";
import { Agent, JsonlLocalAgentStore, createSdkMessageRunStreamEvent, LOCAL_RUN_STREAM_EVENT_TYPE } from "@cursor/sdk";
const roots: string[] = [], adapters: CursorRuntimeAdapter[] = [];
const key = "fixture-private-key-canary";
function root() { const r = mkdtempSync(join(tmpdir(), "specops-cursor-core-")); roots.push(r); return r; }
const workspace = root();
afterEach(async () => { await Promise.all(adapters.splice(0).map((a) => a.close())); });
function options(path: string, driver = new CursorFixtureDriver(join(path, "native-fixture.json"))): CursorAdapterOptions {
  return { profileRoot: path, assets: () => ({ sdk: "fixture", worker: "fixture", root: "fixture", sdkVersion: CURSOR_SDK_VERSION }), control: async (_a, _e, action) => action === "probe" ? { ok: true, probe: { durableAgent: true, nativeId: true, store: "jsonl", node: process.version } } : { ok: true, models: [{ id: "native-model", displayName: "Native model" }] }, driver: () => driver, turnTimeoutMs: 3000 };
}
async function connected(path = root(), driver = new CursorFixtureDriver(join(path, "native-fixture.json"))) {
  const a = new CursorRuntimeAdapter(options(path, driver)); adapters.push(a);
  const p = a.store.list()[0] ?? a.store.create("First");
  a.store.saveKey(p.id, key); await a.refresh(p.id);
  return { a, p, driver, path };
}
async function setup() {
  const result = await connected();
  const native = await result.a.createSession({ runtimeId: "cursor", connectionProfileId: result.p.id, workspaceRootPath: workspace, modelId: "native-model" });
  return { ...result, native };
}
const request = (native: NativeSessionRef, prompt = "hello", id = "client-user") => ({ native, workspaceRootPath: workspace, prompt, turnId: asSpecOpsTurnId(id), context: { clientUserMessageId: id } });
let shared: string;
class ContractCursor extends CursorRuntimeAdapter {
  constructor(path: string, fault?: string) { const driver = new CursorFixtureDriver(join(path, "native-fixture.json")); if (fault === "diagnostics") driver.fault = "diagnostics"; super(options(path, driver)); }
  override async createSession(req: Parameters<CursorRuntimeAdapter["createSession"]>[0]) { const p = this.store.list()[0] ?? this.store.create("Contract"); this.store.saveKey(p.id, key); await this.refresh(p.id); return super.createSession({ ...req, connectionProfileId: p.id, modelId: "native-model" }); }
  override async resumeSession(req: Parameters<CursorRuntimeAdapter["resumeSession"]>[0]) { if (req.native.connectionProfileId) await this.refresh(req.native.connectionProfileId); return super.resumeSession(req); }
  override authenticate(req: Parameters<CursorRuntimeAdapter["authenticate"]>[0]) { const p = this.store.list()[0] ?? this.store.create("Contract"); return super.authenticate({ ...req, connectionProfileId: p.id }); }
}
runAdapterContractSuite({ runtimeId: "cursor", workspaceRootPath: workspace, finishPrompt: "hello", cancelPrompt: "cancel", create: async () => { const a = new ContractCursor(shared ??= root()); adapters.push(a); return a; }, createFaultAdapter: async (fault) => { const a = new ContractCursor(root(), fault); adapters.push(a); return a; } });
it("native agent/run identity, follow-up, explicit recovery and client mapping survive a fresh host", async () => {
  const { a, p, native, path, driver } = await setup();
  const events = await collectContractEvents(a.send(request(native)));
  expect(events.at(-1)?.type).toBe("turn.finished");
  expect(events.find((e) => e.type === "usage.recorded")).toMatchObject({ usage: { input: 5, output: 7, reasoning: 3, cache: { read: 1, write: 2 } } });
  expect(events.filter((e) => e.type === "tool.started")).toHaveLength(1);
  expect(events.filter((e) => e.type === "tool.completed")).toHaveLength(1);
  expect(events.find((e) => e.type === "diagnostic")).toMatchObject({ reason: "unknown-native" });
  expect(events.filter((e) => e.type.startsWith("turn.") && e.type !== "turn.started")).toHaveLength(1);
  const runId = events.find((e) => e.nativeTurnId)?.nativeTurnId;
  expect(runId).toMatch(/^run-/); expect(native.nativeSessionId).toMatch(/^agent-/);
  await a.close();
  const replacement = (await connected(path, driver)).a;
  const history = await replacement.resumeSession({ native, workspaceRootPath: workspace });
  expect(history.history?.[0]).toMatchObject({ id: "client-user", role: "user", content: "hello", nativeTurnId: runId });
  expect(history.history?.[1]).toMatchObject({ role: "assistant", content: "Native fixture answer ", completionState: "completed" });
  expect(JSON.stringify(history)).not.toContain(key);
  const second = await collectContractEvents(replacement.send(request(history, "follow up", "second-user")));
  expect(second.at(-1)?.type).toBe("turn.finished");
  expect(second[0].seq).toBeGreaterThan(events.at(-1)!.seq);
  expect(driver.calls.at(-1)).toMatchObject({ agentId: native.nativeSessionId, cwd: realpathSync(workspace), key, binding: { tools: [], settingSources: [] } });
  expect(readFileSync(join(path, p.id, `session-${native.nativeSessionId}.json`), "utf8")).not.toContain(key);
});
it.each(["disconnect", "quota", "route", "oversize"] as const)("native %s settles once without leaking or replaying and healthy profiles remain usable", async (fault) => {
  const { a, native, driver } = await setup(); driver.fault = fault;
  const events = await collectContractEvents(a.send(request(native, "secret")));
  expect(events.at(-1)?.type).toBe("turn.failed"); expect(events.filter((e) => e.type === "turn.failed")).toHaveLength(1); expect(JSON.stringify(events)).not.toContain(key);
  const calls = driver.calls.length;
  await collectContractEvents(a.send(request(native, "retry", "other-user")));
  expect(driver.calls).toHaveLength(calls);
  driver.fault = undefined;
  const p = a.store.create("Other"); a.store.saveKey(p.id, "other-private-key"); await a.refresh(p.id);
  const other = await a.createSession({ runtimeId: "cursor", connectionProfileId: p.id, workspaceRootPath: workspace, modelId: "native-model" });
  expect((await collectContractEvents(a.send(request(other)))).at(-1)?.type).toBe("turn.finished");
});
it("history, stream identities, object keys and split text credentials are redacted before serialization", async () => {
  const { a, native } = await setup();
  const events = await collectContractEvents(a.send(request(native, "secret")));
  const resumed = await a.resumeSession({ native, workspaceRootPath: workspace });
  expect(JSON.stringify({ events, resumed })).not.toContain(key);
  expect(events.find((e) => e.type === "text.finished")).toMatchObject({ text: "Native [REDACTED] answer " });
  expect(events.find((e) => e.type === "tool.started")).toMatchObject({ toolCall: { callId: "tool-[REDACTED]" } });
});
it("immutable cwd/model/profile/policy/credential bindings fail closed; missing native history retains metadata", async () => {
  const { a, native, p, driver, path } = await setup();
  for (const changed of [{ ...native, modelId: "changed" }, { ...native, modeId: "plan" }, { ...native, runtimeMetadata: {} }]) await expect(a.resumeSession({ native: changed, workspaceRootPath: workspace })).rejects.toThrow("binding");
  a.store.saveKey(p.id, "different-key"); await expect(a.resumeSession({ native, workspaceRootPath: workspace })).rejects.toMatchObject({ code: "authentication-required" });
  a.store.saveKey(p.id, key); driver.fault = "missing";
  await expect(a.resumeSession({ native, workspaceRootPath: workspace })).rejects.toMatchObject({ code: "session-not-found" });
  expect(readFileSync(join(path, p.id, `session-${native.nativeSessionId}.json`), "utf8")).toContain(native.nativeSessionId);
});
it("same client prompt is never redispatched, including after interrupted native run and host replacement", async () => {
  const { a, native, driver, path } = await setup(); driver.fault = "disconnect";
  await collectContractEvents(a.send(request(native)));
  const replacement = (await connected(path, driver)).a;
  const before = driver.calls.length;
  await collectContractEvents(replacement.send(request(native)));
  expect(driver.calls).toHaveLength(before);
  await replacement.resumeSession({ native, workspaceRootPath: workspace });
  await collectContractEvents(replacement.send(request(native, "new", "different-client")));
  expect(driver.calls.at(-1)?.action).toBe("history");
});
it("Stop and logout invalidate only selected profile and release reserved work after cleanup", async () => {
  const { a, native, p } = await setup();
  const iterator = a.send(request(native, "cancel"))[Symbol.asyncIterator]();
  expect((await iterator.next()).value.type).toBe("turn.started");
  await a.cancel({ native });
  const rest: any[] = [];
  for (let step = await iterator.next(); !step.done; step = await iterator.next()) rest.push(step.value);
  expect(rest.at(-1)?.type).toBe("turn.cancelled");
  await a.authenticate({ runtimeId: "cursor", workspaceRootPath: workspace, connectionProfileId: p.id, options: { action: "logout" } });
  expect(a.store.readKey(p.id)).toBeUndefined();
});
it("actual pinned native worker creates/resumes and hydrates official persisted run-event wire records without inference", async () => {
  const path = root(), home = join(path, "home"), storePath = join(home, "store"); mkdirSync(storePath, { recursive: true, mode: 0o700 });
  const assets = resolveCursorAssets();
  const driver = nativeCursorDriver(assets, { PATH: process.env.PATH, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home }, 10000);
  const binding = { fixture: "no-account-native-store" }, abort = new AbortController();
  const input = { action: "create" as const, store: storePath, cwd: realpathSync(path), key: "no-account-fixture", binding };
  const frames = []; for await (const frame of driver.operation(input, abort.signal)) frames.push(frame);
  expect(frames).toHaveLength(1); const agentId = frames[0].agentId;
  const store = new JsonlLocalAgentStore(storePath);
  const runs = await store.runs.list({ filter: { agentIds: [agentId] } });
  const run = runs.items[0]; expect(run.status).toBe("queued"); expect(run.startedAt).toBeNull();
  await store.runs.update({ run: { ...run, status: "finished", startedAt: Date.now(), endedAt: Date.now() } });
  for (const message of [{ type: "user", agent_id: agentId, run_id: run.runId, message: { role: "user", content: [{ type: "text", text: "native stored user" }] } }, { type: "assistant", agent_id: agentId, run_id: run.runId, message: { role: "assistant", content: [{ type: "text", text: "native stored answer" }] } }]) await store.runEvents.append({ runId: run.runId, eventType: LOCAL_RUN_STREAM_EVENT_TYPE, payload: createSdkMessageRunStreamEvent(message as never) });
  for (const name of readdirSync(storePath)) chmodSync(join(storePath, name), 0o600);
  const recovered = []; for await (const frame of driver.operation({ ...input, action: "history", agentId }, abort.signal)) recovered.push(frame);
  expect(recovered.at(-1)).toEqual({ type: "historyDone" });
  expect(recovered.filter((f) => f.type === "historyEvent")).toHaveLength(2);
  expect(recovered.at(-1)?.type).toBe("historyDone");
  const native = await Agent.resume(agentId, { apiKey: "no-account-fixture", tools: [], local: { cwd: realpathSync(path), store, settingSources: [], enableAgentRetries: false } });
  expect(native.agentId).toBe(agentId); await native[Symbol.asyncDispose]();
  unlinkSync(join(storePath, "agents.ndjson"));
  const missing = []; for await (const frame of driver.operation({ ...input, action: "history", agentId }, abort.signal)) missing.push(frame);
  expect(missing).toEqual([{ type: "failure", reason: "missing" }]);
}, 20000);
it("rejects corrupt/private binding input without accepting fabricated native continuity", async () => {
  const { a, native, path, p } = await setup();
  const file = join(path, p.id, `session-${native.nativeSessionId}.json`), b = JSON.parse(readFileSync(file, "utf8"));
  b.native.runtimeMetadata.tools = ["Write"]; writeFileSync(file, JSON.stringify(b), { mode: 0o600 });
  await expect(a.resumeSession({ native, workspaceRootPath: workspace })).rejects.toThrow("immutable binding");
});
it("late native creation is disposed in its private worker after Stop and no raw stdout/stderr escapes", async () => {
  const path=root(), store=join(path,'store');mkdirSync(store,{mode:0o700});
  const module=join(path,'fixture.mjs'),marker=join(path,'disposed');
  writeFileSync(module,`import {writeFileSync} from 'node:fs'; export class JsonlLocalAgentStore {} export const Agent={create:async options=>{writeFileSync(${JSON.stringify(marker+'.entered')},'entered');console.log(options.apiKey);process.stderr.write(options.apiKey);await new Promise(r=>setTimeout(r,150));return {agentId:'agent-late',[Symbol.asyncDispose]:async()=>writeFileSync(${JSON.stringify(marker)},'disposed')}}};`);
  const driver=nativeCursorDriver({...resolveCursorAssets(),sdk:module},{HOME:path,USERPROFILE:path,PATH:process.env.PATH},3000),abort=new AbortController();
  const collecting=(async()=>{const frames=[];for await(const frame of driver.operation({action:'create',store,cwd:path,key,binding:{}},abort.signal))frames.push(frame);return frames;})();
  const until=Date.now()+3000;while(!existsSync(marker+'.entered')&&Date.now()<until)await new Promise(r=>setTimeout(r,10));expect(existsSync(marker+'.entered')).toBe(true);abort.abort();await driver.stop!();
  const frames=await collecting;expect(frames).toEqual([{type:'failure',reason:'cancelled'}]);expect(readFileSync(marker,'utf8')).toBe('disposed');expect(JSON.stringify(frames)).not.toContain(key);
},10000);
it("close is bounded even when a consumer pauses at the first event, and cancelled undispatched prompt is not persisted as accepted",async()=>{
 const {a,native,driver,path,p}=await setup();const iterator=a.send(request(native,'cancel'))[Symbol.asyncIterator]();
 await iterator.next();const calls=driver.calls.length;const started=Date.now();await a.close();expect(Date.now()-started).toBeLessThan(1500);
 for(let step=await iterator.next();!step.done;step=await iterator.next()){}
 expect(driver.calls).toHaveLength(calls);expect(JSON.parse(readFileSync(join(path,p.id,`session-${native.nativeSessionId}.json`),'utf8')).users).toEqual({});
});
// Test artifacts contain synthetic private keys only; do not inspect user native state.
process.once("exit", () => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
