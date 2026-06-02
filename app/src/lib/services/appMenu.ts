import { homeDir } from "@tauri-apps/api/path";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import type { AppCommandId } from "../domain/contracts";
import { logDiagnostic } from "./logging";
import { formatRecentPath } from "./recentFiles";

let cachedHomeDir: string | null | undefined;
let openRecentSubmenu: Submenu | null = null;
let menuRunCommand: ((commandId: AppCommandId) => void) | null = null;
const openRecentPathByItemId = new Map<string, string>();
let refreshMenuChain: Promise<void> = Promise.resolve();
let pendingRecentFilesRefresh: string[] | null = null;
let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const REFRESH_DEBOUNCE_MS = 50;

async function resolveHomeDir(): Promise<string | null> {
  if (cachedHomeDir !== undefined) {
    return cachedHomeDir;
  }
  try {
    cachedHomeDir = await homeDir();
  } catch {
    cachedHomeDir = null;
  }
  return cachedHomeDir;
}

function openRecentItemId(index: number): string {
  return `cmd.file.openRecent.${index}`;
}

export function queueOpenRecentPath(path: string): void {
  if (!menuRunCommand) {
    return;
  }
  openRecentPathByItemId.set("__pending__", path);
  menuRunCommand("file.openRecent");
}

export function takeQueuedOpenRecentPath(): string | null {
  const path = openRecentPathByItemId.get("__pending__") ?? null;
  openRecentPathByItemId.delete("__pending__");
  return path;
}

async function refreshOpenRecentMenuInternal(recentFiles: string[]): Promise<void> {
  if (!openRecentSubmenu) {
    return;
  }

  const existingItems = await openRecentSubmenu.items();
  await logDiagnostic({
    level: "info",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "appMenu: refresh Open Recent start",
    metadata: {
      recentCount: recentFiles.length,
      removedCount: existingItems.length,
    },
  });

  for (let index = existingItems.length - 1; index >= 0; index -= 1) {
    await openRecentSubmenu.removeAt(index);
  }

  openRecentPathByItemId.clear();
  const resolvedHomeDir = await resolveHomeDir();

  for (const [index, path] of recentFiles.entries()) {
    const itemId = openRecentItemId(index);
    openRecentPathByItemId.set(itemId, path);
    await openRecentSubmenu.append(
      await MenuItem.new({
        id: itemId,
        text: formatRecentPath(path, resolvedHomeDir),
        action: () => queueOpenRecentPath(path),
      }),
    );
  }

  await openRecentSubmenu.append(await PredefinedMenuItem.new({ item: "Separator" }));
  await openRecentSubmenu.append(
    await MenuItem.new({
      id: "cmd.file.clearRecent",
      text: "Clear Recent",
      enabled: recentFiles.length > 0,
      action: () => menuRunCommand?.("file.clearRecentFiles"),
    }),
  );

  await logDiagnostic({
    level: "info",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "appMenu: refresh Open Recent complete",
    metadata: {
      recentCount: recentFiles.length,
      appendedCount: recentFiles.length + 2,
    },
  });
}

function flushPendingRecentMenuRefresh(): void {
  if (pendingRecentFilesRefresh === null) {
    return;
  }
  const recentFiles = pendingRecentFilesRefresh;
  pendingRecentFilesRefresh = null;
  refreshMenuChain = refreshMenuChain
    .then(async () => {
      await refreshOpenRecentMenuInternal(recentFiles);
    })
    .catch(async (error: unknown) => {
      const reason = error instanceof Error ? error.message : "unknown error";
      await logDiagnostic({
        level: "error",
        source: "frontend",
        timestamp: new Date().toISOString(),
        message: "failed to refresh Open Recent menu",
        metadata: { reason },
      });
    });
}

export function refreshOpenRecentMenu(recentFiles: string[]): Promise<void> {
  pendingRecentFilesRefresh = recentFiles;
  if (refreshDebounceTimer) {
    clearTimeout(refreshDebounceTimer);
  }
  return new Promise((resolve) => {
    refreshDebounceTimer = setTimeout(() => {
      refreshDebounceTimer = null;
      flushPendingRecentMenuRefresh();
      void refreshMenuChain.then(resolve);
    }, REFRESH_DEBOUNCE_MS);
  });
}

export async function initializeAppMenu(
  runCommand: (commandId: AppCommandId) => void,
  recentFiles: string[],
): Promise<void> {
  await logDiagnostic({
    level: "info",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "appMenu: initialize start",
    metadata: { recentCount: recentFiles.length },
  });

  menuRunCommand = runCommand;

  const newTabItem = await MenuItem.new({
    id: "cmd.file.newTab",
    text: "New Tab",
    accelerator: "CmdOrCtrl+N",
    action: () => runCommand("file.new"),
  });
  const openItem = await MenuItem.new({
    id: "cmd.file.open",
    text: "Open",
    accelerator: "CmdOrCtrl+O",
    action: () => runCommand("file.open"),
  });
  openRecentSubmenu = await Submenu.new({
    text: "Open Recent",
    items: [],
  });
  const openAllInFolderItem = await MenuItem.new({
    id: "cmd.file.openAllInFolder",
    text: "Open all in Folder",
    action: () => runCommand("file.openAllInFolder"),
  });
  const addWorkspaceItem = await MenuItem.new({
    id: "cmd.file.addWorkspace",
    text: "Add Workspace",
    action: () => runCommand("workspace.add"),
  });
  const newWindowItem = await MenuItem.new({
    id: "cmd.file.newWindow",
    text: "New Window",
    accelerator: "CmdOrCtrl+Shift+N",
    action: () => runCommand("app.newWindow"),
  });
  const moveTabItem = await MenuItem.new({
    id: "cmd.file.moveTab",
    text: "Move Tab To New Window",
    action: () => runCommand("tab.moveToNewWindow"),
  });
  const saveItem = await MenuItem.new({
    id: "cmd.file.save",
    text: "Save",
    accelerator: "CmdOrCtrl+S",
    action: () => runCommand("file.save"),
  });
  const saveAsItem = await MenuItem.new({
    id: "cmd.file.saveAs",
    text: "Save As",
    accelerator: "CmdOrCtrl+Alt+S",
    action: () => runCommand("file.saveAs"),
  });
  const saveAllItem = await MenuItem.new({
    id: "cmd.file.saveAll",
    text: "Save All",
    accelerator: "CmdOrCtrl+Shift+S",
    action: () => runCommand("file.saveAll"),
  });
  const renameItem = await MenuItem.new({
    id: "cmd.file.rename",
    text: "Rename",
    action: () => runCommand("file.rename"),
  });
  const reloadFromDiskItem = await MenuItem.new({
    id: "cmd.file.reloadFromDisk",
    text: "Reload from Disk",
    action: () => runCommand("file.reloadFromDisk"),
  });
  const closeItem = await MenuItem.new({
    id: "cmd.file.close",
    text: "Close",
    accelerator: "CmdOrCtrl+W",
    action: () => runCommand("tab.close"),
  });
  const settingsItem = await MenuItem.new({
    id: "cmd.app.settings",
    text: "Settings",
    accelerator: "CmdOrCtrl+,",
    action: () => runCommand("app.toggleSettings"),
  });
  const fileSettingsItem = await MenuItem.new({
    id: "cmd.file.settings",
    text: "Settings…",
    action: () => runCommand("app.toggleSettings"),
  });

  const fileMenu = await Submenu.new({
    text: "File",
    items: [
      newTabItem,
      openItem,
      openRecentSubmenu,
      openAllInFolderItem,
      addWorkspaceItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      fileSettingsItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      newWindowItem,
      moveTabItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      saveItem,
      saveAsItem,
      saveAllItem,
      renameItem,
      reloadFromDiskItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      closeItem,
    ],
  });

  const undoItem = await MenuItem.new({
    id: "cmd.edit.undo",
    text: "Undo",
    accelerator: "CmdOrCtrl+Z",
    action: () => runCommand("edit.undo"),
  });
  const redoItem = await MenuItem.new({
    id: "cmd.edit.redo",
    text: "Redo",
    accelerator: "CmdOrCtrl+Shift+Z",
    action: () => runCommand("edit.redo"),
  });
  const findReplaceItem = await MenuItem.new({
    id: "cmd.edit.findReplace",
    text: "Find / Replace",
    accelerator: "CmdOrCtrl+F",
    action: () => runCommand("app.toggleFindReplace"),
  });
  const cutItem = await PredefinedMenuItem.new({ item: "Cut" });
  const copyItem = await PredefinedMenuItem.new({ item: "Copy" });
  const pasteItem = await PredefinedMenuItem.new({ item: "Paste" });
  const selectAllItem = await PredefinedMenuItem.new({ item: "SelectAll" });
  const goToItem = await MenuItem.new({
    id: "cmd.edit.goTo",
    text: "Go To Line",
    accelerator: "CmdOrCtrl+L",
    action: () => runCommand("app.toggleGoTo"),
  });
  const indentItem = await MenuItem.new({
    id: "cmd.edit.indent",
    text: "Indent",
    accelerator: "CmdOrCtrl+]",
    action: () => runCommand("edit.indent"),
  });
  const outdentItem = await MenuItem.new({
    id: "cmd.edit.outdent",
    text: "Outdent",
    accelerator: "CmdOrCtrl+[",
    action: () => runCommand("edit.outdent"),
  });
  const moveLineUpItem = await MenuItem.new({
    id: "cmd.edit.moveLineUp",
    text: "Move Line Up",
    accelerator: "Alt+Up",
    action: () => runCommand("edit.moveLineUp"),
  });
  const moveLineDownItem = await MenuItem.new({
    id: "cmd.edit.moveLineDown",
    text: "Move Line Down",
    accelerator: "Alt+Down",
    action: () => runCommand("edit.moveLineDown"),
  });
  const duplicateLineItem = await MenuItem.new({
    id: "cmd.edit.duplicateLine",
    text: "Duplicate Line",
    accelerator: "CmdOrCtrl+D",
    action: () => runCommand("edit.duplicateLine"),
  });
  const joinLinesItem = await MenuItem.new({
    id: "cmd.edit.joinLines",
    text: "Join Lines",
    accelerator: "CmdOrCtrl+J",
    action: () => runCommand("edit.joinLines"),
  });

  const editMenu = await Submenu.new({
    text: "Edit",
    items: [
      undoItem,
      redoItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      cutItem,
      copyItem,
      pasteItem,
      selectAllItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      findReplaceItem,
      goToItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      indentItem,
      outdentItem,
      moveLineUpItem,
      moveLineDownItem,
      duplicateLineItem,
      joinLinesItem,
    ],
  });

  const themeItem = await MenuItem.new({
    id: "cmd.view.theme",
    text: "Cycle Theme",
    accelerator: "CmdOrCtrl+Shift+T",
    action: () => runCommand("view.cycleTheme"),
  });
  const diffItem = await MenuItem.new({
    id: "cmd.view.diff",
    text: "Toggle Diff Preview",
    accelerator: "CmdOrCtrl+Shift+D",
    action: () => runCommand("view.toggleDiffPreview"),
  });
  const wrapItem = await MenuItem.new({
    id: "cmd.view.wrap",
    text: "Toggle Wrap",
    accelerator: "CmdOrCtrl+Alt+Z",
    action: () => runCommand("view.toggleWrap"),
  });
  const zoomInItem = await MenuItem.new({
    id: "cmd.view.zoomIn",
    text: "Zoom In",
    accelerator: "CmdOrCtrl+=",
    action: () => runCommand("view.zoomIn"),
  });
  const zoomOutItem = await MenuItem.new({
    id: "cmd.view.zoomOut",
    text: "Zoom Out",
    accelerator: "CmdOrCtrl+-",
    action: () => runCommand("view.zoomOut"),
  });
  const zoomResetItem = await MenuItem.new({
    id: "cmd.view.zoomReset",
    text: "Reset Zoom",
    accelerator: "CmdOrCtrl+0",
    action: () => runCommand("view.zoomReset"),
  });

  const viewMenu = await Submenu.new({
    text: "View",
    items: [
      themeItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      diffItem,
      wrapItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      zoomInItem,
      zoomOutItem,
      zoomResetItem,
    ],
  });

  const appSubmenu = await Submenu.new({
    text: "SpecOps",
    items: [
      await PredefinedMenuItem.new({
        item: {
          About: {
            name: "SpecOps",
          },
        },
      }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      settingsItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Quit" }),
    ],
  });

  const appMenu = await Menu.new({
    items: [appSubmenu, fileMenu, editMenu, viewMenu],
  });
  await appMenu.setAsAppMenu();
  if (refreshDebounceTimer) {
    clearTimeout(refreshDebounceTimer);
    refreshDebounceTimer = null;
  }
  pendingRecentFilesRefresh = recentFiles;
  refreshMenuChain = Promise.resolve();
  await refreshOpenRecentMenuInternal(recentFiles);

  const fileMenuItems = await fileMenu.items();
  await logDiagnostic({
    level: "info",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "appMenu: initialize complete",
    metadata: { fileMenuItemCount: fileMenuItems.length },
  });
}

export function shouldInitializeAppMenu(windowId: string): boolean {
  return windowId === "main";
}

export function resetAppMenuForTests(): void {
  cachedHomeDir = undefined;
  openRecentSubmenu = null;
  menuRunCommand = null;
  openRecentPathByItemId.clear();
  refreshMenuChain = Promise.resolve();
  pendingRecentFilesRefresh = null;
  if (refreshDebounceTimer) {
    clearTimeout(refreshDebounceTimer);
    refreshDebounceTimer = null;
  }
}
