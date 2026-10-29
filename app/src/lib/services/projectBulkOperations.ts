import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import type { ProjectTreeNode } from "./projectTree";
import { topLevelProjectEntries } from "./projectSelection";
import { requestChoice } from "./choiceDialog";
import { requestConfirm } from "./confirmDialogUi";
import type { PromptAnchor } from "./promptAnchor";
import { deleteProjectEntry } from "./projectFileOps";
import { syncOpenDocumentsAfterRelocation } from "./relocateWorkspacePaths";
import { relocateProjectFavorites } from "./projectFavorites";
import { normalizePathSync } from "./diskFingerprint";
import { isPathUnderRoot } from "./workspacePaths";
import { readOpenFileRegistry } from "./openFileRegistry";

export const PROJECT_PATH_RELOCATED = "spec-ops/project-path-relocated";
export const PROJECT_PATH_DELETED = "spec-ops/project-path-deleted";
export interface ProjectRelocation { sourceWindowId: string; oldPath: string; newPath: string }
interface MoveResult { status: "moved" | "conflict" | "skipped"; path: string; canReplace: boolean; warning: string | null }

export async function moveProjectEntries(root: string, entries: readonly ProjectTreeNode[], notify: (message: string) => void): Promise<void> {
  const destination = await open({ directory: true, multiple: false, title: "Move to folder" });
  if (typeof destination !== "string") return;
  const windowId = getCurrentWebviewWindow().label;
  let remainingResolution: string | null = null;
  let moved = 0; let skipped = 0;
  const errors: string[] = [];
  for (const entry of topLevelProjectEntries(entries)) {
    try {
      const args = { workspaceRoot: root, sourcePath: entry.path, destDirPath: destination };
      // Always probe first: a group policy may be invalid for a directory conflict.
      let result = await invoke<MoveResult>("project_move_entry", { ...args, resolution: "ask" });
      if (result.status === "conflict") {
        const owner = (await readOpenFileRegistry())[normalizePathSync(result.path)];
        const canReplace = result.canReplace && !owner;
        let resolution: string | null = remainingResolution;
        if (!resolution || resolution === "replace" && !canReplace) {
          const choice = await requestChoice({
            title: "Destination already exists", message: `${result.path}\n${owner ? "The destination is open in SpecOps. Close it before replacing." : !result.canReplace ? "Folders are not merged or replaced." : "Choose how to handle this item."}`,
            allowApplyToAll: true,
            options: [{ value: "skip", label: "Skip" }, { value: "keep-both", label: "Keep both" }, { value: "replace", label: "Replace", disabled: !canReplace }],
          });
          if (!choice) break;
          resolution = choice.value;
          if (choice.applyToAll) remainingResolution = resolution;
        }
        result = await invoke<MoveResult>("project_move_entry", { ...args, resolution });
      }
      if (result.status === "moved") {
        moved++;
        await syncOpenDocumentsAfterRelocation(entry.path, result.path, windowId);
        await relocateProjectFavorites(root, entry.path, isPathUnderRoot(result.path, root) ? result.path : null);
        await emit(PROJECT_PATH_RELOCATED, { sourceWindowId: windowId, oldPath: entry.path, newPath: result.path } satisfies ProjectRelocation);
        if (result.warning) errors.push(result.warning);
      } else if (result.status === "skipped") skipped++;
      else errors.push(`Destination changed while moving ${entry.name}. Item kept at source.`);
    } catch (error) { errors.push(`${entry.name}: ${String(error)}`); }
  }
  notify(`Moved ${moved} item(s)${skipped ? `, skipped ${skipped}` : ""}${errors.length ? `. ${errors.join("\n")}` : "."}`);
}

/** Shows the confirmation beside `anchor` (the rows being deleted) when given. */
export async function deleteProjectEntries(root: string, entries: readonly ProjectTreeNode[], notify: (message: string) => void, anchor?: PromptAnchor): Promise<void> {
  const targets = topLevelProjectEntries(entries);
  if (!targets.length || !(await requestConfirm({ ...deleteConfirmText(targets), confirmLabel: "Delete", danger: true, anchor }))) return;
  let deleted = 0;
  const errors: string[] = [];
  for (const entry of targets) {
    const result = await deleteProjectEntry(root, entry.path);
    if (result.ok) {
      deleted++;
      await emit(PROJECT_PATH_DELETED, { sourceWindowId: getCurrentWebviewWindow().label, path: entry.path });
    } else errors.push(`${entry.name}: ${result.reason}`);
  }
  notify(`Deleted ${deleted} item(s)${errors.length ? `. ${errors.join("\n")}` : "."}`);
}

const DELETE_CONFIRM_LISTED_NAMES = 8;

function deleteConfirmText(targets: readonly ProjectTreeNode[]): { title: string; message: string } {
  if (targets.length === 1) {
    const [entry] = targets;
    return { title: `Delete ${entry!.kind === "directory" ? "folder" : "file"} “${entry!.name}”?`, message: "This cannot be undone." };
  }
  const names = targets.slice(0, DELETE_CONFIRM_LISTED_NAMES).map((entry) => entry.name);
  const more = targets.length - names.length;
  return {
    title: `Delete ${targets.length} items?`,
    message: `${names.join("\n")}${more > 0 ? `\n…and ${more} more` : ""}\n\nThis cannot be undone.`,
  };
}
