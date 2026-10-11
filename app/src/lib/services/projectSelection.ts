import type { ProjectTreeNode } from "./projectTree";
import { normalizePathSync } from "./diskFingerprint";

export function selectProjectPaths(
  selected: ReadonlySet<string>, anchor: string | null, path: string,
  visiblePaths: readonly string[], modifiers: { shift: boolean; toggle: boolean },
): { paths: Set<string>; anchor: string } {
  if (modifiers.shift && anchor !== null) {
    const start = visiblePaths.indexOf(anchor); const end = visiblePaths.indexOf(path);
    if (start >= 0 && end >= 0) {
      const paths = new Set(modifiers.toggle ? selected : []);
      for (const entry of visiblePaths.slice(Math.min(start, end), Math.max(start, end) + 1)) paths.add(entry);
      return { paths, anchor };
    }
  }
  const paths = new Set(modifiers.toggle ? selected : []);
  if (modifiers.toggle && paths.has(path)) paths.delete(path); else paths.add(path);
  return { paths, anchor: path };
}

/** Collapse descendants for disk mutations; clipboard actions retain every selected row. */
export function topLevelProjectEntries(entries: readonly ProjectTreeNode[]): ProjectTreeNode[] {
  const unique = [...new Map(entries.map((entry) => [normalizePathSync(entry.path), entry])).values()];
  return unique.filter((entry) => !unique.some((parent) => parent.kind === "directory" &&
    normalizePathSync(entry.path).startsWith(`${normalizePathSync(parent.path).replace(/\/+$/, "")}/`)));
}
