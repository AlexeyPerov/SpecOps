export type AppCommandId =
  | "app.toggleThemePane"
  | "app.toggleSettings"
  | "app.newWindow"
  | "app.toggleFindReplace"
  | "app.toggleGoTo"
  | "view.cycleTheme"
  | "view.toggleMarkdownPreview"
  | "view.toggleDiffPreview"
  | "file.new"
  | "file.open"
  | "file.openRecent"
  | "file.clearRecentFiles"
  | "file.openAllInFolder"
  | "file.save"
  | "file.saveAs"
  | "file.saveAll"
  | "file.rename"
  | "file.reloadFromDisk"
  | "tab.close"
  | "tab.moveToNewWindow"
  | "tab.next"
  | "tab.previous"
  | "edit.undo"
  | "edit.redo"
  | "edit.indent"
  | "edit.outdent"
  | "edit.moveLineUp"
  | "edit.moveLineDown"
  | "edit.duplicateLine"
  | "edit.joinLines"
  | "view.toggleWrap"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset"
  | "workspace.add"
  | "workspace.close"
  | "workspace.reorder";

export interface WorkspaceReorderPayload {
  fromIndex: number;
  toIndex: number;
}

export interface CommandBinding {
  mac: string;
  windows: string;
}

export type CommandBindingOverrides = Partial<Record<AppCommandId, Partial<CommandBinding>>>;

export interface CommandDefinition {
  id: AppCommandId;
  label: string;
  menuPath: string;
  binding?: CommandBinding;
}
