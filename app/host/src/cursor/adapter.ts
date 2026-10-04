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
  }
  async describe() {
    return { id: this.runtimeId, label: "Cursor" };
  }
  async describeCapabilities() {
    return {
      schemaVersion: 1 as const,
      supported: ["catalogs" as const],
      details: {
        catalogs: {
          supported: true,
          notes:
            "Official native SDK model catalog for the selected user/service API key. Model parameters await session configuration integration.",
        },
        nativeTurns: {
          supported: false,
          notes:
            "Durable local SDK bootstrap verified; turn mapping and native tool policy await the next phases.",
        },
        browserLogin: {
          supported: false,
          notes:
            "Official SDK browser key minting exists; its host challenge/cancel lifecycle is not implemented.",
        },
        deviceLogin: {
          supported: false,
          notes: "No native device login flow is exposed.",
        },
        permissions: {
          supported: false,
          notes:
            "Local SDK has no programmatic interactive approval callback. Native file hooks and sandbox require separate integration.",
        },
        questions: {
          supported: false,
          notes: "No native interaction bridge is exposed.",
        },
        cloudExecution: {
          supported: false,
          notes:
            "Cloud execution is outside the supported local runtime scope.",
        },
        nativeConfiguration: {
          supported: false,
          notes:
            "No session policy or model parameter editor is exposed during bootstrap.",
        },
      },
    };
  }
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
    return redactForSerialization(
      { ...s },
      Infinity,
    ) as ConnectionProfileSnapshot;
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
  ): Promise<ConnectionProfileSnapshot> {
    const p = this.store.require(id),
      s = this.snapshot(p);
    this.pending.get(id)?.abort();
    const abort = new AbortController();
    this.pending.set(id, abort);
    const generation = ++s.generation;
    s.state = "connecting";
    delete s.account;
    delete s.message;
    delete s.recovery;
    this.catalogs.delete(id);
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
          const models = this.safeModels(result, key);
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
  private safeModels(result: CursorControlResult, key: string) {
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
    const p = this.store.require(request.connectionProfileId);
    if (action === "logout") {
      this.pending.get(p.id)?.abort();
      this.pending.delete(p.id);
      const s = this.snapshot(p);
      s.generation++;
      this.store.logout(p.id);
      this.catalogs.delete(p.id);
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
      description: "Native session configuration awaits integration.",
      fields: [],
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
  async createSession(
    _request: CreateAgentSessionRequest,
  ): Promise<NativeSessionRef> {
    throw adapterErrors.capabilityNotSupported("nativeTurns");
  }
  async resumeSession(
    _request: ResumeAgentSessionRequest,
  ): Promise<NativeSessionRef> {
    throw adapterErrors.capabilityNotSupported("nativeTurns");
  }
  async *send(_request: AgentTurnRequest): AsyncIterable<SessionEvent> {
    throw adapterErrors.capabilityNotSupported("nativeTurns");
  }
  async cancel(_request: CancelAgentTurnRequest) {}
  async close() {
    for (const abort of this.pending.values()) abort.abort();
    this.pending.clear();
    await Promise.allSettled([...this.controls]);
  }
}
