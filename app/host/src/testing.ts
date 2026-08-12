/**
 * In-memory stream helpers for host unit tests.
 *
 * The dispatcher and framing are exercised against these instead of real stdio;
 * the process suite (`process.test.ts`) covers the real stdio path.
 */

import type { HostWritable } from "./dispatch";

/** A synchronous, capturing writable that never applies backpressure. */
export class FakeStdout implements HostWritable {
  readonly lines: string[] = [];

  write(chunk: string | Buffer, callback?: (error?: Error | null) => void): boolean {
    this.lines.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    callback?.();
    return true;
  }

  once(_event: "drain", _listener: () => void): void {
    // No backpressure is ever applied, so drain listeners are unused.
  }

  off(_event: "drain", _listener: () => void): void {
    // No-op.
  }

  /** Parsed JSON messages that were written, in order. */
  get messages(): unknown[] {
    return this.lines.flatMap((line) =>
      line
        .split("\n")
        .filter((entry) => entry.length > 0)
        .map((entry) => JSON.parse(entry)),
    );
  }
}

/** A writable that applies backpressure until {@link drain} is called. */
export class BackpressureStdout implements HostWritable {
  readonly lines: string[] = [];
  private blocked = false;
  private readonly drainListeners: Array<() => void> = [];

  setBlocked(blocked: boolean): void {
    this.blocked = blocked;
  }

  drain(): void {
    const listeners = this.drainListeners.splice(0);
    for (const listener of listeners) listener();
  }

  write(chunk: string | Buffer, callback?: (error?: Error | null) => void): boolean {
    this.lines.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    callback?.();
    return !this.blocked;
  }

  once(_event: "drain", listener: () => void): void {
    this.drainListeners.push(listener);
  }

  off(_event: "drain", listener: () => void): void {
    const index = this.drainListeners.indexOf(listener);
    if (index >= 0) this.drainListeners.splice(index, 1);
  }
}

/** A minimal stderr capture. */
export class FakeStderr {
  readonly lines: string[] = [];
  write(line: string): void {
    this.lines.push(line);
  }
}
