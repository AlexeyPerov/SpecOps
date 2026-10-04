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
  OPENCODE_VERSION,
  resolveExecutable,
  runtimeOwner,
} from "./lifecycle";
export interface OpenCodeAdapterOptions {
  profileRoot?: string;
  executable?: string | null;
  ambient?: NodeJS.ProcessEnv;
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
      supported: ["catalogs" as const],
      details: {
        catalogs: { supported: true },
        nativeTurns: {
          supported: false,
          notes: "Core session support awaits phase B.",
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
    } catch {
      if (
        requestGeneration !== undefined &&
        (requestGeneration !== connection.generation ||
          requestClient !== connection.client)
      )
        throw new Error("Runtime connection generation expired");
      snapshot.generation = connection.generation;
      snapshot.state = "error";
      snapshot.message =
        "OpenCode connection failed. Check the selected profile, endpoint and pinned runtime.";
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
        const key = request.options?.apiKey;
        if (typeof key !== "string" || !key.trim() || key.length > 8192)
          throw new Error("Provider API key is required");
        await connection.client!.auth.set({
          providerID,
          auth: { type: "api", key },
        });
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
        status:
          runtimeOwner(this.options.ambient) === "host"
            ? "degraded"
            : "unavailable",
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
  async createSession(
    _request: CreateAgentSessionRequest,
  ): Promise<NativeSessionRef> {
    throw new Error("OpenCode core sessions require phase B");
  }
  async resumeSession(
    _request: ResumeAgentSessionRequest,
  ): Promise<NativeSessionRef> {
    throw new Error("OpenCode core sessions require phase B");
  }
  async *send(_request: AgentTurnRequest): AsyncIterable<SessionEvent> {
    throw new Error("OpenCode core turns require phase B");
  }
  async cancel(_request: CancelAgentTurnRequest): Promise<void> {}
  close(): void {
    for (const connection of this.connections.values()) connection.close();
  }
}
