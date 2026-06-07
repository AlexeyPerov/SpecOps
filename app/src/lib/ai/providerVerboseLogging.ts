import { appState } from "../state/appState";

type VerboseLoggingReader = () => boolean;

let readVerboseLogging: VerboseLoggingReader = () =>
  appState.getSnapshot().settings.logSettings.verboseProviderLogging;

/** Returns whether full provider request/response payloads should be logged. */
export function isVerboseProviderLoggingEnabled(): boolean {
  return readVerboseLogging();
}

/** Overrides verbose logging detection for unit tests. Pass null to restore the default reader. */
export function setVerboseProviderLoggingReader(reader: VerboseLoggingReader | null): void {
  readVerboseLogging =
    reader ?? (() => appState.getSnapshot().settings.logSettings.verboseProviderLogging);
}
