import type { ExternalFilesSettings } from "../domain/contracts";
import type { ExternalCheckResult, ExternalCheckTrigger } from "./externalFileChangesTypes";

export function shouldRunAutomaticCheck(
  settings: ExternalFilesSettings,
  trigger: Exclude<ExternalCheckTrigger, "manual">,
): boolean {
  if (!settings.watchExternalChanges) {
    return false;
  }
  switch (trigger) {
    case "watcher":
      return true;
    case "focus":
      return settings.checkOnWindowFocus;
    case "tab":
      return settings.checkOnTabActivate;
    case "startup":
      return true;
    default:
      return false;
  }
}

export function resolveExternalReloadPolicy(params: {
  trigger: ExternalCheckTrigger;
  isDirty: boolean;
  autoReloadCleanFiles: boolean;
}): ExternalCheckResult {
  if (!params.isDirty) {
    if (params.trigger === "manual" || params.autoReloadCleanFiles) {
      return "reloaded";
    }
    return "skipped";
  }

  if (params.trigger === "startup") {
    return "deferred";
  }
  return "deferred";
}

export function shouldAttemptDeferredCheck(
  hasDeferredDirtyCheck: boolean,
  trigger: "focus" | "tab",
): boolean {
  if (!hasDeferredDirtyCheck) {
    return true;
  }
  return trigger === "focus" || trigger === "tab";
}
