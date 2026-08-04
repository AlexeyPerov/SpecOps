import {
  debug as pluginDebug,
  error as pluginError,
  info as pluginInfo,
  trace as pluginTrace,
  warn as pluginWarn,
} from "@tauri-apps/plugin-log";
import type { DiagnosticEvent, DiagnosticLevel } from "../domain/contracts";
import { appendConsoleLog } from "./appConsole";

let initialized = false;

export async function initializeLogging(): Promise<void> {
  if (initialized) {
    return;
  }

  initialized = true;
  await pluginInfo("local diagnostics logging initialized");
}

/**
 * Numeric rank for level comparisons. Higher = more severe.
 *
 * P03-08-27: the Rust log plugin (see `lib.rs`) filters everything below
 * `LevelFilter::Info`, so a `debug`/`trace` payload that reaches it is
 * serialized, marshalled across IPC, and then thrown away. We mirror that
 * cutoff on the JS side *before* the `JSON.stringify` + IPC hop so the
 * wasted work never happens.
 */
const LEVEL_RANK: Record<DiagnosticLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Minimum level that is actually forwarded to the Rust log plugin. The plugin
 * discards anything below `Info`, so matching it here skips the stringify and
 * IPC for debug/trace entirely. (The in-app console still sees every level —
 * it has its own `minConsoleLevel` filter, and that path is cheap.)
 *
 * Exposed for tests so the cutoff can be overridden when asserting that a
 * debug payload never reaches the plugin.
 */
export let pluginMinLevelRank: number = LEVEL_RANK.info;

export function setPluginMinLevelForTests(rank: number): void {
  pluginMinLevelRank = rank;
}

export function resetPluginMinLevelForTests(): void {
  pluginMinLevelRank = LEVEL_RANK.info;
}

function shouldForwardToPlugin(level: DiagnosticLevel): boolean {
  return LEVEL_RANK[level] >= pluginMinLevelRank;
}

function forwardToPlugin(level: DiagnosticLevel, payload: string): void {
  void (async () => {
    try {
      switch (level) {
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

export async function logDiagnostic(event: DiagnosticEvent): Promise<void> {
  // The in-app console has its own (separate) level filter and is cheap; it
  // still receives every level so the UI can surface debug noise when the
  // user opts in via the console toolbar.
  appendConsoleLog(event);

  // P03-08-27: drop the stringify + IPC entirely when the level would be
  // discarded by the Rust plugin anyway. This is the dominant cost on the
  // hot path (every git command summary, every chat HTTP event when verbose
  // logging is on, every command dispatch).
  if (!shouldForwardToPlugin(event.level)) {
    return;
  }

  const payload = JSON.stringify({
    source: event.source,
    timestamp: event.timestamp,
    metadata: event.metadata,
    message: event.message,
  });

  forwardToPlugin(event.level, payload);
}
