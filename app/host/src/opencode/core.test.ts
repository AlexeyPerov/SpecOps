import {
  mkdtempSync,
  copyFileSync,
  chmodSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeRuntimeAdapter } from "./adapter";
import { OpenCodeTurn } from "./turn";
import {
  asNativeSessionId,
  asSpecOpsTurnId,
} from "../../../src/lib/session/ids";
import {
  runAdapterContractSuite,
  collectContractEvents,
} from "../../../src/lib/session/adapter/adapter.contract";
import type {
  AgentTurnRequest,
  NativeSessionRef,
} from "../../../src/lib/session/adapter";
import type { RuntimeConnection } from "./lifecycle";
const cleanup: (() => void)[] = [];
let shared: string | undefined;
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn());
  shared = undefined;
});
function root() {
  const path = mkdtempSync(join(tmpdir(), "specops-core-"));
  cleanup.push(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
function runtime(path = root(), options = {}) {
  const executable = join(path, "native.mjs");
  copyFileSync(
    fileURLToPath(new URL("./nativeFixture.mjs", import.meta.url)),
    executable,
  );
  chmodSync(executable, 0o700);
  const adapter = new OpenCodeRuntimeAdapter({
    profileRoot: join(path, "profiles"),
    executable,
    ...options,
  });
  cleanup.push(() => adapter.close());
  return adapter;
}
async function setup(options = {}) {
  const adapter = runtime(undefined, options);
  const profile = adapter.store.create("Core");
  const workspace = root();
  const native = await adapter.createSession({
    runtimeId: "opencode",
    workspaceRootPath: workspace,
    connectionProfileId: profile.id,
    modelId: "fixture/model",
    modeId: "build",
  });
  return { adapter, profile, workspace, native };
}
const request = (
  native: NativeSessionRef,
  workspace: string,
  prompt = "hello",
): AgentTurnRequest => ({
  native,
  workspaceRootPath: workspace,
  prompt,
  turnId: asSpecOpsTurnId("turn"),
});
class ContractRuntime extends OpenCodeRuntimeAdapter {
  readonly profileId: string;
  constructor(path: string) {
    const executable = join(path, "native.mjs");
    copyFileSync(
      fileURLToPath(new URL("./nativeFixture.mjs", import.meta.url)),
      executable,
    );
    chmodSync(executable, 0o700);
    super({ profileRoot: join(path, "profiles"), executable });
    this.profileId =
      this.store.list()[0]?.id ?? this.store.create("Contract").id;
  }
  override authenticate(
    input: Parameters<OpenCodeRuntimeAdapter["authenticate"]>[0],
  ) {
    return super.authenticate({
      ...input,
      connectionProfileId: this.profileId,
    });
  }
  override createSession(
    input: Parameters<OpenCodeRuntimeAdapter["createSession"]>[0],
  ) {
    return super.createSession({
      ...input,
      connectionProfileId: this.profileId,
    });
  }
}
runAdapterContractSuite({
  runtimeId: "opencode",
  workspaceRootPath: "/work",
  finishPrompt: "unknown",
  cancelPrompt: "cancel",
  create: async () => {
    shared ??= root();
    const adapter = new ContractRuntime(shared);
    cleanup.push(() => adapter.close());
    return adapter;
  },
  createFaultAdapter: async () => {
    const adapter = new ContractRuntime(root());
    cleanup.push(() => adapter.close());
    return adapter;
  },
});
describe("native core sessions", () => {
  it("creates native sessions and hydrates authoritative history after host restart without replay", async () => {
    const { adapter, profile, workspace, native } = await setup();
    const events = await collectContractEvents(
      adapter.send(request(native, workspace)),
    );
    expect(events.at(-1)?.type).toBe("turn.finished");
    expect(events.find((e) => e.type === "text.finished")).toMatchObject({
      text: "Native fixture answer",
    });
    adapter.close();
    const replacement = new OpenCodeRuntimeAdapter(adapter.options);
    cleanup.push(() => replacement.close());
    const resumed = await replacement.resumeSession({
      native: JSON.parse(JSON.stringify(native)),
      workspaceRootPath: workspace,
    });
    expect(resumed.history?.map((row) => row.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(resumed.history?.[1].content).toBe("Native fixture answer");
    expect(
      JSON.parse(
        readFileSync(
          join(adapter.store.home(profile.id), "fixture-sessions.json"),
          "utf8",
        ),
      )[native.nativeSessionId].messages,
    ).toHaveLength(2);
    const second = await collectContractEvents(
      replacement.send(request(resumed, workspace)),
    );
    expect(second.at(-1)?.type).toBe("turn.finished");
    await expect(
      replacement.resumeSession({
        native: { ...native, modelId: "other/model" },
        workspaceRootPath: workspace,
      }),
    ).rejects.toThrow("binding mismatch");
  });
  it.each(["permission", "question"])(
    "correlates %s and rejects duplicate or cross-profile replies",
    async (prompt) => {
      const { adapter, native, workspace } = await setup();
      const events = [];
      let token = "";
      for await (const event of adapter.send(
        request(native, workspace, prompt),
      )) {
        events.push(event);
        if (event.type === "permission.requested") {
          token = event.request.permissionId;
          await expect(
            adapter.replyPermission({
              native: { ...native, connectionProfileId: "other" },
              turnId: asSpecOpsTurnId("turn"),
              permissionId: token,
              reply: "once",
            }),
          ).rejects.toThrow("expired");
          await adapter.replyPermission({
            native,
            turnId: asSpecOpsTurnId("turn"),
            permissionId: token,
            reply: "once",
          });
          await expect(
            adapter.replyPermission({
              native,
              turnId: asSpecOpsTurnId("turn"),
              permissionId: token,
              reply: "once",
            }),
          ).rejects.toThrow("expired");
        }
        if (event.type === "question.requested") {
          token = event.request.questionId;
          await adapter.replyQuestion({
            native,
            turnId: asSpecOpsTurnId("turn"),
            questionId: token,
            answer: "One",
          });
        }
      }
      expect(events.at(-1)?.type).toBe("turn.finished");
    },
  );
  it("settles deadline and Stop without hung streams or replay", async () => {
    const { adapter, native, workspace } = await setup({ turnTimeoutMs: 100 });
    const events = await collectContractEvents(
      adapter.send(request(native, workspace, "permission")),
    );
    expect(events.at(-1)?.type).toBe("turn.cancelled");
    const stream = adapter
      .send(request(native, workspace, "cancel"))
      [Symbol.asyncIterator]();
    expect((await stream.next()).value.type).toBe("turn.started");
    await adapter.cancel({ native });
    const remaining = [];
    for (;;) {
      const next = await stream.next();
      if (next.done) break;
      remaining.push(next.value);
    }
    expect(remaining.at(-1)?.type).toBe("turn.cancelled");
  });
  it.each(["delayed-cancel", "ignored-cancel"])(
    "settles %s native work before releasing the session reservation",
    async (prompt) => {
      const { adapter, native, workspace } = await setup();
      const iterator = adapter
        .send(request(native, workspace, prompt))
        [Symbol.asyncIterator]();
      await iterator.next();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const c = await adapter.connect(native.connectionProfileId);
      await adapter.cancel({ native });
      await expect(
        adapter.send(request(native, workspace))[Symbol.asyncIterator]().next(),
      ).rejects.toThrow("already active");
      const events = [];
      for (;;) {
        const next = await iterator.next();
        if (next.done) break;
        events.push(next.value);
      }
      expect(events.at(-1)?.type).toBe("turn.cancelled");
      if (prompt === "ignored-cancel") expect(c.client).toBeNull();
      expect(
        (
          await collectContractEvents(adapter.send(request(native, workspace)))
        ).at(-1)?.type,
      ).toBe("turn.finished");
      const requests = readFileSync(
        join(
          adapter.store.home(native.connectionProfileId!),
          "fixture-requests.jsonl",
        ),
        "utf8",
      )
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      expect(
        requests.filter((row) => row.path.endsWith("/prompt_async")),
      ).toHaveLength(2);
      expect(
        requests.filter((row) => row.path.endsWith("/abort")).length,
      ).toBeGreaterThan(0);
    },
  );
  it("prevents concurrent native sends and isolates profile crash", async () => {
    const { adapter, native, workspace } = await setup();
    const other = adapter.store.create("Other");
    const otherNative = await adapter.createSession({
      runtimeId: "opencode",
      connectionProfileId: other.id,
      workspaceRootPath: workspace,
    });
    const a = adapter
      .send(request(native, workspace, "cancel"))
      [Symbol.asyncIterator]();
    const b = adapter
      .send(request(native, workspace, "cancel"))
      [Symbol.asyncIterator]();
    const results = await Promise.allSettled([a.next(), b.next()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const winner = results[0].status === "fulfilled" ? a : b;
    const c = await adapter.connect(native.connectionProfileId);
    c.close();
    const rest = [];
    for (;;) {
      const next = await winner.next();
      if (next.done) break;
      rest.push(next.value);
    }
    expect(rest.at(-1)?.type).toBe("turn.failed");
    expect(
      (
        await collectContractEvents(
          adapter.send(request(otherNative, workspace)),
        )
      ).at(-1)?.type,
    ).toBe("turn.finished");
  });
});
function mapped() {
  const native = {
    runtimeId: "opencode" as const,
    connectionProfileId: "profile",
    nativeSessionId: asNativeSessionId("session"),
  };
  const connection = {
    generation: 1,
    client: null,
  } as unknown as RuntimeConnection;
  let seq = 0;
  const turn = new OpenCodeTurn(
    request(native, "/work"),
    connection,
    "message",
    () => ++seq,
  );
  turn.event({
    id: "message-created",
    type: "message.updated",
    properties: {
      info: {
        role: "assistant",
        id: "assistant",
        sessionID: "session",
        parentID: "message",
      },
    },
  });
  return { turn, connection };
}
describe("bounded native normalization", () => {
  it("maps reasoning tools steps subtasks file changes usage compaction and deduplicates", async () => {
    const { turn } = mapped();
    const common = { sessionID: "session", messageID: "assistant" };
    const parts = [
      { id: "reason", type: "reasoning", text: "Thought", time: { end: 1 } },
      {
        id: "tool",
        type: "tool",
        callID: "call",
        tool: "task",
        state: {
          status: "completed",
          input: { subagent_type: "helper" },
          output: "Done",
        },
      },
      { id: "step", type: "step-start" },
      {
        id: "finish",
        type: "step-finish",
        reason: "stop",
        cost: 1,
        tokens: {
          input: 2,
          output: 3,
          reasoning: 1,
          cache: { read: 0, write: 0 },
        },
      },
      { id: "patch", type: "patch", files: ["file.ts"] },
    ];
    parts.forEach((part) => {
      turn.part({ ...common, ...part });
      turn.part({ ...common, ...part });
    });
    turn.event({
      id: "compact",
      type: "session.compacted",
      properties: { sessionID: "session" },
    });
    turn.finish("turn.finished");
    const events = await collectContractEvents(turn.events());
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        "reasoning.ended",
        "tool.started",
        "tool.completed",
        "subtask.completed",
        "step.started",
        "step.finished",
        "usage.recorded",
        "diff.posted",
        "compaction.applied",
      ]),
    );
    expect(events.filter((e) => e.type === "usage.recorded")).toHaveLength(1);
  });
  it.each([
    "sk-abcdefghijklmnopqrstuv",
    "Bearer OPAQUE-TOKEN-CANARY",
    "api_key = OPAQUE-KEY-CANARY",
    '"access_token":"OPAQUE-TOKEN-CANARY"',
  ])("redacts every split position of %s", async (secret) => {
    for (let split = 1; split < secret.length; split++) {
      const { turn } = mapped();
      const part = { id: "text", type: "text" };
      turn.part({ ...part, text: secret.slice(0, split) });
      turn.part({ id: "other", type: "step-start" });
      turn.part({ ...part, text: secret });
      turn.finish("turn.finished");
      const events = await collectContractEvents(turn.events());
      expect(JSON.stringify(events)).not.toContain("OPAQUE-");
      expect(JSON.stringify(events)).not.toContain("abcdefghijklmnopqrstuv");
    }
  });
  it("rejects stale correlation and malformed nested data", async () => {
    const { turn, connection } = mapped();
    turn.event({
      id: "wrong",
      type: "message.part.updated",
      properties: {
        sessionID: "other",
        part: {
          id: "text",
          messageID: "assistant",
          type: "text",
          text: "leak",
        },
      },
    });
    connection.generation = 2;
    turn.event({
      id: "stale",
      type: "session.error",
      properties: { sessionID: "session" },
    });
    expect(turn.ended).toBe(false);
    connection.generation = 1;
    turn.part({
      id: "tool",
      type: "tool",
      callID: "call",
      tool: "shell",
      state: { status: "completed" },
    });
    const events = await collectContractEvents(turn.events());
    expect(events.at(-1)?.type).toBe("turn.failed");
    expect(JSON.stringify(events)).not.toContain("leak");
  });
  it("bounds undrained and draining floods without recursion", async () => {
    for (const draining of [false, true]) {
      const { turn } = mapped();
      const collect = async () => {
        const events = [];
        for await (const event of turn.events()) events.push(event);
        return events;
      };
      const consuming = draining ? collect() : undefined;
      for (let i = 0; i < 10000 && !turn.ended; i++) {
        turn.emit({
          type: "diagnostic",
          level: "info",
          message: "word ".repeat(256),
        });
        if (draining) {
          turn.part({
            id: "text-" + i,
            type: "text",
            text: "word ".repeat(256),
          });
          await Promise.resolve();
        }
      }
      if (!turn.ended) turn.finish("turn.finished");
      const events = await (consuming ?? collect());
      expect(
        events.filter((e) => ["turn.failed", "turn.finished"].includes(e.type)),
      ).toHaveLength(1);
      expect(events.at(-1)?.type).toBe("turn.failed");
    }
  });
});

it.runIf(Boolean(process.env.SPECOPS_NATIVE_SMOKE))(
  "creates and resumes a real pinned native session without provider inference",
  async () => {
    const path = root();
    const workspace = root();
    const adapter = new OpenCodeRuntimeAdapter({
      profileRoot: join(path, "profiles"),
      executable: process.env.SPECOPS_NATIVE_SMOKE,
    });
    cleanup.push(() => adapter.close());
    const profile = adapter.store.create("Native lifecycle");
    const native = await adapter.createSession({
      runtimeId: "opencode",
      connectionProfileId: profile.id,
      workspaceRootPath: workspace,
    });
    adapter.close();
    const replacement = new OpenCodeRuntimeAdapter(adapter.options);
    cleanup.push(() => replacement.close());
    const resumed = await replacement.resumeSession({
      native,
      workspaceRootPath: workspace,
    });
    expect(resumed.nativeSessionId).toBe(native.nativeSessionId);
    expect(resumed.history).toEqual([]);
  },
);
