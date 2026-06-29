<script lang="ts">
  import EditorPaneView from "./EditorPaneView.svelte";
  import type {
    DocumentState,
    EditorLayout,
    EditorPane,
    TabState,
  } from "../domain/contracts";

  /**
   * Renders the editor area as a grid of panes driven by `layout.slots`
   * (split view / layout groups). Each row of `slots` is a grid row of cells;
   * a cell whose row is narrower than the widest row spans the full width
   * (this is what produces the close-reflow 2-over-1 shape).
   *
   * The active pane (per `layout.activePaneId`) renders the live editor chrome
   * via the `children` snippet; other panes render a placeholder until per-pane
   * editor wiring lands (Phase 4).
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
    background: var(--pane-border-color, rgba(128, 128, 128, 0.2));
  }
  .editor-grid-cell {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--pane-bg, var(--bg-color, #fff));
  }
</style>
