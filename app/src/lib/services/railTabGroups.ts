import type { DocumentState, TabGroupEntry, TabGroupId } from "../domain/contracts";
import { allTabs, isFileTab } from "../domain/contracts";

/** A tab shown in an expanded tab group row's "last opened" list. */
export interface RailTabGroupTab {
  tabId: string;
  label: string;
}

/** Sidebar row data for one window tab group. */
export interface RailTabGroup {
  id: TabGroupId;
  name: string;
  tabCount: number;
  /** Last opened saved files in append order (newest last), at most the selector limit. */
  recentTabs: RailTabGroupTab[];
}

/**
 * Formats a tab group tab as `<parent-folder>/<filename.ext>`, used by the
 * expanded tab group row's "last opened tabs" list.
 *
 * - On-disk file with a parent folder → `parent/file.ext`.
 * - File at the filesystem root (no parent) → just the filename.
 * - Unsaved/untitled document (no `filePath`) → `title` (or "Untitled").
 *
 * Pure string ops only (no Tauri async path APIs) — this runs inside
 * synchronous `$derived` computations, mirroring `basename` in
 * `state/appState/documentHelpers.ts`.
 */
export function formatTabGroupTabLabel(filePath: string | null, title: string): string {
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

function recentTabs(group: TabGroupEntry, limit: number): RailTabGroupTab[] {
  const documents = new Map<string, DocumentState>(group.snapshot.documents.map((doc) => [doc.id, doc]));
  return allTabs(group.snapshot.session.editorLayout)
    .filter(isFileTab)
    // Untitled buffers have no on-disk path; the row lists real saved files only.
    .filter((tab) => Boolean(documents.get(tab.documentId)?.filePath))
    .slice(-limit)
    .map((tab) => {
      const doc = documents.get(tab.documentId);
      return { tabId: tab.id, label: formatTabGroupTabLabel(doc?.filePath ?? null, doc?.title ?? "") };
    });
}

/**
 * Builds sidebar rows for the window's tab groups. Rows and the returned array
 * keep their identity while a group's name, session and documents are
 * unchanged, so unrelated app-state emits (caret moves, other contexts' edits)
 * do not re-render the rows.
 */
export function createRailTabGroupsSelector(limit = 3): (groups: TabGroupEntry[]) => RailTabGroup[] {
  const cache = new Map<TabGroupId, { group: Pick<TabGroupEntry, "name"> & TabGroupEntry["snapshot"]; row: RailTabGroup }>();
  let previous: RailTabGroup[] = [];
  return (groups) => {
    const rows = groups.map((group) => {
      const cached = cache.get(group.id);
      if (
        cached &&
        cached.group.name === group.name &&
        cached.group.session === group.snapshot.session &&
        cached.group.documents === group.snapshot.documents
      ) {
        return cached.row;
      }
      const row: RailTabGroup = {
        id: group.id,
        name: group.name,
        tabCount: allTabs(group.snapshot.session.editorLayout).length,
        recentTabs: recentTabs(group, limit),
      };
      cache.set(group.id, { group: { name: group.name, ...group.snapshot }, row });
      return row;
    });
    for (const id of cache.keys()) {
      if (!groups.some((group) => group.id === id)) cache.delete(id);
    }
    if (rows.length === previous.length && rows.every((row, index) => row === previous[index])) {
      return previous;
    }
    previous = rows;
    return rows;
  };
}
