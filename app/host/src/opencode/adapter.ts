import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import {
  asNativeSessionId,
  asSpecOpsTurnId,
} from "../../../src/lib/session/ids";
import { adapterErrors } from "../../../src/lib/session/adapter/errors";
import { nativeRoutingKey } from "../../../src/lib/session/profiles";
import { OpenCodeTurn, record } from "./turn";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  AgentRuntimeAdapter,
  AgentAuthRequest,
  AgentAuthResult,
  CreateAgentSessionRequest,
  ResumeAgentSessionRequest,
  NativeSessionRef,
  AgentTurnRequest,
  CancelAgentTurnRequest,
  AdapterHealth,
} from "../../../src/lib/session/adapter";
import type { CatalogExtension } from "../../../src/lib/session/adapter/extensions";
import type { SessionEvent } from "../../../src/lib/session/events";
import type {
  ConnectionProfileSnapshot,
  ProfileAuthUpdate,
} from "../../../src/lib/session/profiles";
import { redactForSerialization } from "../../../src/lib/session/redact";
import { RuntimeProfileStore, type RuntimeProfile } from "./profiles";
import {
  RuntimeConnection,
  RuntimeStartupError,
  OPENCODE_VERSION,
  resolveExecutable,
} from "./lifecycle";
export interface OpenCodeAdapterOptions {
  profileRoot?: string;
  executable?: string | null;
  ambient?: NodeJS.ProcessEnv;
  turnTimeoutMs?: number;
  connectionFactory?: (
    profile: RuntimeProfile,
    store: RuntimeProfileStore,
    executable: string | null,
  ) => RuntimeConnection;
}
export class OpenCodeRuntimeAdapter
  implements AgentRuntimeAdapter, CatalogExtension
{
  readonly runtimeId = "opencode" as const;
  readonly store: RuntimeProfileStore;
  private readonly connections = new Map<string, RuntimeConnection>();
  private readonly snapshots = new Map<string, ConnectionProfileSnapshot>();
  private readonly bindings = new Map<
    string,
    { native: NativeSessionRef; directory: string }
  >();
  private readonly turns = new Map<string, OpenCodeTurn>();
  private readonly clientMessageIds = new Map<string, Record<string, string>>();
  private readonly cursors = new Map<string, number>();
  onAuthUpdate: (update: ProfileAuthUpdate) => void = () => {};
  constructor(readonly options: OpenCodeAdapterOptions = {}) {
    this.store = new RuntimeProfileStore(
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
          "opencode",
        ),
    );
  }
  async describe() {
    return { id: this.runtimeId, label: "OpenCode" };
  }
  async describeCapabilities() {
    return {
      schemaVersion: 1 as const,
      supported: [
        "catalogs" as const,
        "permissions" as const,
        "questions" as const,
      ],
      details: {
        catalogs: { supported: true },
        permissions: { supported: true },
        questions: { supported: true },
        nativeTurns: {
          supported: true,
          notes: "Profile-bound native sessions and cancellable event streams.",
        },
      },
    };
  }
  snapshot(profile: RuntimeProfile): ConnectionProfileSnapshot {
    let value = this.snapshots.get(profile.id);
    if (!value) {
      value = {
        id: profile.id,
        runtimeId: this.runtimeId,
        label: profile.label,
        createdAt: profile.createdAt,
        generation: 0,
        state: "disconnected",
        support: {
          apiKey: profile.ownership === "local",
          browser: false,
          device: false,
        },
      };
      this.snapshots.set(profile.id, value);
    }
    return value;
  }
  private safe(profile: ConnectionProfileSnapshot): ConnectionProfileSnapshot {
    return redactForSerialization(
      { ...profile },
      Infinity,
    ) as ConnectionProfileSnapshot;
  }
  private publish(profile: RuntimeProfile): void {
    const snapshot = this.safe(this.snapshot(profile));
    this.onAuthUpdate({
      runtimeId: this.runtimeId,
      connectionProfileId: profile.id,
      generation: snapshot.generation,
      profile: snapshot,
    });
  }
  async connect(id: unknown): Promise<RuntimeConnection> {
    const profile = this.store.require(id);
    const snapshot = this.snapshot(profile);
    let connection = this.connections.get(profile.id);
    if (!connection) {
      const executable =
        this.options.executable === undefined
          ? resolveExecutable(this.options.ambient)
          : this.options.executable;
      connection =
        this.options.connectionFactory?.(profile, this.store, executable) ??
        new RuntimeConnection(
          profile,
          this.store,
          executable,
          this.options.ambient,
        );
      connection.onExit = (generation) => {
        for (const turn of this.turns.values())
          if (turn.request.native.connectionProfileId === profile.id)
            turn.finish(
              "turn.failed",
              "Native connection ended; resume explicitly.",
            );
        snapshot.generation = generation;
        snapshot.state = "disconnected";
        snapshot.recovery = "offline";
        this.publish(profile);
      };
      this.connections.set(profile.id, connection);
    }
    snapshot.state = "connecting";
    this.publish(profile);
    let requestGeneration: number | undefined;
    let requestClient: RuntimeConnection["client"] = null;
    try {
      await connection.start();
      requestGeneration = connection.generation;
      requestClient = connection.client;
      snapshot.generation = connection.generation;
      delete snapshot.message;
      delete snapshot.recovery;
      const providers = await connection.client!.provider.list();
      if (
        requestGeneration !== connection.generation ||
        requestClient !== connection.client
      )
        throw new Error("Stale provider response");
      if (!providers.data || !Array.isArray(providers.data.connected))
        throw new Error("Invalid provider catalog");
      snapshot.state = providers.data.connected.length
        ? "authenticated"
        : "auth-required";
      this.publish(profile);
      return connection;
    } catch (failure) {
      if (
        requestGeneration !== undefined &&
        (requestGeneration !== connection.generation ||
          requestClient !== connection.client)
      )
        throw new Error("Runtime connection generation expired");
      snapshot.generation = connection.generation;
      snapshot.state = failure instanceof RuntimeStartupError ? failure.kind : "error";
      snapshot.message = failure instanceof RuntimeStartupError ? failure.message : "OpenCode connection failed. Check the selected profile, endpoint and pinned runtime.";
      this.publish(profile);
      throw new Error(snapshot.message);
    }
  }
  async authenticate(request: AgentAuthRequest): Promise<AgentAuthResult> {
    try {
      return await this.authenticationAction(request);
    } catch {
      throw new Error(
        "OpenCode profile action failed. Verify profile, provider and connection settings.",
      );
    }
  }
  private async authenticationAction(
    request: AgentAuthRequest,
  ): Promise<AgentAuthResult> {
    const action = request.options?.action ?? "read";
    if (action === "create-profile") {
      const profile = this.store.create(
        typeof request.options?.label === "string"
          ? request.options.label
          : "OpenCode profile",
        request.options?.endpoint,
      );
      return {
        status: "challenge",
        profile: this.safe(this.snapshot(profile)),
        profiles: this.store.list().map((p) => this.safe(this.snapshot(p))),
      };
    }
    if (action === "list-profiles")
      return {
        status: "challenge",
        profiles: this.store.list().map((p) => this.safe(this.snapshot(p))),
      };
    const profile = this.store.require(request.connectionProfileId);
    if (action === "restart") this.connections.get(profile.id)?.close();
    const connection = await this.connect(profile.id);
    const generation = connection.generation;
    if (action === "login-api-key" || action === "logout") {
      if (profile.ownership !== "local")
        throw new Error(
          "External endpoint credentials are managed by its owner",
        );
      const providerID = request.options?.providerId;
      if (
        typeof providerID !== "string" ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(providerID)
      )
        throw new Error("A valid provider is required");
      if (action === "logout")
        await connection.client!.auth.remove({ providerID });
      else {
        if (request.options?.apiKey !== undefined || request.credential?.ref !== "profile-api-key") throw new Error("Use the selected profile's private api-key file");
        const imported = this.store.importKey(profile.id);
        await connection.client!.auth.set({
          providerID,
          auth: { type: "api", key: imported.key },
        });
        imported.consume();
      }
      if (generation !== connection.generation || !connection.client)
        throw new Error("Authentication generation expired");
      this.store.secure(profile.id);
      await this.connect(profile.id);
    } else if (!["read", "restart"].includes(String(action)))
      throw new Error("Unsupported authentication action");
    const snapshot = this.safe(this.snapshot(profile));
    return {
      status:
        snapshot.state === "authenticated" ? "authenticated" : "challenge",
      profile: snapshot,
    };
  }
  async listModels(input?: {
    connectionProfileId?: string;
    workspaceRootPath?: string;
  }) {
    const connection = await this.connect(input?.connectionProfileId);
    const generation = connection.generation;
    const result = await connection.client!.config.providers({
      directory: input?.workspaceRootPath,
    });
    if (
      !result.data ||
      generation !== connection.generation ||
      !connection.client
    )
      throw new Error("Provider catalog unavailable");
    return result.data.providers
      .flatMap((provider) =>
        Object.values(provider.models).map((model) => ({
          id: `${provider.id}/${model.id}`,
          name: model.name,
        })),
      )
      .map((model) => redactForSerialization(model, Infinity) as typeof model);
  }
  async listModes(input?: {
    connectionProfileId?: string;
    workspaceRootPath?: string;
  }) {
    const connection = await this.connect(input?.connectionProfileId);
    const generation = connection.generation;
    const client = connection.client;
    const result = await connection.client!.app.agents({
      directory: input?.workspaceRootPath,
    });
    if (
      !result.data ||
      generation !== connection.generation ||
      client !== connection.client
    )
      throw new Error("Agent catalog unavailable");
    return result.data
      .filter((agent) => agent.mode !== "subagent" && !agent.hidden)
      .map((agent) => ({ id: agent.name, name: agent.name }));
  }
  async health(connectionProfileId?: string): Promise<AdapterHealth> {
    if (!connectionProfileId)
      return {
        runtimeId: this.runtimeId,
        runtimeVersion: OPENCODE_VERSION,
        status: "degraded",
        checkedAt: new Date().toISOString(),
        message: "Select an OpenCode profile to verify its connection.",
      };
    try {
      const connection = await this.connect(connectionProfileId);
      return {
        runtimeId: this.runtimeId,
        runtimeVersion: OPENCODE_VERSION,
        connectionProfileId,
        generation: connection.generation,
        status:
          this.snapshot(connection.profile).state === "authenticated"
            ? "healthy"
            : "degraded",
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return {
        runtimeId: this.runtimeId,
        connectionProfileId,
        status: "unavailable",
        checkedAt: new Date().toISOString(),
        message: "OpenCode is offline. Other runtimes remain available.",
      };
    }
  }
  private key(native: NativeSessionRef): string {
    return nativeRoutingKey(
      this.runtimeId,
      native.connectionProfileId,
      String(native.nativeSessionId),
    );
  }
  private nextSeq(native: NativeSessionRef): number {
    const key = this.key(native);
    const value = (this.cursors.get(key) ?? 0) + 1;
    this.cursors.set(key, value);
    return value;
  }
  private directory(path: string): string {
    if (!isAbsolute(path))
      throw new Error("A real absolute workspace root is required");
    try {
      return realpathSync.native(path);
    } catch {
      return path;
    }
  }
  private validate(
    native: NativeSessionRef,
    directory: string,
    profileId?: string,
  ): void {
    if (
      native.runtimeId !== this.runtimeId ||
      !native.connectionProfileId ||
      (profileId && profileId !== native.connectionProfileId)
    )
      throw new Error("Native profile binding mismatch");
    const existing = this.bindings.get(this.key(native));
    if (
      existing &&
      (existing.directory !== directory ||
        existing.native.modelId !== native.modelId ||
        existing.native.modeId !== native.modeId ||
        JSON.stringify(existing.native.runtimeMetadata) !==
          JSON.stringify(native.runtimeMetadata))
    )
      throw new Error("Immutable native session binding mismatch");
  }
  private model(
    id?: string,
  ): { providerID: string; modelID: string } | undefined {
    if (!id) return undefined;
    const slash = id.indexOf("/");
    if (slash < 1 || slash === id.length - 1)
      throw new Error("Select a provider/model from the native catalog");
    return { providerID: id.slice(0, slash), modelID: id.slice(slash + 1) };
  }
  async createSession(
    request: CreateAgentSessionRequest,
  ): Promise<NativeSessionRef> {
    if (request.runtimeId !== this.runtimeId)
      throw new Error("Runtime mismatch");
    const directory = this.directory(request.workspaceRootPath);
    const c = await this.connect(request.connectionProfileId);
    const generation = c.generation;
    const configured = await c.client!.config.get({ directory });
    const modelId = request.modelId ?? configured.data?.model;
    const modeId = request.modeId ?? configured.data?.default_agent ?? "build";
    const model = this.model(modelId);
    const created = await c.client!.session.create({
      directory,
      metadata: {
        specopsBinding: {
          connectionProfileId: c.profile.id,
          workspaceRootPath: directory,
          modelId: modelId ?? null,
          modeId,
        },
        specopsClientMessages: {},
      },
      agent: modeId,
      ...(model
        ? { model: { id: model.modelID, providerID: model.providerID } }
        : {}),
    });
    if (!created.data || c.generation !== generation)
      throw new Error("Native session creation expired");
    const native: NativeSessionRef = {
      runtimeId: this.runtimeId,
      connectionProfileId: c.profile.id,
      nativeSessionId: asNativeSessionId(created.data.id),
      modelId,
      modeId,
      runtimeMetadata: { workspaceRootPath: directory },
    };
    this.clientMessageIds.set(this.key(native), {});
    this.bindings.set(this.key(native), { native, directory });
    return native;
  }
  async resumeSession(
    request: ResumeAgentSessionRequest,
  ): Promise<NativeSessionRef> {
    if (!request.native.connectionProfileId)
      throw adapterErrors.sessionNotFound(
        String(request.native.nativeSessionId),
      );
    const directory = this.directory(request.workspaceRootPath);
    this.validate(request.native, directory, request.connectionProfileId);
    try {
      this.store.require(request.native.connectionProfileId);
    } catch {
      throw adapterErrors.sessionNotFound(
        String(request.native.nativeSessionId),
      );
    }
    const c = await this.connect(request.native.connectionProfileId);
    const generation = c.generation;
    let found;
    try {
      found = await c.client!.session.get(
        { sessionID: request.native.nativeSessionId, directory },
        { throwOnError: false },
      );
    } catch (error) {
      if (record(error) && error.status === 404)
        throw adapterErrors.sessionNotFound(
          String(request.native.nativeSessionId),
        );
      throw new Error(
        "Native history unavailable; cached session metadata was preserved.",
      );
    }
    if (found.response.status === 404)
      throw adapterErrors.sessionNotFound(
        String(request.native.nativeSessionId),
      );
    if (found.error)
      throw new Error(
        "Native history unavailable; cached session metadata was preserved.",
      );
    if (
      !found.data ||
      found.data.id !== request.native.nativeSessionId ||
      found.data.directory !== directory
    )
      throw adapterErrors.sessionNotFound(
        String(request.native.nativeSessionId),
      );
    const saved = found.data.metadata?.specopsBinding;
    if (
      !record(saved) ||
      saved.connectionProfileId !== request.native.connectionProfileId ||
      saved.workspaceRootPath !== directory ||
      saved.modelId !== (request.native.modelId ?? null) ||
      saved.modeId !== (request.native.modeId ?? null)
    )
      throw new Error("Persisted native settings binding mismatch");
    if (request.native.runtimeMetadata?.workspaceRootPath !== directory)
      throw new Error("Immutable workspace binding mismatch");
    // Stop an orphaned native run before hydrating. Never resend its prompt.
    const statuses = await c.client!.session.status({ directory });
    if (
      statuses.data?.[request.native.nativeSessionId]?.type !== "idle" &&
      statuses.data?.[request.native.nativeSessionId]
    )
      await c.client!.session.abort({
        sessionID: request.native.nativeSessionId,
        directory,
      });
    const clientIds = record(found.data.metadata?.specopsClientMessages)
      ? found.data.metadata.specopsClientMessages
      : {};
    if (
      Object.keys(clientIds).length > 10000 ||
      Object.entries(clientIds).some(
        ([key, value]) =>
          key.length > 256 || typeof value !== "string" || value.length > 256,
      )
    )
      throw new Error("Native client message mapping exceeds capacity");
    this.clientMessageIds.set(this.key(request.native), clientIds);
    const rows: any[] = [];
    let before: string | undefined;
    const pageIds = new Set<string>();
    for (;;) {
      const page = await c.client!.session.messages({
        sessionID: request.native.nativeSessionId,
        directory,
        limit: 100,
        before,
      });
      if (!Array.isArray(page.data) || generation !== c.generation)
        throw new Error(
          "Native history snapshot unavailable; cached history was preserved.",
        );
      if (!page.data.length) break;
      rows.push(...page.data);
      if (
        rows.length > 10000 ||
        Buffer.byteLength(JSON.stringify(rows)) > 16 * 1024 * 1024
      )
        throw new Error("Native history exceeds hydration capacity");
      if (page.data.length < 100) break;
      before = page.data[0]!.info.id;
      if (pageIds.has(before))
        throw new Error("Native history pagination did not advance");
      pageIds.add(before);
    }
    if (
      rows.some(
        (row) =>
          !record(row.info) ||
          !record(row.info.time) ||
          !Number.isFinite(row.info.time.created),
      )
    )
      throw new Error("Malformed native history; cached history was preserved");
    rows.sort((a, b) => a.info.time.created - b.info.time.created);
    const ids = new Set<string>();
    const history: NonNullable<NativeSessionRef["history"]>[number][] = [];
    for (const row of rows) {
      if (
        !record(row.info) ||
        !Array.isArray(row.parts) ||
        row.info.sessionID !== request.native.nativeSessionId ||
        !["user", "assistant"].includes(row.info.role) ||
        typeof row.info.id !== "string" ||
        !Number.isFinite(row.info.time?.created)
      )
        throw new Error(
          "Malformed native history; cached history was preserved",
        );
      if (ids.has(row.info.id)) continue;
      ids.add(row.info.id);
      const content = row.parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => String(p.text))
        .join("");
      const nativeTurnId =
        row.info.role === "user" ? row.info.id : row.info.parentID;
      const events: SessionEvent[] = [];
      if (row.info.role === "assistant") {
        const mapped = new OpenCodeTurn(
          {
            native: request.native,
            turnId: asSpecOpsTurnId(`native:${nativeTurnId}`),
            workspaceRootPath: directory,
            prompt: "",
          },
          c,
          nativeTurnId,
          () => this.nextSeq(request.native),
          this.options.turnTimeoutMs,
        );
        for (const part of row.parts) mapped.part(part);
        mapped.finish(
          row.info.error || !row.info.time.completed
            ? "turn.failed"
            : "turn.finished",
          "Native history was interrupted; continue explicitly.",
        );
        for await (const event of mapped.events()) events.push(event);
      }
      history.push({
        ...(redactForSerialization(
          {
            id:
              row.info.role === "user"
                ? (clientIds[row.info.id] ?? row.info.id)
                : row.info.id,
            role: row.info.role,
            content,
            createdAt: new Date(row.info.time.created).toISOString(),
            nativeTurnId,
            completionState: row.info.error
              ? "failed"
              : row.info.time.completed || row.info.role === "user"
                ? "completed"
                : "interrupted",
          },
          Infinity,
        ) as any),
        ...(events.length ? { events } : {}),
      });
    }
    const native = { ...request.native, history };
    this.bindings.set(this.key(native), { native: request.native, directory });
    return native;
  }
  async *send(request: AgentTurnRequest): AsyncIterable<SessionEvent> {
    const directory = this.directory(request.workspaceRootPath);
    this.validate(request.native, directory, request.connectionProfileId);
    if (!this.bindings.has(this.key(request.native)))
      throw new Error("Resume the bound native session before sending");
    const key = this.key(request.native);
    if (this.turns.has(key)) throw new Error("A native turn is already active");
    if (!request.native.modelId)
      throw new Error(
        "Select an explicit native model when creating the session before sending",
      );
    const c = await this.connect(request.native.connectionProfileId);
    if (this.turns.has(key)) throw new Error("A native turn is already active");
    // Native message identifiers are monotonic sortable ids; caller message ids remain host-owned.
    const messageId = `msg_${Date.now().toString(16).padStart(12, "0")}${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    const turn = new OpenCodeTurn(
      request,
      c,
      messageId,
      () => this.nextSeq(request.native),
      this.options.turnTimeoutMs,
    );
    this.turns.set(key, turn);
    const dispatch = (async () => {
      try {
        const events = await c.events(directory, turn.abort.signal);
        const consume = (async () => {
          for await (const event of events) {
            turn.event(event);
            if (turn.ended) break;
          }
          if (!turn.ended)
            turn.finish(
              "turn.failed",
              "Native event stream disconnected; resume explicitly.",
            );
        })().catch(() =>
          turn.finish(
            "turn.failed",
            "Native event stream disconnected; resume explicitly.",
          ),
        );
        if (turn.ended || c.generation !== turn.generation) return;
        const clientId = request.context?.clientUserMessageId;
        if (typeof clientId === "string" && clientId.length <= 256) {
          const ids = this.clientMessageIds.get(key) ?? {};
          if (Object.keys(ids).length >= 10000)
            throw new Error("Native client message capacity exceeded");
          const found = await c.client!.session.get({
            sessionID: request.native.nativeSessionId,
            directory,
          });
          if (!found.data) throw new Error("Native session disappeared");
          ids[messageId] = clientId;
          await c.client!.session.update({
            sessionID: request.native.nativeSessionId,
            directory,
            metadata: { ...found.data.metadata, specopsClientMessages: ids },
          });
          this.clientMessageIds.set(key, ids);
        }
        if (turn.ended || c.generation !== turn.generation) return;
        await c.client!.session.promptAsync({
          sessionID: request.native.nativeSessionId,
          directory,
          messageID: messageId,
          model: this.model(request.native.modelId),
          agent: request.native.modeId,
          parts: [
            { type: "text", text: request.prompt },
            ...(request.attachments ?? []).map((a) => ({
              type: "file" as const,
              mime: a.mime,
              url: a.url,
              filename: a.filename,
            })),
          ],
        });
        if (turn.ended || c.generation !== turn.generation)
          await turn.settleNative(true);
        await consume;
      } catch {
        turn.finish(
          "turn.failed",
          "Native turn failed or disconnected; resume explicitly before retrying.",
        );
        await turn.settleNative(true);
      }
    })();
    try {
      yield* turn.events();
    } finally {
      if (!turn.ended) await turn.stop();
      await dispatch;
      if (turn.needsSettlement) await turn.settleNative();
      if (this.turns.get(key) === turn) this.turns.delete(key);
    }
  }
  private active(native: NativeSessionRef, turnId: string): OpenCodeTurn {
    const turn = this.turns.get(this.key(native));
    if (!turn || turn.request.turnId !== turnId || turn.ended)
      throw new Error("Native interaction belongs to an expired turn");
    return turn;
  }
  async replyPermission(input: {
    native: NativeSessionRef;
    turnId: AgentTurnRequest["turnId"];
    permissionId: string;
    reply: import("../../../src/lib/session/events").PermissionReply;
  }): Promise<void> {
    await this.active(input.native, input.turnId).reply(
      input.permissionId,
      "permission",
      input.reply,
    );
  }
  async replyQuestion(input: {
    native: NativeSessionRef;
    turnId: AgentTurnRequest["turnId"];
    questionId: string;
    answer: string;
  }): Promise<void> {
    await this.active(input.native, input.turnId).reply(
      input.questionId,
      "question",
      input.answer,
    );
  }
  async rejectQuestion(input: {
    native: NativeSessionRef;
    turnId: AgentTurnRequest["turnId"];
    questionId: string;
  }): Promise<void> {
    await this.active(input.native, input.turnId).reply(
      input.questionId,
      "question",
    );
  }
  async cancel(request: CancelAgentTurnRequest): Promise<void> {
    const turn = this.turns.get(this.key(request.native));
    if (turn && (!request.turnId || request.turnId === turn.request.turnId))
      await turn.stop();
  }
  close(): void {
    for (const turn of this.turns.values())
      turn.finish("turn.failed", "Agent Host closed; resume explicitly.");
    for (const connection of this.connections.values()) connection.close();
  }
}
