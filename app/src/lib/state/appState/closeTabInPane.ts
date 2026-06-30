import type { AppDomainState, ContextSnapshot } from "../../domain/contracts";
import {
  findPane,
  findTabOwner,
  isFileTab,
  isSessionTab,
  recomputeSelectedTabId,
  setActivePaneInLayout,
} from "../../domain/contracts";
import { findNextOpenSessionTabAfterClose } from "../../services/workspaceAgentSession";
import { isEmptyUnsavedDocument } from "../../services/untitledDocument";
import { createImplicitDraftPair } from "../../services/implicitDraftTab";
import {
  getActiveContextSnapshot,
  nextDocAndTabIds,
  patchActiveContext,
} from "./contextHelpers";
import { buildEmptyUnsavedDocument } from "./documentHelpers";
import { canCreateFileTabs } from "./tabHelpers";
import { createFileTab } from "../../domain/contracts";

type AppStateUpdate = (mutator: (state: AppDomainState) => AppDomainState) => void;

function withPaneTabs(
  ctx: ContextSnapshot,
  paneId: string,
  tabs: ContextSnapshot["session"]["editorLayout"]["panes"][number]["tabs"],
  selectedTabId: string | null,
): ContextSnapshot {
  return {
    ...ctx,
    session: {
      ...ctx.session,
      editorLayout: {
        ...ctx.session.editorLayout,
        panes: ctx.session.editorLayout.panes.map((pane) =>
          pane.id === paneId ? { ...pane, tabs, selectedTabId } : pane,
        ),
      },
    },
  };
}

function pruneUnreferencedDocuments(ctx: ContextSnapshot): ContextSnapshot {
  const referenced = new Set<string>();
  for (const pane of ctx.session.editorLayout.panes) {
    for (const tab of pane.tabs) {
      if (isFileTab(tab)) {
        referenced.add(tab.documentId);
      }
    }
  }
  const documents = ctx.documents.filter((doc) => referenced.has(doc.id));
  if (documents.length === ctx.documents.length) {
    return ctx;
  }
  return { ...ctx, documents };
}

/** Pane-scoped force-close with implicit-draft replacement for empty last tabs. */
export function closeTabInPaneForceOnContext(
  state: AppDomainState,
  ctx: ContextSnapshot,
  paneId: string,
  tabId: string,
): ContextSnapshot {
  const pane = findPane(ctx.session.editorLayout, paneId);
  if (!pane) {
    return ctx;
  }
  const idx = pane.tabs.findIndex((tab) => tab.id === tabId);
  if (idx < 0) {
    return ctx;
  }
  const closingTab = pane.tabs[idx];
  const filtered = pane.tabs.filter((tab) => tab.id !== tabId);

  if (filtered.length > 0) {
    let selectedTabId = recomputeSelectedTabId(pane.tabs, filtered, pane.selectedTabId);
    if (pane.selectedTabId === tabId && closingTab && isSessionTab(closingTab)) {
      const nextSessionTab = findNextOpenSessionTabAfterClose(pane.tabs, tabId);
      if (nextSessionTab) {
        selectedTabId = nextSessionTab.id;
      }
    }
    return withPaneTabs(ctx, paneId, filtered, selectedTabId);
  }

  if (!canCreateFileTabs(state)) {
    return withPaneTabs(ctx, paneId, [], null);
  }

  const document =
    closingTab && isFileTab(closingTab)
      ? ctx.documents.find((doc) => doc.id === closingTab.documentId)
      : undefined;

  if (document && isEmptyUnsavedDocument(document)) {
    const { docId, tabId: draftTabId } = nextDocAndTabIds();
    const { tab, document: draftDoc } = createImplicitDraftPair(draftTabId, docId);
    let next = withPaneTabs(ctx, paneId, [tab], tab.id);
    next = { ...next, documents: [...next.documents, draftDoc] };
    return pruneUnreferencedDocuments(next);
  }

  const { docId, tabId: bootstrapTabId } = nextDocAndTabIds();
  const bootstrapDoc = buildEmptyUnsavedDocument(docId);
  const bootstrapTab = createFileTab(bootstrapTabId, docId);
  let next = withPaneTabs(ctx, paneId, [bootstrapTab], bootstrapTab.id);
  next = { ...next, documents: [...next.documents, bootstrapDoc] };
  return pruneUnreferencedDocuments(next);
}

export function createCloseTabInPaneSlice(deps: { update: AppStateUpdate }) {
  const { update } = deps;

  return {
    closeTabInPaneForce(paneId: string, tabId: string): void {
      update((state) =>
        patchActiveContext(state, (ctx) => closeTabInPaneForceOnContext(state, ctx, paneId, tabId)),
      );
    },
    closeTabInPane(paneId: string, tabId: string): void {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          const pane = findPane(ctx.session.editorLayout, paneId);
          if (!pane || pane.tabs.length <= 1) {
            return ctx;
          }
          if (!pane.tabs.some((tab) => tab.id === tabId)) {
            return ctx;
          }
          return closeTabInPaneForceOnContext(state, ctx, paneId, tabId);
        }),
      );
    },
  };
}

export function closeTabForceById(state: AppDomainState, tabId: string): AppDomainState {
  const ctx = getActiveContextSnapshot(state);
  const owner = findTabOwner(ctx.session.editorLayout, tabId);
  if (!owner) {
    return state;
  }
  return patchActiveContext(state, (snapshot) =>
    closeTabInPaneForceOnContext(state, snapshot, owner.pane.id, tabId),
  );
}

export function selectTabAcrossPanes(state: AppDomainState, tabId: string): AppDomainState {
  return patchActiveContext(state, (ctx) => {
    const owner = findTabOwner(ctx.session.editorLayout, tabId);
    if (!owner) {
      return ctx;
    }
    let layout = setActivePaneInLayout(ctx.session.editorLayout, owner.pane.id);
    const pane = layout.panes.find((entry) => entry.id === owner.pane.id);
    if (!pane) {
      return ctx;
    }
    if (pane.selectedTabId === tabId && layout.activePaneId === owner.pane.id) {
      if (layout === ctx.session.editorLayout) {
        return ctx;
      }
      return { ...ctx, session: { ...ctx.session, editorLayout: layout } };
    }
    layout = {
      ...layout,
      panes: layout.panes.map((entry) =>
        entry.id === owner.pane.id ? { ...entry, selectedTabId: tabId } : entry,
      ),
    };
    return { ...ctx, session: { ...ctx.session, editorLayout: layout } };
  });
}
