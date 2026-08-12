import { describe, expect, it } from "vitest";
import { HostDispatcher } from "./dispatch";
import { AdapterRegistry } from "./registry";
import { buildInfo } from "./version";
import { createFakeRuntimeAdapter } from "../../src/lib/session/adapter/fake";
import type { AgentRuntimeAdapter } from "../../src/lib/session/adapter";
import { ProtocolErrorCode, RequestMethod } from "./protocol";
import { FakeStdout, FakeStderr, BackpressureStdout } from "./testing";

const TERMINAL_KINDS = new Set(["turn.finished", "turn.failed", "turn.cancelled"]);

function makeDispatcher(adapter?: AgentRuntimeAdapter): { dispatcher: HostDispatcher; stdout: FakeStdout; stderr: FakeStderr } {
  const registry = new AdapterRegistry();
  registry.register(
    adapter ??
      createFakeRuntimeAdapter({
        turns: {
          hello: { events: [{ kind: "text.delta", delta: "Hi " }, { kind: "text.delta", delta: "there" }], outcome: { outcome: "finish" } },
          "long-running": { events: [{ kind: "status", status: "running" }], outcome: { outcome: "hang" } },
          gated: {
            events: [{ kind: "permission", permissionId: "p1", label: "Run" }, { kind: "text", text: "ok" }],
            awaitReply: true,
            outcome: { outcome: "finish" },
          },
        },
      }),
  );
  const stdout = new FakeStdout();
  const stderr = new FakeStderr();
  const dispatcher = new HostDispatcher({ registry, stdout, stderr, buildInfo: buildInfo() });
  return { dispatcher, stdout, stderr };
}

async function initialize(dispatcher: HostDispatcher, protocolVersion = 1): Promise<void> {
  await dispatcher.handle({ jsonrpc: "2.0", id: "init", method: RequestMethod.Initialize, params: { protocolVersion } });
}

async function call(dispatcher: HostDispatcher, id: string | number, method: string, params?: unknown): Promise<void> {
  await dispatcher.handle({ jsonrpc: "2.0", id, method, params });
}

function parsedMessages(stdout: { readonly lines: readonly string[] }): unknown[] {
  return stdout.lines.flatMap((line) =>
    line
      .split("\n")
      .filter((entry) => entry.length > 0)
      .map((entry) => JSON.parse(entry)),
  );
}

function resultFor(stdout: { readonly lines: readonly string[] }, id: string | number): unknown {
  for (const message of parsedMessages(stdout) as Array<{ id?: unknown; result?: unknown; error?: { code: number; message: string } }>) {
    if (message.id === id && message.result !== undefined) return message.result;
  }
  throw new Error(`no result for id ${id}`);
}

function errorFor(stdout: { readonly lines: readonly string[] }, id: string | number): { code: number; message: string } {
  for (const message of parsedMessages(stdout) as Array<{ id?: unknown; error?: { code: number; message: string } }>) {
    if (message.id === id && message.error) return message.error;
  }
  throw new Error(`no error for id ${id}`);
}

function eventsFor(stdout: { readonly lines: readonly string[] }): Array<{ params: { event: { type: string; seq: number } } }> {
  return parsedMessages(stdout).filter(
    (message): message is { method: string; params: { event: { type: string; seq: number } } } =>
      (message as { method?: string }).method === "session.event",
  ) as Array<{ params: { event: { type: string; seq: number } } }>;
}

async function waitForIdle(dispatcher: HostDispatcher, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (dispatcher.activeTurnCount > 0 && Date.now() - start < timeoutMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  expect(dispatcher.activeTurnCount).toBe(0);
}

async function waitForEvent(
  stdout: { readonly lines: readonly string[] },
  predicate: (event: { type: string; seq: number }) => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (eventsFor(stdout).some((entry) => predicate(entry.params.event))) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("timed out waiting for event");
}

describe("dispatcher: initialize + version negotiation", () => {
  it("responds to initialize with version, build info, and runtimes", async () => {
    const { dispatcher, stdout } = makeDispatcher();
    await initialize(dispatcher);
    const result = resultFor(stdout, "init") as {
      protocolVersion: number;
      server: { build: { hostVersion: string }; runtimes: { id: string }[] };
    };
    expect(result.protocolVersion).toBe(1);
    expect(result.server.build.hostVersion.length).toBeGreaterThan(0);
    expect(result.server.runtimes.map((r) => r.id)).toContain("fake");
    expect(dispatcher.isInitialized).toBe(true);
  });

  it("rejects incompatible protocol versions and signals exit", async () => {
    const { dispatcher, stdout } = makeDispatcher();
    await initialize(dispatcher, 999);
    expect(errorFor(stdout, "init").code).toBe(ProtocolErrorCode.PROTOCOL_VERSION_MISMATCH);
    expect(dispatcher.shouldExit).toBe(true);
    expect(dispatcher.isInitialized).toBe(false);
  });
});

describe("dispatcher: guards and errors", () => {
  it("requires initialize before any other method", async () => {
    const { dispatcher, stdout } = makeDispatcher();
    await call(dispatcher, 1, RequestMethod.Discover);
    expect(errorFor(stdout, 1).code).toBe(ProtocolErrorCode.NOT_INITIALIZED);
  });

  it("returns METHOD_NOT_FOUND for unknown methods", async () => {
    const { dispatcher, stdout } = makeDispatcher();
    await initialize(dispatcher);
    await call(dispatcher, 1, "does.not.exist");
    expect(errorFor(stdout, 1).code).toBe(ProtocolErrorCode.METHOD_NOT_FOUND);
  });

  it("returns INVALID_PARAMS for malformed params", async () => {
    const { dispatcher, stdout } = makeDispatcher();
    await initialize(dispatcher);
    await call(dispatcher, 1, RequestMethod.SessionCreate, { runtimeId: "bogus", workspaceRootPath: "/ws" });
    expect(errorFor(stdout, 1).code).toBe(ProtocolErrorCode.INVALID_PARAMS);
  });

  it("maps an unknown runtime to INVALID_PARAMS", async () => {
    const { dispatcher, stdout } = makeDispatcher();
    await initialize(dispatcher);
    await call(dispatcher, 1, RequestMethod.SessionCreate, { runtimeId: "codex", workspaceRootPath: "/ws" });
    const error = errorFor(stdout, 1);
    expect(error.code).toBe(ProtocolErrorCode.INVALID_PARAMS);
  });

  it("maps an adapter error to ADAPTER_ERROR with adapterCode", async () => {
    const { dispatcher, stdout } = makeDispatcher(createFakeRuntimeAdapter({ failCreate: "runtime-unavailable" }));
    await initialize(dispatcher);
    await call(dispatcher, 1, RequestMethod.SessionCreate, { runtimeId: "fake", workspaceRootPath: "/ws" });
    const error = errorFor(stdout, 1) as { code: number; message: string; data?: { adapterCode: string } };
    expect(error.code).toBe(ProtocolErrorCode.ADAPTER_ERROR);
    expect(error.data?.adapterCode).toBe("runtime-unavailable");
  });
});

describe("dispatcher: discovery + sessions", () => {
  it("returns runtime descriptors with capabilities", async () => {
    const { dispatcher, stdout } = makeDispatcher();
    await initialize(dispatcher);
    await call(dispatcher, 1, RequestMethod.Discover);
    const result = resultFor(stdout, 1) as { runtimes: Array<{ id: string; capabilities: { schemaVersion: number } }> };
    expect(result.runtimes).toHaveLength(1);
    expect(result.runtimes[0].capabilities.schemaVersion).toBeGreaterThan(0);
  });

  it("creates and resumes a session", async () => {
    const { dispatcher, stdout } = makeDispatcher();
    await initialize(dispatcher);
    await call(dispatcher, 1, RequestMethod.SessionCreate, { runtimeId: "fake", workspaceRootPath: "/ws" });
    const ref = resultFor(stdout, 1) as { nativeSessionId: string };
    expect(ref.nativeSessionId.length).toBeGreaterThan(0);
    await call(dispatcher, 2, RequestMethod.SessionResume, { native: { runtimeId: "fake", nativeSessionId: ref.nativeSessionId }, workspaceRootPath: "/ws" });
    expect(resultFor(stdout, 2)).toBeDefined();
  });

  it("reports health", async () => {
    const { dispatcher, stdout } = makeDispatcher();
    await initialize(dispatcher);
    await call(dispatcher, 1, RequestMethod.Health, {});
    const result = resultFor(stdout, 1) as Array<{ runtimeId: string; status: string }>;
    expect(result[0].runtimeId).toBe("fake");
  });
});

describe("dispatcher: turn streaming", () => {
  it("acks turn.send then streams events in order with exactly one terminal", async () => {
    const { dispatcher, stdout } = makeDispatcher();
    await initialize(dispatcher);
    await call(dispatcher, 1, RequestMethod.SessionCreate, { runtimeId: "fake", workspaceRootPath: "/ws" });
    const ref = resultFor(stdout, 1) as { nativeSessionId: string };

    await call(dispatcher, 2, RequestMethod.TurnSend, {
      turnId: "sos-turn-1",
      native: { runtimeId: "fake", nativeSessionId: ref.nativeSessionId },
      workspaceRootPath: "/ws",
      prompt: "hello",
    });
    // The ack is written before any event.
    const ack = resultFor(stdout, 2) as { turnId: string };
    expect(ack.turnId).toBe("sos-turn-1");

    await waitForIdle(dispatcher);
    const events = eventsFor(stdout);
    const types = events.map((e) => e.params.event.type);
    expect(types[0]).toBe("turn.started");
    expect(types.at(-1)).toMatch(/turn\.(finished|failed|cancelled)/);
    expect(types.filter((t) => TERMINAL_KINDS.has(t))).toHaveLength(1);
    // Sequence ids strictly monotonic.
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i].params.event.seq).toBeGreaterThan(events[i - 1].params.event.seq);
    }
  });

  it("rejects a second concurrent turn on the same session", async () => {
    const { dispatcher, stdout } = makeDispatcher();
    await initialize(dispatcher);
    await call(dispatcher, 1, RequestMethod.SessionCreate, { runtimeId: "fake", workspaceRootPath: "/ws" });
    const ref = resultFor(stdout, 1) as { nativeSessionId: string };
    const native = { runtimeId: "fake", nativeSessionId: ref.nativeSessionId };

    await call(dispatcher, 2, RequestMethod.TurnSend, { turnId: "t1", native, workspaceRootPath: "/ws", prompt: "long-running" });
    expect(resultFor(stdout, 2)).toBeDefined(); // ack
    await call(dispatcher, 3, RequestMethod.TurnSend, { turnId: "t2", native, workspaceRootPath: "/ws", prompt: "long-running" });
    expect(errorFor(stdout, 3).code).toBe(ProtocolErrorCode.INVALID_PARAMS);

    await call(dispatcher, 4, RequestMethod.TurnCancel, { native });
    await waitForIdle(dispatcher);
  });

  it("forwards turn.cancelled when a long turn is cancelled", async () => {
    const { dispatcher, stdout } = makeDispatcher();
    await initialize(dispatcher);
    await call(dispatcher, 1, RequestMethod.SessionCreate, { runtimeId: "fake", workspaceRootPath: "/ws" });
    const ref = resultFor(stdout, 1) as { nativeSessionId: string };
    const native = { runtimeId: "fake", nativeSessionId: ref.nativeSessionId };

    await call(dispatcher, 2, RequestMethod.TurnSend, { turnId: "t1", native, workspaceRootPath: "/ws", prompt: "long-running" });
    await call(dispatcher, 3, RequestMethod.TurnCancel, { native });
    await waitForIdle(dispatcher);
    const events = eventsFor(stdout);
    expect(events.at(-1)?.params.event.type).toBe("turn.cancelled");
  });

  it("unblocks a gated permission turn after permission.reply and finishes it", async () => {
    const { dispatcher, stdout } = makeDispatcher();
    await initialize(dispatcher);
    await call(dispatcher, 1, RequestMethod.SessionCreate, { runtimeId: "fake", workspaceRootPath: "/ws" });
    const ref = resultFor(stdout, 1) as { nativeSessionId: string };
    const native = { runtimeId: "fake", nativeSessionId: ref.nativeSessionId };

    await call(dispatcher, 2, RequestMethod.TurnSend, { turnId: "t1", native, workspaceRootPath: "/ws", prompt: "gated" });
    // Wait for the permission request to be forwarded before replying (mirrors
    // a real client, which only replies after seeing the permission event).
    await waitForEvent(stdout, (event) => event.type === "permission.requested");
    await call(dispatcher, 3, RequestMethod.PermissionReply, { native, turnId: "t1", permissionId: "p1", reply: "once" });
    await waitForIdle(dispatcher);
    const events = eventsFor(stdout);
    const types = events.map((e) => e.params.event.type);
    expect(types).toContain("permission.requested");
    expect(types.at(-1)).toBe("turn.finished");
  });
});

describe("dispatcher: graceful shutdown", () => {
  it("cancels active turns and settles during graceful shutdown", async () => {
    const { dispatcher, stdout } = makeDispatcher();
    await initialize(dispatcher);
    await call(dispatcher, 1, RequestMethod.SessionCreate, { runtimeId: "fake", workspaceRootPath: "/ws" });
    const ref = resultFor(stdout, 1) as { nativeSessionId: string };
    await call(dispatcher, 2, RequestMethod.TurnSend, {
      turnId: "t1",
      native: { runtimeId: "fake", nativeSessionId: ref.nativeSessionId },
      workspaceRootPath: "/ws",
      prompt: "long-running",
    });
    expect(dispatcher.activeTurnCount).toBe(1);

    await dispatcher.gracefulShutdown("test");
    expect(dispatcher.isShuttingDown).toBe(true);
    expect(dispatcher.activeTurnCount).toBe(0);
    expect(eventsFor(stdout).at(-1)?.params.event.type).toBe("turn.cancelled");
  });

  it("shutdown request acks and cancels active turns", async () => {
    const { dispatcher, stdout } = makeDispatcher();
    await initialize(dispatcher);
    await call(dispatcher, 1, RequestMethod.SessionCreate, { runtimeId: "fake", workspaceRootPath: "/ws" });
    const ref = resultFor(stdout, 1) as { nativeSessionId: string };
    await call(dispatcher, 2, RequestMethod.TurnSend, {
      turnId: "t1",
      native: { runtimeId: "fake", nativeSessionId: ref.nativeSessionId },
      workspaceRootPath: "/ws",
      prompt: "long-running",
    });
    await call(dispatcher, 3, RequestMethod.Shutdown);
    expect(resultFor(stdout, 3)).toBeDefined();
    expect(dispatcher.activeTurnCount).toBe(0);
  });
});

describe("dispatcher: backpressure", () => {
  it("applies backpressure and preserves event ordering on a slow consumer", async () => {
    const stdout = new BackpressureStdout();
    const registry = new AdapterRegistry();
    registry.register(
      createFakeRuntimeAdapter({
        turns: {
          burst: {
            events: [
              { kind: "text.delta", delta: "a" },
              { kind: "text.delta", delta: "b" },
              { kind: "text.delta", delta: "c" },
            ],
            outcome: { outcome: "finish" },
          },
        },
      }),
    );
    const dispatcher = new HostDispatcher({ registry, stdout, stderr: new FakeStderr(), buildInfo: buildInfo() });
    await initialize(dispatcher);
    await call(dispatcher, 1, RequestMethod.SessionCreate, { runtimeId: "fake", workspaceRootPath: "/ws" });
    const ref = resultFor(stdout, 1) as { nativeSessionId: string };

    stdout.setBlocked(true);
    await call(dispatcher, 2, RequestMethod.TurnSend, {
      turnId: "t1",
      native: { runtimeId: "fake", nativeSessionId: ref.nativeSessionId },
      workspaceRootPath: "/ws",
      prompt: "burst",
    });

    // Drain repeatedly until the pump completes; each drain flushes one pending write.
    const start = Date.now();
    while (dispatcher.activeTurnCount > 0 && Date.now() - start < 2000) {
      stdout.drain();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    stdout.setBlocked(false);
    stdout.drain();
    await waitForIdle(dispatcher);

    const events = eventsFor(stdout);
    const seqs = events.map((e) => e.params.event.seq);
    const sorted = [...seqs].sort((a, b) => a - b);
    expect(seqs).toEqual(sorted);
    expect(events.at(-1)?.params.event.type).toBe("turn.finished");
  });
});
