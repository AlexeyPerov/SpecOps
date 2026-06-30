import type { ContextSnapshot } from "../../domain/contracts";
import { ensureImplicitDraftsInLayout } from "../../domain/contracts";
import { createImplicitDraftPair } from "../../services/implicitDraftTab";
import { nextDocAndTabIds } from "./contextHelpers";

/** Fills empty panes with a hidden implicit untitled draft tab + document. */
export function seedImplicitDraftsInContext(ctx: ContextSnapshot): ContextSnapshot {
  const { layout, newDocuments } = ensureImplicitDraftsInLayout(
    ctx.session.editorLayout,
    nextDocAndTabIds,
    (tabId, documentId) => createImplicitDraftPair(tabId, documentId),
  );
  if (newDocuments.length === 0) {
    return ctx;
  }
  return {
    documents: [...ctx.documents, ...newDocuments],
    session: { ...ctx.session, editorLayout: layout },
  };
}
