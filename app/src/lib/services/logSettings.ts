import type { LogSettings } from "../domain/contracts";

export const defaultLogSettings: LogSettings = {
  // P03-08-27: verbose provider logging deep-clones full request/response
  // payloads on every chat turn and ships them through the log pipeline even
  // when the Rust plugin discards them (they are emitted at `debug`). Default
  // off; opt in from Settings → Logs panel when diagnosing a provider issue.
  verboseProviderLogging: false,
  canOpenLogsPanel: true,
  // P03-08-T2: perf sample collection for the downloadable report. Off by
  // default so the ring is never allocated on the hot path; turning it on in
  // Settings captures every perf timing for export.
  collectPerfLogs: false,
};

/** Validates and normalizes persisted log settings. */
export function normalizeLogSettings(value: unknown): LogSettings {
  if (typeof value !== "object" || value === null) {
    return { ...defaultLogSettings };
  }

  const record = value as Record<string, unknown>;
  return {
    verboseProviderLogging:
      typeof record.verboseProviderLogging === "boolean"
        ? record.verboseProviderLogging
        : defaultLogSettings.verboseProviderLogging,
    canOpenLogsPanel:
      typeof record.canOpenLogsPanel === "boolean"
        ? record.canOpenLogsPanel
        : defaultLogSettings.canOpenLogsPanel,
    collectPerfLogs:
      typeof record.collectPerfLogs === "boolean"
        ? record.collectPerfLogs
        : defaultLogSettings.collectPerfLogs,
  };
}
