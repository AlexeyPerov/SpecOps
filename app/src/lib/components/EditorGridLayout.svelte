<script lang="ts">
  import EditorPaneView from "./EditorPaneView.svelte";
  import type {
    DocumentState,
    EditorLayout,
    EditorPane,
    TabState,
  } from "../domain/contracts";
  import type { PaneDropTargetElements } from "./paneDropTargets";

  /**
   * Renders the editor area as a grid of panes driven by `layout.slots`
   * (split view / layout groups). Each row of `slots` is a grid row of cells;
   * a cell whose row is narrower than the widest row spans the full width
   * (this is what produces the close-reflow 2-over-1 shape).
   *
   * The active pane (per `layout.activePaneId`) renders the live editor chrome
   * via the `children` snippet; other panes render a placeholder until per-pane
   * editor wiring lands (Phase 4).
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
    children,
  }: {
    layout: EditorLayout;
    documents: DocumentState[];
    useChatTerminology: boolean;
    windowId: string;
    notify: (message: string) => void;
    onSelectTab: (tabId: string) => void;
    onCloseTab: (tabId: string) => void | Promise<void>;
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
    children?: import("svelte").Snippet;
  } = $props();

  const canClosePane = $derived(layout.panes.length > 1);
  const maxRowWidth = $derived(Math.max(1, ...layout.slots.map((row) => row.length)));
  const rowCount = $derived(layout.slots.length);

  // Flatten slots into cells in reading order, tracking each cell's pane + row width.
  interface PaneCell {
    pane: EditorPane;
    paneIndex: number;
    spansFullWidth: boolean;
    key: string;
  }
  const cells = $derived.by<PaneCell[]>(() => {
    const out: PaneCell[] = [];
    const seen = new Set<number>();
    for (const row of layout.slots) {
      const rowWidth = row.length;
      for (const paneIndex of row) {
        if (seen.has(paneIndex)) {
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
          spansFullWidth: rowWidth < maxRowWidth,
          key: pane.id,
        });
      }
    }
    // Safety net: include any pane not referenced by slots.
    for (let i = 0; i < layout.panes.length; i += 1) {
      if (!seen.has(i)) {
        out.push({
          pane: layout.panes[i],
          paneIndex: i,
          spansFullWidth: false,
          key: `extra-${layout.panes[i].id}`,
        });
      }
    }
    return out;
  });

  const gridStyle = $derived(
    `grid-template-columns: repeat(${maxRowWidth}, minmax(0, 1fr)); grid-template-rows: repeat(${rowCount}, minmax(0, 1fr));`,
  );

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

  // Tab-drop highlight is driven by each TabBar's cross-pane hover (written
  // back into the bindable `tabDropTargetPaneId`); file-drop highlight is read
  // from the parent (the project-tree drag owns that state).
  function setTabDropTarget(paneId: string | null): void {
    tabDropTargetPaneId = paneId;
  }
</script>

<div class="editor-grid" style={gridStyle}>
  {#each cells as cell (cell.key)}
    <div
      class="editor-grid-cell"
      style={cell.spansFullWidth ? "grid-column: 1 / -1;" : ""}
    >
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
        tabDropTargetPaneId={tabDropTargetPaneId}
        fileDropTargetPaneId={fileDropTargetPaneId}
        onTabDropTargetChange={setTabDropTarget}
        onMoveTabBetweenPanes={onMoveTabBetweenPanes}
        onOpenFileInPane={onOpenFileInPane}
      >
        {#if cell.pane.id === layout.activePaneId}
          {@render children?.()}
        {/if}
      </EditorPaneView>
    </div>
  {/each}
</div>

<style>
  .editor-grid {
    display: grid;
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
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--color-bg-root);
  }
</style>
