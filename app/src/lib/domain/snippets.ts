/** Markdown snippet domain types (M6). */

export type SnippetSource = "builtin" | "user";

/** v1 scope is Markdown documents only. */
export type SnippetScope = "markdown";

/**
 * Stable built-in catalog ids. Immutable data — users may disable but not
 * mutate names, triggers, or bodies.
 */
export type BuiltinSnippetId =
  | "front-matter"
  | "requirements"
  | "acceptance-checklist"
  | "decision-record"
  | "callout"
  | "fenced-block"
  | "table";

/** User-authored snippet stored in settings. */
export interface UserSnippetRecord {
  id: string;
  name: string;
  description: string;
  trigger: string;
  body: string;
  enabled: boolean;
}

/**
 * Persisted snippet preferences.
 * - `enabledBuiltinIds` — whitelist of built-in ids that are offered.
 * - `userSnippets` — custom records (invalid rows dropped on normalize).
 */
export interface MarkdownSnippetSettings {
  enabledBuiltinIds: BuiltinSnippetId[];
  userSnippets: UserSnippetRecord[];
}

/** Resolved snippet ready for completion/insertion/picker display. */
export interface ResolvedMarkdownSnippet {
  id: string;
  name: string;
  description: string;
  trigger: string;
  body: string;
  scope: SnippetScope;
  source: SnippetSource;
  enabled: boolean;
}
