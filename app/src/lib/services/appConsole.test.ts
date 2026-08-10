import { beforeEach, describe, expect, it } from "vitest";
import {
  appendConsoleLog,
  clearConsoleLogs,
  consoleLevelRank,
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

  it("exposes a level rank for the display filter (higher = more severe)", () => {
    expect(consoleLevelRank("debug")).toBeLessThan(consoleLevelRank("info"));
    expect(consoleLevelRank("info")).toBeLessThan(consoleLevelRank("warn"));
    expect(consoleLevelRank("warn")).toBeLessThan(consoleLevelRank("error"));
  });

  it("retains all retained entries in the ring regardless of the display filter", async () => {
    // The display filter (applied in ConsoleLogsPanel) hides entries below the
    // chosen level without removing them from the ring. The store snapshot must
    // still carry every retained entry so the filter can reveal them again when
    // the level is lowered. This test pins that contract: after appending a mix
    // of levels, the store holds all of them and a client-side rank filter is
    // what narrows the visible set.
    appendConsoleLog({ level: "debug", source: "frontend", timestamp: new Date().toISOString(), message: "d" });
    appendConsoleLog({ level: "info", source: "frontend", timestamp: new Date().toISOString(), message: "i" });
    appendConsoleLog({ level: "warn", source: "frontend", timestamp: new Date().toISOString(), message: "w" });
    await flushFrames();

    let entries: { level: string; message: string }[] = [];
    const unsubscribe = consoleLogs.subscribe((value) => {
      entries = value.map((entry) => ({ level: entry.level, message: entry.message }));
    });
    unsubscribe();

    // The ring retains all three; the display filter narrows client-side.
    expect(entries.map((entry) => entry.message)).toEqual(["d", "i", "w"]);

    // A "warn" display filter hides debug+info but they remain in the ring.
    const warnRank = consoleLevelRank("warn");
    const visibleAtWarn = entries.filter((entry) => consoleLevelRank(entry.level as never) >= warnRank);
    expect(visibleAtWarn.map((entry) => entry.message)).toEqual(["w"]);

    // Lowering to "debug" reveals them again — same ring, different filter.
    const debugRank = consoleLevelRank("debug");
    const visibleAtDebug = entries.filter((entry) => consoleLevelRank(entry.level as never) >= debugRank);
    expect(visibleAtDebug.map((entry) => entry.message)).toEqual(["d", "i", "w"]);
  });
});
