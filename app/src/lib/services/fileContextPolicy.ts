import { appState } from "../state/appState";
import { runInTabGroupContext } from "./workspacePaths";

export function isFileContextRestricted(): boolean {
  return appState.getSnapshot().settings.restrictFilesToContext;
}

export function runOpenInActiveContext<T>(fn: () => Promise<T> | T): Promise<T> | T {
  if (isFileContextRestricted()) {
    return runInTabGroupContext(fn);
  }
  return fn();
}
