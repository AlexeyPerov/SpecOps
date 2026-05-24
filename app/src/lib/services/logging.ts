import {
  debug as pluginDebug,
  error as pluginError,
  info as pluginInfo,
  trace as pluginTrace,
  warn as pluginWarn,
} from "@tauri-apps/plugin-log";
import type { DiagnosticEvent } from "../domain/contracts";
import { appendConsoleLog } from "./appConsole";

let initialized = false;

export async function initializeLogging(): Promise<void> {
  if (initialized) {
    return;
  }

  initialized = true;
  await pluginInfo("local diagnostics logging initialized");
}

export async function logDiagnostic(event: DiagnosticEvent): Promise<void> {
  appendConsoleLog(event);

  const payload = JSON.stringify({
    source: event.source,
    timestamp: event.timestamp,
    metadata: event.metadata,
    message: event.message,
  });

  void (async () => {
    try {
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
    } catch {
      // Plugin logging must not block or break app flows.
    }
  })();
}
