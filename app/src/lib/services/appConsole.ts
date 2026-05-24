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

let nextEntryId = 0;
const { subscribe, update, set } = writable<ConsoleLogEntry[]>([]);

export const consoleLogs = { subscribe };

export function appendConsoleLog(event: DiagnosticEvent): void {
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
    const next = [...entries, entry];
    if (next.length > MAX_ENTRIES) {
      return next.slice(next.length - MAX_ENTRIES);
    }
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
