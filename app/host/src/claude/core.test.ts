import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeRuntimeAdapter, type ClaudeAdapterOptions } from "./adapter";
import { CLAUDE_NATIVE_VERSION, CLAUDE_SDK_VERSION } from "./runtime";
import { ClaudeFixtureDriver, fixturePath } from "./fixtures";
import {
  collectContractEvents,
  runAdapterContractSuite,
} from "../../../src/lib/session/adapter/adapter.contract";
import { asSpecOpsTurnId } from "../../../src/lib/session/ids";
import type { NativeSessionRef } from "../../../src/lib/session/adapter";
const roots: string[] = [];
const adapters: ClaudeRuntimeAdapter[] = [];
function root() {
  const path = mkdtempSync(join(tmpdir(), "specops-native-session-"));
  roots.push(path);
  return path;
}
const workspace = root();
function options(
  path: string,
  driver = new ClaudeFixtureDriver(fixturePath(path)),
): ClaudeAdapterOptions {
  return {
    profileRoot: path,
    enableNativeTurns: true,
    assets: () => ({
      sdk: "fixture",
      executable: "fixture",
      nativeVersion: CLAUDE_NATIVE_VERSION,
      sdkVersion: CLAUDE_SDK_VERSION,
    }),
    probe: async () => [{ value: "native-model", displayName: "Native model" }],
    verifyKey: async () => {},
    sessionDriver: () => driver,
    turnTimeoutMs: 1000,
  };
}
class ContractClaude extends ClaudeRuntimeAdapter {
  readonly profileId: string;
  constructor(path: string) {
    super(options(path));
    this.profileId =
      this.store.list()[0]?.id ?? this.store.create("Contract").id;
    this.store.saveKey(this.profileId, "fixture-private-key-canary");
    adapters.push(this);
  }
  override authenticate(
    request: Parameters<ClaudeRuntimeAdapter["authenticate"]>[0],
  ) {
    return super.authenticate({
      ...request,
      connectionProfileId: this.profileId,
    });
  }
  override createSession(
    request: NonNullable<Parameters<ClaudeRuntimeAdapter["createSession"]>[0]>,
  ) {
    return super.createSession({
      ...request,
      connectionProfileId: this.profileId,
      modelId: "native-model",
    });
  }
}
let shared: string;
afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.close();
});
runAdapterContractSuite({
  runtimeId: "claude",
  workspaceRootPath: workspace,
  finishPrompt: "hello",
  cancelPrompt: "cancel",
  create: async () => new ContractClaude((shared ??= root())),
  createFaultAdapter: async () => new ContractClaude(root()),
});
const request = (native: NativeSessionRef, prompt = "hello") => ({
  native,
  workspaceRootPath: workspace,
  prompt,
  turnId: asSpecOpsTurnId("turn"),
  context: { clientUserMessageId: "client-message" },
});
async function setup() {
  const path = root();
  const driver = new ClaudeFixtureDriver(fixturePath(path));
  const a = new ClaudeRuntimeAdapter(options(path, driver));
  adapters.push(a);
  const p = a.store.create("First");
  a.store.saveKey(p.id, "fixture-private-key-canary");
  const native = await a.createSession({
    runtimeId: "claude",
    workspaceRootPath: workspace,
    connectionProfileId: p.id,
    modelId: "native-model",
  });
  return { a, p, native, path, driver };
}
describe("Claude native sessions", () => {
  it("persists immutable profile/model/cwd, resumes same native history after fresh host and uses client IDs", async () => {
    const { a, p, native, path, driver } = await setup();
    const first = await collectContractEvents(a.send(request(native)));
    expect(first.at(-1)?.type).toBe("turn.finished");
    expect(
      first
        .filter((e) => e.type === "text.delta")
        .map((e) => (e as any).delta)
        .join(""),
    ).toBe("Native fixture answer");
    expect(first.filter((e) => e.type === "tool.started")).toHaveLength(1);
    expect(first.filter((e) => e.type === "tool.completed")).toHaveLength(1);
    a.close();
    const replacement = new ClaudeRuntimeAdapter(options(path, driver));
    adapters.push(replacement);
    const resumed = await replacement.resumeSession({
      native: JSON.parse(JSON.stringify(native)),
      workspaceRootPath: workspace,
    });
    expect(resumed.nativeSessionId).toBe(native.nativeSessionId);
    expect(resumed.history?.filter((m) => m.role === "user")).toHaveLength(1);
    expect(resumed.history?.[0].id).toBe("client-message");
    const second = await collectContractEvents(
      replacement.send(request(resumed)),
    );
    expect(second.at(0)!.seq).toBeGreaterThan(first.at(-1)!.seq);
    expect(second.find((e) => e.type === "usage.recorded")).toMatchObject({
      cost: 0.125,
    });
    const calls = driver.calls.filter((c) => c.resume);
    expect(calls.at(-1)?.resume).toBe(native.nativeSessionId);
    expect(calls.at(-1)?.cwd).toBe(realpathSync(workspace));
    expect(calls.at(-1)?.env?.HOME).toBe(replacement.store.home(p.id));
    expect(calls.at(-1)?.settingSources).toEqual([]);
    expect(calls.at(-1)?.tools).toEqual([]);
    expect(calls.at(-1)?.permissionMode).toBe("default");
    const denied = await calls.at(-1)!.canUseTool!(
      "Read",
      {},
      { signal: new AbortController().signal, toolUseID: "x", requestId: "x" },
    );
    expect(denied?.behavior).toBe("deny");
    await expect(
      collectContractEvents(
        replacement.send(request({ ...native, modelId: "changed" })),
      ),
    ).rejects.toThrow("Immutable");
  });
  it("has independent profile bindings and preserves missing accepted history metadata", async () => {
    const { a, native, path } = await setup();
    const p = a.store.create("Second");
    a.store.saveKey(p.id, "other-private-key");
    const other = await a.createSession({
      runtimeId: "claude",
      workspaceRootPath: workspace,
      connectionProfileId: p.id,
      modelId: "native-model",
    });
    expect(other.nativeSessionId).not.toBe(native.nativeSessionId);
    await collectContractEvents(a.send(request(native)));
    const binding = join(
      path,
      native.connectionProfileId!,
      `session-${native.nativeSessionId}.json`,
    );
    const before = readFileSync(binding, "utf8");
    rmSync(fixturePath(path));
    await expect(
      a.resumeSession({ native, workspaceRootPath: workspace }),
    ).rejects.toMatchObject({ code: "session-not-found" });
    expect(readFileSync(binding, "utf8")).toBe(before);
  });
  it.each(["fail", "interrupt"])(
    "settles %s exactly once and iterator drains",
    async (prompt) => {
      const { a, native } = await setup();
      const events = await collectContractEvents(
        a.send(request(native, prompt)),
      );
      expect(
        events.filter(
          (e) => e.type.startsWith("turn.") && e.type !== "turn.started",
        ),
      ).toHaveLength(1);
      expect(events.at(-1)?.type).toBe("turn.failed");
      expect(JSON.stringify(events)).not.toContain(
        "fixture-private-key-canary",
      );
    },
  );
  it("redacts credentials fragmented across native events before any serialization", async () => {
    const { a, native } = await setup();
    const events = await collectContractEvents(
      a.send(request(native, "secret")),
    );
    expect(JSON.stringify(events)).not.toContain("fixture-private-key-canary");
    expect(events.find((e) => e.type === "text.finished")).toMatchObject({
      text: "[redacted] private",
    });
  });
  it("health/read during running turn preserve generation; cancellation leaves native session reusable", async () => {
    const { a, p, native } = await setup();
    const iterator = a.send(request(native, "cancel"))[Symbol.asyncIterator]();
    await iterator.next();
    const generation = a.snapshot(p).generation;
    await a.health(p.id);
    await a.authenticate({
      runtimeId: "claude",
      workspaceRootPath: workspace,
      connectionProfileId: p.id,
      options: { action: "read" },
    });
    expect(a.snapshot(p).generation).toBe(generation);
    await a.cancel({ native });
    const events = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      events.push(next.value);
    }
    expect(events.at(-1)?.type).toBe("turn.cancelled");
    expect(
      (await collectContractEvents(a.send(request(native)))).at(-1)?.type,
    ).toBe("turn.finished");
  });
  it("guards concurrent dispatch and terminates a bounded capacity overflow even if consumer pauses", async () => {
    const { a, native, driver } = await setup();
    const iterator = a
      .send(request(native, "capacity"))
      [Symbol.asyncIterator]();
    expect((await iterator.next()).value?.type).toBe("turn.started");
    await expect(
      collectContractEvents(a.send(request(native))),
    ).rejects.toThrow("already active");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const events = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      events.push(next.value);
    }
    expect(events.at(-1)?.type).toBe("turn.failed");
    expect(driver.closed).toBeGreaterThan(1);
  });
  it("logout rejects stale running events and ends exactly once", async () => {
    const { a, p, native } = await setup();
    const iterator = a.send(request(native, "cancel"))[Symbol.asyncIterator]();
    await iterator.next();
    await a.authenticate({
      runtimeId: "claude",
      workspaceRootPath: workspace,
      connectionProfileId: p.id,
      options: { action: "logout" },
    });
    const events = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      events.push(next.value);
    }
    expect(events.at(-1)?.type).toBe("turn.cancelled");
    expect(a.store.readKey(p.id)).toBeUndefined();
  });
});
// Native/account tests are opt-in; these fixtures never contact the provider.
process.on("exit", () => {
  for (const path of roots) rmSync(path, { recursive: true, force: true });
});
it.runIf(process.env.SPECOPS_CLAUDE_NATIVE_PROBE === "1")(
  "probes real native control create/history without an account or inference",
  async () => {
    const a = new ClaudeRuntimeAdapter({
      profileRoot: root(),
      enableNativeTurns: true,
      verifyKey: async () => {},
    });
    adapters.push(a);
    const p = a.store.create("Native no-account probe");
    a.store.saveKey(p.id, "specops-placeholder-not-a-live-credential");
    const models = await a.listModels({ connectionProfileId: p.id });
    expect(models.length).toBeGreaterThan(0);
    const native = await a.createSession({
      runtimeId: "claude",
      workspaceRootPath: workspace,
      connectionProfileId: p.id,
      modelId: models[0].id,
    });
    const resumed = await a.resumeSession({
      native,
      workspaceRootPath: workspace,
    });
    expect(resumed.history).toEqual([]);
    expect(resumed.nativeSessionId).toBe(native.nativeSessionId);
    expect(
      JSON.parse(
        readFileSync(
          join(a.store.home(p.id), `session-${native.nativeSessionId}.json`),
          "utf8",
        ),
      ).started,
    ).toBe(false);
  },
  30000,
);
it("owns and reaps observed native descendants after native parent death", async () => {
  const { ClaudeProcessOwner } = await import("./session");
  const { spawn, execFileSync } = await import("node:child_process");
  const { existsSync } = await import("node:fs");
  const path = root();
  const pidFile = join(path, "descendant");
  const owner = new ClaudeProcessOwner();
  const source = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`;
  const parent = spawn(process.execPath, ["-e", source], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  owner.own(parent);
  try {
    const until = Date.now() + 2000;
    while (!existsSync(pidFile) && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 10));
    const pid = Number(readFileSync(pidFile, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 350));
    parent.kill("SIGKILL");
    await new Promise<void>((resolve) => parent.once("exit", () => resolve()));
    await owner.close();
    let alive = true;
    const deadline = Date.now() + 1000;
    while (alive && Date.now() < deadline) {
      const rows = execFileSync("/bin/ps", ["-axo", "pid=,stat="], {
        encoding: "utf8",
      }).split("\n");
      alive = rows.some((row) => new RegExp(`^\\s*${pid}\\s+(?!Z)`).test(row));
      if (alive) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(alive).toBe(false);
  } finally {
    await owner.close();
  }
});
it("cancels pending authentication without any later native prompt dispatch", async () => {
  const { a, p, native, driver } = await setup();
  const count = driver.calls.length;
  let release!: () => void;
  let entered!: () => void;
  const began = new Promise<void>((resolve) => {
    entered = resolve;
  });
  a.options.verifyKey = async () => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  a.snapshot(p).state = "disconnected";
  const iterator = a.send(request(native))[Symbol.asyncIterator]();
  const next = iterator.next();
  const cancelled = expect(next).rejects.toMatchObject({ code: "cancelled" });
  await began;
  await a.cancel({ native });
  release();
  await cancelled;
  expect(driver.calls).toHaveLength(count);
  expect(
    JSON.parse(
      readFileSync(
        join(a.store.home(p.id), `session-${native.nativeSessionId}.json`),
        "utf8",
      ),
    ).started,
  ).toBe(false);
});
it("rejects in-place native session credential or workspace switching", async () => {
  const { a, p, native } = await setup();
  a.store.saveKey(p.id, "other-private-key");
  await expect(
    a.resumeSession({ native, workspaceRootPath: workspace }),
  ).rejects.toMatchObject({ code: "authentication-required" });
  a.store.saveKey(p.id, "fixture-private-key-canary");
  await expect(
    a.resumeSession({ native, workspaceRootPath: root() }),
  ).rejects.toThrow("Immutable");
});
it("closes a late query after cancellation without submitting a native prompt", async () => {
  const { a, native, driver, path } = await setup();
  let release!: () => void;
  let entered!: () => void;
  const began = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  a.options.sessionDriver = () => ({
    history: driver.history.bind(driver),
    query: async (input) => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      calls++;
      return driver.query(input);
    },
  });
  const iterator = a.send(request(native))[Symbol.asyncIterator]();
  await iterator.next();
  await began;
  await a.cancel({ native });
  release();
  const events = [];
  while (true) {
    const next = await iterator.next();
    if (next.done) break;
    events.push(next.value);
  }
  expect(events.at(-1)?.type).toBe("turn.cancelled");
  expect(calls).toBe(1);
  expect(driver.closed).toBe(2);
  expect(
    driver.history(native.nativeSessionId).then((r) => r.messages),
  ).resolves.toEqual([]);
  expect(
    readFileSync(
      join(
        path,
        native.connectionProfileId!,
        `session-${native.nativeSessionId}.json`,
      ),
      "utf8",
    ),
  ).toContain('"started":true');
});
