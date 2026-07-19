/**
 * Pure-logic coordinator for the 10-overlay close-others matrix.
 *
 * Extracted from `OverlayHost.svelte` so the cross-overlay rules are unit-
 * testable without mounting the component. The component owns the `$state`
 * and calls into these helpers; the helpers themselves only read / write the
 * plain state object the component hands them.
 *
 * All behavior here mirrors the pre-refactor inline blocks in `+page.svelte`
 * (the openQuickOpen / openHeadingJump / etc. handlers at lines 1110-1199,
 * the workspace-switch picker-clear at 1553-1575, and the markdown-only
 * picker closer at 1581-1591). The asymmetries noted in the L14 changelog —
 * bookmark list NOT closed on language change; sessionList / addMultiple /
 * timeline / workspaceContextMenu NOT closed on workspace switch — are pinned
 * by tests in `overlayCoordinator.test.ts`.
 */

import type { ContextId } from "../../domain/contracts";
import type { OverlayKind } from "./overlayHostTypes";

/**
 * The mutable overlay-state shape the coordinator operates on. The component
 * passes its `$state` fields wrapped in a plain object (or a fresh snapshot
 * for tests).
 */
export interface OverlayState {
  quickOpenOpen: boolean;
  commandPaletteOpen: boolean;
  headingJumpOpen: boolean;
  bookmarkListOpen: boolean;
  snippetInsertOpen: boolean;
  projectSearchOpen: boolean;
  sessionListOpen: boolean;
  addMultipleOpen: boolean;
  timelineOpen: boolean;
  workspaceContextMenu: { workspaceId: ContextId; x: number; y: number } | null;
}

export interface OverlayCoordinatorDeps {
  /** Read the current state (the component hands its live `$state` snapshot). */
  getState: () => OverlayState;
  /** Apply a partial patch back into the component's `$state`. */
  patch: (patch: Partial<OverlayState>) => void;
  /** Reset snippetInsertHostIdentity (only this field needs a dedicated setter
   *  because it lives next to snippetInsertOpen but isn't in OverlayState). */
  clearSnippetInsertHostIdentity?: () => void;
}

/** The pickers that participate in the open-one-closes-others matrix. */
const CLOSE_OTHERS_PICKERS: ReadonlySet<OverlayKind> = new Set([
  "quickOpen",
  "commandPalette",
  "headingJump",
  "bookmarkList",
  "snippetInsert",
]);

/**
 * The pickers that should close the editor inline-tools when they open.
 * Mirrors the pre-refactor calls to `editorTools.close({ restoreFocus: false })`
 * inside openHeadingJump / openBookmarkList / openSnippetInsert /
 * openCommandPalette. Quick Open deliberately did NOT close editor tools.
 */
const EDITOR_TOOLS_CLOSING_PICKERS: ReadonlySet<OverlayKind> = new Set([
  "commandPalette",
  "headingJump",
  "bookmarkList",
  "snippetInsert",
]);

export function createOverlayCoordinator(deps: OverlayCoordinatorDeps) {
  /**
   * Close every other "close-others" picker. Used by openOverlay to enforce
   * the matrix; also reusable for the workspace-switch closer.
   */
  function closeOtherPickers(except: OverlayKind): void {
    const patch: Partial<OverlayState> = {};
    if (except !== "quickOpen") patch.quickOpenOpen = false;
    if (except !== "commandPalette") patch.commandPaletteOpen = false;
    if (except !== "headingJump") patch.headingJumpOpen = false;
    if (except !== "bookmarkList") patch.bookmarkListOpen = false;
    if (except !== "snippetInsert") {
      patch.snippetInsertOpen = false;
      deps.clearSnippetInsertHostIdentity?.();
    }
    deps.patch(patch);
  }

  /** Returns true if the given picker opening should close editor inline tools. */
  function shouldCloseEditorTools(kind: OverlayKind): boolean {
    return EDITOR_TOOLS_CLOSING_PICKERS.has(kind);
  }

  /** Returns true if the given overlay kind is one of the 5 pickers. */
  function isPicker(kind: OverlayKind): boolean {
    return CLOSE_OTHERS_PICKERS.has(kind);
  }

  /** True when ANY of the 10 overlays is open. */
  function isAnyOverlayOpen(): boolean {
    const s = deps.getState();
    return (
      s.sessionListOpen ||
      s.addMultipleOpen ||
      s.projectSearchOpen ||
      s.timelineOpen ||
      s.quickOpenOpen ||
      s.commandPaletteOpen ||
      s.headingJumpOpen ||
      s.bookmarkListOpen ||
      s.snippetInsertOpen ||
      Boolean(s.workspaceContextMenu)
    );
  }

  /**
   * Mirrors the pre-refactor workspace-switch picker-clear block at
   * +page.svelte:1553-1575. sessionList / addMultiple / timeline /
   * workspaceContextMenu are intentionally NOT closed (pre-existing behavior).
   *
   * Project search is NOT closed here either — the pre-refactor code cancelled
   * the in-flight search and cleared the results/status/running flags but left
   * `projectSearchOpen` true. The cancellation flag-bump is the caller's
   * responsibility (it lives in the component alongside the results state).
   */
  function closeAllOnWorkspaceSwitch(): void {
    const s = deps.getState();
    const patch: Partial<OverlayState> = {
      quickOpenOpen: false,
      commandPaletteOpen: false,
      headingJumpOpen: false,
      bookmarkListOpen: false,
    };
    // snippetInsert also clears its captured host identity.
    if (s.snippetInsertOpen) {
      patch.snippetInsertOpen = false;
      deps.clearSnippetInsertHostIdentity?.();
    }
    deps.patch(patch);
  }

  /**
   * Mirrors the pre-refactor markdown-only picker closer at +page.svelte:1581-
   * 1591. Asymmetric with closeAllOnWorkspaceSwitch: bookmarkList is NOT
   * closed here — bookmarks exist for any document type.
   */
  function closeMarkdownOnlyPickers(language: string | undefined): void {
    if (language === "markdown") {
      return;
    }
    const s = deps.getState();
    const patch: Partial<OverlayState> = {};
    if (s.headingJumpOpen) patch.headingJumpOpen = false;
    if (s.snippetInsertOpen) {
      patch.snippetInsertOpen = false;
      deps.clearSnippetInsertHostIdentity?.();
    }
    if (Object.keys(patch).length > 0) {
      deps.patch(patch);
    }
  }

  return {
    closeOtherPickers,
    shouldCloseEditorTools,
    isPicker,
    isAnyOverlayOpen,
    closeAllOnWorkspaceSwitch,
    closeMarkdownOnlyPickers,
  };
}

export type OverlayCoordinator = ReturnType<typeof createOverlayCoordinator>;
