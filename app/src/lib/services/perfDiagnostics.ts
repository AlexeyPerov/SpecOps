/**
 * Lightweight performance timing helpers for startup / workspace / tab paths.
 *
 * Emits structured diagnostics (`metadata.kind === "perf"`) so Console and
 * plugin logs can be filtered for baseline and before/after comparisons.
 *
 * P03-08-T2: when collection is enabled (`setPerfCollectionEnabled(true)`),
 * every sample is also captured into a bounded in-memory ring *before* the
 * log hop, so a downloadable report can be produced even for debug-level
 * samples that the Rust log plugin discards. The ring is allocated lazily on
 * first enable and cleared on disable, so the off path is allocation-free.
 */

import { logDiagnostic } from "./logging";

export const PERF_DIAGNOSTIC_KIND = "perf" as const;

export type PerfMetric =
  | "startup.total"
  | "startup.phase"
  | "workspace.sessionLoad"
  | "workspace.restore"
  | "workspace.switchRestore"
  | "projectTree.rootLoad"
  | "tab.activationSideEffects"
  | "workspaceCatalog.build"
  | "workspaceCatalog.rebuild"
  | "workspaceCatalog.rank";

export interface PerfTimingMetadata {
  metric: PerfMetric;
  durationMs: number;
  /** Optional phase / operation label (e.g. startup phase name). */
  label?: string;
  [key: string]: unknown;
}

export interface PerfSample {
  /** Per-run id (stable for the whole app session). */
  runId: string;
  /** Monotonic timestamp (ms since epoch). */
  ts: number;
  /** Diagnostic level the sample was emitted at. */
  level: "info" | "debug";
  message: string;
  metadata: PerfTimingMetadata;
}

/** Bounded ring of the most recent perf samples. */
const PERF_RING_CAPACITY = 2_000;
const ring: PerfSample[] = [];
let ringHead = 0;
let ringCount = 0;

let collectionEnabled = false;
/** Stable id for the current run, lazily minted on first capture. */
let runId = "";

export function setPerfCollectionEnabled(enabled: boolean): void {
  collectionEnabled = enabled;
  if (!enabled) {
    ring.length = 0;
    ringHead = 0;
    ringCount = 0;
  }
}

export function isPerfCollectionEnabled(): boolean {
  return collectionEnabled;
}

/** Mints (once) and returns a stable per-run id. */
function ensureRunId(): string {
  if (!runId) {
    runId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return runId;
}

/** Current perf samples in oldest→newest order (copy). */
export function getPerfSamples(): PerfSample[] {
  if (ringCount === 0) {
    return [];
  }
  const out: PerfSample[] = new Array(ringCount);
  for (let i = 0; i < ringCount; i += 1) {
    out[i] = ring[(ringHead + i) % PERF_RING_CAPACITY];
  }
  return out;
}

/** Clear the ring without disabling collection (e.g. starting a fresh run). */
export function clearPerfSamples(): void {
  ring.length = 0;
  ringHead = 0;
  ringCount = 0;
}

function captureSample(
  message: string,
  metadata: PerfTimingMetadata,
  level: "info" | "debug",
): void {
  if (!collectionEnabled) {
    return;
  }
  const sample: PerfSample = {
    runId: ensureRunId(),
    ts: Date.now(),
    level,
    message,
    metadata,
  };
  if (ringCount < PERF_RING_CAPACITY) {
    ring[ringCount] = sample;
    ringCount += 1;
  } else {
    ring[ringHead] = sample;
    ringHead = (ringHead + 1) % PERF_RING_CAPACITY;
  }
}

export function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function elapsedMs(startedAt: number): number {
  return Math.round((nowMs() - startedAt) * 1000) / 1000;
}

export async function logPerfTiming(
  message: string,
  metadata: PerfTimingMetadata,
  level: "info" | "debug" = "info",
): Promise<void> {
  // Capture before the log hop so the ring has the sample even when the Rust
  // plugin (or the JS console) discards a debug-level line.
  captureSample(message, metadata, level);
  await logDiagnostic({
    level,
    source: "frontend",
    timestamp: new Date().toISOString(),
    message,
    metadata: {
      kind: PERF_DIAGNOSTIC_KIND,
      ...metadata,
    },
  });
}

/**
 * Time an async operation and emit a perf diagnostic. Re-throws on failure
 * after logging duration + error (unless `swallow` is true).
 */
export async function measureAsync<T>(
  message: string,
  metric: PerfMetric,
  action: () => Promise<T>,
  extras?: Record<string, unknown> & { label?: string; swallow?: boolean },
): Promise<T | undefined> {
  const startedAt = nowMs();
  const { swallow, label, ...rest } = extras ?? {};
  try {
    const result = await action();
    await logPerfTiming(message, {
      metric,
      durationMs: elapsedMs(startedAt),
      ...(label !== undefined ? { label } : {}),
      ...rest,
    });
    return result;
  } catch (error: unknown) {
    await logPerfTiming(
      `${message} (failed)`,
      {
        metric,
        durationMs: elapsedMs(startedAt),
        ...(label !== undefined ? { label } : {}),
        ...rest,
        error: error instanceof Error ? error.message : String(error),
      },
      "info",
    );
    if (swallow) {
      return undefined;
    }
    throw error;
  }
}

interface MetricAggregate {
  metric: string;
  count: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function aggregateByMetric(samples: readonly PerfSample[]): MetricAggregate[] {
  const byMetric = new Map<string, number[]>();
  for (const sample of samples) {
    const durations = byMetric.get(sample.metadata.metric) ?? [];
    if (typeof sample.metadata.durationMs === "number") {
      durations.push(sample.metadata.durationMs);
    }
    byMetric.set(sample.metadata.metric, durations);
  }
  const aggregates: MetricAggregate[] = [];
  for (const [metric, durations] of byMetric) {
    if (durations.length === 0) {
      continue;
    }
    const sorted = [...durations].sort((a, b) => a - b);
    aggregates.push({
      metric,
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
    });
  }
  return aggregates.sort((a, b) => a.metric.localeCompare(b.metric));
}

/**
 * Snapshot of settings that influence the perf-relevant paths, so a downloaded
 * report is interpretable without the user re-recording their config. Kept
 * coarse (strings/numbers/booleans) so the JSON stays small and stable.
 */
export type PerfReportSettingsSnapshot = Record<string, unknown>;

export interface PerfReportContext {
  /** App version (best-effort; "unknown" if unavailable). */
  appVersion?: string;
  /** Relevant settings snapshot supplied by the caller. */
  settings?: PerfReportSettingsSnapshot;
}

/**
 * Build a downloadable perf report from the in-memory ring: per-metric
 * aggregates plus the raw samples, run id, and (optional) app version +
 * settings snapshot. JSON-serializable.
 */
export function serializePerfReport(context: PerfReportContext = {}): {
  generatedAt: string;
  runId: string;
  appVersion: string;
  settings: PerfReportSettingsSnapshot;
  aggregates: MetricAggregate[];
  samples: PerfSample[];
} {
  const samples = getPerfSamples();
  return {
    generatedAt: new Date().toISOString(),
    runId: samples.at(0)?.runId ?? runId,
    appVersion: context.appVersion ?? "unknown",
    settings: context.settings ?? {},
    aggregates: aggregateByMetric(samples),
    samples,
  };
}

/** Markdown summary of the per-metric aggregates (for quick visual scanning). */
export function serializePerfReportMarkdown(context: PerfReportContext = {}): string {
  const report = serializePerfReport(context);
  const lines: string[] = [
    `# SpecOps performance report`,
    ``,
    `- Generated: ${report.generatedAt}`,
    `- Run id: ${report.runId}`,
    `- App version: ${report.appVersion}`,
    `- Samples: ${report.samples.length}`,
    ``,
    `## Aggregates by metric`,
    ``,
    `| metric | count | min (ms) | p50 (ms) | p95 (ms) | max (ms) |`,
    `| --- | ---: | ---: | ---: | ---: | ---: |`,
  ];
  for (const agg of report.aggregates) {
    lines.push(
      `| ${agg.metric} | ${agg.count} | ${agg.min} | ${agg.p50} | ${agg.p95} | ${agg.max} |`,
    );
  }
  return lines.join("\n");
}
