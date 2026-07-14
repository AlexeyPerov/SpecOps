<script lang="ts">
  import EditorPaneView from "./EditorPaneView.svelte";
  import type {
    DocumentState,
    EditorLayout,
    EditorPane,
    TabState,
  } from "../domain/contracts";
  import { effectiveLayoutSlots } from "../domain/contracts";
  import type { PaneDropTargetElements } from "./paneDropTargets";

  /**
   * Renders the editor area as a grid of panes driven by `layout.slots`
   * (split view / layout groups). Each row of `slots` is a grid row of cells;
   * a cell whose row is narrower than the widest row spans the full width
   * (this is what produces the close-reflow 2-over-1 shape).
   *
   * Each pane with tabs renders stable editor content via `renderPaneContent`;
   * the active pane owns command-runner registration (F3-B).
   *
   * Phase 5/6 — owns the cross-pane DnD registry: each `EditorPaneView`
   * registers its strip + body elements here so the tab/project drag
   * controllers can hit-test every pane from one place. Also tracks the
   * current drop-target pane id so the hovered pane can render an affordance.
   */
  let {
    layout,
    documents,
    useChatTerminology = false,
    windowId,
    notify,
    onSelectTab,
    onCloseTab,
    onClosePane,
    onFocusPane,
    onMoveTabBetweenPanes,
    onOpenFileInPane,
    tabDropTargetPaneId = $bindable(null),
    fileDropTargetPaneId = null,
    renderPaneContent,
  }: {
    layout: EditorLayout;
    documents: DocumentState[];
    useChatTerminology: boolean;
    windowId: string;
    notify: (message: string) => void;
    onSelectTab: (tabId: string) => void;
    onCloseTab: (paneId: string, tabId: string) => void | Promise<void>;
    onClosePane: (paneId: string) => void;
    onFocusPane: (paneId: string) => void;
    onMoveTabBetweenPanes: (
      fromPaneId: string,
      tabId: string,
      toPaneId: string,
      toIndex: number,
    ) => void;
    onOpenFileInPane: (filePath: string, paneId: string) => void | Promise<void>;
    tabDropTargetPaneId?: string | null;
    /** Driven by the parent (from the project-tree file drag); read-only here. */
    fileDropTargetPaneId?: string | null;
    renderPaneContent?: import("svelte").Snippet<[paneId: string]>;
  } = $props();

  const canClosePane = $derived(layout.panes.length > 1);

  const resolvedSlots = $derived(effectiveLayoutSlots(layout));
  const maxRowWidth = $derived(Math.max(1, ...resolvedSlots.map((row) => row.length)));

  interface PaneCell {
    pane: EditorPane;
    paneIndex: number;
    /** 1-based CSS grid row. */
    gridRow: number;
    /** CSS grid-column value (e.g. `1`, `2`, `1 / -1`). */
    gridColumn: string;
    key: string;
  }

  const cells = $derived.by<PaneCell[]>(() => {
    const slots = resolvedSlots;
    const width = maxRowWidth;
    const out: PaneCell[] = [];
    const seen = new Set<number>();

    for (let rowIndex = 0; rowIndex < slots.length; rowIndex += 1) {
      const row = slots[rowIndex] ?? [];
      const rowWidth = row.length;
      const spansFullWidth = rowWidth < width;
      for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
        const paneIndex = row[colIndex];
        if (paneIndex === undefined || seen.has(paneIndex)) {
          continue;
        }
        seen.add(paneIndex);
        const pane = layout.panes[paneIndex];
        if (!pane) {
          continue;
        }
        out.push({
          pane,
          paneIndex,
          gridRow: rowIndex + 1,
          gridColumn: spansFullWidth ? "1 / -1" : String(colIndex + 1),
          key: pane.id,
        });
      }
    }

    // Safety net: panes not referenced by slots stack in extra full-width rows.
    let extraRow = slots.length + 1;
    for (let i = 0; i < layout.panes.length; i += 1) {
      if (!seen.has(i)) {
        out.push({
          pane: layout.panes[i],
          paneIndex: i,
          gridRow: extraRow,
          gridColumn: "1 / -1",
          key: `extra-${layout.panes[i].id}`,
        });
        extraRow += 1;
      }
    }
    return out;
  });

  /** Explicit row tracks for every placed pane (implicit rows collapse to thin strips). */
  const rowCount = $derived.by(() => {
    let maxRow = resolvedSlots.length;
    for (const cell of cells) {
      if (cell.gridRow > maxRow) {
        maxRow = cell.gridRow;
      }
    }
    return Math.max(1, maxRow);
  });

  const gridStyle = $derived(
    `grid-template-columns: repeat(${maxRowWidth}, minmax(0, 1fr)); grid-template-rows: repeat(${rowCount}, minmax(0, 1fr));`,
  );

  function cellGridStyle(cell: PaneCell): string {
    return `grid-row: ${cell.gridRow}; grid-column: ${cell.gridColumn};`;
  }

  function paneTabs(pane: EditorPane): TabState[] {
    return pane.tabs;
  }

  // ---- Cross-pane DnD registry (Phase 5/6) ----
  // paneId → strip/body elements, populated by each EditorPaneView on mount.
  const paneElements = $state(new Map<string, { stripEl: HTMLElement | null; bodyEl: HTMLElement | null }>());

  function registerPaneElements(
    paneId: string,
    elements: { stripEl: HTMLElement | null; bodyEl: HTMLElement | null },
  ): void {
    paneElements.set(paneId, elements);
  }

  function unregisterPaneElements(paneId: string): void {
    paneElements.delete(paneId);
  }

  /** Live snapshot of every pane's strip/body elements, for hit-testing. */
  const paneElementsList = $derived.by<PaneDropTargetElements[]>(() => {
    void paneElements.size; // depend on the map
    const out: PaneDropTargetElements[] = [];
    for (const cell of cells) {
      const entry = paneElements.get(cell.pane.id);
      out.push({
        paneId: cell.pane.id,
        stripEl: entry?.stripEl ?? null,
        bodyEl: entry?.bodyEl ?? null,
      });
    }
    return out;
  });

  function getPaneElements(): PaneDropTargetElements[] {
    return paneElementsList;
  }

  function getPaneTabCount(paneId: string): number {
    return layout.panes.find((pane) => pane.id === paneId)?.tabs.length ?? 0;
  }

  // Tab-drop highlight is driven by each TabBar's cross-pane hover (written
  // back into the bindable `tabDropTargetPaneId`); file-drop highlight is read
  // from the parent (the project-tree drag owns that state).
  function setTabDropTarget(paneId: string | null): void {
    tabDropTargetPaneId = paneId;
  }
</script>

<div class="editor-grid" style={gridStyle}>
  {#each cells as cell (cell.key)}
    <div class="editor-grid-cell" style={cellGridStyle(cell)}>
      <EditorPaneView
        paneId={cell.pane.id}
        tabs={paneTabs(cell.pane)}
        selectedTabId={cell.pane.selectedTabId}
        {documents}
        isActive={cell.pane.id === layout.activePaneId}
        canClose={canClosePane}
        {useChatTerminology}
        {windowId}
        {notify}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onClosePane={onClosePane}
        onFocus={onFocusPane}
        onRegisterElements={registerPaneElements}
        onUnregisterElements={unregisterPaneElements}
        getPaneElements={getPaneElements}
        getPaneTabCount={getPaneTabCount}
        tabDropTargetPaneId={tabDropTargetPaneId}
        fileDropTargetPaneId={fileDropTargetPaneId}
        onTabDropTargetChange={setTabDropTarget}
        onMoveTabBetweenPanes={onMoveTabBetweenPanes}
        onOpenFileInPane={onOpenFileInPane}
      >
        {#if cell.pane.selectedTabId}
          {@render renderPaneContent?.(cell.pane.id)}
        {/if}
      </EditorPaneView>
    </div>
  {/each}
</div>

<style>
  .editor-grid {
    display: grid;
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    gap: 1px;
    background: var(--color-border-subtle);
  }
  .editor-grid-cell {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--color-bg-root);
  }
</style>
