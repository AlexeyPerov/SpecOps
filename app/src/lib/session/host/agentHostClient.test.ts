import { describe, expect, it, vi } from "vitest";
import {
  AGENT_HOST_EVENT,
  createAgentHostClient,
  newTurnId,
  type AgentHostBindings,
} from "./agentHostClient";
import type { UnlistenFn } from "@tauri-apps/api/event";

/** A fake Tauri binding set that records invokes and lets tests push events. */
function fakeBindings(): AgentHostBindings & {
  calls: { cmd: string; args?: Record<string, unknown> }[];
  emit(event: unknown): void;
  handlerRef: { current: ((payload: unknown) => void) | null };
} {
  const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  const handlerRef: { current: ((payload: unknown) => void) | null } = { current: null };
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args });
    switch (cmd) {
      case "agent_host_request": {
        const method = args?.method as string;
        if (method === "discover") return { runtimes: [] };
        if (method === "session.create")
          return { runtimeId: "fake", nativeSessionId: "fake-native-1" };
        if (method === "health")
          return { status: "healthy", runtimeId: "fake", checkedAt: "1970-01-01T00:00:00.000Z" };
        if (method === "turn.send") return { turnId: (args?.params as { turnId: string }).turnId };
        return null;
      }
      case "agent_host_status":
      case "agent_host_start":
      case "agent_host_stop":
      case "agent_host_restart":
        return {
          running: true,
          health: "healthy",
          pid: 123,
          generation: 1,
          hostVersion: "0.1.0",
          protocolVersion: 1,
          restartCount: 0,
          lastError: null,
        };
      default:
        return null;
    }
  });
  const listen = vi.fn(async (_event: string, h: (payload: unknown) => void) => {
    handlerRef.current = h;
    return (() => {}) as unknown as UnlistenFn;
  });
  return {
    invoke,
    listen,
    calls,
    handlerRef,
    emit(event: unknown) {
      handlerRef.current?.(event);
    },
  };
}

describe("agent host client", () => {
  it("routes discovery + create + health through agent_host_request", async () => {
    const fb = fakeBindings();
    const client = createAgentHostClient(fb);

    const discovered = await client.discover();
    expect(discovered.runtimes).toEqual([]);
    const created = await client.createSession({
      runtimeId: "fake",
      workspaceRootPath: "/ws",
    });
    expect(created.nativeSessionId).toBe("fake-native-1");
    expect(created.runtimeId).toBe("fake");
    const health = await client.health();
    expect(health.status).toBe("healthy");

    const requestCalls = fb.calls.filter((c) => c.cmd === "agent_host_request");
    expect(requestCalls.map((c) => (c.args as { method: string }).method)).toEqual([
      "discover",
      "session.create",
      "health",
    ]);
  });

  it("forwards start/stop/restart/status to their own commands", async () => {
    const fb = fakeBindings();
    const client = createAgentHostClient(fb);
    const status = await client.start();
    expect(status.running).toBe(true);
    expect(client.status?.health).toBe("healthy");
    await client.stop();
    await client.restart();
    await client.getStatus();
    expect(fb.calls.map((c) => c.cmd)).toEqual([
      "agent_host_start",
      "agent_host_stop",
      "agent_host_restart",
      "agent_host_status",
    ]);
  });

  it("subscribes to the event stream and yields turn events until a terminal", async () => {
    const fb = fakeBindings();
    const client = createAgentHostClient(fb);
    const turnId = newTurnId();
    const native = { runtimeId: "fake" as const, nativeSessionId: "fake-native-1" as never };

    // Drive the async iterator and collect events; push them after send resolves.
    const iter = client.sendTurn({
      turnId,
      native,
      workspaceRootPath: "/ws",
      prompt: "ping",
    });
    const collected: string[] = [];
    const drive = (async () => {
      // Wait for the listener + ack to settle.
      await Promise.resolve();
      await Promise.resolve();
      // The listen() fake captured the handler; emit three events.
      expect(fb.listen).toHaveBeenCalledWith(AGENT_HOST_EVENT, expect.any(Function));
      fb.emit({
        method: "session.event",
        params: { nativeSessionId: "fake-native-1", event: { type: "turn.started", turnId, seq: 1 } },
      });
      fb.emit({
        method: "session.event",
        params: {
          nativeSessionId: "fake-native-1",
          event: { type: "text.delta", turnId, delta: "pong", seq: 2 },
        },
      });
      fb.emit({
        method: "session.event",
        params: {
          nativeSessionId: "fake-native-1",
          event: { type: "turn.finished", turnId, seq: 3 },
        },
      });
    })();

    for await (const event of iter) {
      collected.push(event.type);
    }
    await drive;
    expect(collected).toEqual(["turn.started", "text.delta", "turn.finished"]);
  });

  it("ignores events for a different native session", async () => {
    const fb = fakeBindings();
    const client = createAgentHostClient(fb);
    const turnId = newTurnId();
    const native = { runtimeId: "fake" as const, nativeSessionId: "fake-native-1" as never };

    const iter = client.sendTurn({
      turnId,
      native,
      workspaceRootPath: "/ws",
      prompt: "ping",
    });
    const drive = (async () => {
      await Promise.resolve();
      await Promise.resolve();
      // Event for a different session — must be ignored.
      fb.emit({
        method: "session.event",
        params: {
          nativeSessionId: "other",
          event: { type: "turn.started", turnId, seq: 1 },
        },
      });
      fb.emit({
        method: "session.event",
        params: {
          nativeSessionId: "fake-native-1",
          event: { type: "turn.finished", turnId, seq: 2 },
        },
      });
    })();

    const collected: string[] = [];
    for await (const event of iter) {
      collected.push(event.type);
    }
    await drive;
    expect(collected).toEqual(["turn.finished"]);
  });

  it("maps a protocol error from agent_host_request to a rejection", async () => {
    const fb = fakeBindings();
    fb.invoke = vi.fn(async (cmd: string) => {
      if (cmd === "agent_host_request") {
        throw { kind: "protocol", code: -32006, message: "adapter error" };
      }
      return null;
    });
    const client = createAgentHostClient(fb);
    await expect(client.discover()).rejects.toMatchObject({
      kind: "protocol",
      code: -32006,
    });
  });
});
