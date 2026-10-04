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

import { StringDecoder } from "node:string_decoder";

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
  off?(event: string, listener: (...args: any[]) => void): unknown;
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
  const decoder = new StringDecoder("utf8");
  const capacity = 64;
  let waiter: { resolve: (r: IteratorResult<FramingReadResult>) => void; reject: (e: Error) => void } | null = null;
  let finished = false;
  let streamError: Error | null = null;
  let buffer = "";
  let discarding = false;
  const cleanup = (): void => {
    stream.off?.("data", onData);
    stream.off?.("end", onEnd);
    stream.off?.("error", onError);
  };
  const take = (): IteratorResult<FramingReadResult> => {
    const value = queue.shift();
    if (queue.length < capacity / 2 && !finished) stream.resume?.();
    return value ? { value, done: false } : { value: undefined, done: true };
  };
  const wake = (): void => {
    if (!waiter) return;
    const pending = waiter;
    waiter = null;
    if (streamError) pending.reject(streamError);
    else if (queue.length || finished) pending.resolve(take());
    else waiter = pending;
  };
  const onError = (error: Error): void => {
    streamError = error;
    finished = true;
    queue.length = 0;
    buffer = "";
    stream.pause?.();
    cleanup();
    wake();
  };
  const push = (result: FramingReadResult): void => {
    if (queue.length >= capacity) {
      onError(new FramingError("input queue capacity exceeded"));
      return;
    }
    queue.push(result);
    if (queue.length >= capacity / 2) stream.pause?.();
    wake();
  };
  const parse = (line: string): void => {
    if (!line) return;
    if (Buffer.byteLength(line, "utf8") > limit) {
      push({ ok: false, reason: "too-large", detail: "oversized line" });
    } else {
      try { push({ ok: true, value: JSON.parse(line) }); }
      catch { push({ ok: false, reason: "malformed-json", detail: "invalid JSON" }); }
    }
  };
  const onData = (chunk: Buffer | string): void => {
    if (finished) return;
    const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
    // Accumulate one line at a time, dropping the rest of oversized frames.
    for (const segment of text.split("\n").entries()) {
      const [index, part] = segment;
      if (index > 0) {
        if (!discarding) parse(buffer);
        buffer = "";
        discarding = false;
      }
      if (finished) return;
      if (!discarding) {
        if (Buffer.byteLength(buffer, "utf8") + Buffer.byteLength(part, "utf8") > limit) {
          push({ ok: false, reason: "too-large", detail: "oversized line" });
          buffer = "";
          discarding = true;
        } else buffer += part;
      }
    }
  };
  const onEnd = (): void => {
    if (finished) return;
    buffer += decoder.end();
    if (!discarding) parse(buffer);
    buffer = "";
    finished = true;
    cleanup();
    wake();
  };
  stream.on("data", onData);
  stream.on("end", onEnd);
  stream.on("error", onError);
  return {
    [Symbol.asyncIterator](): AsyncIterator<FramingReadResult> {
      return {
        next() {
          if (streamError) return Promise.reject(streamError);
          if (queue.length || finished) return Promise.resolve(take());
          return new Promise((resolve, reject) => { waiter = { resolve, reject }; });
        },
        return() {
          finished = true;
          queue.length = 0;
          buffer = "";
          cleanup();
          wake();
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
