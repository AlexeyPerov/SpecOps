import { confirm } from "@tauri-apps/plugin-dialog";
import type { ProjectTreeNode } from "./projectTree";
import {
  createProjectFile,
  createProjectFolder,
  deleteProjectEntry,
  moveProjectEntry,
  parentDirForRefresh,
  renameProjectEntry,
} from "./projectFileOps";
import { chatStore } from "../state/chatStore";
import { describeOpenActivePathResult, openActivePath } from "./openActivePath";
import { promptEntryName } from "./entryNamePrompt";
import type { createProjectTreeController } from "./projectTreeController";

export interface AppShellProjectTreeHandlersDeps {
  getActiveWorkspaceRoot: () => string | null;
  getIsAgentTabActive: () => boolean;
  getCurrentWindowId: () => string;
  notify: (message: string) => void;
  projectTreeController: ReturnType<typeof createProjectTreeController>;
}

export function createAppShellProjectTreeHandlers(deps: AppShellProjectTreeHandlersDeps) {
  const {
    getActiveWorkspaceRoot,
    getIsAgentTabActive,
    getCurrentWindowId,
    notify,
    projectTreeController,
  } = deps;

  async function loadProjectTreeRoot(): Promise<void> {
    await projectTreeController.loadProjectTreeRoot({
      workspaceRoot: getActiveWorkspaceRoot(),
      isAgentTabActive: getIsAgentTabActive(),
      onWorkspaceBlocked: () => {
        void chatStore.runAccessPreflight();
      },
    });
  }

  async function loadProjectTreeChildren(directoryPath: string): Promise<void> {
    await projectTreeController.loadProjectTreeChildren(getActiveWorkspaceRoot(), directoryPath);
  }

  async function handleToggleProjectTreeDirectory(path: string): Promise<void> {
    await projectTreeController.handleToggleProjectTreeDirectory(getActiveWorkspaceRoot(), path);
  }

  async function handleOpenProjectTreeFile(path: string): Promise<void> {
    const result = await openActivePath(path, getCurrentWindowId());
    notify(describeOpenActivePathResult(result));
  }

  async function refreshProjectTree(): Promise<void> {
    await projectTreeController.refreshProjectTree(getActiveWorkspaceRoot(), getIsAgentTabActive());
  }

  function notifyProjectTreeFilesystemChange(path: string): void {
    projectTreeController.handleFilesystemChange(getActiveWorkspaceRoot(), path);
  }

  async function refreshProjectTreeDirectories(directoryPaths: string[]): Promise<void> {
    await projectTreeController.reloadDirectories(getActiveWorkspaceRoot(), directoryPaths);
  }

  async function afterProjectTreeMutation(...paths: string[]): Promise<void> {
    const dirs = new Set<string>();
    const workspaceRoot = getActiveWorkspaceRoot();
    if (workspaceRoot) {
      dirs.add(workspaceRoot);
    }
    for (const path of paths) {
      dirs.add(parentDirForRefresh(path));
    }
    await refreshProjectTreeDirectories([...dirs]);
    for (const path of paths) {
      notifyProjectTreeFilesystemChange(path);
    }
  }

  async function handleMoveProjectTreeEntry(
    sourcePath: string,
    destDirPath: string,
  ): Promise<void> {
    const activeWorkspaceRoot = getActiveWorkspaceRoot();
    if (!activeWorkspaceRoot) {
      return;
    }
    const result = await moveProjectEntry(
      activeWorkspaceRoot,
      sourcePath,
      destDirPath,
      getCurrentWindowId(),
    );
    if (!result.ok) {
      notify(result.reason);
      return;
    }
    notify(`Moved to ${destDirPath}`);
    await afterProjectTreeMutation(sourcePath, result.path, destDirPath);
  }

  async function handleNewProjectFile(parentDirPath: string): Promise<void> {
    const activeWorkspaceRoot = getActiveWorkspaceRoot();
    if (!activeWorkspaceRoot) {
      return;
    }
    const name = await promptEntryName({
      title: "New file name",
      defaultValue: "untitled.txt",
      confirmLabel: "Create",
    });
    if (name === null) {
      return;
    }
    const result = await createProjectFile(activeWorkspaceRoot, parentDirPath, name);
    if (!result.ok) {
      notify(result.reason);
      return;
    }
    notify(`Created ${name}`);
    await afterProjectTreeMutation(result.path);
    await handleOpenProjectTreeFile(result.path);
  }

  async function handleNewProjectFolder(parentDirPath: string): Promise<void> {
    const activeWorkspaceRoot = getActiveWorkspaceRoot();
    if (!activeWorkspaceRoot) {
      return;
    }
    const name = await promptEntryName({
      title: "New folder name",
      defaultValue: "New Folder",
      confirmLabel: "Create",
    });
    if (name === null) {
      return;
    }
    const result = await createProjectFolder(activeWorkspaceRoot, parentDirPath, name);
    if (!result.ok) {
      notify(result.reason);
      return;
    }
    notify(`Created folder ${name}`);
    await afterProjectTreeMutation(result.path);
  }

  async function handleRenameProjectEntry(
    path: string,
    kind: ProjectTreeNode["kind"],
  ): Promise<void> {
    const activeWorkspaceRoot = getActiveWorkspaceRoot();
    if (!activeWorkspaceRoot) {
      return;
    }
    const currentName = path.replaceAll("\\", "/").split("/").pop() ?? path;
    const name = await promptEntryName({
      title: "Rename",
      defaultValue: currentName,
      confirmLabel: "Rename",
    });
    if (name === null) {
      return;
    }
    const result = await renameProjectEntry(
      activeWorkspaceRoot,
      path,
      name,
      getCurrentWindowId(),
    );
    if (!result.ok) {
      notify(result.reason);
      return;
    }
    notify(`Renamed to ${name}`);
    await afterProjectTreeMutation(path, result.path);
    if (kind === "file") {
      await handleOpenProjectTreeFile(result.path);
    }
  }

  async function handleDeleteProjectEntry(
    path: string,
    kind: ProjectTreeNode["kind"],
  ): Promise<void> {
    const activeWorkspaceRoot = getActiveWorkspaceRoot();
    if (!activeWorkspaceRoot) {
      return;
    }
    const label = kind === "directory" ? "folder" : "file";
    const entryLabel = path.replaceAll("\\", "/").split("/").pop() ?? path;
    const confirmed = await confirm(`Delete ${label} "${entryLabel}"?`, {
      title: "Delete",
      okLabel: "Delete",
      cancelLabel: "Cancel",
      kind: "warning",
    });
    if (!confirmed) {
      return;
    }
    const result = await deleteProjectEntry(activeWorkspaceRoot, path);
    if (!result.ok) {
      notify(result.reason);
      return;
    }
    notify("Deleted");
    await afterProjectTreeMutation(path);
  }

  async function toggleProjectTreeHidden(next: boolean): Promise<void> {
    projectTreeController.setShowHidden(next);
    await refreshProjectTree();
  }

  return {
    loadProjectTreeRoot,
    loadProjectTreeChildren,
    handleToggleProjectTreeDirectory,
    handleOpenProjectTreeFile,
    refreshProjectTree,
    notifyProjectTreeFilesystemChange,
    handleMoveProjectTreeEntry,
    handleNewProjectFile,
    handleNewProjectFolder,
    handleRenameProjectEntry,
    handleDeleteProjectEntry,
    toggleProjectTreeHidden,
  };
}
