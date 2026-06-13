import type { LogSettings } from "../domain/contracts";

export const defaultLogSettings: LogSettings = {
  verboseProviderLogging: true,
  canOpenLogsPanel: true,
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
  };
}
