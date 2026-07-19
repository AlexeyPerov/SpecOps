/**
 * Shared types for the overlay-host subsystem.
 *
 * `OverlayHost.svelte` owns the state and coordinator for the 10 overlays that
 * used to live inline in `+page.svelte`. The host exposes an imperative
 * `OverlayHostApi` (captured by the page via `bind:this`) so the page's
 * retained `$effect`s can drive cross-cutting concerns (close-on-workspace-
 * switch, close-markdown-only-pickers, isAnyOverlayOpen) without the host
 * needing to read the full app snapshot.
 *
 * The two AppShell-rendered overlays (project search panel + workspace context
 * menu) keep their presentational prop shape (defined in `AppShell.svelte`'s
 * prop interfaces). The host hands those shapes back up to the page via
 * exported `$derived` snapshots so AppShell can keep rendering them in its
 * own layout flow — moving the panel out of AppShell's bottom-panel container
 * would change DOM layering, which is out of scope for L14.
 */

import type { ContextId } from "../../domain/contracts";
import type { ProjectSearchResult } from "../../services/projectSearch";

/** The 10 overlay kinds tracked by `OverlayHost`. */
export type OverlayKind =
  | "quickOpen"
  | "commandPalette"
  | "headingJump"
  | "bookmarkList"
  | "snippetInsert"
  | "projectSearch"
  | "sessionList"
  | "addMultiple"
  | "timeline"
  | "workspaceContextMenu";

/**
 * Imperative surface the host exposes to its parent. The parent captures it
 * via `bind:this` and uses it for the cross-cutting `$effect`s that stayed on
 * the page (they couple to retained snapshot state).
 */
export interface OverlayHostApi {
  /** True when ANY of the 10 overlays is open (drives editor-tools sync). */
  isAnyOverlayOpen: () => boolean;
  /** Open a specific overlay, closing the others per the close-others rules. */
  openOverlay: (kind: OverlayKind, options?: OpenOverlayOptions) => void;
  /** Close one overlay. */
  closeOverlay: (kind: OverlayKind) => void;
  /**
   * Close every overlay that should not survive a workspace switch. Mirrors
   * the pre-refactor behavior at `+page.svelte:1553-1575`:
   * closes quickOpen, commandPalette, headingJump, bookmarkList, snippetInsert
   * and cancels in-flight project search. sessionList / addMultiple / timeline
   * / workspaceContextMenu are intentionally NOT closed (pre-existing
   * behavior — see L14 changelog).
   */
  closeAllOnWorkspaceSwitch: () => void;
  /**
   * Close markdown-only / host-scoped pickers when the active document is no
   * longer editable Markdown. Mirrors `+page.svelte:1581-1591`. Asymmetric
   * with workspace-switch (bookmark list is NOT closed here) — pinned as
   * pre-existing behavior.
   */
  closeMarkdownOnlyPickers: (language: string | undefined) => void;
  /** Open the workspace context menu at viewport coordinates. */
  openWorkspaceContextMenu: (workspaceId: ContextId, x: number, y: number) => void;
  /** Refresh the quick-open catalog (delegated to the registry). */
  refreshQuickOpenCatalog: () => void;
}

export interface OpenOverlayOptions {
  /** For project search: whether to focus the replace field. */
  focusReplace?: boolean;
}

/** Snapshot of the project-search panel state (fed to AppShell's prop). */
export interface ProjectSearchPanelState {
  open: boolean;
  heightPx: number;
  focusNonce: number;
  focusReplace: boolean;
  query: string;
  replaceValue: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  queryError: string;
  results: ProjectSearchResult[];
  running: boolean;
  status: string;
}

/** Snapshot of the workspace context menu (fed to AppShell's prop). */
export interface WorkspaceContextMenuState {
  menu: { workspaceId: ContextId; x: number; y: number } | null;
  workspaceId: ContextId | null;
}

/**
 * The OverlayHost instance surface as seen by its parent (captured via
 * `bind:this`). Svelte 5 exposes a component instance as a proxy object
 * whose properties are the exported `const`s. `AppShellHost` reads these to
 * wire the AppShell-rendered overlays (project search + workspace context
 * menu) and `+page.svelte` reads `api` for the cross-cutting `$effect`s.
 */
export interface OverlayHostBound {
  api: OverlayHostApi;
  projectSearchPanelState: ProjectSearchPanelState;
  workspaceContextMenu: {
    workspaceId: ContextId;
    x: number;
    y: number;
  } | null;
  sessionListActiveSessionId: string | null;
  persistProjectSearchHeight: () => void;
  /** Internal setter — exposes the project-search query field setters. */
  setProjectSearchQuery: (query: string) => void;
  setProjectSearchReplace: (replace: string) => void;
  setProjectSearchCaseSensitive: (value: boolean) => void;
  setProjectSearchWholeWord: (value: boolean) => void;
  setProjectSearchRegex: (value: boolean) => void;
  setProjectSearchHeight: (heightPx: number) => void;
  runProjectSearch: () => Promise<void>;
  replaceAllInProject: () => Promise<void>;
  openProjectSearchResult: (path: string, line: number) => Promise<void>;
}
