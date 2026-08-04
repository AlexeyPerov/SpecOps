import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pluginLog = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-log", () => pluginLog);

import {
  logDiagnostic,
  resetPluginMinLevelForTests,
  setPluginMinLevelForTests,
} from "./logging";
import { resetConsoleForTests, setMinConsoleLevel } from "./appConsole";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("logging", () => {
  beforeEach(() => {
    pluginLog.debug.mockClear();
    pluginLog.info.mockClear();
    pluginLog.warn.mockClear();
    pluginLog.error.mockClear();
    pluginLog.trace.mockClear();
    resetConsoleForTests();
    setMinConsoleLevel("debug");
    resetPluginMinLevelForTests();
  });

  afterEach(() => {
    resetPluginMinLevelForTests();
  });

  it("forwards info/warn/error to the plugin (stringified once)", async () => {
    await logDiagnostic({
      level: "info",
      source: "frontend",
      message: "hello",
      timestamp: "2026-08-04T00:00:00.000Z",
      metadata: { a: 1 },
    });
    await logDiagnostic({
      level: "warn",
      source: "frontend",
      message: "careful",
      timestamp: "2026-08-04T00:00:00.000Z",
    });
    await logDiagnostic({
      level: "error",
      source: "frontend",
      message: "boom",
      timestamp: "2026-08-04T00:00:00.000Z",
    });
    await flush();

    expect(pluginLog.info).toHaveBeenCalledTimes(1);
    expect(pluginLog.warn).toHaveBeenCalledTimes(1);
    expect(pluginLog.error).toHaveBeenCalledTimes(1);
    const payload = pluginLog.info.mock.calls[0][0] as string;
    expect(() => JSON.parse(payload)).not.toThrow();
    expect(JSON.parse(payload).message).toBe("hello");
  });

  it("drops debug/trace before stringify + IPC (matches the Rust Info cutoff)", async () => {
    await logDiagnostic({
      level: "debug",
      source: "frontend",
      message: "noisy",
      timestamp: "2026-08-04T00:00:00.000Z",
      metadata: { huge: "x".repeat(100_000) },
    });
    await flush();

    // Never reaches the plugin, so no stringify happens at all.
    expect(pluginLog.debug).not.toHaveBeenCalled();
    expect(pluginLog.trace).not.toHaveBeenCalled();
    expect(pluginLog.info).not.toHaveBeenCalled();
  });

  it("still appends dropped levels to the in-app console", async () => {
    await logDiagnostic({
      level: "debug",
      source: "frontend",
      message: "console-only",
      timestamp: "2026-08-04T00:00:00.000Z",
    });
    // The console ring receives it even though the plugin path was skipped.
    // The ring writes synchronously but subscriber notifies are rAF-coalesced,
    // so let a frame elapse before reading.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    let messages: string[] = [];
    const { consoleLogs } = await import("./appConsole");
    const unsubscribe = consoleLogs.subscribe((entries) => {
      messages = entries.map((entry) => entry.message);
    });
    unsubscribe();
    expect(messages).toContain("console-only");
  });

  it("honors a lowered cutoff (debug forwarding opt-in)", async () => {
    setPluginMinLevelForTests(0);
    await logDiagnostic({
      level: "debug",
      source: "frontend",
      message: "now-forwarded",
      timestamp: "2026-08-04T00:00:00.000Z",
    });
    await flush();
    expect(pluginLog.debug).toHaveBeenCalledTimes(1);
  });
});
