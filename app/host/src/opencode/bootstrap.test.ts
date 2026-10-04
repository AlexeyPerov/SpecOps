import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  readFileSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { RuntimeProfileStore, endpoint } from "./profiles";
import {
  RuntimeConnection,
  OPENCODE_VERSION,
  resolveExecutable,
  runtimeOwner,
} from "./lifecycle";
import { OpenCodeRuntimeAdapter } from "./adapter";
const roots: string[] = [];
const connections: RuntimeConnection[] = [];
function store() {
  const root = mkdtempSync(join(tmpdir(), "specops-bootstrap-"));
  roots.push(root);
  return new RuntimeProfileStore(root);
}
afterEach(() => {
  for (const c of connections.splice(0)) c.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe("host runtime bootstrap", () => {
  it("persists isolated profiles and skips orphan/corrupt records", () => {
    const s = store();
    const a = s.create("first");
    const b = s.create("second");
    mkdirSync(join(s.root, "orphan"));
    mkdirSync(join(s.root, "bad"));
    writeFileSync(join(s.root, "bad", "profile.json"), "bad");
    const again = new RuntimeProfileStore(s.root);
    expect(again.list().map((p) => p.id)).toEqual(
      expect.arrayContaining([a.id, b.id]),
    );
    expect(again.list()).toHaveLength(2);
    const env = s.environment(a.id, {
      PATH: "/bin",
      OPENAI_API_KEY: "secret",
      AWS_PROFILE: "secret",
      HOME: "/ambient",
      OPENCODE_CONFIG: "other",
    });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.AWS_PROFILE).toBeUndefined();
    expect(env.HOME).toBe(s.home(a.id));
    expect(env.OPENCODE_CONFIG).toBe(join(s.home(a.id), "opencode.json"));
    expect(s.environment(b.id).HOME).not.toBe(env.HOME);
    expect(readFileSync(join(s.home(a.id), "opencode.json"), "utf8")).toContain(
      "disabled",
    );
  });
  it("validates external endpoint and executable overrides without fallback", () => {
    expect(endpoint("http://127.0.0.1:9999")).toBe("http://127.0.0.1:9999");
    for (const url of [
      "http://example.com",
      "http://user:pass@localhost",
      "https://example.com/?key=secret",
    ])
      expect(() => endpoint(url)).toThrow();
    expect(
      resolveExecutable({
        SPECOPS_OPENCODE_EXECUTABLE: "relative",
        PATH: "/bin",
      }),
    ).toBeNull();
    expect(runtimeOwner({})).toBe("host");
    expect(runtimeOwner({ SPECOPS_OPENCODE_OWNER: "legacy" })).toBe("legacy");
    expect(() => runtimeOwner({ SPECOPS_OPENCODE_OWNER: "both" })).toThrow();
  });
  it("external connection probes pinned health without owning a child", async () => {
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          req.url === "/global/health"
            ? { healthy: true, version: OPENCODE_VERSION }
            : { all: [], default: {}, connected: [] },
        ),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address() as { port: number };
      const s = store();
      const p = s.create("external", `http://127.0.0.1:${address.port}`);
      const c = new RuntimeConnection(p, s, null);
      connections.push(c);
      await c.start();
      expect(c.client).not.toBeNull();
      expect(c.child).toBeNull();
      c.close();
      expect(c.client).toBeNull();
      await c.start();
      expect(c.generation).toBe(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("refuses local start in legacy owner mode and incompatible version", async () => {
    const s = store();
    const p = s.create("local");
    const legacy = new RuntimeConnection(p, s, null, {
      SPECOPS_OPENCODE_OWNER: "legacy",
    });
    connections.push(legacy);
    await expect(legacy.start()).rejects.toThrow("connection failed");
    expect(legacy.child).toBeNull();
    const path = join(s.root, "native");
    writeFileSync(path, "#!/bin/sh\necho 0.0.0\n");
    chmodSync(path, 0o700);
    const c = new RuntimeConnection(p, s, path);
    connections.push(c);
    await expect(c.start()).rejects.toThrow("connection failed");
    expect(c.child).toBeNull();
  });
  it("offline runtime returns safe health and refuses unsupported core work", async () => {
    const s = store();
    const adapter = new OpenCodeRuntimeAdapter({
      profileRoot: s.root,
      executable: null,
    });
    const auth = await adapter.authenticate({
      runtimeId: "opencode",
      workspaceRootPath: s.root,
      options: { action: "create-profile", label: "local" },
    });
    expect(auth.profile?.runtimeId).toBe("opencode");
    expect((await adapter.health(auth.profile!.id)).status).toBe("unavailable");
    expect(JSON.stringify(auth)).not.toContain("apiKeyValue");
    expect(
      (await adapter.describeCapabilities()).details.nativeTurns.supported,
    ).toBe(false);
    adapter.close();
  });
});

it("native fixture preserves auth across restart and kills observed descendants", async () => {
  const s = store();
  const adapter = new OpenCodeRuntimeAdapter({
    profileRoot: s.root,
    executable: fileURLToPath(new URL("./nativeFixture.mjs", import.meta.url)),
  });
  const result = await adapter.authenticate({
    runtimeId: "opencode",
    workspaceRootPath: s.root,
    options: { action: "create-profile" },
  });
  const id = result.profile!.id;
  try {
    const connection = await adapter.connect(id);
    connections.push(connection);
    const pid = Number(readFileSync(join(s.home(id), "fixture-child"), "utf8"));
    const signed = await adapter.authenticate({
      runtimeId: "opencode",
      workspaceRootPath: s.root,
      connectionProfileId: id,
      options: {
        action: "login-api-key",
        providerId: "example",
        apiKey: "fixture-secret",
      },
    });
    expect(signed.status).toBe("authenticated");
    expect(JSON.stringify(signed)).not.toContain("fixture-secret");
    expect(
      statSync(join(s.home(id), "data", "opencode", "auth.json")).mode & 0o777,
    ).toBe(0o600);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const restarted = await adapter.authenticate({
      runtimeId: "opencode",
      workspaceRootPath: s.root,
      connectionProfileId: id,
      options: { action: "restart" },
    });
    expect(restarted.status).toBe("authenticated");
    expect(restarted.profile!.generation).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(() => process.kill(pid, 0)).toThrow();
    await adapter.authenticate({
      runtimeId: "opencode",
      workspaceRootPath: s.root,
      connectionProfileId: id,
      options: { action: "logout", providerId: "example" },
    });
    expect(adapter.snapshot(s.require(id)).state).toBe("auth-required");
  } finally {
    adapter.close();
  }
}, 15000);

it("late provider catalog cannot overwrite disconnected generation", async () => {
  const s = store();
  const p = s.create("external", "http://127.0.0.1:9999");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let called!: () => void;
  const observed = new Promise<void>((resolve) => {
    called = resolve;
  });
  const c = new RuntimeConnection(p, s, null, {}, async (request) => {
    const url = new URL(
      request instanceof Request ? request.url : String(request),
    );
    if (url.pathname === "/provider") {
      called();
      await waiting;
    }
    return new Response(
      JSON.stringify(
        url.pathname === "/global/health"
          ? { healthy: true, version: OPENCODE_VERSION }
          : { all: [], default: {}, connected: ["example"] },
      ),
      { headers: { "Content-Type": "application/json" } },
    );
  });
  connections.push(c);
  const adapter = new OpenCodeRuntimeAdapter({
    profileRoot: s.root,
    connectionFactory: () => c,
  });
  const reading = adapter.connect(p.id);
  await observed;
  c.close();
  release();
  await expect(reading).rejects.toThrow("generation expired");
  expect(adapter.snapshot(p).state).toBe("disconnected");
});

it.skipIf(!process.env.SPECOPS_NATIVE_SMOKE)(
  "isolated pinned native bootstrap without account credentials",
  async () => {
    const s = store();
    const adapter = new OpenCodeRuntimeAdapter({
      profileRoot: s.root,
      executable: process.env.SPECOPS_NATIVE_SMOKE,
    });
    const profile = s.create("isolated native probe");
    try {
      const connection = await adapter.connect(profile.id);
      connections.push(connection);
      expect(connection.generation).toBe(1);
      expect(connection.child).not.toBeNull();
      expect(["auth-required", "authenticated"]).toContain(
        adapter.snapshot(profile).state,
      );
      expect(() =>
        readFileSync(join(s.home(profile.id), "data", "opencode", "auth.json")),
      ).toThrow();
      expect(
        await adapter.listModes({ connectionProfileId: profile.id }),
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "build" })]),
      );
    } finally {
      adapter.close();
    }
  },
  20000,
);
