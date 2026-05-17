import {
  debug as pluginDebug,
  error as pluginError,
  info as pluginInfo,
  trace as pluginTrace,
  warn as pluginWarn,
} from "@tauri-apps/plugin-log";
import type { DiagnosticEvent } from "../domain/contracts";

let initialized = false;

export async function initializeLogging(): Promise<void> {
  if (initialized) {
    return;
  }

  initialized = true;
  await pluginInfo("local diagnostics logging initialized");
}

export async function logDiagnostic(event: DiagnosticEvent): Promise<void> {
  const payload = JSON.stringify({
    source: event.source,
    timestamp: event.timestamp,
    metadata: event.metadata,
    message: event.message,
  });

  switch (event.level) {
    case "debug":
      await pluginDebug(payload);
      break;
    case "info":
      await pluginInfo(payload);
      break;
    case "warn":
      await pluginWarn(payload);
      break;
    case "error":
      await pluginError(payload);
      break;
    default:
      await pluginTrace(payload);
      break;
  }
}
