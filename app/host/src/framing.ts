/**
 * Newline-delimited JSON framing over a byte stream (phase D, task AS01-D-03).
 *
 * Each protocol message is one JSON object terminated by `\n`. The writer
 * enforces the max-message limit and never splits a message across lines (JSON
 * serialization emits no literal newlines). The reader reassembles messages
 * that span chunks and rejects oversized or malformed lines explicitly rather
 * than crashing.
 *
 * stderr is deliberately never parsed as protocol — the dispatcher logs there
 * (redacted) and treats it as a separate diagnostic channel.
 */

import { MAX_MESSAGE_BYTES } from "./protocol";

export interface FramingOptions {
  readonly maxMessageBytes?: number;
}

export class FramingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FramingError";
  }
}

export type FramingReadResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: "too-large" | "malformed-json"; readonly detail: string };

export interface StreamLike {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  pause?(): unknown;
  resume?(): unknown;
}

/**
 * Yield one result per framed line. Honours {@link maxMessageBytes} both per
 * line and as a buffer high-water mark (a line that grows past the limit without
 * a newline is rejected and its accumulator reset, so memory cannot grow without
 * bound on a hostile/buggy peer).
 *
 * Listeners are attached **eagerly** (when `readMessages` is called), so data
 * the peer writes before the consumer starts iterating is not lost.
 */
export function readMessages(stream: StreamLike, options: FramingOptions = {}): AsyncIterable<FramingReadResult> {
  const limit = options.maxMessageBytes ?? MAX_MESSAGE_BYTES;
  const queue: FramingReadResult[] = [];
  let resolveWaiter: ((result: IteratorResult<FramingReadResult>) => void) | null = null;
  let finished = false;
  let streamError: Error | null = null;
  let buffer = "";

  const wake = (): void => {
    if (!resolveWaiter) return;
    const resolve = resolveWaiter;
    resolveWaiter = null;
    if (queue.length > 0) {
      resolve({ value: queue.shift()!, done: false });
    } else if (streamError) {
      resolve({ value: undefined, done: true });
    } else {
      resolve({ value: undefined, done: true });
    }
  };

  const push = (result: FramingReadResult): void => {
    queue.push(result);
    wake();
  };

  stream.on("data", (chunk: Buffer | string) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length === 0) continue;
      if (Buffer.byteLength(line, "utf8") > limit) {
        push({ ok: false, reason: "too-large", detail: `${line.length} bytes` });
        continue;
      }
      try {
        push({ ok: true, value: JSON.parse(line) });
      } catch {
        push({ ok: false, reason: "malformed-json", detail: line.slice(0, 120) });
      }
    }
    // High-water guard: a single line accumulating past the limit without `\n`.
    if (Buffer.byteLength(buffer, "utf8") > limit) {
      push({ ok: false, reason: "too-large", detail: "unterminated oversized line" });
      buffer = "";
    }
  });
  stream.on("end", () => {
    finished = true;
    if (buffer.length > 0) {
      const tail = buffer;
      buffer = "";
      if (Buffer.byteLength(tail, "utf8") > limit) {
        push({ ok: false, reason: "too-large", detail: "trailing oversized line" });
      } else {
        try {
          push({ ok: true, value: JSON.parse(tail) });
        } catch {
          push({ ok: false, reason: "malformed-json", detail: tail.slice(0, 120) });
        }
      }
    }
    wake();
  });
  stream.on("error", (error: Error) => {
    streamError = error;
    finished = true;
    wake();
  });

  return {
    [Symbol.asyncIterator](): AsyncIterator<FramingReadResult> {
      return {
        next(): Promise<IteratorResult<FramingReadResult>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (finished) {
            if (streamError) return Promise.reject(streamError);
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise<IteratorResult<FramingReadResult>>((resolve) => {
            resolveWaiter = resolve;
          });
        },
        return(): Promise<IteratorResult<FramingReadResult>> {
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

export interface WritableLike {
  write(chunk: string | Buffer): boolean;
  write(chunk: string | Buffer, callback: (error?: Error | null) => void): boolean;
}

/**
 * Serialize and write a message followed by `\n`. Throws {@link FramingError} if
 * the serialized form exceeds the limit, so oversized diagnostics never reach
 * the wire.
 */
export function writeMessage(stream: WritableLike, message: unknown, options: FramingOptions = {}): void {
  const limit = options.maxMessageBytes ?? MAX_MESSAGE_BYTES;
  const json = JSON.stringify(message);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > limit) {
    throw new FramingError(`message of ${bytes} bytes exceeds limit ${limit}`);
  }
  stream.write(json + "\n");
}
