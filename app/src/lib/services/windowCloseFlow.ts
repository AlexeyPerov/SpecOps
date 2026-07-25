import { invoke } from "@tauri-apps/api/core";
import type { AppDomainState, ContextId, DocumentState } from "../domain/contracts";
import { appState } from "../state/appState";
import { allContextSnapshots } from "../state/appState/contextHelpers";
import { requestConfirm } from "./confirmDialogUi";
import { saveAllDirtyDocumentsToDisk } from "./workspaceCloseFlow";
import { flushSessionPersistence } from "./sessionManager";
import { logDiagnostic } from "./logging";

/** A dirty document together with the context that owns it. */
export type DirtyDocumentEntry = {
  contextId: ContextId;
  document: DocumentState;
};

/**
 * Every unsaved editable buffer in the window, across all contexts.
 *
 * Image/binary/large-pending documents are excluded: they are never editable, so an
 * `isDirty` flag on one would not correspond to anything the user could save.
 */
export function collectDirtyDocuments(state: AppDomainState): DirtyDocumentEntry[] {
  const entries: DirtyDocumentEntry[] = [];
  for (const context of allContextSnapshots(state)) {
    for (const document of context.snapshot.documents) {
      if (document.isDirty && document.contentKind === "text") {
        entries.push({ contextId: context.id, document });
      }
    }
  }
  return entries;
}

/** Group dirty documents by owning context so each batch can be saved in place. */
function groupByContext(entries: DirtyDocumentEntry[]): Map<ContextId, DocumentState[]> {
  const grouped = new Map<ContextId, DocumentState[]>();
  for (const entry of entries) {
    const existing = grouped.get(entry.contextId);
    if (existing) {
      existing.push(entry.document);
    } else {
      grouped.set(entry.contextId, [entry.document]);
    }
  }
  return grouped;
}

function describeDirtyDocuments(entries: DirtyDocumentEntry[]): string {
  const titles = entries.slice(0, 5).map((entry) => entry.document.title);
  const remaining = entries.length - titles.length;
  const list = titles.map((title) => `• ${title}`).join("\n");
  return remaining > 0 ? `${list}\n• …and ${remaining} more` : list;
}

export type WindowCloseDeps = {
  getWindowId: () => string;
  notify: (message: string) => void;
  /** Awaited before the window is allowed to close. */
  flushSession: () => Promise<void>;
};

/**
 * Decide whether the window may close, saving or discarding unsaved work first.
 *
 * Returns true to proceed with the close, false to keep the window open.
 *
 * Two things used to go wrong at this point, both silent:
 *
 *  1. Nothing prompted. Cmd+Q went straight through `PredefinedMenuItem` "Quit" and
 *     dirty tabs were simply gone.
 *  2. The only durable copy of an unsaved buffer is the session snapshot, and that was
 *     written on a 1200 ms debounce restarted by every keystroke — then flushed
 *     fire-and-forget from `pagehide`, which cannot await. Continuous typing meant it
 *     never landed at all.
 *
 * So this both asks, and awaits the flush before returning true.
 */
export async function confirmWindowClose(deps: WindowCloseDeps): Promise<boolean> {
  const dirtyEntries = collectDirtyDocuments(appState.getSnapshot());

  if (dirtyEntries.length > 0) {
    const shouldSave = await requestConfirm({
      title: "Unsaved changes",
      message:
        `${dirtyEntries.length} file(s) have unsaved changes:\n\n${describeDirtyDocuments(dirtyEntries)}` +
        "\n\nSave them before closing?",
      confirmLabel: "Save all",
      cancelLabel: "More options",
    });

    if (shouldSave) {
      for (const [contextId, documents] of groupByContext(dirtyEntries)) {
        const saved = await saveAllDirtyDocumentsToDisk(
          contextId,
          documents,
          deps.notify,
          deps,
        );
        if (!saved) {
          // A save-as was dismissed or a write failed. Abort the close so the user
          // still has the buffer rather than losing it to a half-finished quit.
          return false;
        }
      }
    } else {
      const shouldDiscard = await requestConfirm({
        title: "Discard changes",
        message: "Close without saving? Unsaved changes are kept in the restored session.",
        confirmLabel: "Close without saving",
        cancelLabel: "Cancel",
        danger: true,
      });
      if (!shouldDiscard) {
        return false;
      }
    }
  }

  // Awaited, unlike the pagehide path: this is the last chance to get unsaved buffers
  // into session.json, and it needs two IPC hops (read then write) to get there.
  try {
    await deps.flushSession();
  } catch (error: unknown) {
    await logDiagnostic({
      level: "error",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "session flush on window close failed",
      metadata: { error: error instanceof Error ? error.message : String(error) },
    });
  }
  return true;
}

/**
 * Quit the whole app: same prompt and flush as a window close, then exit.
 *
 * Wired to a custom "Quit SpecOps" menu item rather than Tauri's predefined one,
 * because the predefined item calls `exit(0)` immediately — firing neither
 * `CloseRequested` nor `ExitRequested` — so Cmd+Q used to bypass the prompt, the
 * session flush, and the Rust-side sidecar/git cleanup all at once.
 */
export async function requestAppQuit(deps: {
  getWindowId: () => string;
  notify: (message: string) => void;
}): Promise<void> {
  const mayQuit = await confirmWindowClose({
    getWindowId: deps.getWindowId,
    notify: deps.notify,
    flushSession: () =>
      flushSessionPersistence(appState.getSnapshot(), deps.getWindowId()),
  });
  if (!mayQuit) {
    return;
  }
  // `quit_app` re-runs the Rust shutdown cleanup (stop the sidecar, reap git
  // children) before exiting the process.
  await invoke("quit_app");
}
