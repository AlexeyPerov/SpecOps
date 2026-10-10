import { claudeCapabilities } from "../../../src/lib/session/runtimeCapabilities";
import { realpathSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import {
  asNativeSessionId,
  asSpecOpsTurnId,
} from "../../../src/lib/session/ids";
import { ClaudeBindings, type ClaudeBinding } from "./binding";
import {
  ClaudeProcessOwner,
  nativeSessionDriver,
  type ClaudeSessionDriver,
} from "./session";
import { ClaudeTurn } from "./turn";
import { ClaudeInteractions } from "./interactions";
import { claudePolicy, claudeQueryPolicy, claudeConfiguration } from "./policy";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentRuntimeAdapter,
  AgentAuthRequest,
  AgentAuthResult,
  NativeSessionRef,
  AgentTurnRequest,
  CreateAgentSessionRequest,
  ResumeAgentSessionRequest,
  CancelAgentTurnRequest,
} from "../../../src/lib/session/adapter";
import type {
  CatalogExtension,
  SessionConfigurationExtension,
  PermissionExtension,
  QuestionExtension,
  LifecycleExtension,
} from "../../../src/lib/session/adapter/extensions";
import type { SessionEvent } from "../../../src/lib/session/events";
import type {
  ConnectionProfileSnapshot,
  ProfileAuthUpdate,
} from "../../../src/lib/session/profiles";
import { adapterErrors } from "../../../src/lib/session/adapter/errors";
import { redactForSerialization } from "../redact";
import { ClaudeProfileStore, type ClaudeProfile } from "./profiles";
import {
  CLAUDE_NATIVE_VERSION,
  ClaudeRuntimeError,
  resolveClaudeAssets,
  probeClaudeSdk,
  type ClaudeAssets,
} from "./runtime";
export class ClaudeAuthError extends Error {
  constructor(readonly reason: "auth-required" | "offline") {
    super("Claude credential verification failed");
  }
}
export async function verifyClaudeKey(
  key: string,
  signal?: AbortSignal,
): Promise<void> {
  // Verification uses a bounded non-inference API endpoint. Never expose provider response bodies.
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
      redirect: "error",
    });
  } catch {
    throw new ClaudeAuthError("offline");
  }
  await response.body?.cancel();
  if (response.status === 401 || response.status === 403)
    throw new ClaudeAuthError("auth-required");
  if (!response.ok) throw new ClaudeAuthError("offline");
}
export interface ClaudeAdapterOptions {
  profileRoot?: string;
  /** Explicit embedding/test disable switch. Installed/live acceptance is tracked separately. */
  enableNativeTurns?: boolean;
  sessionDriver?: (assets: ClaudeAssets) => ClaudeSessionDriver;
  turnTimeoutMs?: number;
  interactionTimeoutMs?: number;
  ambient?: NodeJS.ProcessEnv;
  assets?: () => ClaudeAssets;
  probe?: (
    assets: ClaudeAssets,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ) => Promise<readonly { value: string; displayName: string }[]>;
  verifyKey?: (key: string, signal?: AbortSignal) => Promise<void>;
}
export class ClaudeRuntimeAdapter
  implements
    AgentRuntimeAdapter,
    CatalogExtension,
    SessionConfigurationExtension,
    PermissionExtension,
    QuestionExtension,
    LifecycleExtension
{
  readonly runtimeId = "claude" as const;
  readonly store: ClaudeProfileStore;
  readonly snapshots = new Map<string, ConnectionProfileSnapshot>();
  private readonly catalogs = new Map<
    string,
    readonly { id: string; name: string }[]
  >();
  private readonly pending = new Map<string, AbortController>();
  private bindings: ClaudeBindings;
  private turns = new Map<string, ClaudeTurn>();
  private interactions = new Map<string, ClaudeInteractions>();
  private reserved = new Map<
    string,
    { abort: AbortController; turnId: string }
  >();
  private controls = new Map<string, Set<AbortController>>();
  onAuthUpdate: (update: ProfileAuthUpdate) => void = () => {};
  constructor(readonly options: ClaudeAdapterOptions = {}) {
    this.store = new ClaudeProfileStore(
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
          "claude",
        ),
    );
    this.bindings = new ClaudeBindings(this.store);
  }
  async describe() {
    return { id: this.runtimeId, label: "Claude" };
  }
  async describeCapabilities() { const capabilities = claudeCapabilities(); return { ...capabilities, details: { ...capabilities.details, nativeTurns: { ...capabilities.details.nativeTurns, supported: this.options.enableNativeTurns !== false } } }; }
  snapshot(p: ClaudeProfile) {
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
    return redactForSerialization(
      { ...s },
      Infinity,
    ) as ConnectionProfileSnapshot;
  }
  private publish(p: ClaudeProfile) {
    const s = this.safe(this.snapshot(p));
    this.onAuthUpdate({
      runtimeId: this.runtimeId,
      connectionProfileId: p.id,
      generation: s.generation,
      profile: s,
    });
  }
  private begin(p: ClaudeProfile) {
    this.pending.get(p.id)?.abort();
    const abort = new AbortController();
    this.pending.set(p.id, abort);
    const s = this.snapshot(p);
    s.generation++;
    s.state = "connecting";
    delete s.account;
    delete s.message;
    delete s.recovery;
    this.catalogs.delete(p.id);
    this.publish(p);
    return { s, generation: s.generation, abort };
  }
  async refresh(
    id: string,
    candidate?: string,
  ): Promise<ConnectionProfileSnapshot> {
    const p = this.store.require(id);
    if (
      !candidate &&
      this.snapshot(p).state === "authenticated" &&
      [...this.turns.values()].some(
        (t) => !t.ended && t.request.native.connectionProfileId === id,
      )
    )
      return this.safe(this.snapshot(p));
    if (candidate) await this.stopProfile(id);
    const { s, generation, abort } = this.begin(p);
    const current = () => !abort.signal.aborted && s.generation === generation;
    try {
      const assets = (this.options.assets ?? resolveClaudeAssets)();
      const key = candidate ?? this.store.readKey(id);
      // Native initialization without a key does not authorize sessions or claim an account.
      const rows = await (this.options.probe ?? probeClaudeSdk)(
        assets,
        this.store.environment(id, key, this.options.ambient),
        abort.signal,
      );
      if (!current()) throw new Error("Authentication generation expired");
      if (!key) {
        s.state = "auth-required";
        s.recovery = "auth-required";
      } else {
        await (this.options.verifyKey ?? verifyClaudeKey)(key, abort.signal);
        if (!current()) throw new Error("Authentication generation expired");
        if (candidate) {
          this.store.saveKey(id, key);
          this.store.consumeImport(id, key);
        }
        s.state = "authenticated";
        s.account = { type: "apiKey" };
        if (rows.length > 1000 || JSON.stringify(rows).length > 1024 * 1024)
          throw new Error("Native catalog exceeds capacity");
        const unique = new Map<string, { id: string; name: string }>();
        for (const row of rows)
          if (
            typeof row.value === "string" &&
            !row.value.includes(key) &&
            /^[a-zA-Z0-9._:-]{1,200}$/.test(row.value) &&
            typeof row.displayName === "string"
          )
            unique.set(row.value, {
              id: row.value,
              name: String(
                redactForSerialization(
                  row.displayName.replaceAll(key, "[REDACTED]").slice(0, 200),
                ),
              ),
            });
        this.catalogs.set(id, [...unique.values()]);
      }
    } catch (error) {
      if (!current()) throw new Error("Authentication generation expired");
      if (error instanceof ClaudeRuntimeError) {
        s.state = error.state;
        s.message = error.message;
      } else if (error instanceof ClaudeAuthError) {
        s.state = error.reason === "auth-required" ? "auth-required" : "error";
        s.recovery = error.reason;
        s.message =
          error.reason === "auth-required"
            ? "API key was rejected. Import a valid private API key."
            : "Claude is offline. Reconnect this profile and verify its credential.";
      } else {
        s.state = "error";
        s.recovery = "retry";
        s.message =
          "Claude initialization failed. Check private profile files and reinstall the pinned native assets, then reconnect.";
      }
    } finally {
      if (current()) {
        this.pending.delete(id);
        this.publish(p);
      }
    }
    return this.safe(s);
  }
  async authenticate(request: AgentAuthRequest): Promise<AgentAuthResult> {
    if (request.runtimeId !== this.runtimeId)
      throw new Error("Runtime mismatch");
    const action = request.options?.action ?? "read";
    const profiles = () =>
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
    const p = this.store.require(request.connectionProfileId);
    if (request.options?.apiKey !== undefined)
      throw new Error("Use the selected profile private API key file");
    if (action === "logout") {
      await this.stopProfile(p.id);
      this.pending.get(p.id)?.abort();
      this.pending.delete(p.id);
      const s = this.snapshot(p);
      s.generation++;
      this.store.logout(p.id);
      this.catalogs.delete(p.id);
      s.state = "auth-required";
      delete s.account;
      delete s.message;
      s.recovery = "auth-required";
      this.publish(p);
      return { status: "challenge", profile: this.safe(s) };
    }
    if (!["read", "restart", "login-api-key"].includes(String(action)))
      throw new Error(
        "Claude supports host-owned API key profiles. Subscription browser/device login and cloud import are unavailable.",
      );
    if (
      action === "login-api-key" &&
      (request.credential?.kind !== "api-key" ||
        request.credential.ref !== "profile-api-key")
    )
      throw new Error("Use the selected profile private API key file");
    if (action === "restart") await this.stopProfile(p.id);
    const profile = await this.refresh(
      p.id,
      action === "login-api-key" ? this.store.importKey(p.id) : undefined,
    );
    return {
      status: profile.state === "authenticated" ? "authenticated" : "challenge",
      profile,
    };
  }
  async listModels(input?: { connectionProfileId?: string }) {
    const p = this.store.require(input?.connectionProfileId);
    if (this.snapshot(p).state !== "authenticated") await this.refresh(p.id);
    return this.snapshot(p).state === "authenticated"
      ? (this.catalogs.get(p.id) ?? [])
      : [];
  }
  async listModes() {
    return [];
  }
  async describeSessionConfiguration() {
    return claudeConfiguration;
  }
  async health(connectionProfileId?: string) {
    if (!connectionProfileId) {
      let message = "Select a Claude profile to verify its connection.";
      let status: "degraded" | "unavailable" = "degraded";
      try {
        (this.options.assets ?? resolveClaudeAssets)();
      } catch (e) {
        status = "unavailable";
        message =
          e instanceof ClaudeRuntimeError
            ? e.message
            : "Claude assets unavailable";
      }
      return {
        runtimeId: this.runtimeId,
        runtimeVersion: CLAUDE_NATIVE_VERSION,
        status,
        message,
        checkedAt: new Date().toISOString(),
      };
    }
    const s = await this.refresh(connectionProfileId);
    return {
      runtimeId: this.runtimeId,
      runtimeVersion: CLAUDE_NATIVE_VERSION,
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
  private gate() {
    if (this.options.enableNativeTurns === false)
      throw adapterErrors.capabilityNotSupported("nativeTurns");
  }
  private driver() {
    const assets = (this.options.assets ?? resolveClaudeAssets)();
    return (this.options.sessionDriver ?? nativeSessionDriver)(assets);
  }
  private async authenticated(id?: string) {
    const p = this.store.require(id);
    if (this.snapshot(p).state !== "authenticated") await this.refresh(p.id);
    if (this.snapshot(p).state !== "authenticated" || !this.store.readKey(p.id))
      throw adapterErrors.authenticationRequired();
    return p;
  }
  private routing(native: NativeSessionRef) {
    return `${native.connectionProfileId}:${native.nativeSessionId}`;
  }
  private validate(native: NativeSessionRef, path: string, profile?: string) {
    if (!native.connectionProfileId)
      throw adapterErrors.sessionNotFound(native.nativeSessionId);
    if (
      native.runtimeId !== "claude" ||
      (profile && profile !== native.connectionProfileId)
    )
      throw new Error("Immutable native profile mismatch");
    const b = this.bindings.read(native);
    if (!b) throw adapterErrors.sessionNotFound(native.nativeSessionId);
    if (
      realpathSync(path) !== b.native.runtimeMetadata?.workspaceRootPath ||
      native.modelId !== b.native.modelId ||
      native.modeId !== b.native.modeId ||
      JSON.stringify(native.runtimeMetadata) !==
        JSON.stringify(b.native.runtimeMetadata)
    )
      throw new Error("Immutable native settings or workspace mismatch");
    claudePolicy(b.native.runtimeMetadata);
    const key = this.store.readKey(native.connectionProfileId);
    if (
      !key ||
      createHash("sha256").update(key).digest("hex") !== b.credentialDigest
    )
      throw adapterErrors.authenticationRequired(
        "Native session credential binding changed; restore the original profile credential or create a new session.",
      );
    return b;
  }
  private queryOptions(
    binding: ClaudeBinding,
    abort: AbortController,
    owner: ClaudeProcessOwner,
    interactions?: ClaudeInteractions,
  ) {
    const id = binding.native.connectionProfileId!;
    const key = this.store.readKey(id);
    if (!key) throw adapterErrors.authenticationRequired();
    return {
      cwd: String(binding.native.runtimeMetadata!.workspaceRootPath),
      env: this.store.environment(id, key, this.options.ambient),
      pathToClaudeCodeExecutable: (this.options.assets ?? resolveClaudeAssets)()
        .executable,
      model: binding.native.modelId,
      ...claudeQueryPolicy(binding.native.runtimeMetadata!),
      canUseTool: interactions?.canUseTool ?? (async () => ({ behavior: "deny" as const, message: "No active native interaction context." })),
      onUserDialog: interactions?.onUserDialog ?? (async () => ({ behavior: "cancelled" as const })),
      supportedDialogKinds: [],
      persistSession: true,
      includePartialMessages: true,
      abortController: abort,
      spawnClaudeCodeProcess: owner.spawn(
        this.store.environment(id, key, this.options.ambient),
      ),
      ...(binding.started
        ? { resume: binding.native.nativeSessionId }
        : { sessionId: binding.native.nativeSessionId }),
    };
  }
  private control(id: string) {
    const abort = new AbortController();
    let set = this.controls.get(id);
    if (!set) this.controls.set(id, (set = new Set()));
    set.add(abort);
    return {
      abort,
      done: () => {
        set!.delete(abort);
        if (!set!.size) this.controls.delete(id);
      },
    };
  }
  private async stopProfile(id: string) {
    for (const [routing, reservation] of this.reserved)
      if (routing.startsWith(`${id}:`)) reservation.abort.abort();
    for (const abort of this.controls.get(id) ?? []) abort.abort();
    await Promise.all(
      [...this.turns.values()]
        .filter((t) => t.request.native.connectionProfileId === id)
        .map((t) => t.stop()),
    );
  }
  async createSession(
    request: CreateAgentSessionRequest = {
      runtimeId: "claude",
      workspaceRootPath: "",
    },
  ): Promise<NativeSessionRef> {
    this.gate();
    if (
      request.runtimeId !== "claude" ||
      request.modeId
    )
      throw new Error("Unsupported native session settings");
    const policy = claudePolicy(request.runtimeMetadata);
    const p = await this.authenticated(request.connectionProfileId);
    const directory = realpathSync(request.workspaceRootPath);
    if (
      !request.modelId ||
      (this.catalogs.get(p.id) ?? []).every((m) => m.id !== request.modelId)
    )
      throw new Error("Select an explicit native catalog model");
    const native: NativeSessionRef = {
      runtimeId: "claude",
      connectionProfileId: p.id,
      nativeSessionId: asNativeSessionId(randomUUID()),
      modelId: request.modelId,
      runtimeMetadata: {
        workspaceRootPath: directory,
        ...policy,
      },
    };
    const binding: ClaudeBinding = {
      native,
      credentialDigest: createHash("sha256")
        .update(this.store.readKey(p.id)!)
        .digest("hex"),
      started: false,
      cursor: 0,
      cost: 0,
      users: {},
    };
    const owner = new ClaudeProcessOwner();
    const { abort, done } = this.control(p.id);
    const generation = this.snapshot(p).generation;
    let q: Awaited<ReturnType<ClaudeSessionDriver["query"]>> | undefined;
    async function* idle() {
      if (abort.signal.aborted) return;
      await new Promise<void>((resolve) =>
        abort.signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    }
    try {
      q = await this.driver().query({
        prompt: idle(),
        options: this.queryOptions(binding, abort, owner),
      });
      await Promise.race([
        q.supportedModels(),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Native session initialization timed out")),
            10000,
          );
          abort.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("Native session initialization cancelled"));
            },
            { once: true },
          );
        }),
      ]);
      if (abort.signal.aborted || generation !== this.snapshot(p).generation)
        throw new Error("Native creation expired");
      this.bindings.save(binding);
      return native;
    } finally {
      abort.abort();
      q?.close();
      await owner.close();
      done();
    }
  }
  async resumeSession(
    request: ResumeAgentSessionRequest,
  ): Promise<NativeSessionRef> {
    this.gate();
    const binding = this.validate(
      request.native,
      request.workspaceRootPath,
      request.connectionProfileId,
    );
    const p = await this.authenticated(request.native.connectionProfileId);
    const { abort, done } = this.control(p.id);
    const generation = this.snapshot(p).generation;
    try {
      const result = await this.driver().history(
        request.native.nativeSessionId,
        String(binding.native.runtimeMetadata!.workspaceRootPath),
        this.store.environment(
          p.id,
          this.store.readKey(p.id),
          this.options.ambient,
        ),
        abort.signal,
      );
      if (abort.signal.aborted || generation !== this.snapshot(p).generation)
        throw new Error("Native history expired");
      // A control-only session has no conversation yet. It remains an explicitly
      // reserved UUID until the first native prompt; accepted turns never fall back.
      if (!result.exists && binding.started)
        throw adapterErrors.sessionNotFound(request.native.nativeSessionId);
      if (
        result.messages.length > 4096 ||
        Buffer.byteLength(JSON.stringify(result.messages)) > 8 * 1024 * 1024
      )
        throw new Error("Native history exceeds hydration capacity");
      const history: NonNullable<NativeSessionRef["history"]>[number][] = [];
      let nativeTurnId = "";
      let assistantText = "";
      let assistantId = "";
      let completed = false;
      let events: SessionEvent[] = [];
      let seq = 0;
      const flush = () => {
        if (!assistantId) return;
        history.push({
          id: `native-assistant:${nativeTurnId}`,
          role: "assistant",
          content: assistantText,
          createdAt: binding.users[nativeTurnId]?.createdAt ?? "",
          nativeTurnId,
          nativeItemId: assistantId,
          completionState: completed ? "completed" : "interrupted",
          events,
        });
        assistantText = "";
        assistantId = "";
        events = [];
        completed = false;
      };
      const key = this.store.readKey(p.id)!;
      const safe = (value: unknown): any =>
        typeof value === "string"
          ? redactForSerialization(
              value.replaceAll(key, "[REDACTED]"),
              Infinity,
            )
          : Array.isArray(value)
            ? value.map(safe)
            : value && typeof value === "object"
              ? Object.fromEntries(
                  Object.entries(value).map(([k, v]) => [
                    k.replaceAll(key, "[REDACTED]"),
                    safe(v),
                  ]),
                )
              : value;
      let eventBytes = 0,
        eventCount = 0;
      const add = (payload: Record<string, unknown>, nativeItemId: string) => {
        if (nativeItemId.length > 500 || ++eventCount > 16000)
          throw new Error("Native history exceeds normalized capacity");
        const event = {
          ...safe(payload),
          nativeSessionId: request.native.nativeSessionId,
          connectionProfileId: p.id,
          nativeTurnId,
          nativeItemId,
          nativeGeneration: generation,
          turnId: asSpecOpsTurnId(`native:${nativeTurnId}`),
          seq: ++seq,
          at: binding.users[nativeTurnId]?.createdAt ?? "",
        } as SessionEvent;
        eventBytes += Buffer.byteLength(JSON.stringify(event));
        if (eventBytes > 8 * 1024 * 1024)
          throw new Error("Native history exceeds normalized capacity");
        events.push(event);
      };
      for (const message of result.messages) {
        if (
          message.session_id !== request.native.nativeSessionId ||
          !["user", "assistant"].includes(message.type) ||
          typeof message.uuid !== "string" ||
          message.uuid.length > 500
        )
          throw new Error("Malformed native history");
        const content = (message.message as any)?.content;
        if (typeof content !== "string" && !Array.isArray(content))
          throw new Error("Malformed native history content");
        const blocks = Array.isArray(content)
          ? content
          : [{ type: "text", text: content }];
        const isResult = blocks.some((b) => b?.type === "tool_result");
        const text = blocks
          .filter((b) => b?.type === "text")
          .map((b) => {
            if (typeof b.text !== "string")
              throw new Error("Malformed native history text");
            return b.text;
          })
          .join("");
        if (
          message.type === "user" &&
          !message.parent_tool_use_id &&
          !isResult
        ) {
          flush();
          nativeTurnId = message.uuid;
          history.push({
            id: binding.users[message.uuid]?.id ?? message.uuid,
            role: "user",
            content: safe(text),
            createdAt: binding.users[message.uuid]?.createdAt ?? "",
            nativeTurnId,
            nativeItemId: message.uuid,
          });
        } else if (message.type === "assistant") {
          if (!nativeTurnId)
            throw new Error("Native history has no parent user");
          assistantText += safe(text);
          assistantId = message.uuid;
          const stop = (message.message as any).stop_reason;
          completed = ["end_turn", "stop_sequence"].includes(stop);
          for (const [index, block] of blocks.entries()) {
            const id = `${(message.message as any).id ?? message.uuid}:${index}`;
            if (block.type === "text")
              add({ type: "text.delta", delta: block.text }, id);
            else if (block.type === "thinking") {
              if (typeof block.thinking !== "string")
                throw new Error("Malformed native history reasoning");
              add(
                {
                  type: "reasoning.ended",
                  reasoningId: id,
                  text: block.thinking,
                },
                id,
              );
            } else if (block.type === "tool_use") {
              if (
                typeof block.id !== "string" ||
                typeof block.name !== "string"
              )
                throw new Error("Malformed native history tool");
              add(
                {
                  type: "tool.started",
                  toolCall: {
                    callId: block.id,
                    toolName: block.name,
                    status: "running",
                    input: block.input,
                  },
                },
                block.id,
              );
            } else
              add(
                {
                  type: "diagnostic",
                  level: "info",
                  reason: "unknown-native",
                  message: "Unmapped native history content",
                },
                id,
              );
          }
        } else if (isResult && nativeTurnId) {
          for (const block of blocks)
            if (block.type === "tool_result") {
              if (typeof block.tool_use_id !== "string")
                throw new Error("Malformed native history result");
              add(
                {
                  type: "tool.completed",
                  callId: block.tool_use_id,
                  status: block.is_error ? "failure" : "success",
                  output: block.content,
                },
                block.tool_use_id,
              );
            }
        }
      }
      flush();
      // Native identity fields are untrusted transcript data too. Redact the full
      // common history boundary, including IDs and normalized event envelopes.
      return { ...binding.native, history: safe(history) };
    } finally {
      done();
    }
  }
  async *send(request: AgentTurnRequest): AsyncIterable<SessionEvent> {
    this.gate();
    const b = this.validate(
      request.native,
      request.workspaceRootPath,
      request.connectionProfileId,
    );
    const routing = this.routing(request.native);
    if (this.reserved.has(routing))
      throw new Error("A native turn is already active");
    const reservation = new AbortController();
    this.reserved.set(routing, { abort: reservation, turnId: request.turnId });
    let turn: ClaudeTurn | undefined;
    let dispatch: Promise<void> | undefined;
    try {
      const p = await this.authenticated(request.native.connectionProfileId);
      if (reservation.signal.aborted) throw adapterErrors.cancelled();
      if (request.attachments?.length)
        throw adapterErrors.capabilityNotSupported("attachments");
      const generation = this.snapshot(p).generation;
      const key = this.store.readKey(p.id)!;
      const userId = randomUUID();
      b.users[userId] = {
        id:
          typeof request.context?.clientUserMessageId === "string"
            ? request.context.clientUserMessageId
            : request.turnId,
        createdAt: new Date().toISOString(),
      };
      this.bindings.save(b);
      turn = new ClaudeTurn(
        request,
        userId,
        generation,
        key,
        new ClaudeProcessOwner(),
        () => ++b.cursor,
        () =>
          this.snapshot(p).generation === generation &&
          this.snapshot(p).state === "authenticated",
        (total) => {
          const delta = Math.max(0, total - b.cost);
          b.cost = total;
          return delta;
        },
        this.options.turnTimeoutMs ?? 300000,
      );
      this.turns.set(routing, turn);
      const interactions = new ClaudeInteractions(turn, this.options.interactionTimeoutMs ?? 120000);
      this.interactions.set(routing, interactions);
      const current = turn;
      const driver = this.driver();
      dispatch = (async () => {
        try {
          // Persist acceptance intent before dispatch. A crash cannot silently issue a
          // second first prompt; resume requires native authoritative history.
          const options = this.queryOptions(b, current.abort, current.owner, interactions);
          b.started = true;
          this.bindings.save(b);
          async function* prompt() {
            if (current.abort.signal.aborted) return;
            yield {
              type: "user" as const,
              uuid: userId,
              session_id: request.native.nativeSessionId,
              parent_tool_use_id: null,
              message: { role: "user" as const, content: request.prompt },
            };
          }
          const q = await driver.query({ prompt: prompt(), options });
          current.query = q;
          if (current.ended) {
            q.close();
            await current.owner.close();
            return;
          }
          for await (const event of q) {
            current.event(event);
            if (current.ended) break;
          }
          if (!current.ended) current.finish("turn.failed");
        } catch {
          if (!current.ended) current.finish("turn.failed");
        } finally {
          await current.settle();
          this.bindings.save(b);
        }
      })();
      yield* turn.events();
    } finally {
      if (turn) {
        if (!turn.ended) await turn.stop();
        await turn.settle();
      }
      if (dispatch) await dispatch;
      this.interactions.delete(routing);
      this.turns.delete(routing);
      this.reserved.delete(routing);
    }
  }
  async cancel(request: CancelAgentTurnRequest): Promise<void> {
    const reservation = this.reserved.get(this.routing(request.native));
    if (
      reservation &&
      (!request.turnId || request.turnId === reservation.turnId)
    )
      reservation.abort.abort();
    const turn = this.turns.get(this.routing(request.native));
    if (turn && (!request.turnId || turn.request.turnId === request.turnId))
      await turn.stop();
  }
  private interaction(native: NativeSessionRef, turnId: string) {
    const routing = this.routing(native);
    const turn = this.turns.get(routing);
    if (!turn || turn.request.turnId !== turnId || JSON.stringify(native) !== JSON.stringify(turn.request.native))
      throw new Error("Native interaction routing mismatch");
    const interactions = this.interactions.get(routing);
    if (!interactions) throw new Error("Native interaction expired");
    return interactions;
  }
  async replyPermission(input: Parameters<PermissionExtension["replyPermission"]>[0]) {
    this.interaction(input.native, input.turnId).reply(input.permissionId, "permission", input.reply);
  }
  async replyQuestion(input: Parameters<QuestionExtension["replyQuestion"]>[0]) {
    this.interaction(input.native, input.turnId).reply(input.questionId, "question", input.answer);
  }
  async rejectQuestion(input: Parameters<QuestionExtension["rejectQuestion"]>[0]) {
    this.interaction(input.native, input.turnId).reply(input.questionId, "question");
  }
  async interrupt(input: { native: NativeSessionRef }) {
    await this.cancel({native: input.native});
  }
  close() {
    for (const reservation of this.reserved.values()) reservation.abort.abort();
    for (const id of this.controls.keys()) void this.stopProfile(id);
    for (const turn of this.turns.values()) void turn.stop();
    for (const [id, abort] of this.pending) {
      abort.abort();
      const s = this.snapshots.get(id);
      if (s) {
        s.generation++;
        s.state = "disconnected";
        delete s.account;
        this.onAuthUpdate({
          runtimeId: this.runtimeId,
          connectionProfileId: id,
          generation: s.generation,
          profile: this.safe(s),
        });
      }
    }
    this.pending.clear();
    this.catalogs.clear();
  }
}
