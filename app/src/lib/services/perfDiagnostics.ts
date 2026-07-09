/**
 * Lightweight performance timing helpers for startup / workspace / tab paths.
 *
 * Emits structured diagnostics (`metadata.kind === "perf"`) so Console and
 * plugin logs can be filtered for baseline and before/after comparisons.
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
  | "tab.activationSideEffects";

export interface PerfTimingMetadata {
  metric: PerfMetric;
  durationMs: number;
  /** Optional phase / operation label (e.g. startup phase name). */
  label?: string;
  [key: string]: unknown;
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
