import { writable } from "svelte/store";
import type { DiagnosticEvent, DiagnosticLevel } from "../domain/contracts";

export interface ConsoleLogEntry {
  id: string;
  level: DiagnosticLevel;
  source: DiagnosticEvent["source"];
  timestamp: string;
  message: string;
  metadata?: Record<string, unknown>;
  text: string;
}

const MAX_ENTRIES = 1000;

const LEVEL_RANK: Record<DiagnosticLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Minimum level retained in the in-app console store. `debug` and below-noise
 * `info` events (e.g. every command dispatch) are dropped before they enter the
 * 1000-entry ring so the console surfaces signal, not keystroke-by-keystroke
 * noise. The Rust log plugin still receives every level via `logDiagnostic`.
 */
let minConsoleLevel: DiagnosticLevel = "info";

export function setMinConsoleLevel(level: DiagnosticLevel): void {
  minConsoleLevel = level;
}

export function getMinConsoleLevel(): DiagnosticLevel {
  return minConsoleLevel;
}

let nextEntryId = 0;
const { subscribe, update, set } = writable<ConsoleLogEntry[]>([]);

export const consoleLogs = { subscribe };

export function appendConsoleLog(event: DiagnosticEvent): void {
  if (LEVEL_RANK[event.level] < LEVEL_RANK[minConsoleLevel]) {
    return;
  }
  update((entries) => {
    const entry: ConsoleLogEntry = {
      id: String(nextEntryId += 1),
      level: event.level,
      source: event.source,
      timestamp: event.timestamp,
      message: event.message,
      metadata: event.metadata,
      text: formatConsoleEventText(event),
    };
    // Avoid double-copying: append, then trim in place only when over the cap.
    const next = entries.length >= MAX_ENTRIES ? [...entries.slice(1), entry] : [...entries, entry];
    return next;
  });
}

export function clearConsoleLogs(): void {
  set([]);
}

export function resetConsoleForTests(): void {
  nextEntryId = 0;
  set([]);
}

function formatConsoleTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatMetadata(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "";
  }
  try {
    return ` ${JSON.stringify(metadata)}`;
  } catch {
    return " [metadata unavailable]";
  }
}

export function formatConsoleLine(entry: ConsoleLogEntry): string {
  return entry.text;
}

function formatConsoleEventText(event: DiagnosticEvent): string {
  const time = formatConsoleTimestamp(event.timestamp);
  return `${time} ${event.level.padEnd(5)} ${event.source} ${event.message}${formatMetadata(event.metadata)}`;
}
