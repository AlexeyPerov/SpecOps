import { cursorCapabilities } from "../../../src/lib/session/runtimeCapabilities";
import { cursorParameters, cursorPolicy, PARAM_PREFIX, type CursorParameter } from "./policy";
import { realpathSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { asNativeSessionId } from "../../../src/lib/session/ids";
import { CursorBindings, type CursorBinding } from "./binding";
import { nativeCursorDriver, type CursorSessionDriver, type CursorOperation } from "./session";
import { CursorMapper, cursorSafe } from "./mapping";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentRuntimeAdapter,
  AgentAuthRequest,
  AgentAuthResult,
  NativeSessionRef,
  CreateAgentSessionRequest,
  ResumeAgentSessionRequest,
  AgentTurnRequest,
  CancelAgentTurnRequest,
} from "../../../src/lib/session/adapter";
import type {
  CatalogExtension,
  SessionConfigurationExtension,
} from "../../../src/lib/session/adapter/extensions";
import type {
  ConnectionProfileSnapshot,
  ProfileAuthUpdate,
} from "../../../src/lib/session/profiles";
import type { SessionEvent } from "../../../src/lib/session/events";
import { adapterErrors } from "../../../src/lib/session/adapter/errors";
import { redactForSerialization } from "../redact";
import { CursorProfileStore, type CursorProfile } from "./profiles";
import {
  CURSOR_SDK_VERSION,
  CursorRuntimeError,
  resolveCursorAssets,
  cursorControl,
  type CursorAssets,
  type CursorControlResult,
} from "./runtime";
export interface CursorAdapterOptions {
  profileRoot?: string;
  ambient?: NodeJS.ProcessEnv;
  assets?: () => CursorAssets;
  control?: typeof cursorControl;
  driver?: (assets: CursorAssets, env: NodeJS.ProcessEnv) => CursorSessionDriver;
  turnTimeoutMs?: number;
}
export class CursorRuntimeAdapter
  implements
    AgentRuntimeAdapter,
    CatalogExtension,
    SessionConfigurationExtension
{
  readonly runtimeId = "cursor" as const;
  readonly store: CursorProfileStore;
  readonly snapshots = new Map<string, ConnectionProfileSnapshot>();
  private bindings: CursorBindings;
  private redactionKeys = new Map<string, Set<string>>();
  private rememberKey(id: string, key: string) {
    const keys = this.redactionKeys.get(id) ?? new Set<string>();
    if (!keys.has(key) && keys.size >= 32) throw new Error("Profile credential changes exceed this host capacity; restart the host");
    keys.add(key); this.redactionKeys.set(id, keys);
  }
  private parameters = new Map<string, CursorParameter[]>();
  private closed = false;
  private mutating = new Set<string>();
  private operations = new Map<string, { profileId: string; abort: AbortController; done: Promise<void>; turnId?: string; stop?: () => Promise<void> }>();
  private catalogs = new Map<string, readonly { id: string; name: string }[]>();
  private pending = new Map<string, AbortController>();
  private controls = new Set<Promise<CursorControlResult>>();
  private control: typeof cursorControl = (...args) => {
    const work = (this.options.control ?? cursorControl)(...args);
    this.controls.add(work);
    void work.finally(() => this.controls.delete(work)).catch(() => {});
    return work;
  };
  onAuthUpdate: (update: ProfileAuthUpdate) => void = () => {};
  constructor(readonly options: CursorAdapterOptions = {}) {
    this.store = new CursorProfileStore(
      options.profileRoot ??
        join(
          options.ambient?.SPECOPS_PROFILE_ROOT ??
            process.env.SPECOPS_PROFILE_ROOT ??
            join(
              homedir(),
              "Library",
              "Application Support",
              "SpecOps",
              "connection-profiles",
            ),
          "cursor",
        ),
    );
    this.bindings = new CursorBindings(this.store);
  }
  async describe() {
    return { id: this.runtimeId, label: "Cursor" };
  }
  async describeCapabilities() { return cursorCapabilities(); }
  snapshot(p: CursorProfile) {
    let s = this.snapshots.get(p.id);
    if (!s) {
      s = {
        ...p,
        generation: 0,
        state: "disconnected",
        support: { apiKey: true, browser: false, device: false },
      };
      this.snapshots.set(p.id, s);
    }
    return s;
  }
  private safe(s: ConnectionProfileSnapshot) {
    for (const name of ["credential", "api-key"]) { const key = this.store.readKey(s.id, name); if (key) this.rememberKey(s.id, key); }
    let safe = { ...s };
    for (const key of this.redactionKeys.get(s.id) ?? []) safe = cursorSafe(safe, key);
    return cursorSafe(safe, "");
  }
  private publish(p: CursorProfile) {
    const s = this.safe(this.snapshot(p));
    this.onAuthUpdate({
      runtimeId: this.runtimeId,
      connectionProfileId: p.id,
      generation: s.generation,
      profile: s,
    });
  }
  async refresh(
    id: string,
    candidate?: string,
    fromOperation = false,
  ): Promise<ConnectionProfileSnapshot> {
    const p = this.store.require(id),
      s = this.snapshot(p);
    if (this.closed) throw adapterErrors.runtimeUnavailable();
    if (!fromOperation && [...this.operations.values()].some((op) => op.profileId === id)) return this.safe(s);
    this.pending.get(id)?.abort();
    const abort = new AbortController();
    this.pending.set(id, abort);
    const redactionKey = candidate ?? this.store.readKey(id);
    if (redactionKey) this.rememberKey(id, redactionKey);
    const generation = ++s.generation;
    s.state = "connecting";
    delete s.account;
    delete s.message;
    delete s.recovery;
    this.catalogs.delete(id);
    for (const key of this.parameters.keys()) if (key.startsWith(id + ":")) this.parameters.delete(key);
    this.publish(p);
    const current = () => !abort.signal.aborted && s.generation === generation;
    try {
      const assets = (this.options.assets ?? resolveCursorAssets)(),
        env = this.store.environment(id, undefined, this.options.ambient),
        control = this.control;
      const probe = await control(
        assets,
        env,
        "probe",
        undefined,
        abort.signal,
      );
      if (
        !probe.ok ||
        !probe.probe?.durableAgent ||
        !probe.probe.nativeId ||
        probe.probe.store !== "jsonl"
      )
        throw new CursorRuntimeError("incompatible-runtime");
      if (!current()) throw new Error();
      const key = candidate ?? this.store.readKey(id);
      if (!key) {
        s.state = "auth-required";
        s.recovery = "auth-required";
      } else {
        const result = await control(assets, env, "read", key, abort.signal);
        if (!current()) throw new Error();
        if (!result.ok) {
          s.state =
            result.reason === "auth-required" ? "auth-required" : "error";
          s.recovery = result.reason ?? "offline";
          s.message =
            result.reason === "auth-required"
              ? "API key was rejected. Import a valid private key."
              : "Cursor is offline. Reconnect the selected profile.";
        } else {
          const models = this.safeModels(result, key, p.id);
          if (candidate) {
            this.store.saveKey(id, key);
            this.store.consumeImport(id, key);
          }
          this.catalogs.set(id, models);
          s.state = "authenticated";
          s.account = { type: "apiKey" };
        }
      }
    } catch (error) {
      if (!current()) throw new Error("Authentication generation expired");
      if (error instanceof CursorRuntimeError) {
        s.state = error.state;
        s.message = error.message;
      } else {
        s.state = "error";
        s.recovery = "retry";
        s.message =
          "Cursor initialization failed. Check private profile files and reinstall the pinned native assets, then reconnect.";
      }
    } finally {
      if (current()) {
        this.pending.delete(id);
        this.publish(p);
      }
    }
    return this.safe(s);
  }
  private safeModels(result: CursorControlResult, key: string, profileId: string) {
    const rows = result.models;
    if (
      !Array.isArray(rows) ||
      rows.length > 1000 ||
      Buffer.byteLength(JSON.stringify(rows)) > 1048576
    )
      throw new Error("Native catalog exceeds capacity");
    const unique = new Map<string, { id: string; name: string }>();
    for (const row of rows)
      if (
        typeof row.id === "string" &&
        /^[A-Za-z0-9._:-]{1,200}$/.test(row.id) &&
        !row.id.includes(key) &&
        typeof row.displayName === "string"
      )
        unique.set(row.id, {
          id: row.id,
          name: String(
            redactForSerialization(
              row.displayName.replaceAll(key, "[REDACTED]"),
            ),
          ).slice(0, 200),
        });
    for (const id of this.parameters.keys()) if (id.startsWith(profileId + ":")) this.parameters.delete(id);
    for (const row of rows) if (unique.has(row.id)) this.parameters.set(profileId + ":" + row.id, cursorParameters(row.parameters, key));
    return [...unique.values()];
  }
  async authenticate(request: AgentAuthRequest): Promise<AgentAuthResult> {
    if (request.runtimeId !== this.runtimeId)
      throw new Error("Runtime mismatch");
    if (request.options?.apiKey !== undefined)
      throw new Error("Use the selected profile private API key file");
    const action = request.options?.action ?? "read",
      profiles = () =>
        this.store.list().map((p) => this.safe(this.snapshot(p)));
    if (action === "list-profiles")
      return { status: "not-required", profiles: profiles() };
    if (action === "create-profile") {
      const p = this.store.create(
        typeof request.options?.label === "string" ? request.options.label : "",
      );
      return {
        status: "challenge",
        profile: this.safe(this.snapshot(p)),
        profiles: profiles(),
      };
    }
    if (!["read", "restart", "login-api-key", "logout"].includes(String(action))) throw adapterErrors.capabilityNotSupported("authentication-flow");
    const p = this.store.require(request.connectionProfileId);
    const mutation = action !== "read", ownsMutation = !this.mutating.has(p.id);
    if (mutation) {
      if (!ownsMutation && action !== "logout") throw new Error("Profile authentication is already changing");
      this.mutating.add(p.id);
      await this.stopProfile(p.id);
    }
    try {
    if (action === "logout") {
      this.pending.get(p.id)?.abort();
      this.pending.delete(p.id);
      const s = this.snapshot(p);
      s.generation++;
      const previousKey = this.store.readKey(p.id);
      if (previousKey) this.rememberKey(p.id, previousKey);
      this.store.logout(p.id);
      this.catalogs.delete(p.id);
      for (const key of this.parameters.keys()) if (key.startsWith(p.id + ":")) this.parameters.delete(key);
      s.state = "auth-required";
      s.recovery = "auth-required";
      delete s.account;
      delete s.message;
      this.publish(p);
      return { status: "challenge", profile: this.safe(s) };
    }
    if (!["read", "restart", "login-api-key"].includes(String(action)))
      throw adapterErrors.capabilityNotSupported("authentication-flow");
    if (
      action === "login-api-key" &&
      (request.credential?.kind !== "api-key" ||
        request.credential.ref !== "profile-api-key")
    )
      throw new Error("Use the selected profile private API key file");
    const profile = await this.refresh(
      p.id,
      action === "login-api-key" ? this.store.importKey(p.id) : undefined,
    );
    return {
      status: profile.state === "authenticated" ? "authenticated" : "challenge",
      profile,
    };
    } finally { if (mutation && ownsMutation) this.mutating.delete(p.id); }
  }
  async listModels(input?: { connectionProfileId?: string }) {
    const p = this.store.require(input?.connectionProfileId);
    if (this.snapshot(p).state !== "authenticated") await this.refresh(p.id);
    return this.snapshot(p).state === "authenticated"
      ? (this.catalogs.get(p.id) ?? [])
      : [];
  }
  async listModes() {
    return [{ id: "agent", name: "Agent", primary: true }];
  }
  async describeSessionConfiguration(input?: {connectionProfileId?: string}) {
    const profileId = this.store.require(input?.connectionProfileId).id;
    const models = await this.listModels({connectionProfileId:profileId});
    const parameters = new Map<string, {optionsByModel: Record<string,string[]>}>();
    for (const model of models) for (const p of this.parameters.get(profileId + ":" + model.id) ?? []) {
      const field = parameters.get(p.id) ?? {optionsByModel: Object.create(null)};
      field.optionsByModel[model.id] = ["", ...p.values]; parameters.set(p.id,field);
    }
    if (parameters.size > 32 || Buffer.byteLength(JSON.stringify([...parameters])) > 65536) throw adapterErrors.capabilityNotSupported("native-model-parameter-catalog-capacity");
    return {
      schemaVersion: 1 as const, scope: "session" as const,
      description: "Immutable native local settings. File tools run without approval. Sandbox enforcement depends on platform; native workspace sandbox policy may apply. No verified read-only or workspace confinement guarantee. Shell, task, MCP, questions and filesystem settings/hooks excluded.",
      fields: [
        {id:"toolset",label:"Native file tools",kind:"select" as const,options:["none","files-read","files-write"],default:"none",description:"File writes/deletes run without approval when enabled. Read tools provide no filesystem enforcement guarantee."},
        {id:"sandbox",label:"Native sandbox",kind:"select" as const,options:["enabled","disabled"],default:"enabled",description:"Native sandbox request. Disabling allows selected tools without sandbox restrictions; enforcement remains platform dependent."},
        ...[...parameters].map(([id,field])=>({id:PARAM_PREFIX+id,label:id,kind:"select" as const,default:"",...field,description:"Selected profile catalog values only; empty uses native default."})),
      ],
    };
  }
  async health(connectionProfileId?: string) {
    if (connectionProfileId) {
      const s = await this.refresh(connectionProfileId);
      return {
        runtimeId: this.runtimeId,
        runtimeVersion: CURSOR_SDK_VERSION,
        connectionProfileId,
        generation: s.generation,
        status:
          s.state === "authenticated"
            ? ("healthy" as const)
            : ["missing-runtime", "incompatible-runtime", "error"].includes(
                  s.state,
                )
              ? ("unavailable" as const)
              : ("degraded" as const),
        message: s.message,
        checkedAt: new Date().toISOString(),
      };
    }
    let message = "Select a Cursor profile to verify its connection.",
      status: "degraded" | "unavailable" = "degraded";
    try {
      (this.options.assets ?? resolveCursorAssets)();
    } catch (e) {
      status = "unavailable";
      message =
        e instanceof CursorRuntimeError
          ? e.message
          : "Cursor assets unavailable";
    }
    return {
      runtimeId: this.runtimeId,
      runtimeVersion: CURSOR_SDK_VERSION,
      status,
      message,
      checkedAt: new Date().toISOString(),
    };
  }
  private digest(id: string) {
    const key = this.store.readKey(id);
    if (!key) throw adapterErrors.authenticationRequired();
    return createHash("sha256").update(key).digest("hex");
  }
  private reserve(profileId: string, route: string, turnId?: string) {
    this.store.require(profileId);
    if (this.closed || this.mutating.has(profileId)) throw adapterErrors.runtimeUnavailable("Selected profile is changing or disconnected");
    if (this.operations.has(route)) throw new Error("Native session operation is already active");
    const abort = new AbortController();
    let resolve!: () => void;
    const done = new Promise<void>((r) => { resolve = r; });
    this.operations.set(route, { profileId, abort, done, turnId });
    let finished = false;
    return { abort, finish: () => { if (finished) return; finished = true; this.operations.delete(route); resolve(); } };
  }
  private async stopProfile(id: string) {
    const ops = [...this.operations.values()].filter((op) => op.profileId === id);
    for (const op of ops) op.abort.abort();
    this.pending.get(id)?.abort();
    await Promise.allSettled(ops.map((op) => op.stop?.()));
  }
  private async authenticated(id: string, signal: AbortSignal) {
    const p = this.store.require(id);
    if (this.snapshot(p).state !== "authenticated") {
      if (this.pending.has(id)) throw adapterErrors.authenticationRequired("Selected profile is still connecting; retry after it settles");
      const abort = () => this.pending.get(id)?.abort();
      signal.addEventListener("abort", abort, { once: true });
      try { await this.refresh(id, undefined, true); } finally { signal.removeEventListener("abort", abort); }
    }
    if (signal.aborted) throw adapterErrors.cancelled();
    if (this.snapshot(p).state !== "authenticated") throw adapterErrors.authenticationRequired();
    this.digest(id);
    return p;
  }
  private driver(id: string) {
    const assets = (this.options.assets ?? resolveCursorAssets)();
    const env = this.store.environment(id, undefined, this.options.ambient);
    return this.options.driver?.(assets, env) ?? nativeCursorDriver(assets, env, this.options.turnTimeoutMs);
  }
  private nativeBinding(b: CursorBinding) {
    return { runtimeId: "cursor", connectionProfileId: b.native.connectionProfileId, workspaceRootPath: b.native.runtimeMetadata!.workspaceRootPath, modelId: b.native.modelId, modeId: "agent", credentialDigest: b.credentialDigest, ...b.native.runtimeMetadata };
  }
  private operation(b: CursorBinding, action: CursorOperation["action"]): CursorOperation {
    return { action, agentId: b.native.nativeSessionId, store: this.bindings.store(b.native.connectionProfileId!, b.storeId), cwd: String(b.native.runtimeMetadata!.workspaceRootPath), key: this.store.readKey(b.native.connectionProfileId!)!, modelId: b.native.modelId, binding: this.nativeBinding(b) };
  }
  private valid(b: CursorBinding, generation: number, signal: AbortSignal) {
    const p = this.store.require(b.native.connectionProfileId);
    if (signal.aborted || this.closed || this.snapshot(p).generation !== generation || this.digest(p.id) !== b.credentialDigest) throw adapterErrors.cancelled("Native operation expired");
  }
  private validate(native: NativeSessionRef, cwd: string, profile?: string) {
    if (native.runtimeId !== "cursor" || (profile !== undefined && profile !== native.connectionProfileId)) throw new Error("Native profile mismatch");
    if (!native.connectionProfileId) throw adapterErrors.sessionNotFound("Selected native agent");
    const b = this.bindings.read(native);
    if (!b) throw adapterErrors.sessionNotFound("Selected native agent");
    if (b.native.modelId !== native.modelId || b.native.modeId !== native.modeId || JSON.stringify(b.native.runtimeMetadata) !== JSON.stringify(native.runtimeMetadata) || b.native.runtimeMetadata!.workspaceRootPath !== realpathSync(cwd)) throw new Error("Native workspace/model/settings binding mismatch");
    if (this.digest(native.connectionProfileId!) !== b.credentialDigest) throw adapterErrors.authenticationRequired("Restore the original profile credential or create a new session");
    return b;
  }
  async createSession(request: CreateAgentSessionRequest): Promise<NativeSessionRef> {
    const p = this.store.require(request.connectionProfileId);
if (request.runtimeId !== "cursor" || (request.modeId !== undefined && request.modeId !== "agent")) throw adapterErrors.capabilityNotSupported("native-session-settings");
    const policy = cursorPolicy(request.runtimeMetadata, this.parameters.get(p.id + ":" + request.modelId));
    const reserved = this.reserve(p.id, p.id + ":create");
    try {
      await this.authenticated(p.id, reserved.abort.signal);
      if (JSON.stringify(policy) !== JSON.stringify(cursorPolicy(request.runtimeMetadata, this.parameters.get(p.id + ":" + request.modelId)))) throw adapterErrors.capabilityNotSupported("changed-native-model-parameters");
      if (!request.modelId || !(this.catalogs.get(p.id) ?? []).some((m) => m.id === request.modelId)) throw new Error("Select an explicit native catalog model");
      const b: CursorBinding = { native: { runtimeId: "cursor", nativeSessionId: asNativeSessionId("agent-pending"), connectionProfileId: p.id, modelId: request.modelId, modeId: "agent", runtimeMetadata: { ...policy, workspaceRootPath: realpathSync(request.workspaceRootPath) } }, storeId: randomUUID(), credentialDigest: this.digest(p.id), cursor: 0, users: Object.create(null) };
      const generation = this.snapshot(p).generation;
      let created = false;
      const driver = this.driver(p.id);
      this.operations.get(p.id + ":create")!.stop = () => driver.stop?.() ?? Promise.resolve();
      for await (const frame of driver.operation(this.operation(b, "create"), reserved.abort.signal)) {
        this.valid(b, generation, reserved.abort.signal);
        if (frame.type !== "created" || created || typeof frame.agentId !== "string" || !/^agent-[A-Za-z0-9_-]{1,150}$/.test(frame.agentId) || frame.agentId.includes(this.store.readKey(p.id)!)) throw new Error("Native agent creation failed; inspect retained private store before trying again");
        b.native = { ...b.native, nativeSessionId: asNativeSessionId(frame.agentId) };
        this.bindings.save(b); created = true;
      }
      this.valid(b, generation, reserved.abort.signal);
      if (!created) throw new Error("Native agent creation acknowledgement missing; inspect retained private store");
      return b.native;
    } finally { reserved.finish(); }
  }
  async resumeSession(request: ResumeAgentSessionRequest): Promise<NativeSessionRef> {
    const b = this.validate(request.native, request.workspaceRootPath, request.connectionProfileId);
    const id = b.native.connectionProfileId!, reserved = this.reserve(id, id + ":" + b.native.nativeSessionId);
    try {
      await this.authenticated(id, reserved.abort.signal);
      const generation = this.snapshot(this.store.require(id)).generation, key = this.store.readKey(id)!;
      const history: NonNullable<NativeSessionRef["history"]>[number][] = [];
      const runs = new Map<string, { run: any; mapper: CursorMapper; events: SessionEvent[]; user: string; at: string; count: number; lastSeq: number }>();
      let done = false, bytes = 0;
      const driver = this.driver(id);
      this.operations.get(id + ":" + b.native.nativeSessionId)!.stop = () => driver.stop?.() ?? Promise.resolve();
      for await (const frame of driver.operation(this.operation(b, "history"), reserved.abort.signal)) {
        this.valid(b, generation, reserved.abort.signal);
        if (done) throw new Error("Native history after acknowledgement");
        bytes += Buffer.byteLength(JSON.stringify(frame));
        if (bytes > 16777216) throw new Error("Native history exceeds capacity");
        if (frame.type === "failure") {
          if (frame.reason === "missing") throw adapterErrors.sessionNotFound("Selected native agent");
          throw new Error("Native history is unavailable; retained session metadata was preserved");
        }
        if (frame.type === "historyRun") {
          const run = frame.run;
          if (!run || run.agentId !== b.native.nativeSessionId || typeof run.runId !== "string" || !/^run-[A-Za-z0-9_-]{1,150}$/.test(run.runId) || run.runId.includes(key) || runs.has(run.runId) || runs.size >= 4096 || !["queued", "running", "finished", "error", "cancelled", "expired"].includes(run.status) || !Number.isFinite(run.createdAt) || Math.abs(run.createdAt) > 8640000000000000) throw new Error("Malformed native history run");
          runs.set(run.runId, { run, mapper: new CursorMapper(b.native.nativeSessionId, run.runId, run.runId, key), events: [], user: "", at: new Date(run.createdAt).toISOString(), count: 0, lastSeq: 0 });
        } else if (frame.type === "historyEvent") {
          const entry = runs.get(frame.runId);
          if (!entry || !Number.isSafeInteger(frame.seq) || frame.seq <= entry.lastSeq || ++entry.count > 4096 || !Number.isFinite(frame.createdAt) || Math.abs(frame.createdAt) > 8640000000000000) throw new Error("Malformed native history event");
          entry.lastSeq = frame.seq;
          const message = frame.message;
          if (message?.type === "user") {
            if (message.agent_id !== b.native.nativeSessionId || message.run_id !== frame.runId || !Array.isArray(message.message?.content) || message.message.content.some((x: any) => x.type !== "text" || typeof x.text !== "string")) throw new Error("Malformed native user history");
            entry.user += message.message.content.map((x: any) => x.text).join("");
          }
          for (const payload of entry.mapper.event(message)) entry.events.push({ ...payload, nativeSessionId: b.native.nativeSessionId, connectionProfileId: id, nativeTurnId: frame.runId, nativeGeneration: generation, nativeItemId: frame.runId + ":event:" + frame.seq, seq: ++b.cursor, at: new Date(frame.createdAt).toISOString() } as SessionEvent);
        } else if (frame.type === "historyDone") { if (done) throw new Error("Duplicate native history acknowledgement"); done = true; }
        else throw new Error("Malformed native history response");
      }
      if (!done) throw new Error("Native history acknowledgement missing");
      for (const [runId, entry] of runs) {
        if (entry.count === 0 && entry.run.status === "queued" && entry.run.startedAt == null) continue;
        const mapped = Object.values(b.users).find((u) => u.runId === runId);
        if (mapped && ["finished", "error", "cancelled", "expired"].includes(entry.run.status)) mapped.settled = true;
        const events = [...entry.events, ...entry.mapper.finish().map((payload) => ({ ...payload, nativeSessionId: b.native.nativeSessionId, connectionProfileId: id, nativeTurnId: runId, nativeGeneration: generation, seq: ++b.cursor, at: entry.at } as SessionEvent))];
        if (entry.user) history.push({ id: mapped?.id ?? runId + ":user", role: "user", content: entry.user, createdAt: entry.at, nativeTurnId: runId });
        history.push({ id: runId + ":assistant", role: "assistant", content: entry.mapper.text, createdAt: entry.at, nativeTurnId: runId, completionState: entry.run.status === "finished" ? "completed" : entry.run.status === "error" ? "failed" : "interrupted", events });
      }
      this.bindings.save(b);
      return cursorSafe({ ...b.native, history }, key);
    } finally { reserved.finish(); }
  }
  async *send(request: AgentTurnRequest): AsyncIterable<SessionEvent> {
    const b = this.validate(request.native, request.workspaceRootPath, request.connectionProfileId);
    const id = b.native.connectionProfileId!, reserved = this.reserve(id, id + ":" + b.native.nativeSessionId, request.turnId);
    let mapper: CursorMapper | undefined, terminal = false, dispatched = false, announced = false;
    let terminalEvent: any, durableSettlement = false;
    let clientId: string | undefined;
    let generation = 0, key = "", failureMessage = "Native turn failed or its acknowledgement was lost; resume explicitly. The prompt will not be resent.";
    const emit = (payload: any): SessionEvent => cursorSafe({ ...payload, nativeSessionId: b.native.nativeSessionId, connectionProfileId: id, nativeGeneration: generation, ...(mapper ? { nativeTurnId: mapper.runId } : {}), seq: ++b.cursor, at: new Date().toISOString() }, key);
    try {
      await this.authenticated(id, reserved.abort.signal);
      generation = this.snapshot(this.store.require(id)).generation;
      key = this.store.readKey(id)!;
      if (request.attachments?.length) throw adapterErrors.capabilityNotSupported("attachments");
      clientId = typeof request.context?.clientUserMessageId === "string" ? request.context.clientUserMessageId : request.turnId;
      if (!clientId || ["__proto__", "constructor", "prototype"].includes(clientId) || clientId.includes(key) || clientId.length > 500 || Buffer.byteLength(request.prompt) > 262144) throw new Error("Native turn input exceeds capacity");
      if (Object.hasOwn(b.users, clientId) || Object.values(b.users).some((u) => !u.settled)) throw new Error("Previous native dispatch is uncertain or already accepted; resume explicitly and inspect history before continuing");
      b.users[clientId] = { id: clientId, createdAt: new Date().toISOString(), settled: false };
      this.bindings.save(b);
      announced = true;
      yield emit({ type: "turn.started", turnId: request.turnId });
      if (reserved.abort.signal.aborted) throw adapterErrors.cancelled();
      const operation = { ...this.operation(b, "send"), prompt: request.prompt };
      const driver = this.driver(id);
      this.operations.get(id + ":" + b.native.nativeSessionId)!.stop = () => driver.stop?.() ?? Promise.resolve();
      dispatched = true;
      for await (const frame of driver.operation(operation, reserved.abort.signal)) {
        if (reserved.abort.signal.aborted) {
          if (frame.type === "terminal" && mapper && frame.runId === mapper.runId && frame.status === "cancelled") { b.users[clientId].settled = true; terminal = true; terminalEvent = { type: "turn.cancelled", turnId: request.turnId }; }
          continue;
        }
        this.valid(b, generation, reserved.abort.signal);
        if (terminal) throw new Error("Native event after terminal");
        if (frame.type === "started") {
          if (mapper || frame.agentId !== b.native.nativeSessionId || typeof frame.runId !== "string" || !/^run-[A-Za-z0-9_-]{1,150}$/.test(frame.runId) || frame.runId.includes(key)) throw new Error("Malformed native run acknowledgement");
          mapper = new CursorMapper(b.native.nativeSessionId, frame.runId, request.turnId, key);
          b.users[clientId].runId = frame.runId; this.bindings.save(b);
        } else if (frame.type === "event" && mapper) {
          for (const payload of mapper.event(frame.message)) yield emit(payload);
        } else if (frame.type === "terminal" && mapper && frame.runId === mapper.runId && ["finished", "error", "cancelled"].includes(frame.status)) {
          for (const payload of mapper.finish()) yield emit(payload);
          b.users[clientId].settled = true; terminal = true;
          terminalEvent = frame.status === "finished" ? { type: "turn.finished", turnId: request.turnId } : frame.status === "cancelled" ? { type: "turn.cancelled", turnId: request.turnId } : { type: "turn.failed", turnId: request.turnId, message: "Native run failed; resume explicitly to inspect retained history." };
        } else if (frame.type === "failure") {
          failureMessage = frame.reason === "auth-required" ? "Native authentication was rejected. Reconnect this profile; the prompt will not be resent." : frame.reason === "quota" ? "Native quota or rate limit reached. Wait or review the selected account; the prompt will not be resent." : frame.reason === "offline" ? "Native service is unreachable. Check connectivity and resume explicitly; the prompt will not be resent." : "Native runtime failed or disconnected. Resume explicitly to inspect retained history; the prompt will not be resent.";
          throw new Error("Native turn failed");
        }
        else throw new Error("Malformed native turn response");
      }
      if (!terminal) throw new Error("Native terminal acknowledgement missing");
      // Publish terminal only after worker disposal and durable settlement.
      const settled = emit(terminalEvent);
      this.bindings.save(b);
      durableSettlement = true;
      terminalEvent = undefined;
      reserved.finish();
      yield settled;
    } catch {
      if (terminalEvent) terminal = false;
      if (!terminal) {
        if (!announced) { announced = true; yield emit({ type: "turn.started", turnId: request.turnId }); }
        if (!dispatched && clientId && reserved.abort.signal.aborted) delete b.users[clientId];
        if (!reserved.abort.signal.aborted) yield emit({ type: "diagnostic", level: "warn", reason: "malformed", message: "Native operation could not be completed safely; no raw payload retained." });
        if (mapper) for (const payload of mapper.finish()) yield emit(payload);
        terminal = true;
        const settled = emit(reserved.abort.signal.aborted ? { type: "turn.cancelled", turnId: request.turnId } : { type: "turn.failed", turnId: request.turnId, message: failureMessage });
        this.bindings.save(b);
        durableSettlement = true;
        reserved.finish();
        yield settled;
      }
    } finally {
      reserved.abort.abort();
      try { if (!durableSettlement) this.bindings.save(b); } finally { reserved.finish(); }
    }
  }
  async cancel(request: CancelAgentTurnRequest) {
    const route = request.native.connectionProfileId + ":" + request.native.nativeSessionId;
    const op = this.operations.get(route);
    if (op && (!request.turnId || request.turnId === op.turnId)) { op.abort.abort(); await op.stop?.(); }
  }
  async close() {
    this.closed = true;
    for (const abort of this.pending.values()) abort.abort();
    this.pending.clear();
    for (const op of this.operations.values()) op.abort.abort();
    await Promise.allSettled([...this.controls, ...[...this.operations.values()].map((op) => op.stop?.())]);
  }
}
