import { beforeEach, describe, expect, it } from "vitest";
import {
  appendConsoleLog,
  clearConsoleLogs,
  consoleLogs,
  resetConsoleForTests,
} from "./appConsole";

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
  });

  it("appends formatted entries and caps the buffer", () => {
    for (let index = 0; index < 1002; index += 1) {
      appendConsoleLog({
        level: "info",
        source: "frontend",
        timestamp: "2026-05-24T12:00:00.000Z",
        message: `entry-${index}`,
      });
    }

    const latest = readConsoleMessages();

    expect(latest).toHaveLength(1000);
    expect(latest[0]).toBe("entry-2");
    expect(latest.at(-1)).toBe("entry-1001");
  });

  it("formats console lines with metadata", () => {
    appendConsoleLog({
      level: "error",
      source: "frontend",
      timestamp: "2026-05-24T15:41:16.000Z",
      message: "refresh failed",
      metadata: { reason: "boom" },
    });

    const line = readLastConsoleText();

    expect(line).toContain("error frontend refresh failed");
    expect(line).toContain('{"reason":"boom"}');
  });

  it("clears stored entries", () => {
    appendConsoleLog({
      level: "debug",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "hello",
    });

    clearConsoleLogs();

    expect(readConsoleMessages()).toHaveLength(0);
  });
});
