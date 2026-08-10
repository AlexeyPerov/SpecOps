import { writable } from "svelte/store";
import type { DiagnosticEvent, DiagnosticLevel } from "../domain/contracts";

export interface ConsoleLogEntry {
  id: string;
  level: DiagnosticLevel;
  source: DiagnosticEvent["source"];
  timestamp: string;
  message: string;
  /** Pre-serialized, size-capped metadata string (or empty). */
  metadataText: string;
  text: string;
}

/**
 * P03-08-28: ring capacity. Kept as a fixed-size pre-allocated array written
 * through a head index so each append is O(1) — no per-line `[...entries]`
 * clone of ~1000 elements and no per-append subscriber notify storm.
 */
const MAX_ENTRIES = 1000;

/**
 * P03-08-28: cap on the serialized metadata JSON retained per entry. Provider
 * payloads and error details can run to hundreds of KB; retaining the full
 * pre-formatted JSON for 1000 lines is the bulk of the ring's memory. Anything
 * past this is truncated with an ellipsis marker.
 */
const MAX_METADATA_TEXT_LENGTH = 2_048;

const LEVEL_RANK: Record<DiagnosticLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Numeric rank for a log level (higher = more severe). Exposed so the console
 * UI can apply a live *display* filter on top of the append-time retention
 * floor — the dropdown hides already-retained entries below the chosen level
 * without discarding them from the ring.
 */
export function consoleLevelRank(level: DiagnosticLevel): number {
  return LEVEL_RANK[level];
}

/**
 * Minimum level retained in the in-app console store. `debug` and below-noise
 * `info` events (e.g. every command dispatch) are dropped before they enter the
 * ring so the console surfaces signal, not keystroke-by-keystroke noise. The
 * Rust log plugin still receives every level via `logDiagnostic`.
 */
let minConsoleLevel: DiagnosticLevel = "info";

export function setMinConsoleLevel(level: DiagnosticLevel): void {
  minConsoleLevel = level;
}

export function getMinConsoleLevel(): DiagnosticLevel {
  return minConsoleLevel;
}

// Pre-allocated ring. Slots are reused in place; `head` is the index of the
// oldest entry (or the next write position when not yet full). `count` is the
// number of populated slots.
const ring: ConsoleLogEntry[] = [];
let head = 0;
let count = 0;
let nextEntryId = 0;

const { subscribe, set } = writable<ConsoleLogEntry[]>([]);

export const consoleLogs = { subscribe };

let flushScheduled = false;
let flushFlushed = false;

/**
 * Snapshot the current ring contents into a fresh array in oldest→newest
 * order. Allocated once per flush, not per append.
 */
function snapshotRing(): ConsoleLogEntry[] {
  if (count === 0) {
    return [];
  }
  const out: ConsoleLogEntry[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = ring[(head + i) % MAX_ENTRIES];
  }
  return out;
}

/**
 * P03-08-28: coalesce subscriber notifications across an animation frame. A
 * burst of log lines (e.g. a startup phase) previously notified the panel once
 * per line, each notify forcing a reactive re-derive + scroll layout. Batching
 * into one rAF flush keeps the panel responsive under load. Falls back to a
 * microtask-ish timer when rAF is unavailable (tests / non-DOM).
 */
function scheduleFlush(): void {
  if (flushScheduled) {
    return;
  }
  flushScheduled = true;
  const run = () => {
    flushScheduled = false;
    set(snapshotRing());
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
  } else {
    setTimeout(run, 0);
  }
}

export function appendConsoleLog(event: DiagnosticEvent): void {
  if (LEVEL_RANK[event.level] < LEVEL_RANK[minConsoleLevel]) {
    return;
  }
  const metadataText = formatMetadata(event.metadata);
  const entry: ConsoleLogEntry = {
    id: String(nextEntryId += 1),
    level: event.level,
    source: event.source,
    timestamp: event.timestamp,
    message: event.message,
    metadataText,
    text: formatConsoleEventText(event, metadataText),
  };
  // O(1) ring write: overwrite the oldest slot once full, advance head.
  if (count < MAX_ENTRIES) {
    ring[count] = entry;
    count += 1;
  } else {
    ring[head] = entry;
    head = (head + 1) % MAX_ENTRIES;
  }
  scheduleFlush();
}

export function clearConsoleLogs(): void {
  ring.length = 0;
  head = 0;
  count = 0;
  // Cancel any pending flush by re-snapshotting now: the ring is empty, so the
  // snapshot is empty regardless of what a late rAF callback would have read.
  flushFlushed = false;
  flushScheduled = false;
  set([]);
}

export function resetConsoleForTests(): void {
  nextEntryId = 0;
  ring.length = 0;
  head = 0;
  count = 0;
  flushScheduled = false;
  flushFlushed = false;
  // Tests read the store synchronously right after appending; push an empty
  // snapshot so the stale rAF-scheduled flush from a prior test cannot leak.
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

function truncateForRetention(value: string): string {
  if (value.length <= MAX_METADATA_TEXT_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_METADATA_TEXT_LENGTH)} …[truncated ${value.length - MAX_METADATA_TEXT_LENGTH} chars]`;
}

function formatMetadata(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "";
  }
  try {
    // P03-08-28: serialize once, cap the length, and keep only the string in
    // the entry — the original object reference is dropped so the ring never
    // pins large provider payloads / error objects for 1000 subsequent lines.
    return truncateForRetention(JSON.stringify(metadata));
  } catch {
    return " [metadata unavailable]";
  }
}

export function formatConsoleLine(entry: ConsoleLogEntry): string {
  return entry.text;
}

function formatConsoleEventText(event: DiagnosticEvent, metadataText: string): string {
  const time = formatConsoleTimestamp(event.timestamp);
  const meta = metadataText ? ` ${metadataText}` : "";
  return `${time} ${event.level.padEnd(5)} ${event.source} ${event.message}${meta}`;
}
