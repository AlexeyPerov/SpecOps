import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  readFileSync,
  cpSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CursorRuntimeAdapter } from "./adapter";
import {
  CursorRuntimeError,
  cursorControl,
  resolveCursorAssets,
  verifyCursorAssetDirectory,
  CURSOR_SDK_VERSION,
  type CursorControlResult,
} from "./runtime";
const roots: string[] = [];
const root = () => {
  const r = mkdtempSync(join(tmpdir(), "specops-cursor-test-"));
  roots.push(r);
  return r;
};
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const assets = {
  sdk: "fixture",
  worker: "fixture",
  root: "fixture",
  sdkVersion: CURSOR_SDK_VERSION,
};
const probe: CursorControlResult = {
  ok: true,
  probe: {
    durableAgent: true,
    nativeId: true,
    store: "jsonl",
    node: process.version,
  },
};
function setup(
  read: CursorControlResult = {
    ok: true,
    models: [{ id: "native-model", displayName: "Native model" }],
  },
) {
  const a = new CursorRuntimeAdapter({
    profileRoot: root(),
    assets: () => assets,
    control: async (_a, _e, action) => (action === "probe" ? probe : read),
  });
  const p = a.store.create("fixture");
  return { a, p };
}
function auth(a: CursorRuntimeAdapter, id: string, action: string) {
  return a.authenticate({
    runtimeId: "cursor",
    workspaceRootPath: "",
    connectionProfileId: id,
    options: { action },
    ...(action === "login-api-key"
      ? { credential: { kind: "api-key" as const, ref: "profile-api-key" } }
      : {}),
  });
}
describe("Cursor bootstrap", () => {
  it("private explicit API key profiles import, native catalog and local logout are isolated", async () => {
    const { a, p } = setup();
    const other = a.store.create("other");
    a.store.saveKey(other.id, "other-key");
    writeFileSync(join(a.store.home(p.id), "api-key"), "credential-canary", {
      mode: 0o600,
    });
    const r = await auth(a, p.id, "login-api-key");
    expect(r.status).toBe("authenticated");
    expect(r.profile?.account).toEqual({ type: "apiKey" });
    expect(JSON.stringify(r)).not.toContain("credential-canary");
    expect(existsSync(join(a.store.home(p.id), "api-key"))).toBe(false);
    expect(await a.listModels({ connectionProfileId: p.id })).toEqual([
      { id: "native-model", name: "Native model" },
    ]);
    await auth(a, p.id, "logout");
    expect(a.store.readKey(p.id)).toBeUndefined();
    expect(a.store.readKey(other.id)).toBe("other-key");
  });
  it.each(["auth-required", "offline"] as const)(
    "distinguishes native %s without credential promotion",
    async (reason) => {
      const { a, p } = setup({ ok: false, reason });
      writeFileSync(join(a.store.home(p.id), "api-key"), "fixture-key", {
        mode: 0o600,
      });
      const r = await auth(a, p.id, "login-api-key");
      expect(r.profile?.recovery).toBe(reason);
      expect(a.store.readKey(p.id)).toBeUndefined();
      expect(existsSync(join(a.store.home(p.id), "api-key"))).toBe(true);
    },
  );
  it.each(["missing-runtime", "incompatible-runtime"] as const)(
    "distinguishes %s",
    async (state) => {
      const a = new CursorRuntimeAdapter({
        profileRoot: root(),
        assets: () => {
          throw new CursorRuntimeError(
            state,
            state === "missing-runtime" ? "native-asset" : "version",
          );
        },
      });
      const p = a.store.create("test");
      expect((await auth(a, p.id, "read")).profile?.state).toBe(state);
      expect((await a.health()).status).toBe("unavailable");
    },
  );
  it("requires private bounded nofollow credential files and strips inherited provider/config/Node options", () => {
    const { a, p } = setup();
    const home = a.store.home(p.id),
      f = join(home, "api-key");
    writeFileSync(f, "canary", { mode: 0o644 });
    expect(() => a.store.importKey(p.id)).toThrow();
    unlinkSync(f);
    const other = join(home, "other");
    writeFileSync(other, "canary", { mode: 0o600 });
    symlinkSync(other, f);
    expect(() => a.store.importKey(p.id)).toThrow();
    const env = a.store.environment(p.id, "secret", {
      CURSOR_API_KEY: "ambient",
      CURSOR_BACKEND_URL: "evil",
      NODE_OPTIONS: "evil",
      ANTHROPIC_API_KEY: "ambient",
      HOME: "/global",
      PATH: "/usr/bin",
    });
    expect(env.HOME).toBe(home);
    expect(env.PATH).toBe("/usr/bin");
    for (const name of [
      "CURSOR_API_KEY",
      "CURSOR_BACKEND_URL",
      "NODE_OPTIONS",
      "ANTHROPIC_API_KEY",
    ])
      expect(env[name]).toBeUndefined();
  });
  it("redacts catalog credentials and advertises only implemented local native scope", async () => {
    const { a, p } = setup({
      ok: true,
      models: [
        { id: "canary", displayName: "secret" },
        { id: "native", displayName: "prefix canary suffix" },
      ],
    });
    a.store.saveKey(p.id, "canary");
    await auth(a, p.id, "read");
    expect(
      JSON.stringify(await a.listModels({ connectionProfileId: p.id })),
    ).not.toContain("canary");
    expect((await a.describeCapabilities()).details.nativeTurns.supported).toBe(
      true,
    );
    await expect(auth(a, p.id, "login-browser")).rejects.toThrow();
    await expect(
      a.createSession({ runtimeId: "cursor", workspaceRootPath: "" }),
    ).rejects.toThrow();
    await expect(
      a.authenticate({
        runtimeId: "cursor",
        workspaceRootPath: "",
        connectionProfileId: p.id,
        options: { apiKey: "raw" },
      }),
    ).rejects.toThrow();
  });
  it("logout invalidates late native auth and never writes a pending imported key", async () => {
    const { a, p } = setup();
    let release: (r: CursorControlResult) => void = () => {};
    let entered: () => void = () => {};
    const waiting = new Promise<void>((r) => (entered = r));
    a.options.control = async (_a, _e, action) => {
      if (action === "probe") return probe;
      entered();
      return new Promise((r) => (release = r));
    };
    writeFileSync(join(a.store.home(p.id), "api-key"), "pending-canary", {
      mode: 0o600,
    });
    const request = auth(a, p.id, "login-api-key");
    const failure = expect(request).rejects.toThrow("generation");
    await waiting;
    await auth(a, p.id, "logout");
    release({ ok: true, models: [] });
    await failure;
    expect(a.store.readKey(p.id)).toBeUndefined();
    expect(a.snapshot(p).state).toBe("auth-required");
  });
  it("selected profile refresh replaces stale catalogs and discards malformed native rows", async () => {
    const { a, p } = setup();
    a.store.saveKey(p.id, "fixture-key");
    await auth(a, p.id, "read");
    a.options.control = async (_a, _e, action) =>
      action === "probe"
        ? probe
        : {
            ok: true,
            models: [
              { id: "new", displayName: "New" },
              { id: "bad id", displayName: "Bad" },
            ],
          };
    await auth(a, p.id, "restart");
    expect(await a.listModels({ connectionProfileId: p.id })).toEqual([
      { id: "new", name: "New" },
    ]);
  });
  it("profile metadata rejects nonprivate, oversized, malformed dates and links", () => {
    const { a, p } = setup();
    const f = join(a.store.home(p.id), "profile.json");
    const saved = readFileSync(f);
    writeFileSync(f, JSON.stringify({ ...p, createdAt: "invalid" }));
    expect(a.store.list()).toEqual([]);
    writeFileSync(f, "x".repeat(9000));
    expect(a.store.list()).toEqual([]);
    writeFileSync(f, saved);
    expect(a.store.list()).toHaveLength(1);
  });
  it("native account-free create/dispose/resume runs in an isolated worker", async () => {
    const { a, p } = setup();
    const r = await cursorControl(
      resolveCursorAssets(),
      a.store.environment(p.id, undefined, { PATH: "/usr/bin:/bin" }),
      "probe",
    );
    expect(r.probe).toMatchObject({
      durableAgent: true,
      nativeId: true,
      store: "jsonl",
    });
  }, 15000);
  it("copied payload detects missing native assets, mismatched pins and checksum corruption", () => {
    const packaged = resolve("dist/cursor");
    if (!existsSync(packaged))
      throw new Error("Build the host before copied-asset verification");
    const out = join(root(), "cursor");
    cpSync(packaged, out, { recursive: true });
    expect(verifyCursorAssetDirectory(out).sdkVersion).toBe(CURSOR_SDK_VERSION);
    const worker = readFileSync(join(out, "worker.mjs"));
    writeFileSync(join(out, "worker.mjs"), "corruption");
    expect(() => verifyCursorAssetDirectory(out)).toThrow("incompatible");
    writeFileSync(join(out, "worker.mjs"), worker);
    const manifest = JSON.parse(readFileSync(join(out, "assets.json"), "utf8"));
    const native = Object.keys(manifest.files).find((n) =>
      n.endsWith("/bin/rg"),
    )!;
    unlinkSync(join(out, native));
    expect(() => verifyCursorAssetDirectory(out)).toThrow("native assets");
    manifest.sdkVersion = "unsupported";
    writeFileSync(join(out, "assets.json"), JSON.stringify(manifest));
    expect(() => verifyCursorAssetDirectory(out)).toThrow("incompatible");
  });
});
