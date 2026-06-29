import type { AppDomainState } from "../../domain/contracts";
import { reflowAfterClose, setActivePaneInLayout, setLayoutKind } from "../../domain/contracts";
import { patchActiveContext } from "./contextHelpers";

type AppStateUpdate = (mutator: (state: AppDomainState) => AppDomainState) => void;

/**
 * Split-view (layout groups) reducer slice. Owns the per-context editor layout
 * mutations: switching the active preset, focusing a pane, and closing a pane
 * (which reflows by remaining count). See `domain/editorLayout.ts` and
 * `specs/text-editor/split-view-execution-plan.md` Phase 3.
 */
export function createEditorLayoutSlice(deps: { update: AppStateUpdate }) {
  const { update } = deps;

  return {
    /** Apply a named preset to the active context's editor layout (Q2/Q3 merge). */
    setEditorLayout(kind: Parameters<typeof setLayoutKind>[1]): void {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          const next = setLayoutKind(ctx.session.editorLayout, kind);
          if (next === ctx.session.editorLayout) {
            return ctx;
          }
          return { ...ctx, session: { ...ctx.session, editorLayout: next } };
        }),
      );
    },
    /** Focus a pane by id in the active context. */
    setActiveEditorPane(paneId: string): void {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          const next = setActivePaneInLayout(ctx.session.editorLayout, paneId);
          if (next === ctx.session.editorLayout) {
            return ctx;
          }
          return { ...ctx, session: { ...ctx.session, editorLayout: next } };
        }),
      );
    },
    /** Focus the Nth pane (1-based, by slot reading order) in the active context. */
    setActiveEditorPaneBySlot(slotOneBased: number): void {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          const { panes, slots } = ctx.session.editorLayout;
          const orderedIds: string[] = [];
          const seen = new Set<number>();
          for (const row of slots) {
            for (const paneIndex of row) {
              if (!seen.has(paneIndex)) {
                seen.add(paneIndex);
                const pane = panes[paneIndex];
                if (pane) {
                  orderedIds.push(pane.id);
                }
              }
            }
          }
          for (let i = 0; i < panes.length; i += 1) {
            if (!seen.has(i)) {
              orderedIds.push(panes[i].id);
            }
          }
          const targetId = orderedIds[slotOneBased - 1];
          if (!targetId) {
            return ctx;
          }
          const next = setActivePaneInLayout(ctx.session.editorLayout, targetId);
          if (next === ctx.session.editorLayout) {
            return ctx;
          }
          return { ...ctx, session: { ...ctx.session, editorLayout: next } };
        }),
      );
    },
    /** Close a pane by id; reflows by remaining count (Q7/F1/F2). */
    closeEditorPane(paneId: string): void {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          const next = reflowAfterClose(ctx.session.editorLayout, paneId);
          if (next === ctx.session.editorLayout) {
            return ctx;
          }
          return { ...ctx, session: { ...ctx.session, editorLayout: next } };
        }),
      );
    },
  };
}
