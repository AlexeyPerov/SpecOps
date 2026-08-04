import { beforeEach, describe, expect, it } from "vitest";
import {
  appendConsoleLog,
  clearConsoleLogs,
  consoleLogs,
  resetConsoleForTests,
  setMinConsoleLevel,
} from "./appConsole";

/**
 * Wait for the rAF-coalesced console flush to land in the store. The ring
 * writes synchronously but subscriber notifications are batched per animation
 * frame (P03-08-28), so a test that appends and then reads must let a frame
 * elapse first.
 */
function flushFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function readConsoleMessages(): string[] {
  let messages: string[] = [];
  const unsubscribe = consoleLogs.subscribe((entries) => {
    messages = entries.map((entry) => entry.message);
  });
  unsubscribe();
  return messages;
}

function readLastConsoleText(): string {
  let text = "";
  const unsubscribe = consoleLogs.subscribe((entries) => {
    text = entries.at(-1)?.text ?? "";
  });
  unsubscribe();
  return text;
}

describe("appConsole", () => {
  beforeEach(() => {
    resetConsoleForTests();
    setMinConsoleLevel("debug");
  });

  it("appends formatted entries and caps the buffer", async () => {
    for (let index = 0; index < 1002; index += 1) {
      appendConsoleLog({
        level: "info",
        source: "frontend",
        timestamp: "2026-05-24T12:00:00.000Z",
        message: `entry-${index}`,
      });
    }
    await flushFrames();

    const latest = readConsoleMessages();

    expect(latest).toHaveLength(1000);
    expect(latest[0]).toBe("entry-2");
    expect(latest.at(-1)).toBe("entry-1001");
  });

  it("formats console lines with metadata", async () => {
    appendConsoleLog({
      level: "error",
      source: "frontend",
      timestamp: "2026-05-24T15:41:16.000Z",
      message: "refresh failed",
      metadata: { reason: "boom" },
    });
    await flushFrames();

    const line = readLastConsoleText();

    expect(line).toContain("error frontend refresh failed");
    expect(line).toContain('{"reason":"boom"}');
  });

  it("retains metadata as a capped serialized string, not the live object", async () => {
    const big = { payload: "x".repeat(10_000) };
    appendConsoleLog({
      level: "info",
      source: "frontend",
      timestamp: "2026-05-24T15:41:16.000Z",
      message: "verbose",
      metadata: big,
    });
    await flushFrames();

    let entry: { metadataText?: string } | undefined;
    const unsubscribe = consoleLogs.subscribe((entries) => {
      entry = entries.at(-1);
    });
    unsubscribe();

    // The live object reference is dropped; only a size-capped string survives.
    expect(entry?.metadataText?.length ?? 0).toBeLessThan(10_000);
    expect(entry?.metadataText ?? "").toContain("[truncated");
  });

  it("clears stored entries", async () => {
    appendConsoleLog({
      level: "debug",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "hello",
    });
    await flushFrames();

    clearConsoleLogs();
    // Clear pushes synchronously so a read right after reflects the empty ring.
    expect(readConsoleMessages()).toHaveLength(0);
  });
});
