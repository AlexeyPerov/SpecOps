export type AppCommandId =
  | "app.toggleThemePane"
  | "app.toggleSettings"
  | "app.openWorkspaceManager"
  | "app.openVersionControl"
  | "app.newWindow"
  | "app.toggleFindReplace"
  | "app.toggleGoTo"
  | "app.findInProject"
  | "app.replaceInProject"
  | "app.quickOpenFile"
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
  | "edit.selectNextOccurrence"
  | "edit.selectAllOccurrences"
  | "edit.skipOccurrence"
  | "edit.undoOccurrence"
  | "view.toggleWrap"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset"
  | "view.layoutSingle"
  | "view.layoutCols2"
  | "view.layoutRows2"
  | "view.layoutRows3"
  | "view.layoutGrid"
  | "view.focusPane1"
  | "view.focusPane2"
  | "view.focusPane3"
  | "view.focusPane4"
  | "view.focusEditor"
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

/** SpecOps-native command category for menus and future palette grouping. */
export type CommandCategory =
  | "App"
  | "File"
  | "Edit"
  | "View"
  | "Tab"
  | "Workspace"
  | "Navigation";

/**
 * Explicit discoverability intent. Every command must declare one:
 * - `palette` — searchable in the future command palette
 * - `exclude` — intentionally omitted (reason required)
 */
export type CommandPaletteIntent = "palette" | "exclude";

/**
 * Named availability policy shared by menu, shortcuts, and palette.
 * Resolved purely via `commands/availability.ts` (no I/O).
 */
export type CommandAvailabilityKey =
  | "always"
  | "workspace"
  | "document"
  | "dirty"
  | "markdown"
  | "hidden";

export interface CommandDefinition {
  id: AppCommandId;
  label: string;
  /** Native menu placement path; `Hidden/...` means not in the native menu bar. */
  menuPath: string;
  category: CommandCategory;
  /** Extra fuzzy-search terms (aliases); label and id are always searchable. */
  searchTerms?: readonly string[];
  /** Required discoverability intent for palette consistency tests. */
  paletteIntent: CommandPaletteIntent;
  /** Required when `paletteIntent` is `exclude`. */
  paletteExcludeReason?: string;
  /** Availability policy key; defaults to `always` when omitted. */
  availability?: CommandAvailabilityKey;
  binding?: CommandBinding;
}
