/**
 * Shared adapter contract suite (phase C, task AS01-C-04).
 *
 * `runAdapterContractSuite` asserts the mandatory behavioral contract every
 * runtime adapter must satisfy, independent of vendor. The fake adapter (and,
 * unchanged, the phase 02–05 real adapters) plug in via a factory. The suite
 * covers lifecycle ordering, monotonic sequence ids, terminal exclusivity,
 * cancellation semantics, restart/resume, and capability honesty.
 *
 * Adapter-specific content (e.g. coercing a *specific* unknown native event) is
 * exercised in adapter-local tests, not here, because it cannot be reproduced
 * deterministically across real runtimes.
 *
 * This is a helper module (not a `*.test.ts` file): it only registers tests via
 * {@link runAdapterContractSuite} when an adapter test file invokes it.
 */

import { describe, expect, it } from "vitest";
import type { AgentRuntimeAdapter, NativeSessionRef } from "./adapter";
import {
  mintSpecOpsTurnId,
  type SpecOpsTurnId,
} from "../ids";
import type { SessionEvent } from "../events";
import {
  CAPABILITY_EXTENSION_MAP,
  isTodosExtension,
} from "./extensions";

/** Contract a factory fulfils so the shared suite can drive an adapter. */
export interface ContractAdapterFactory {
  /** Fresh adapter instance (isolated state per test). */
  create(): Promise<AgentRuntimeAdapter>;
  /** Runtime id the adapter claims. */
  readonly runtimeId: string;
  /** Prompt that produces a normal, terminating turn (no interactive gating). */
  readonly finishPrompt: string;
  /** Prompt that produces a long-running turn safe to cancel mid-stream. */
  readonly cancelPrompt: string;
  /** Optional workspace root passed to create/send. */
  readonly workspaceRootPath?: string;
}

const TERMINAL_KINDS = new Set(["turn.finished", "turn.failed", "turn.cancelled"]);
const DEFAULT_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms = DEFAULT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function createSession(
  adapter: AgentRuntimeAdapter,
  workspaceRootPath: string,
): Promise<NativeSessionRef> {
  return adapter.createSession({ runtimeId: adapter.runtimeId as never, workspaceRootPath });
}

async function drainTerminal(stream: AsyncIterable<SessionEvent>): Promise<SessionEvent[]> {
  const out: SessionEvent[] = [];
  for await (const event of stream) {
    out.push(event);
    if (TERMINAL_KINDS.has(event.type)) {
      return out;
    }
  }
  return out;
}

/**
 * Register the shared contract suite for an adapter produced by `factory`.
 * Call inside an adapter's own test file (top level).
 */
export function runAdapterContractSuite(factory: ContractAdapterFactory): void {
  const root = factory.workspaceRootPath ?? "/contract-workspace";

  async function setup(): Promise<{ adapter: AgentRuntimeAdapter; ref: NativeSessionRef }> {
    const adapter = await factory.create();
    const ref = await createSession(adapter, root);
    return { adapter, ref };
  }

  function turnId(): SpecOpsTurnId {
    return mintSpecOpsTurnId();
  }

  describe("mandatory adapter contract", () => {
    it("describe() returns a descriptor matching the adapter runtime id", async () => {
      const adapter = await factory.create();
      const descriptor = await adapter.describe();
      expect(descriptor.id).toBe(factory.runtimeId);
      expect(typeof descriptor.label).toBe("string");
      expect(descriptor.label.length).toBeGreaterThan(0);
    });

    it("describeCapabilities() returns a versioned, detailed capability map", async () => {
      const adapter = await factory.create();
      const capabilities = await adapter.describeCapabilities();
      expect(capabilities.schemaVersion).toBeGreaterThan(0);
      expect(Array.isArray(capabilities.supported)).toBe(true);
      for (const id of capabilities.supported) {
        expect(capabilities.details[id]).toBeDefined();
        expect(capabilities.details[id].supported).toBe(true);
      }
    });

    it("capability honesty: advertised standardized capabilities are implemented", async () => {
      const adapter = await factory.create();
      const capabilities = await adapter.describeCapabilities();
      for (const id of capabilities.supported) {
        const checker = CAPABILITY_EXTENSION_MAP[id as keyof typeof CAPABILITY_EXTENSION_MAP];
        if (checker) {
          expect(checker(adapter), `advertised "${id}" must be implemented`).toBe(true);
        }
        if (id === "nativeTodos") {
          expect(isTodosExtension(adapter)).toBe(true);
        }
      }
    });

    it("authenticate() resolves (no throw) for the basic flow", async () => {
      const adapter = await factory.create();
      const result = await withTimeout(
        adapter.authenticate({ runtimeId: adapter.runtimeId as never, workspaceRootPath: root }),
      );
      expect(["authenticated", "not-required", "challenge"]).toContain(result.status);
    });

    it("createSession() returns a native ref with the runtime id and non-empty session id", async () => {
      const adapter = await factory.create();
      const ref = await createSession(adapter, root);
      expect(ref.runtimeId).toBe(factory.runtimeId);
      expect(String(ref.nativeSessionId).length).toBeGreaterThan(0);
    });

    it("resumeSession() returns the (possibly refreshed) native ref", async () => {
      const { adapter, ref } = await setup();
      const resumed = await adapter.resumeSession({ native: ref, workspaceRootPath: root });
      expect(resumed.runtimeId).toBe(factory.runtimeId);
      expect(String(resumed.nativeSessionId).length).toBeGreaterThan(0);
    });

    it("send() emits turn.started first for the provided turn id", async () => {
      const { adapter, ref } = await setup();
      const id = turnId();
      const events = await drainTerminal(
        adapter.send({ turnId: id, native: ref, workspaceRootPath: root, prompt: factory.finishPrompt }),
      );
      expect(events.at(0)?.type).toBe("turn.started");
      expect((events.at(0) as { turnId?: SpecOpsTurnId }).turnId).toBe(id);
    });

    it("send() ends with exactly one terminal event", async () => {
      const { adapter, ref } = await setup();
      const events = await drainTerminal(
        adapter.send({ turnId: turnId(), native: ref, workspaceRootPath: root, prompt: factory.finishPrompt }),
      );
      const terminals = events.filter((event) => TERMINAL_KINDS.has(event.type));
      expect(terminals).toHaveLength(1);
    });

    it("sequence ids are strictly monotonic within a turn", async () => {
      const { adapter, ref } = await setup();
      const events = await drainTerminal(
        adapter.send({ turnId: turnId(), native: ref, workspaceRootPath: root, prompt: factory.finishPrompt }),
      );
      for (let i = 1; i < events.length; i += 1) {
        expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
      }
    });

    it("sequence ids stay monotonic across a second turn on the same session", async () => {
      const { adapter, ref } = await setup();
      const first = await drainTerminal(
        adapter.send({ turnId: turnId(), native: ref, workspaceRootPath: root, prompt: factory.finishPrompt }),
      );
      const second = await drainTerminal(
        adapter.send({ turnId: turnId(), native: ref, workspaceRootPath: root, prompt: factory.finishPrompt }),
      );
      expect(second.at(0)!.seq).toBeGreaterThan(first.at(-1)!.seq);
    });

    it("cancel() during a long turn ends the stream with turn.cancelled", async () => {
      const { adapter, ref } = await setup();
      const id = turnId();
      const stream = adapter.send({ turnId: id, native: ref, workspaceRootPath: root, prompt: factory.cancelPrompt });
      const iterator = stream[Symbol.asyncIterator]();

      const started = await withTimeout(iterator.next());
      expect((started.value as SessionEvent).type).toBe("turn.started");

      await adapter.cancel({ native: ref });

      const collected: SessionEvent[] = [started.value as SessionEvent];
      await withTimeout(
        (async () => {
          while (true) {
            const next = await iterator.next();
            if (next.done) break;
            collected.push(next.value);
            if (TERMINAL_KINDS.has(next.value.type)) break;
          }
        })(),
      );

      const terminal = collected.at(-1);
      expect(terminal?.type).toBe("turn.cancelled");
    });

    it("cancel() with no active turn is idempotent (no throw)", async () => {
      const { adapter, ref } = await setup();
      await expect(adapter.cancel({ native: ref })).resolves.toBeUndefined();
    });

    it("health() reports a status for the adapter runtime", async () => {
      const adapter = await factory.create();
      const health = await adapter.health();
      expect(health.runtimeId).toBe(factory.runtimeId);
      expect(["healthy", "degraded", "unavailable"]).toContain(health.status);
    });
  });
}
