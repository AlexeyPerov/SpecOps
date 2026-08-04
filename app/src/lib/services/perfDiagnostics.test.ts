import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPerfSamples,
  elapsedMs,
  getPerfSamples,
  isPerfCollectionEnabled,
  logPerfTiming,
  measureAsync,
  nowMs,
  PERF_DIAGNOSTIC_KIND,
  serializePerfReport,
  serializePerfReportMarkdown,
  setPerfCollectionEnabled,
} from "./perfDiagnostics";
import { logDiagnostic } from "./logging";

vi.mock("./logging", () => ({
  logDiagnostic: vi.fn(async () => {}),
}));

const logDiagnosticMock = vi.mocked(logDiagnostic);

describe("perfDiagnostics", () => {
  beforeEach(() => {
    logDiagnosticMock.mockReset();
    setPerfCollectionEnabled(false);
    clearPerfSamples();
  });

  afterEach(() => {
    setPerfCollectionEnabled(false);
    clearPerfSamples();
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

  describe("perf sample ring (P03-08-T2)", () => {
    it("does not capture samples when collection is disabled", async () => {
      expect(isPerfCollectionEnabled()).toBe(false);
      await logPerfTiming("ignored", { metric: "startup.total", durationMs: 1 });
      expect(getPerfSamples()).toHaveLength(0);
    });

    it("captures samples when collection is enabled, including debug-level", async () => {
      setPerfCollectionEnabled(true);
      await logPerfTiming("a", { metric: "startup.total", durationMs: 10 }, "info");
      await logPerfTiming("b", { metric: "startup.total", durationMs: 20 }, "debug");
      await logPerfTiming("c", { metric: "workspace.switchRestore", durationMs: 5 });

      const samples = getPerfSamples();
      expect(samples).toHaveLength(3);
      expect(samples.map((s) => s.message)).toEqual(["a", "b", "c"]);
      // Same run id across all samples.
      const runId = samples[0]!.runId;
      expect(samples.every((s) => s.runId === runId)).toBe(true);
    });

    it("serializePerfReport aggregates min/p50/p95/max per metric", async () => {
      setPerfCollectionEnabled(true);
      for (const d of [10, 20, 30, 40, 100]) {
        await logPerfTiming("m", { metric: "startup.phase", durationMs: d });
      }
      const report = serializePerfReport({ appVersion: "9.9.9" });
      expect(report.appVersion).toBe("9.9.9");
      expect(report.samples).toHaveLength(5);
      const agg = report.aggregates.find((a) => a.metric === "startup.phase");
      expect(agg).toBeDefined();
      expect(agg!.count).toBe(5);
      expect(agg!.min).toBe(10);
      expect(agg!.max).toBe(100);
      expect(agg!.p50).toBeGreaterThanOrEqual(20);
      expect(agg!.p95).toBeGreaterThanOrEqual(agg!.p50);
    });

    it("serializePerfReportMarkdown renders a table header and rows", async () => {
      setPerfCollectionEnabled(true);
      await logPerfTiming("m", { metric: "tab.activationSideEffects", durationMs: 7 });
      const md = serializePerfReportMarkdown();
      expect(md).toContain("SpecOps performance report");
      expect(md).toContain("| metric |");
      expect(md).toContain("tab.activationSideEffects");
    });

    it("disabling collection clears the ring", async () => {
      setPerfCollectionEnabled(true);
      await logPerfTiming("m", { metric: "startup.total", durationMs: 1 });
      expect(getPerfSamples()).toHaveLength(1);
      setPerfCollectionEnabled(false);
      expect(getPerfSamples()).toHaveLength(0);
    });
  });
});

