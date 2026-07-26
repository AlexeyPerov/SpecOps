/**
 * Atomic text-file writes (H24).
 *
 * A plain `writeTextFile` truncates the target before writing, so a crash,
 * kill, or full disk mid-write leaves the file empty or partial — for
 * `session.json` that destroys every open tab's unsaved content. Writing to a
 * sibling temp file and renaming it over the target makes the swap atomic on
 * the same volume: readers see either the old content or the new, never a
 * truncated file.
 *
 * The temp file lives next to the target (same directory, therefore same
 * volume) so the rename cannot degrade into a copy. If the rename fails
 * (some platforms/filesystems refuse rename-over-existing), we fall back to a
 * direct write rather than losing the change entirely.
 */

import { remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";

function tempPathFor(path: string): string {
  return `${path}.${Math.random().toString(36).slice(2, 10)}.tmp`;
}

/** Write `content` to `path` via temp-file + rename (direct-write fallback). */
export async function atomicWriteTextFile(path: string, content: string): Promise<void> {
  const tempPath = tempPathFor(path);
  try {
    await writeTextFile(tempPath, content);
    await rename(tempPath, path);
  } catch {
    // rename-over-existing can fail on some platforms/filesystems; fall back
    // to a direct write rather than losing the write entirely.
    try {
      await remove(tempPath);
    } catch {
      // best-effort temp cleanup
    }
    await writeTextFile(path, content);
  }
}
