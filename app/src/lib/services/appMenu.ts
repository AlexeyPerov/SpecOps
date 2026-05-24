import { homeDir } from "@tauri-apps/api/path";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import type { AppCommandId } from "../domain/contracts";
import { formatRecentPath } from "./recentFiles";

let cachedHomeDir: string | null | undefined;
let openRecentSubmenu: Submenu | null = null;
let menuRunCommand: ((commandId: AppCommandId) => void) | null = null;
const openRecentPathByItemId = new Map<string, string>();

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

export async function refreshOpenRecentMenu(recentFiles: string[]): Promise<void> {
  if (!openRecentSubmenu) {
    return;
  }

  const existingItems = await openRecentSubmenu.items();
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
}

export async function initializeAppMenu(
  runCommand: (commandId: AppCommandId) => void,
  recentFiles: string[],
): Promise<void> {
  menuRunCommand = runCommand;

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

  const fileMenu = await Submenu.new({
    text: "File",
    items: [
      openItem,
      openRecentSubmenu,
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

  const settingsItem = await MenuItem.new({
    id: "cmd.view.settings",
    text: "Toggle Settings Pane",
    accelerator: "CmdOrCtrl+,",
    action: () => runCommand("app.toggleSettingsPane"),
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
      settingsItem,
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
    text: "spec-ops",
    items: [
      await PredefinedMenuItem.new({
        item: {
          About: {
            name: "spec-ops",
          },
        },
      }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Quit" }),
    ],
  });

  const appMenu = await Menu.new({
    items: [appSubmenu, fileMenu, editMenu, viewMenu],
  });
  await appMenu.setAsAppMenu();
  await refreshOpenRecentMenu(recentFiles);
}

export function resetAppMenuForTests(): void {
  cachedHomeDir = undefined;
  openRecentSubmenu = null;
  menuRunCommand = null;
  openRecentPathByItemId.clear();
}
