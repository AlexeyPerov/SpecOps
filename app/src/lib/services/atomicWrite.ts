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
 * (some platforms/filesystems refuse rename-over-existing), we retry the
 * rename once after removing the target — and only if *that* rename shape is
 * the problem do we fall back to a direct write. A failure while writing the
 * temp file (ENOSPC, EIO) is re-thrown: falling back to a truncating write
 * there would destroy the previously-good target, which is exactly the
 * scenario atomicity exists to prevent.
 *
 * Note on durability: the rename is atomic but is not `fsync`'d, so a power
 * loss immediately after this returns can still leave a zero-length target.
 * Adding an fsync of the temp file and the parent directory would close that
 * gap; the Tauri fs plugin does not expose fsync/dirfsync, so the residual
 * window is accepted and documented here rather than papered over.
 */

import { remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";

function tempPathFor(path: string): string {
  return `${path}.${Math.random().toString(36).slice(2, 10)}.tmp`;
}

/**
 * Best-effort classification of an error from the temp write / rename steps.
 *
 * Only rename-specific failures (the target exists and the platform refuses to
 * rename over it, or the destination vanished mid-rename) may trigger the
 * non-atomic fallback. Everything else — a full disk, an I/O error while
 * writing the temp file, a permission error — must propagate, because a
 * truncating direct write in those conditions would destroy the existing good
 * target.
 */
function isRenameFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  // "file exists" / EEXIST: rename-over-existing rejected (the classic case).
  // "not permitted" / EACCES on rename: some sandboxes refuse rename-over-file.
  // "no such file" / ENOENT during rename: temp or target vanished — retryable.
  return (
    lower.includes("file exists") ||
    lower.includes("already exists") ||
    lower.includes("os error 17") ||
    lower.includes("not permitted") ||
    lower.includes("no such file") ||
    lower.includes("not found") ||
    lower.includes("os error 2")
  );
}

/** Write `content` to `path` via temp-file + rename (direct-write fallback only for rename failures). */
export async function atomicWriteTextFile(path: string, content: string): Promise<void> {
  const tempPath = tempPathFor(path);
  try {
    // Write the temp file first. A failure here (ENOSPC, EIO, EACCES on the
    // directory) must NOT trigger the truncating fallback — the original file
    // is still intact and overwriting it with a partial/empty buffer is the
    // data-loss scenario atomic writes exist to prevent.
    await writeTextFile(tempPath, content);
  } catch (error: unknown) {
    await cleanupTemp(tempPath);
    throw error;
  }

  try {
    await rename(tempPath, path);
    return;
  } catch (error: unknown) {
    // Only a rename-specific failure may fall through to the retry/fallback.
    if (!isRenameFailure(error)) {
      await cleanupTemp(tempPath);
      throw error;
    }
  }

  // Rename-over-existing failed in a retryable way. Remove the stale target
  // and retry the rename once; this keeps the swap atomic on platforms where
  // `rename` won't overwrite but `remove` + `rename` will, and leaves a
  // (brief) window where the target is absent only on platforms that needed
  // the fallback in the first place.
  try {
    await remove(path);
  } catch {
    // Target may already be gone (ENOENT is fine); any other error means we
    // cannot clear the way for the rename, so surface the original temp
    // content via direct write as a last resort below.
  }
  try {
    await rename(tempPath, path);
    return;
  } catch {
    // Fall through to the non-atomic direct write.
  }

  // Last resort: the platform genuinely cannot rename over the target. A
  // direct write is the only way to make progress, and at this point the
  // rename has already been attempted (and the temp file written
  // successfully), so we are not destroying a good target due to a write
  // error — we are replacing it because no atomic swap is available here.
  try {
    await writeTextFile(path, content);
  } finally {
    await cleanupTemp(tempPath);
  }
}

async function cleanupTemp(tempPath: string): Promise<void> {
  try {
    await remove(tempPath);
  } catch {
    // best-effort temp cleanup
  }
}
