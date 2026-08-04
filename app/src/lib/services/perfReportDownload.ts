/**
 * P03-08-T2: download the captured performance ring as a JSON report.
 *
 * Uses the native save dialog + atomic write (same path as Save File As) so the
 * report lands on disk without crossing the session-write lock. App version is
 * resolved lazily from the Tauri app handle; falls back to "unknown" outside
 * the runtime (tests).
 */
import { save } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { atomicWriteTextFile } from "./atomicWrite";
import {
  isPerfCollectionEnabled,
  serializePerfReport,
  serializePerfReportMarkdown,
  type PerfReportSettingsSnapshot,
} from "./perfDiagnostics";

let cachedAppVersion: string | null = null;

async function resolveAppVersion(): Promise<string> {
  if (cachedAppVersion !== null) {
    return cachedAppVersion;
  }
  try {
    cachedAppVersion = await getVersion();
  } catch {
    cachedAppVersion = "unknown";
  }
  return cachedAppVersion;
}

export interface DownloadPerfReportOptions {
  /** Relevant settings snapshot to embed in the report. */
  settings?: PerfReportSettingsSnapshot;
  /** Emit markdown instead of JSON. */
  format?: "json" | "markdown";
}

/**
 * Open a save dialog and write the perf report. Returns the chosen path, or
 * `null` if the user cancelled. When collection is disabled the report still
 * serializes whatever is in the ring (possibly empty) so the action is never a
 * silent no-op — the user gets a file that records the state.
 */
export async function downloadPerfReport(
  options: DownloadPerfReportOptions = {},
): Promise<string | null> {
  const format = options.format ?? "json";
  const appVersion = await resolveAppVersion();
  const defaultName =
    format === "markdown"
      ? `specops-perf-${Date.now()}.md`
      : `specops-perf-${Date.now()}.json`;

  const selectedPath = await save({
    title: "Save performance report",
    defaultPath: defaultName,
  });
  if (!selectedPath) {
    return null;
  }

  const content =
    format === "markdown"
      ? serializePerfReportMarkdown({ appVersion, settings: options.settings })
      : `${JSON.stringify(
          serializePerfReport({ appVersion, settings: options.settings }),
          null,
          2,
        )}\n`;

  await atomicWriteTextFile(selectedPath, content);
  return selectedPath;
}

/** Whether the report action has data to export (collection on + ring non-empty). */
export function hasPerfReportData(): boolean {
  return isPerfCollectionEnabled();
}
