import { beforeEach, describe, expect, it, vi } from "vitest";
import { elapsedMs, logPerfTiming, measureAsync, nowMs, PERF_DIAGNOSTIC_KIND } from "./perfDiagnostics";
import { logDiagnostic } from "./logging";

vi.mock("./logging", () => ({
  logDiagnostic: vi.fn(async () => {}),
}));

const logDiagnosticMock = vi.mocked(logDiagnostic);

describe("perfDiagnostics", () => {
  beforeEach(() => {
    logDiagnosticMock.mockReset();
  });

  it("nowMs and elapsedMs return finite non-negative numbers", () => {
    const started = nowMs();
    expect(Number.isFinite(started)).toBe(true);
    expect(elapsedMs(started)).toBeGreaterThanOrEqual(0);
  });

  it("logPerfTiming emits kind=perf metadata", async () => {
    await logPerfTiming("test metric", {
      metric: "startup.total",
      durationMs: 12.5,
      label: "unit",
    });

    expect(logDiagnosticMock).toHaveBeenCalledTimes(1);
    const event = logDiagnosticMock.mock.calls[0]![0];
    expect(event.message).toBe("test metric");
    expect(event.level).toBe("info");
    expect(event.metadata).toMatchObject({
      kind: PERF_DIAGNOSTIC_KIND,
      metric: "startup.total",
      durationMs: 12.5,
      label: "unit",
    });
  });

  it("measureAsync logs duration and returns the action result", async () => {
    const result = await measureAsync(
      "workspace session load",
      "workspace.sessionLoad",
      async () => 42,
      { sessionCount: 3, label: "hydrate" },
    );

    expect(result).toBe(42);
    expect(logDiagnosticMock).toHaveBeenCalledTimes(1);
    const event = logDiagnosticMock.mock.calls[0]![0];
    expect(event.message).toBe("workspace session load");
    expect(event.metadata).toMatchObject({
      kind: PERF_DIAGNOSTIC_KIND,
      metric: "workspace.sessionLoad",
      label: "hydrate",
      sessionCount: 3,
    });
    expect(typeof event.metadata?.durationMs).toBe("number");
  });

  it("measureAsync rethrows after logging failures", async () => {
    await expect(
      measureAsync("boom", "tab.activationSideEffects", async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");

    expect(logDiagnosticMock).toHaveBeenCalledTimes(1);
    const event = logDiagnosticMock.mock.calls[0]![0];
    expect(event.message).toBe("boom (failed)");
    expect(event.metadata).toMatchObject({
      kind: PERF_DIAGNOSTIC_KIND,
      metric: "tab.activationSideEffects",
      error: "nope",
    });
  });

  it("measureAsync swallows errors when requested", async () => {
    const result = await measureAsync(
      "soft fail",
      "startup.phase",
      async () => {
        throw new Error("ignored");
      },
      { swallow: true, label: "load-settings" },
    );

    expect(result).toBeUndefined();
    expect(logDiagnosticMock).toHaveBeenCalledTimes(1);
  });
});
