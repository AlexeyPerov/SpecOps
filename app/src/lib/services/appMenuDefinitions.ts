import { MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import type { AppCommandId } from "../domain/contracts";

async function commandItem(params: {
  id: string;
  text: string;
  commandId: AppCommandId;
  accelerator?: string;
  runCommand: (commandId: AppCommandId) => void;
}) {
  return MenuItem.new({
    id: params.id,
    text: params.text,
    accelerator: params.accelerator,
    action: () => params.runCommand(params.commandId),
  });
}

export async function buildFileMenu(params: {
  runCommand: (commandId: AppCommandId) => void;
  openRecentSubmenu: Submenu;
}) {
  const { runCommand, openRecentSubmenu } = params;
  const newTabItem = await commandItem({
    id: "cmd.file.newTab",
    text: "New Tab",
    accelerator: "CmdOrCtrl+N",
    commandId: "file.new",
    runCommand,
  });
  const openItem = await commandItem({
    id: "cmd.file.open",
    text: "Open",
    accelerator: "CmdOrCtrl+O",
    commandId: "file.open",
    runCommand,
  });
  const quickOpenItem = await commandItem({
    id: "cmd.file.quickOpen",
    text: "Quick Open",
    accelerator: "CmdOrCtrl+P",
    commandId: "app.quickOpenFile",
    runCommand,
  });
  const openAllInFolderItem = await commandItem({
    id: "cmd.file.openAllInFolder",
    text: "Open all in Folder",
    commandId: "file.openAllInFolder",
    runCommand,
  });
  const addWorkspaceItem = await commandItem({
    id: "cmd.file.addWorkspace",
    text: "Add Workspace",
    commandId: "workspace.add",
    runCommand,
  });
  const newWindowItem = await commandItem({
    id: "cmd.file.newWindow",
    text: "New Window",
    accelerator: "CmdOrCtrl+Shift+N",
    commandId: "app.newWindow",
    runCommand,
  });
  const moveTabItem = await commandItem({
    id: "cmd.file.moveTab",
    text: "Move Tab To New Window",
    commandId: "tab.moveToNewWindow",
    runCommand,
  });
  const saveItem = await commandItem({
    id: "cmd.file.save",
    text: "Save",
    accelerator: "CmdOrCtrl+S",
    commandId: "file.save",
    runCommand,
  });
  const saveAsItem = await commandItem({
    id: "cmd.file.saveAs",
    text: "Save As",
    accelerator: "CmdOrCtrl+Alt+S",
    commandId: "file.saveAs",
    runCommand,
  });
  const saveAllItem = await commandItem({
    id: "cmd.file.saveAll",
    text: "Save All",
    accelerator: "CmdOrCtrl+Shift+S",
    commandId: "file.saveAll",
    runCommand,
  });
  const renameItem = await commandItem({
    id: "cmd.file.rename",
    text: "Rename",
    commandId: "file.rename",
    runCommand,
  });
  const reloadFromDiskItem = await commandItem({
    id: "cmd.file.reloadFromDisk",
    text: "Reload from Disk",
    commandId: "file.reloadFromDisk",
    runCommand,
  });
  const closeItem = await commandItem({
    id: "cmd.file.close",
    text: "Close",
    accelerator: "CmdOrCtrl+W",
    commandId: "tab.close",
    runCommand,
  });

  return Submenu.new({
    text: "File",
    items: [
      newTabItem,
      openItem,
      quickOpenItem,
      openRecentSubmenu,
      openAllInFolderItem,
      addWorkspaceItem,
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
}

export async function buildEditMenu(runCommand: (commandId: AppCommandId) => void) {
  const undoItem = await commandItem({
    id: "cmd.edit.undo",
    text: "Undo",
    accelerator: "CmdOrCtrl+Z",
    commandId: "edit.undo",
    runCommand,
  });
  const redoItem = await commandItem({
    id: "cmd.edit.redo",
    text: "Redo",
    accelerator: "CmdOrCtrl+Shift+Z",
    commandId: "edit.redo",
    runCommand,
  });
  const findReplaceItem = await commandItem({
    id: "cmd.edit.findReplace",
    text: "Find / Replace",
    accelerator: "CmdOrCtrl+F",
    commandId: "app.toggleFindReplace",
    runCommand,
  });
  const commandPaletteItem = await commandItem({
    id: "cmd.edit.commandPalette",
    text: "Command Palette",
    accelerator: "CmdOrCtrl+Shift+P",
    commandId: "app.openCommandPalette",
    runCommand,
  });
  const goToItem = await commandItem({
    id: "cmd.edit.goTo",
    text: "Go To Line",
    accelerator: "CmdOrCtrl+L",
    commandId: "app.toggleGoTo",
    runCommand,
  });
  const findInProjectItem = await commandItem({
    id: "cmd.edit.findInProject",
    text: "Find in Project",
    accelerator: "CmdOrCtrl+Shift+F",
    commandId: "app.findInProject",
    runCommand,
  });
  const replaceInProjectItem = await commandItem({
    id: "cmd.edit.replaceInProject",
    text: "Replace in Project",
    accelerator: "CmdOrCtrl+Shift+R",
    commandId: "app.replaceInProject",
    runCommand,
  });
  const indentItem = await commandItem({
    id: "cmd.edit.indent",
    text: "Indent",
    accelerator: "CmdOrCtrl+]",
    commandId: "edit.indent",
    runCommand,
  });
  const outdentItem = await commandItem({
    id: "cmd.edit.outdent",
    text: "Outdent",
    accelerator: "CmdOrCtrl+[",
    commandId: "edit.outdent",
    runCommand,
  });
  const moveLineUpItem = await commandItem({
    id: "cmd.edit.moveLineUp",
    text: "Move Line Up",
    accelerator: "Alt+Up",
    commandId: "edit.moveLineUp",
    runCommand,
  });
  const moveLineDownItem = await commandItem({
    id: "cmd.edit.moveLineDown",
    text: "Move Line Down",
    accelerator: "Alt+Down",
    commandId: "edit.moveLineDown",
    runCommand,
  });
  const duplicateLineItem = await commandItem({
    id: "cmd.edit.duplicateLine",
    text: "Duplicate Line",
    accelerator: "CmdOrCtrl+Alt+D",
    commandId: "edit.duplicateLine",
    runCommand,
  });
  const joinLinesItem = await commandItem({
    id: "cmd.edit.joinLines",
    text: "Join Lines",
    accelerator: "CmdOrCtrl+J",
    commandId: "edit.joinLines",
    runCommand,
  });
  const selectNextOccurrenceItem = await commandItem({
    id: "cmd.edit.selectNextOccurrence",
    text: "Select Next Occurrence",
    accelerator: "CmdOrCtrl+D",
    commandId: "edit.selectNextOccurrence",
    runCommand,
  });
  const selectAllOccurrencesItem = await commandItem({
    id: "cmd.edit.selectAllOccurrences",
    text: "Select All Occurrences",
    accelerator: "CmdOrCtrl+Shift+L",
    commandId: "edit.selectAllOccurrences",
    runCommand,
  });
  const skipOccurrenceItem = await commandItem({
    id: "cmd.edit.skipOccurrence",
    text: "Skip Occurrence",
    commandId: "edit.skipOccurrence",
    runCommand,
  });
  const undoOccurrenceItem = await commandItem({
    id: "cmd.edit.undoOccurrence",
    text: "Remove Last Occurrence",
    commandId: "edit.undoOccurrence",
    runCommand,
  });
  const toggleFoldItem = await commandItem({
    id: "cmd.edit.toggleFold",
    text: "Toggle Fold",
    accelerator: "CmdOrCtrl+Alt+.",
    commandId: "edit.toggleFold",
    runCommand,
  });
  const foldItem = await commandItem({
    id: "cmd.edit.fold",
    text: "Fold",
    accelerator: "CmdOrCtrl+Alt+[",
    commandId: "edit.fold",
    runCommand,
  });
  const unfoldItem = await commandItem({
    id: "cmd.edit.unfold",
    text: "Unfold",
    accelerator: "CmdOrCtrl+Alt+]",
    commandId: "edit.unfold",
    runCommand,
  });
  const foldAllItem = await commandItem({
    id: "cmd.edit.foldAll",
    text: "Fold All",
    accelerator: "Ctrl+Alt+[",
    commandId: "edit.foldAll",
    runCommand,
  });
  const unfoldAllItem = await commandItem({
    id: "cmd.edit.unfoldAll",
    text: "Unfold All",
    accelerator: "Ctrl+Alt+]",
    commandId: "edit.unfoldAll",
    runCommand,
  });

  return Submenu.new({
    text: "Edit",
    items: [
      undoItem,
      redoItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Cut" }),
      await PredefinedMenuItem.new({ item: "Copy" }),
      await PredefinedMenuItem.new({ item: "Paste" }),
      await PredefinedMenuItem.new({ item: "SelectAll" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      commandPaletteItem,
      findReplaceItem,
      findInProjectItem,
      replaceInProjectItem,
      goToItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      indentItem,
      outdentItem,
      moveLineUpItem,
      moveLineDownItem,
      duplicateLineItem,
      joinLinesItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      selectNextOccurrenceItem,
      selectAllOccurrencesItem,
      skipOccurrenceItem,
      undoOccurrenceItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      toggleFoldItem,
      foldItem,
      unfoldItem,
      foldAllItem,
      unfoldAllItem,
    ],
  });
}

export async function buildViewMenu(runCommand: (commandId: AppCommandId) => void) {
  const layoutSingle = await commandItem({
    id: "cmd.view.layoutSingle",
    text: "Single",
    commandId: "view.layoutSingle",
    runCommand,
  });
  const layoutCols2 = await commandItem({
    id: "cmd.view.layoutCols2",
    text: "2 Columns",
    commandId: "view.layoutCols2",
    runCommand,
  });
  const layoutRows2 = await commandItem({
    id: "cmd.view.layoutRows2",
    text: "2 Rows",
    commandId: "view.layoutRows2",
    runCommand,
  });
  const layoutRows3 = await commandItem({
    id: "cmd.view.layoutRows3",
    text: "3 Rows",
    commandId: "view.layoutRows3",
    runCommand,
  });
  const layoutGrid = await commandItem({
    id: "cmd.view.layoutGrid",
    text: "Grid",
    commandId: "view.layoutGrid",
    runCommand,
  });
  const layoutSubmenu = await Submenu.new({
    text: "Layout",
    items: [layoutSingle, layoutCols2, layoutRows2, layoutRows3, layoutGrid],
  });

  const themeItem = await commandItem({
    id: "cmd.view.theme",
    text: "Cycle Theme",
    accelerator: "CmdOrCtrl+Shift+T",
    commandId: "view.cycleTheme",
    runCommand,
  });
  const diffItem = await commandItem({
    id: "cmd.view.diff",
    text: "Toggle Diff Preview",
    accelerator: "CmdOrCtrl+Shift+D",
    commandId: "view.toggleDiffPreview",
    runCommand,
  });
  const wrapItem = await commandItem({
    id: "cmd.view.wrap",
    text: "Toggle Wrap",
    accelerator: "CmdOrCtrl+Alt+Z",
    commandId: "view.toggleWrap",
    runCommand,
  });
  const outlineItem = await commandItem({
    id: "cmd.view.markdownOutline",
    text: "Markdown Outline",
    accelerator: "CmdOrCtrl+Shift+O",
    commandId: "app.toggleMarkdownOutline",
    runCommand,
  });
  const zoomInItem = await commandItem({
    id: "cmd.view.zoomIn",
    text: "Zoom In",
    accelerator: "CmdOrCtrl+=",
    commandId: "view.zoomIn",
    runCommand,
  });
  const zoomOutItem = await commandItem({
    id: "cmd.view.zoomOut",
    text: "Zoom Out",
    accelerator: "CmdOrCtrl+-",
    commandId: "view.zoomOut",
    runCommand,
  });
  const zoomResetItem = await commandItem({
    id: "cmd.view.zoomReset",
    text: "Reset Zoom",
    accelerator: "CmdOrCtrl+0",
    commandId: "view.zoomReset",
    runCommand,
  });
  const focusEditorItem = await commandItem({
    id: "cmd.view.focusEditor",
    text: "Focus Editor",
    accelerator: "CmdOrCtrl+Shift+E",
    commandId: "view.focusEditor",
    runCommand,
  });

  return Submenu.new({
    text: "View",
    items: [
      layoutSubmenu,
      await PredefinedMenuItem.new({ item: "Separator" }),
      focusEditorItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      themeItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      diffItem,
      wrapItem,
      outlineItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      zoomInItem,
      zoomOutItem,
      zoomResetItem,
    ],
  });
}

export async function buildAppSubmenu(runCommand: (commandId: AppCommandId) => void) {
  const themesItem = await commandItem({
    id: "cmd.app.themes",
    text: "Themes",
    accelerator: "CmdOrCtrl+Shift+,",
    commandId: "app.toggleThemePane",
    runCommand,
  });
  const settingsItem = await commandItem({
    id: "cmd.app.settings",
    text: "Settings",
    accelerator: "CmdOrCtrl+,",
    commandId: "app.toggleSettings",
    runCommand,
  });
  const workspaceManagerItem = await commandItem({
    id: "cmd.app.workspaceManager",
    text: "Workspace Manager",
    commandId: "app.openWorkspaceManager",
    runCommand,
  });
  const versionControlItem = await commandItem({
    id: "cmd.app.versionControl",
    text: "Version Control",
    accelerator: "CmdOrCtrl+Shift+G",
    commandId: "app.openVersionControl",
    runCommand,
  });

  return Submenu.new({
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
      themesItem,
      settingsItem,
      workspaceManagerItem,
      versionControlItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Quit" }),
    ],
  });
}

/** Static native menu command ids (dynamic Open Recent paths excluded). */
export const NATIVE_MENU_COMMAND_IDS: readonly AppCommandId[] = [
  "file.new",
  "file.open",
  "app.quickOpenFile",
  "file.openAllInFolder",
  "workspace.add",
  "app.newWindow",
  "tab.moveToNewWindow",
  "file.save",
  "file.saveAs",
  "file.saveAll",
  "file.rename",
  "file.reloadFromDisk",
  "tab.close",
  "file.clearRecentFiles",
  "edit.undo",
  "edit.redo",
  "app.openCommandPalette",
  "app.toggleFindReplace",
  "app.toggleGoTo",
  "app.findInProject",
  "app.replaceInProject",
  "edit.indent",
  "edit.outdent",
  "edit.moveLineUp",
  "edit.moveLineDown",
  "edit.duplicateLine",
  "edit.joinLines",
  "edit.selectNextOccurrence",
  "edit.selectAllOccurrences",
  "edit.skipOccurrence",
  "edit.undoOccurrence",
  "edit.toggleFold",
  "edit.fold",
  "edit.unfold",
  "edit.foldAll",
  "edit.unfoldAll",
  "view.layoutSingle",
  "view.layoutCols2",
  "view.layoutRows2",
  "view.layoutRows3",
  "view.layoutGrid",
  "view.cycleTheme",
  "view.toggleDiffPreview",
  "view.toggleWrap",
  "app.toggleMarkdownOutline",
  "view.zoomIn",
  "view.zoomOut",
  "view.zoomReset",
  "view.focusEditor",
  "app.toggleThemePane",
  "app.toggleSettings",
  "app.openWorkspaceManager",
  "app.openVersionControl",
];
