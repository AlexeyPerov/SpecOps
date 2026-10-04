import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { readMessages, writeMessage, FramingError } from "./framing";
import { MAX_MESSAGE_BYTES } from "./protocol";
import { buildOversizedLine, PROTOCOL_FIXTURES, VALID_INITIALIZE } from "./fixtures";

/** Minimal readable stream stub that emits data/end/error on demand. */
class FakeReadable extends EventEmitter {
  push(chunk: string): void {
    this.emit("data", chunk);
  }
  end(): void {
    this.emit("end");
  }
  error(error: Error): void {
    this.emit("error", error);
  }
}

async function drain(reader: AsyncIterable<{ ok: boolean }>): Promise<{ ok: boolean; reason?: string; value?: unknown }[]> {
  const out: { ok: boolean; reason?: string; value?: unknown }[] = [];
  for await (const entry of reader) {
    out.push(entry as { ok: boolean; reason?: string; value?: unknown });
  }
  return out;
}

describe("framing read", () => {
  it("parses one message per line", async () => {
    const stream = new FakeReadable();
    const reader = readMessages(stream);
    stream.push(`${VALID_INITIALIZE}\n`);
    stream.end();
    const results = await drain(reader);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect((results[0].value as { method: string }).method).toBe("initialize");
  });

  it("handles multiple messages per chunk and messages split across chunks", async () => {
    const stream = new FakeReadable();
    const reader = readMessages(stream);
    const a = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "a" });
    const b = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "b" });
    stream.push(`${a}\n${b}\n`);
    // a message split across two chunks
    const c = JSON.stringify({ jsonrpc: "2.0", id: 3, method: "c" });
    stream.push(`${c.slice(0, 10)}`);
    stream.push(`${c.slice(10)}\n`);
    stream.end();
    const results = await drain(reader);
    expect(results.filter((r) => r.ok)).toHaveLength(3);
  });

  it("rejects malformed JSON lines without crashing", async () => {
    const stream = new FakeReadable();
    const reader = readMessages(stream);
    const malformed = PROTOCOL_FIXTURES.find((f) => f.name === "malformed-broken-json")!;
    stream.push(`${malformed.line}\n`);
    stream.push(`${VALID_INITIALIZE}\n`);
    stream.end();
    const results = await drain(reader);
    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(false);
    expect(results[0].reason).toBe("malformed-json");
    expect(results[1].ok).toBe(true);
  });

  it("rejects oversized lines", async () => {
    const stream = new FakeReadable();
    const reader = readMessages(stream, { maxMessageBytes: MAX_MESSAGE_BYTES });
    stream.push(`${buildOversizedLine()}\n`);
    stream.end();
    const results = await drain(reader);
    expect(results[0].ok).toBe(false);
    expect(results[0].reason).toBe("too-large");
  });

  it("resets an unterminated oversized line so memory cannot grow unbounded", async () => {
    const stream = new FakeReadable();
    const reader = readMessages(stream, { maxMessageBytes: 256 });
    stream.push(`${"x".repeat(300)}`); // no newline yet, exceeds limit
    stream.push(`\n${VALID_INITIALIZE}\n`);
    stream.end();
    const results = await drain(reader);
    expect(results[0].ok).toBe(false);
    expect(results[0].reason).toBe("too-large");
    expect(results.some((r) => r.ok)).toBe(true);
  });

  it("flushes a trailing line without a newline at end", async () => {
    const stream = new FakeReadable();
    const reader = readMessages(stream);
    stream.push(VALID_INITIALIZE); // no trailing newline
    stream.end();
    const results = await drain(reader);
    expect(results[0].ok).toBe(true);
  });

  it("propagates stream errors", async () => {
    const stream = new FakeReadable();
    const reader = readMessages(stream);
    stream.push(`${VALID_INITIALIZE}\n`);
    stream.error(new Error("pipe broke"));
    await expect(drain(reader)).rejects.toThrow("pipe broke");
  });
});

describe("framing write", () => {
  it("writes a newline-terminated JSON message", () => {
    const written: string[] = [];
    const writable = { write: (chunk: string) => Boolean(written.push(chunk)) };
    writeMessage(writable, { jsonrpc: "2.0", method: "x" });
    expect(written[0].endsWith("\n")).toBe(true);
    expect(JSON.parse(written[0]).method).toBe("x");
  });

  it("throws when the serialized message exceeds the limit", () => {
    const writable = { write: () => true };
    expect(() => writeMessage(writable, { pad: "x".repeat(MAX_MESSAGE_BYTES + 10) }, { maxMessageBytes: MAX_MESSAGE_BYTES })).toThrow(
      FramingError,
    );
  });
});

describe("stabilized framing", () => {
  it("round-trips Cyrillic and emoji split at every UTF-8 byte", async () => {
    const source = new FakeReadable();
    const reader = readMessages(source);
    const bytes = Buffer.from(JSON.stringify({ text: "Привет 👋" }) + "\n");
    for (const byte of bytes) source.emit("data", Buffer.from([byte]));
    source.end();
    expect(await drain(reader)).toEqual([{ ok: true, value: { text: "Привет 👋" } }]);
    expect(source.listenerCount("data")).toBe(0);
  });
  it("rejects a pending read on stream error", async () => {
    const source = new FakeReadable();
    const iterator = readMessages(source)[Symbol.asyncIterator]();
    const pending = iterator.next();
    source.error(new Error("read failed"));
    await expect(pending).rejects.toThrow("read failed");
  });
  it("bounds flooding peers and discards oversized remainders", async () => {
    const source = new FakeReadable();
    const reader = readMessages(source, { maxMessageBytes: 8 });
    source.push("123456789");
    source.push('12345\n{}\n');
    source.end();
    expect(await drain(reader)).toEqual([{ ok: false, reason: "too-large", detail: "oversized line" }, { ok: true, value: {} }]);
    const flood = new FakeReadable();
    const pending = readMessages(flood);
    flood.push('{}\n'.repeat(1000));
    await expect(drain(pending)).rejects.toThrow("capacity");
  });
});
