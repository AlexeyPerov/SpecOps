/**
 * Agent Host wiring (phase D, task AS01-D-01).
 *
 * `createHost` connects a registry (the fake adapter by default), the
 * dispatcher, and newline framing over stdio, and runs the message loop with
 * signal handling. `createDefaultRegistry` is the only place adapters are
 * registered; phase 02–05 add real runtimes here.
 */

import { AdapterRegistry } from "./registry";
import { HostDispatcher, type HostWritable } from "./dispatch";
import { readMessages } from "./framing";
import { buildInfo } from "./version";
import { redactForLogs } from "./redact";
import { createFakeRuntimeAdapter } from "../../src/lib/session/adapter/fake";
import type { AgentRuntimeAdapter } from "../../src/lib/session/adapter";

export interface HostStreams {
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
}

export interface CreateHostOptions extends Partial<HostStreams> {
  /** Adapter registry; defaults to {@link createDefaultRegistry}. */
  readonly registry?: AdapterRegistry;
  /** Extra adapters registered on the default registry (ignored if registry given). */
  readonly extraAdapters?: readonly AgentRuntimeAdapter[];
  readonly maxConcurrentTurns?: number;
}

/**
 * Build the default registry with the deterministic fake adapter registered.
 * The fake recognizes a couple of well-known dev prompts so the host can be
 * exercised end-to-end (and supervised in phase E) without a vendor runtime:
 * - `ping` → a normal finishing turn (emits `pong`);
 * - `long-running` → a turn that hangs until cancelled (used for
 *   cancel/supervision tests).
 * Any other prompt falls back to the fake's minimal finishing turn.
 */
export function createDefaultRegistry(extra: readonly AgentRuntimeAdapter[] = []): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(
    createFakeRuntimeAdapter({
      turns: {
        ping: { events: [{ kind: "text", text: "pong" }], outcome: { outcome: "finish" } },
        "long-running": { events: [{ kind: "status", status: "running" }], outcome: { outcome: "hang" } },
      },
    }),
  );
  for (const adapter of extra) {
    registry.register(adapter);
  }
  return registry;
}

export interface Host {
  readonly dispatcher: HostDispatcher;
  readonly registry: AdapterRegistry;
  /** Run the stdio loop. Resolves with the process exit code. */
  run(): Promise<number>;
}

export function createHost(options: CreateHostOptions = {}): Host {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  const registry = options.registry ?? createDefaultRegistry(options.extraAdapters);

  const stderrLogger = {
    write(line: string): void {
      stderr.write(redactForLogs(line) as string);
    },
  };

  const dispatcher = new HostDispatcher({
    registry,
    stdout: stdout as unknown as HostWritable,
    stderr: stderrLogger,
    buildInfo: buildInfo(),
    ...(options.maxConcurrentTurns !== undefined ? { maxConcurrentTurns: options.maxConcurrentTurns } : {}),
  });

  const log = (line: string): void => stderrLogger.write(`${line}\n`);

  let stopping = false;
  const stop = async (reason: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await dispatcher.gracefulShutdown(reason);
  };

  const run = async (): Promise<number> => {
    // Signal-driven shutdown (only when running against the real process).
    if (options.stdin === undefined && typeof process !== "undefined" && typeof process.on === "function") {
      const onSignal = (signal: string): void => {
        void stop(signal).finally(() => process.exit(0));
      };
      process.on("SIGTERM", () => onSignal("SIGTERM"));
      process.on("SIGINT", () => onSignal("SIGINT"));
    }

    try {
      for await (const result of readMessages(stdin)) {
        if (!result.ok) {
          log(`framing ${result.reason}: ${result.detail}`);
          continue;
        }
        try {
          await dispatcher.handle(result.value);
        } catch (error) {
          log(`dispatch error: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (dispatcher.shouldExit) {
          break;
        }
      }
      await stop("stdin closed");
    } catch (error) {
      log(`host loop error: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    return 0;
  };

  return { dispatcher, registry, run };
}
