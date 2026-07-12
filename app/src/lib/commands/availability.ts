/**
 * Pure command availability resolution for menus, shortcuts, and future palette.
 * Resolvers must not mutate state or perform I/O.
 */

import type { CommandAvailabilityKey } from "../domain/commands";

/** Snapshot of UI/domain facts used by availability resolvers — values only. */
export interface CommandAvailabilitySnapshot {
  hasWorkspace: boolean;
  hasActiveDocument: boolean;
  isDirty: boolean;
  paneCount: number;
  markdownPreviewAvailable: boolean;
  /** True when the active document is markdown and edit-capable (edit/split). */
  markdownEditAvailable: boolean;
}

export type CommandAvailability =
  | { status: "enabled" }
  | { status: "disabled"; reason: string }
  | { status: "hidden" };

export type CommandAvailabilityResolver = (
  snapshot: CommandAvailabilitySnapshot,
) => CommandAvailability;

export const alwaysEnabled: CommandAvailabilityResolver = () => ({ status: "enabled" });

export const requiresWorkspace: CommandAvailabilityResolver = (snapshot) =>
  snapshot.hasWorkspace
    ? { status: "enabled" }
    : { status: "disabled", reason: "Open a workspace first." };

export const requiresActiveDocument: CommandAvailabilityResolver = (snapshot) =>
  snapshot.hasActiveDocument
    ? { status: "enabled" }
    : { status: "disabled", reason: "No active document." };

export const requiresDirtyDocument: CommandAvailabilityResolver = (snapshot) => {
  if (!snapshot.hasActiveDocument) {
    return { status: "disabled", reason: "No active document." };
  }
  if (!snapshot.isDirty) {
    return { status: "disabled", reason: "Document has no unsaved changes." };
  }
  return { status: "enabled" };
};

export const requiresMarkdownPreview: CommandAvailabilityResolver = (snapshot) =>
  snapshot.markdownPreviewAvailable
    ? { status: "enabled" }
    : { status: "hidden" };

export const requiresMarkdownEdit: CommandAvailabilityResolver = (snapshot) => {
  if (!snapshot.hasActiveDocument) {
    return { status: "disabled", reason: "No active document." };
  }
  if (!snapshot.markdownEditAvailable) {
    return {
      status: "disabled",
      reason: "Available for Markdown documents in edit or split mode.",
    };
  }
  return { status: "enabled" };
};

function requiresMinimumPanes(minimum: number, label: string): CommandAvailabilityResolver {
  return (snapshot) =>
    snapshot.paneCount >= minimum
      ? { status: "enabled" }
      : { status: "disabled", reason: `${label} is not available in the current layout.` };
}

export const requiresPane2: CommandAvailabilityResolver = requiresMinimumPanes(2, "Pane 2");
export const requiresPane3: CommandAvailabilityResolver = requiresMinimumPanes(3, "Pane 3");
export const requiresPane4: CommandAvailabilityResolver = requiresMinimumPanes(4, "Pane 4");

/** Payload-only / internal commands that should not appear as runnable UI actions. */
export const alwaysHidden: CommandAvailabilityResolver = () => ({ status: "hidden" });

const RESOLVERS: Record<CommandAvailabilityKey, CommandAvailabilityResolver> = {
  always: alwaysEnabled,
  workspace: requiresWorkspace,
  document: requiresActiveDocument,
  dirty: requiresDirtyDocument,
  markdown: requiresMarkdownPreview,
  markdownEdit: requiresMarkdownEdit,
  pane2: requiresPane2,
  pane3: requiresPane3,
  pane4: requiresPane4,
  hidden: alwaysHidden,
};

export function availabilityResolverFor(
  key: CommandAvailabilityKey | undefined,
): CommandAvailabilityResolver {
  return RESOLVERS[key ?? "always"];
}

export function resolveCommandAvailability(
  key: CommandAvailabilityKey | undefined,
  snapshot: CommandAvailabilitySnapshot,
): CommandAvailability {
  return availabilityResolverFor(key)(snapshot);
}

/** Empty snapshot for tests / offline catalog builds. */
export function emptyAvailabilitySnapshot(): CommandAvailabilitySnapshot {
  return {
    hasWorkspace: false,
    hasActiveDocument: false,
    isDirty: false,
    paneCount: 1,
    markdownPreviewAvailable: false,
    markdownEditAvailable: false,
  };
}

/** Build a pure availability snapshot from live UI facts. */
export function buildCommandAvailabilitySnapshot(params: {
  hasWorkspace: boolean;
  hasActiveDocument: boolean;
  isDirty: boolean;
  paneCount: number;
  markdownPreviewAvailable: boolean;
  markdownEditAvailable: boolean;
}): CommandAvailabilitySnapshot {
  return {
    hasWorkspace: params.hasWorkspace,
    hasActiveDocument: params.hasActiveDocument,
    isDirty: params.isDirty,
    paneCount: Math.max(1, params.paneCount),
    markdownPreviewAvailable: params.markdownPreviewAvailable,
    markdownEditAvailable: params.markdownEditAvailable,
  };
}
