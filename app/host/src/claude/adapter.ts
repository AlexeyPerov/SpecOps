import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentRuntimeAdapter,
  AgentAuthRequest,
  AgentAuthResult,
  NativeSessionRef,
  AgentTurnRequest,
} from "../../../src/lib/session/adapter";
import type {
  CatalogExtension,
  SessionConfigurationExtension,
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
    SessionConfigurationExtension
{
  readonly runtimeId = "claude" as const;
  readonly store: ClaudeProfileStore;
  readonly snapshots = new Map<string, ConnectionProfileSnapshot>();
  private readonly catalogs = new Map<
    string,
    readonly { id: string; name: string }[]
  >();
  private readonly pending = new Map<string, AbortController>();
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
  }
  async describe() {
    return { id: this.runtimeId, label: "Claude" };
  }
  async describeCapabilities() {
    return {
      schemaVersion: 1 as const,
      supported: ["catalogs" as const],
      details: {
        catalogs: {
          supported: true,
          notes:
            "Native discoverable models; access is determined by the selected API key.",
        },
        nativeTurns: {
          supported: false,
          notes: "Native session lifecycle is awaiting implementation.",
        },
        subscriptionLogin: {
          supported: false,
          notes:
            "Third-party subscription login is unsupported. Use a dedicated API key.",
        },
        cloudCredentials: {
          supported: false,
          notes: "Cloud credential import is not implemented.",
        },
      },
    };
  }
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
    return {
      schemaVersion: 1 as const,
      scope: "session" as const,
      description:
        "Native settings and tool/budget policies will be exposed when native sessions are implemented. Profile initialization disables project/user settings.",
      fields: [],
    };
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
  async createSession(): Promise<NativeSessionRef> {
    throw adapterErrors.capabilityNotSupported("nativeTurns");
  }
  async resumeSession(): Promise<NativeSessionRef> {
    throw adapterErrors.capabilityNotSupported("nativeTurns");
  }
  async *send(_request: AgentTurnRequest): AsyncIterable<SessionEvent> {
    throw adapterErrors.capabilityNotSupported("nativeTurns");
  }
  async cancel(): Promise<void> {
    throw adapterErrors.capabilityNotSupported("nativeTurns");
  }
  close() {
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
