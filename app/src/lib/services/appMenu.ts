import { homeDir } from "@tauri-apps/api/path";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import type { AppCommandId } from "../domain/contracts";
import { logDiagnostic } from "./logging";
import { formatRecentPath } from "./recentFiles";
import { buildAppSubmenu, buildEditMenu, buildFileMenu, buildViewMenu } from "./appMenuDefinitions";

let cachedHomeDir: string | null | undefined;
let openRecentSubmenu: Submenu | null = null;
let menuRunCommand: ((commandId: AppCommandId) => void) | null = null;
const openRecentPathByItemId = new Map<string, string>();
let refreshMenuChain: Promise<void> = Promise.resolve();
let pendingRecentFilesRefresh: string[] | null = null;
let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const REFRESH_DEBOUNCE_MS = 50;

export async function resolveHomeDirForMenu(): Promise<string | null> {
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
  const resolvedHomeDir = await resolveHomeDirForMenu();

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
  openRecentSubmenu = await Submenu.new({
    text: "Open Recent",
    items: [],
  });
  const fileMenu = await buildFileMenu({ runCommand, openRecentSubmenu });
  const editMenu = await buildEditMenu(runCommand);
  const viewMenu = await buildViewMenu(runCommand);
  const appSubmenu = await buildAppSubmenu(runCommand);

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
