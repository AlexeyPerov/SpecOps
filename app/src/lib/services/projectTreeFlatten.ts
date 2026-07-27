/**
 * Flattens the lazily-loaded project tree into the visible row list (H35).
 *
 * The tree used to render through a recursive component pair (one component
 * per row, props like `dragState`/`statusByPath` threaded through every
 * level, so any change invalidated the whole recursive subtree). Flattening
 * moves the traversal into one pure pass so the view can render a single
 * `{#each}` — and window it for large trees.
 */

import type { ProjectTreeNode } from "./projectTree";

export type ProjectTreeRow =
  | {
      kind: "node";
      node: ProjectTreeNode;
      depth: number;
      /** Directory that can expand (unloaded, non-empty, or currently loading). */
      canExpand: boolean;
      /** Raw expanded flag (drives aria-expanded, like the old recursive list). */
      expanded: boolean;
    }
  | { kind: "loading"; path: string; depth: number };

/** Stable Svelte each-key for a row. */
export function projectTreeRowKey(row: ProjectTreeRow): string {
  return row.kind === "node" ? row.node.path : `loading:${row.path}`;
}

export function flattenProjectTree(
  nodes: readonly ProjectTreeNode[],
  expandedPaths: ReadonlySet<string>,
  childrenByPath: ReadonlyMap<string, ProjectTreeNode[]>,
  loadingPaths: ReadonlySet<string>,
): ProjectTreeRow[] {
  const rows: ProjectTreeRow[] = [];

  function visit(list: readonly ProjectTreeNode[], depth: number): void {
    for (const node of list) {
      const isDirectory = node.kind === "directory";
      const hasLoadedChildren = isDirectory && childrenByPath.has(node.path);
      const children = isDirectory ? (childrenByPath.get(node.path) ?? []) : [];
      const canExpand =
        isDirectory &&
        (!hasLoadedChildren || children.length > 0 || loadingPaths.has(node.path));
      const expanded = isDirectory && expandedPaths.has(node.path);
      rows.push({ kind: "node", node, depth, canExpand, expanded });
      if (!isDirectory || !canExpand || !expanded) {
        continue;
      }
      if (loadingPaths.has(node.path)) {
        rows.push({ kind: "loading", path: node.path, depth: depth + 1 });
        continue;
      }
      visit(children, depth + 1);
    }
  }

  visit(nodes, 0);
  return rows;
}
