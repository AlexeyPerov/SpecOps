export type ExternalCheckTrigger = "watcher" | "focus" | "tab" | "startup" | "manual";

export type ExternalCheckResult =
  | "unchanged"
  | "reloaded"
  | "kept"
  | "missing"
  | "skipped"
  | "deferred";
