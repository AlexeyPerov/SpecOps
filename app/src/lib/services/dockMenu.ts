import { invoke } from "@tauri-apps/api/core";
import { formatRecentPath } from "./recentFiles";
import { resolveHomeDirForMenu } from "./appMenu";

interface DockRecentItem {
  path: string;
  label: string;
}

export async function refreshDockMenu(recentFiles: string[]): Promise<void> {
  try {
    const homeDir = await resolveHomeDirForMenu();
    const items: DockRecentItem[] = recentFiles.map((path) => ({
      path,
      label: formatRecentPath(path, homeDir),
    }));
    await invoke("refresh_dock_menu", { items });
  } catch {
    // Dock menu is macOS-only; ignore when the command is unavailable.
  }
}
