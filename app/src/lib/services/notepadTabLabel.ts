/**
 * Formats a notepad tab as `<parent-folder>/<filename.ext>`, used by the
 * expanded notepad rail card's "last opened tabs" list.
 *
 * - On-disk file with a parent folder → `parent/file.ext`.
 * - File at the filesystem root (no parent) → just the filename.
 * - Unsaved/untitled document (no `filePath`) → `title` (or "Untitled").
 *
 * Pure string ops only (no Tauri async path APIs) — this runs inside
 * synchronous `$derived` computations, mirroring `basename` in
 * `state/appState/documentHelpers.ts`.
 */
export function formatNotepadTabLabel(filePath: string | null, title: string): string {
  if (!filePath) {
    return title || "Untitled";
  }
  const normalized = filePath.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const filename = parts[parts.length - 1];
  if (!filename || parts.length < 2) {
    // No parent folder (root) or empty path → just the filename / title.
    return filename || title || "Untitled";
  }
  const parent = parts[parts.length - 2];
  return `${parent}/${filename}`;
}
