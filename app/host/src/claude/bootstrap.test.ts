import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ClaudeRuntimeAdapter,
  ClaudeAuthError,
  verifyClaudeKey,
} from "./adapter";
import {
  CLAUDE_SDK_VERSION,
  CLAUDE_NATIVE_VERSION,
  ClaudeRuntimeError,
  resolveClaudeAssets,
  probeClaudeSdk,
} from "./runtime";
const roots: string[] = [];
function root() {
  const p = mkdtempSync(join(tmpdir(), "specops-claude-"));
  roots.push(p);
  return p;
}
const assets = () => ({
  sdk: "fixture",
  executable: "fixture",
  sdkVersion: CLAUDE_SDK_VERSION,
  nativeVersion: CLAUDE_NATIVE_VERSION,
});
function adapter(extra: Record<string, unknown> = {}) {
  return new ClaudeRuntimeAdapter({
    profileRoot: root(),
    assets,
    probe: async () => [
      { value: "native-model", displayName: "Native model" },
      { value: "native-model", displayName: "Native model" },
      { value: "bad\nmodel", displayName: "Ignored" },
    ],
    verifyKey: async () => {},
    ...extra,
  });
}
function request(id?: string, action = "read") {
  return {
    runtimeId: "claude" as const,
    connectionProfileId: id,
    workspaceRootPath: "",
    options: { action },
    ...(action === "login-api-key"
      ? { credential: { kind: "api-key" as const, ref: "profile-api-key" } }
      : {}),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
describe("Claude host bootstrap", () => {
  it("keeps stable identity and explicit disabled turns honest", async () => {
    const a = adapter({enableNativeTurns: false});
    expect(await a.describe()).toEqual({ id: "claude", label: "Claude" });
    expect((await a.describeCapabilities()).details.nativeTurns.supported).toBe(
      false,
    );
    await expect(a.createSession()).rejects.toMatchObject({
      code: "capability-not-supported",
    });
  });
  it("isolates profile homes and refuses all inherited account/provider hooks", () => {
    const a = adapter();
    const p = a.store.create("first");
    const env = a.store.environment(p.id, undefined, {
      ANTHROPIC_API_KEY: "ambient-canary",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-canary",
      AWS_ACCESS_KEY_ID: "aws",
      GOOGLE_APPLICATION_CREDENTIALS: "/ambient",
      NODE_OPTIONS: "--require /injected",
      HTTPS_PROXY: "https://secret",
      PATH: "/bin",
    });
    expect(env.PATH).toBe("/bin");
    expect(JSON.stringify(env)).not.toMatch(/canary|injected|ambient|secret/);
    expect(env.HOME).toBe(a.store.home(p.id));
    expect(env.CLAUDE_CONFIG_DIR).toBe(join(a.store.home(p.id), "native"));
  });
  it("validates and consumes private API key imports without serializing them", async () => {
    const verifyKey = vi.fn(async () => {});
    const a = adapter({ verifyKey });
    const p = a.store.create("first");
    const second = a.store.create("second");
    const key = "opaque-secret-canary-8372";
    writeFileSync(join(a.store.home(p.id), "api-key"), key, { mode: 0o600 });
    const imported = await a.authenticate(request(p.id, "login-api-key"));
    expect(imported.status).toBe("authenticated");
    expect(verifyKey).toHaveBeenCalledWith(key, expect.any(AbortSignal));
    expect(JSON.stringify(imported)).not.toContain(key);
    expect(existsSync(join(a.store.home(p.id), "api-key"))).toBe(false);
    expect(readFileSync(join(a.store.home(p.id), "credential"), "utf8")).toBe(
      key,
    );
    expect((await a.authenticate(request(second.id))).profile?.state).toBe(
      "auth-required",
    );
    expect(await a.listModels({ connectionProfileId: p.id })).toEqual([
      { id: "native-model", name: "Native model" },
    ]);
    await a.authenticate(request(p.id, "logout"));
    expect(a.store.readKey(p.id)).toBeUndefined();
    expect(await a.listModels({ connectionProfileId: p.id })).toEqual([]);
  });
  it("distinguishes rejected keys, offline and missing/incompatible runtime; keeps other profiles unaffected", async () => {
    const a = adapter({
      verifyKey: async () => {
        throw new ClaudeAuthError("auth-required");
      },
    });
    const p = a.store.create("bad");
    writeFileSync(join(a.store.home(p.id), "api-key"), "canary", {
      mode: 0o600,
    });
    expect(
      (await a.authenticate(request(p.id, "login-api-key"))).profile?.state,
    ).toBe("auth-required");
    expect(a.store.readKey(p.id)).toBeUndefined();
    for (const state of ["missing-runtime", "incompatible-runtime"] as const) {
      const b = adapter({
        assets: () => {
          throw new ClaudeRuntimeError(state);
        },
      });
      const bp = b.store.create(state);
      expect((await b.authenticate(request(bp.id))).profile?.state).toBe(state);
    }
    const c = adapter({
      verifyKey: async () => {
        throw new ClaudeAuthError("offline");
      },
    });
    const cp = c.store.create("offline");
    c.store.saveKey(cp.id, "canary");
    expect((await c.authenticate(request(cp.id))).profile?.recovery).toBe(
      "offline",
    );
  });
  it("logout suppresses late auth success and never persists the stale import", async () => {
    let resolve!: () => void;
    const a = adapter({
      verifyKey: () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    });
    const p = a.store.create("late");
    writeFileSync(join(a.store.home(p.id), "api-key"), "late-canary", {
      mode: 0o600,
    });
    const pending = a.authenticate(request(p.id, "login-api-key"));
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await a.authenticate(request(p.id, "logout"));
    resolve();
    await expect(pending).rejects.toThrow("generation expired");
    expect(a.store.readKey(p.id)).toBeUndefined();
    expect(a.snapshot(p).state).toBe("auth-required");
  });
  it("refuses loose, symlinked, oversized credentials and unsupported login", async () => {
    const a = adapter();
    const p = a.store.create("unsafe");
    const file = join(a.store.home(p.id), "api-key");
    writeFileSync(file, "canary", { mode: 0o644 });
    expect(() => a.store.importKey(p.id)).toThrow("private");
    chmodSync(file, 0o600);
    rmSync(file);
    symlinkSync("/not-read", file);
    expect(() => a.store.importKey(p.id)).toThrow();
    rmSync(file);
    writeFileSync(file, "x".repeat(8193), { mode: 0o600 });
    expect(() => a.store.importKey(p.id)).toThrow("bounded");
    await expect(
      a.authenticate(request(p.id, "login-browser")),
    ).rejects.toThrow("Subscription");
  });
  it("does not leak provider response bodies; validation sends no inference request", async () => {
    const fetch = vi.fn(
      async (_url: string, _options?: unknown) =>
        new Response("secret-provider-body", { status: 401 }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(verifyClaudeKey("opaque-canary")).rejects.toMatchObject({
      reason: "auth-required",
      message: "Claude credential verification failed",
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.anthropic.com/v1/models?limit=1",
    );
  });
});
it.skipIf(process.env.SPECOPS_CLAUDE_NATIVE_PROBE !== "1")(
  "pinned native SDK initializes without a prompt or ambient credential",
  async () => {
    const a = new ClaudeRuntimeAdapter({ profileRoot: root() });
    const p = a.store.create("probe");
    const rows = await probeClaudeSdk(
      resolveClaudeAssets(),
      a.store.environment(p.id),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => typeof r.value === "string")).toBe(true);
  },
  15000,
);
