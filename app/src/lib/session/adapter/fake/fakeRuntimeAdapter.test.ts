import { afterEach, describe, expect, it } from "vitest";
import {
  createFakeRuntimeAdapter,
  type FakeRuntimeAdapter,
} from "./fakeRuntimeAdapter";
import type { ContractAdapterFactory } from "../adapter.contract";
import { runAdapterContractSuite } from "../adapter.contract";
import { isAdapterError } from "../errors";
import { isPermissionExtension, isQuestionExtension, isCheckpointExtension } from "../extensions";
import {
  mintSpecOpsTurnId,
  resetSessionIdCountersForTests,
  type SpecOpsTurnId,
} from "../../ids";
import { redactForSerialization } from "../../redact";
import type { SessionEvent } from "../../events";

afterEach(() => {
  resetSessionIdCountersForTests();
});

const ROOT = "/fake-ws";

function makeAdapter(): FakeRuntimeAdapter {
  return createFakeRuntimeAdapter({
    turns: {
      hello: { events: [{ kind: "text", text: "hi there" }], outcome: { outcome: "finish" } },
      "long-running": { events: [{ kind: "status", status: "running" }], outcome: { outcome: "hang" } },
    },
  });
}

async function createSession(adapter: FakeRuntimeAdapter) {
  return adapter.createSession({ runtimeId: "fake", workspaceRootPath: ROOT });
}

const factory: ContractAdapterFactory = {
  runtimeId: "fake",
  finishPrompt: "hello",
  cancelPrompt: "long-running",
  workspaceRootPath: ROOT,
  async create() {
    return makeAdapter();
  },
};

runAdapterContractSuite(factory);

describe("fake runtime — scripted behavior", () => {
  it("text.delta events accumulate and the turn finishes", async () => {
    const adapter = createFakeRuntimeAdapter({
      turns: {
        stream: {
          events: [
            { kind: "text.delta", delta: "Hello" },
            { kind: "text.delta", delta: " world" },
          ],
          outcome: { outcome: "finish" },
        },
      },
    });
    const ref = await createSession(adapter);
    const events: SessionEvent[] = [];
    for await (const event of adapter.send({ turnId: mintSpecOpsTurnId(), native: ref, workspaceRootPath: ROOT, prompt: "stream" })) {
      events.push(event);
    }
    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "text.delta",
      "text.delta",
      "turn.finished",
    ]);
  });

  it("emits tool started + completed for a scripted tool", async () => {
    const adapter = createFakeRuntimeAdapter({
      turns: {
        tools: {
          events: [
            { kind: "tool", callId: "c1", toolName: "Read", input: { path: "a.ts" }, output: "x", status: "success" },
          ],
          outcome: { outcome: "finish" },
        },
      },
    });
    const ref = await createSession(adapter);
    const events: SessionEvent[] = [];
    for await (const event of adapter.send({ turnId: mintSpecOpsTurnId(), native: ref, workspaceRootPath: ROOT, prompt: "tools" })) {
      events.push(event);
    }
    const kinds = events.map((event) => event.type);
    expect(kinds).toContain("tool.started");
    expect(kinds).toContain("tool.completed");
  });

  it("a fail outcome terminates the stream with turn.failed", async () => {
    const adapter = createFakeRuntimeAdapter({
      turns: {
        boom: {
          events: [{ kind: "text.delta", delta: "partial" }],
          outcome: { outcome: "fail", message: "model exploded" },
        },
      },
    });
    const ref = await createSession(adapter);
    const events: SessionEvent[] = [];
    for await (const event of adapter.send({ turnId: mintSpecOpsTurnId(), native: ref, workspaceRootPath: ROOT, prompt: "boom" })) {
      events.push(event);
    }
    const terminal = events.at(-1)!;
    expect(terminal.type).toBe("turn.failed");
    expect((terminal as { message: string }).message).toBe("model exploded");
  });

  it("unrecognized native payloads are preserved as redacted diagnostics", async () => {
    const adapter = createFakeRuntimeAdapter({
      turns: {
        weird: {
          events: [
            {
              kind: "unknown-native",
              raw: { shape: "mystery", authorization: "Bearer supersecret" },
            },
          ],
          outcome: { outcome: "finish" },
        },
      },
    });
    const ref = await createSession(adapter);
    const events: SessionEvent[] = [];
    for await (const event of adapter.send({ turnId: mintSpecOpsTurnId(), native: ref, workspaceRootPath: ROOT, prompt: "weird" })) {
      events.push(event);
    }
    const diagnostic = events.find((event) => event.type === "diagnostic") as Extract<SessionEvent, { type: "diagnostic" }>;
    expect(diagnostic).toBeDefined();
    expect(diagnostic.reason).toBe("unknown-native");
    const raw = redactForSerialization({ shape: "mystery", authorization: "Bearer supersecret" }) as Record<string, unknown>;
    // The redactedRaw must not contain the bearer secret.
    expect(JSON.stringify(diagnostic.redactedRaw)).not.toContain("supersecret");
    expect(JSON.stringify(raw)).not.toContain("supersecret");
  });

  it("malformed payloads are coerced to diagnostics", async () => {
    const adapter = createFakeRuntimeAdapter({
      turns: {
        bad: {
          events: [{ kind: "malformed", raw: "{ broken", message: "Could not parse native event" }],
          outcome: { outcome: "finish" },
        },
      },
    });
    const ref = await createSession(adapter);
    const events: SessionEvent[] = [];
    for await (const event of adapter.send({ turnId: mintSpecOpsTurnId(), native: ref, workspaceRootPath: ROOT, prompt: "bad" })) {
      events.push(event);
    }
    const diagnostic = events.find((event) => event.type === "diagnostic") as Extract<SessionEvent, { type: "diagnostic" }>;
    expect(diagnostic.reason).toBe("malformed");
    expect(diagnostic.message).toBe("Could not parse native event");
  });

  it("gates on a permission request until a reply arrives, then continues", async () => {
    const adapter = createFakeRuntimeAdapter({
      turns: {
        gated: {
          events: [
            { kind: "permission", permissionId: "p1", label: "Run shell" },
            { kind: "text", text: "after permission" },
          ],
          awaitReply: true,
          outcome: { outcome: "finish" },
        },
      },
    });
    expect(isPermissionExtension(adapter)).toBe(true);
    const ref = await createSession(adapter);
    const turnId = mintSpecOpsTurnId();
    const iterator = adapter.send({ turnId, native: ref, workspaceRootPath: ROOT, prompt: "gated" })[Symbol.asyncIterator]();

    const started = await iterator.next();
    const permission = await iterator.next();
    expect(started.value.type).toBe("turn.started");
    expect(permission.value.type).toBe("permission.requested");

    await adapter.replyPermission({ native: ref, turnId, permissionId: "p1", reply: "once" });

    const collected: SessionEvent[] = [started.value as SessionEvent, permission.value as SessionEvent];
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      collected.push(next.value);
      if (next.value.type === "turn.finished") break;
    }
    expect(collected.map((event) => event.type)).toEqual([
      "turn.started",
      "permission.requested",
      "text.finished",
      "turn.finished",
    ]);
  });

  it("gates on a question until answered", async () => {
    const adapter = createFakeRuntimeAdapter({
      turns: {
        q: {
          events: [
            { kind: "question", questionId: "q1", prompt: "Which file?", choices: ["a", "b"] },
            { kind: "text", text: "ok" },
          ],
          awaitReply: true,
          outcome: { outcome: "finish" },
        },
      },
    });
    expect(isQuestionExtension(adapter)).toBe(true);
    const ref = await createSession(adapter);
    const turnId = mintSpecOpsTurnId();
    const iterator = adapter.send({ turnId, native: ref, workspaceRootPath: ROOT, prompt: "q" })[Symbol.asyncIterator]();
    await iterator.next(); // started
    const question = await iterator.next();
    expect(question.value.type).toBe("question.requested");
    await adapter.replyQuestion({ native: ref, turnId, questionId: "q1", answer: "a" });
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      if (next.value.type === "turn.finished") break;
    }
  });

  it("cancels a turn gated on a permission ( wakes the blocked stream)", async () => {
    const adapter = createFakeRuntimeAdapter({
      turns: {
        gated: {
          events: [{ kind: "permission", permissionId: "p1", label: "Run shell" }],
          awaitReply: true,
          outcome: { outcome: "finish" },
        },
      },
    });
    const ref = await createSession(adapter);
    const turnId = mintSpecOpsTurnId();
    const iterator = adapter.send({ turnId, native: ref, workspaceRootPath: ROOT, prompt: "gated" })[Symbol.asyncIterator]();
    await iterator.next(); // started
    await iterator.next(); // permission.requested -> now blocked on reply
    await adapter.cancel({ native: ref });
    const terminal = await iterator.next();
    expect((terminal.value as SessionEvent).type).toBe("turn.cancelled");
  });

  it("createSession error injection raises a typed adapter error", async () => {
    const adapter = createFakeRuntimeAdapter({ failCreate: "runtime-unavailable" });
    await expect(createSession(adapter)).rejects.toSatisfy((error: unknown) => isAdapterError(error));
  });

  it("auth challenge and auth failure surface as configured", async () => {
    const challenge = createFakeRuntimeAdapter({ auth: { status: "challenge", challenge: { kind: "url", url: "https://example" } } });
    const challengeResult = await challenge.authenticate({ runtimeId: "fake", workspaceRootPath: ROOT });
    expect(challengeResult.status).toBe("challenge");
    expect(challengeResult.challenge?.url).toBe("https://example");

    const failed = createFakeRuntimeAdapter({ auth: { status: "authenticated", fail: "authentication-failed" } });
    await expect(failed.authenticate({ runtimeId: "fake", workspaceRootPath: ROOT })).rejects.toSatisfy((error: unknown) =>
      isAdapterError(error) && error.code === "authentication-failed",
    );
  });

  it("resumeSession rejects unknown ids when failResumeUnknown is set", async () => {
    const adapter = createFakeRuntimeAdapter({ failResumeUnknown: true });
    await expect(
      adapter.resumeSession({ native: { runtimeId: "fake", nativeSessionId: "missing" as never }, workspaceRootPath: ROOT }),
    ).rejects.toSatisfy((error: unknown) => isAdapterError(error) && error.code === "session-not-found");
  });

  it("forkSession creates a new native session that can carry its own turn", async () => {
    const adapter = createFakeRuntimeAdapter({
      turns: { hello: { events: [{ kind: "text", text: "hi" }], outcome: { outcome: "finish" } } },
    });
    expect(isCheckpointExtension(adapter)).toBe(true);
    const parent = await createSession(adapter);
    const child = await adapter.forkSession({ native: parent });
    expect(String(child.nativeSessionId)).not.toBe(String(parent.nativeSessionId));
    const events: SessionEvent[] = [];
    for await (const event of adapter.send({ turnId: mintSpecOpsTurnId(), native: child, workspaceRootPath: ROOT, prompt: "hello" })) {
      events.push(event);
    }
    expect(events.at(-1)?.type).toBe("turn.finished");
  });

  it("describeCapabilities advertises the extensions the fake implements", async () => {
    const adapter = makeAdapter();
    const capabilities = await adapter.describeCapabilities();
    expect(capabilities.supported).toContain("permissions");
    expect(capabilities.supported).toContain("questions");
    expect(capabilities.supported).toContain("fork");
  });

  it("describeCatalog and health return populated summaries", async () => {
    const adapter = createFakeRuntimeAdapter({ runtimeVersion: "fake-1.0", healthStatus: "degraded", healthMessage: "slow" });
    const models = await adapter.listModels();
    const modes = await adapter.listModes();
    expect(models.length).toBeGreaterThan(0);
    expect(modes.length).toBeGreaterThan(0);
    const health = await adapter.health();
    expect(health.status).toBe("degraded");
    expect(health.runtimeVersion).toBe("fake-1.0");
    expect(health.message).toBe("slow");
  });
});
