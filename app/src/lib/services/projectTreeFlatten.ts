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

/**
 * `previousRows` (the last result, by key) lets an unchanged row keep its
 * object identity, so a keyed `{#each}` skips it instead of re-rendering every
 * visible row on each expand/collapse.
 */
export function flattenProjectTree(
  nodes: readonly ProjectTreeNode[],
  expandedPaths: ReadonlySet<string>,
  childrenByPath: ReadonlyMap<string, ProjectTreeNode[]>,
  loadingPaths: ReadonlySet<string>,
  previousRows?: ReadonlyMap<string, ProjectTreeRow>,
): ProjectTreeRow[] {
  const rows: ProjectTreeRow[] = [];

  function pushNode(node: ProjectTreeNode, depth: number, canExpand: boolean, expanded: boolean): void {
    const previous = previousRows?.get(node.path);
    if (
      previous?.kind === "node" &&
      previous.node === node &&
      previous.depth === depth &&
      previous.canExpand === canExpand &&
      previous.expanded === expanded
    ) {
      rows.push(previous);
      return;
    }
    rows.push({ kind: "node", node, depth, canExpand, expanded });
  }

  function pushLoading(path: string, depth: number): void {
    const previous = previousRows?.get(`loading:${path}`);
    rows.push(
      previous?.kind === "loading" && previous.depth === depth
        ? previous
        : { kind: "loading", path, depth },
    );
  }

  function visit(list: readonly ProjectTreeNode[], depth: number): void {
    for (const node of list) {
      const isDirectory = node.kind === "directory";
      const hasLoadedChildren = isDirectory && childrenByPath.has(node.path);
      const children = isDirectory ? (childrenByPath.get(node.path) ?? []) : [];
      const canExpand =
        isDirectory &&
        (!hasLoadedChildren || children.length > 0 || loadingPaths.has(node.path));
      const expanded = isDirectory && expandedPaths.has(node.path);
      pushNode(node, depth, canExpand, expanded);
      if (!isDirectory || !canExpand || !expanded) {
        continue;
      }
      if (loadingPaths.has(node.path)) {
        pushLoading(node.path, depth + 1);
        continue;
      }
      visit(children, depth + 1);
    }
  }

  visit(nodes, 0);
  return rows;
}
