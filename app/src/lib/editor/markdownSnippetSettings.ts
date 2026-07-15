/**
 * Markdown snippet settings: validation, normalization, and resolution (M6.1).
 *
 * Privacy: never log snippet bodies. Invalid records are dropped on load —
 * no migration of older hypothetical formats.
 */
import type {
  BuiltinSnippetId,
  MarkdownSnippetSettings,
  ResolvedMarkdownSnippet,
  UserSnippetRecord,
} from "../domain/snippets";
import {
  BUILTIN_SNIPPET_IDS,
  getBuiltinSnippet,
  isBuiltinSnippetId,
  listBuiltinSnippets,
} from "./markdownSnippetCatalog";

export const SNIPPET_LIMITS = {
  name: 80,
  description: 200,
  trigger: 32,
  body: 8_000,
  maxUserSnippets: 50,
} as const;

/** Trigger: letter, then letters/digits/underscore/hyphen. */
const TRIGGER_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
/** User ids: `user-{slug}`. */
const USER_ID_PATTERN = /^user-[a-z0-9-]+$/i;
/**
 * Valid CodeMirror-style placeholder (`${…}` / `#{…}`) with optional number
 * and default text. Defaults may not contain unescaped braces.
 */
const PLACEHOLDER_PATTERN =
  /[#$]\{(?:(\d+)(?::((?:\\[{}]|[^{}])*))|((?:\\[{}]|[^{}])*))\}/g;
/** SpecOps selected-text token substituted before insert. */
const SELECTION_TOKEN = "${SELECTION}";

export type SnippetFieldError = {
  field: "id" | "name" | "description" | "trigger" | "body";
  message: string;
};

export const defaultMarkdownSnippetSettings: MarkdownSnippetSettings = {
  enabledBuiltinIds: [...BUILTIN_SNIPPET_IDS],
  userSnippets: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function createUserSnippetId(): string {
  return `user-${crypto.randomUUID()}`;
}

export function isUserSnippetId(value: string): boolean {
  return USER_ID_PATTERN.test(value);
}

/**
 * Escape text so it can be injected into a snippet template as literal content
 * (braces and backslashes will not start placeholders).
 */
export function escapeSnippetLiteral(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/[{}]/g, "\\$&");
}

/**
 * Replace `${SELECTION}` with the escaped selection before CodeMirror parses
 * the template. Missing selection becomes an empty string.
 */
export function prepareSnippetBody(body: string, selectedText: string): string {
  if (!body.includes(SELECTION_TOKEN)) {
    return body;
  }
  return body.split(SELECTION_TOKEN).join(escapeSnippetLiteral(selectedText));
}

/**
 * Validate placeholder syntax without invoking CodeMirror. After removing
 * valid placeholders, escapes, and the selection token, no bare `${` / `#{`
 * may remain.
 */
export function validateSnippetBody(body: unknown): string | null {
  if (typeof body !== "string") {
    return "Body must be a string.";
  }
  if (body.length === 0) {
    return "Body cannot be empty.";
  }
  if (body.length > SNIPPET_LIMITS.body) {
    return `Body must be at most ${SNIPPET_LIMITS.body} characters.`;
  }

  let remaining = body.split(SELECTION_TOKEN).join("");
  remaining = remaining.replace(PLACEHOLDER_PATTERN, "");
  remaining = remaining.replace(/\\[{}]/g, "");
  if (/[#$]\{/.test(remaining)) {
    return "Body has invalid placeholder syntax. Use ${1:default}, ${0}, or ${SELECTION}.";
  }
  return null;
}

export function validateSnippetTrigger(trigger: unknown): string | null {
  if (typeof trigger !== "string") {
    return "Trigger must be a string.";
  }
  const trimmed = trigger.trim();
  if (trimmed.length === 0) {
    return "Trigger cannot be empty.";
  }
  if (trimmed.length > SNIPPET_LIMITS.trigger) {
    return `Trigger must be at most ${SNIPPET_LIMITS.trigger} characters.`;
  }
  if (!TRIGGER_PATTERN.test(trimmed)) {
    return "Trigger must start with a letter and use only letters, digits, _ or -.";
  }
  return null;
}

/** Collect field-level errors for a user snippet draft (settings UI). */
export function validateUserSnippetDraft(
  draft: Partial<UserSnippetRecord>,
  options?: {
    /** Other triggers already claimed (builtins + other user snippets). */
    takenTriggers?: ReadonlySet<string>;
    /** Other ids already claimed. */
    takenIds?: ReadonlySet<string>;
    /** When updating, allow the draft to keep its own id/trigger. */
    currentId?: string;
  },
): SnippetFieldError[] {
  const errors: SnippetFieldError[] = [];
  const id =
    typeof draft.id === "string" && draft.id.trim().length > 0
      ? draft.id.trim()
      : "";
  if (!id || !isUserSnippetId(id)) {
    errors.push({ field: "id", message: "Id must look like user-{slug}." });
  } else if (options?.takenIds?.has(id) && id !== options.currentId) {
    errors.push({ field: "id", message: "Id is already in use." });
  }

  const name = typeof draft.name === "string" ? draft.name.trim() : "";
  if (name.length === 0) {
    errors.push({ field: "name", message: "Name cannot be empty." });
  } else if (name.length > SNIPPET_LIMITS.name) {
    errors.push({
      field: "name",
      message: `Name must be at most ${SNIPPET_LIMITS.name} characters.`,
    });
  }

  const description = typeof draft.description === "string" ? draft.description : "";
  if (description.length > SNIPPET_LIMITS.description) {
    errors.push({
      field: "description",
      message: `Description must be at most ${SNIPPET_LIMITS.description} characters.`,
    });
  }

  const triggerError = validateSnippetTrigger(draft.trigger);
  if (triggerError) {
    errors.push({ field: "trigger", message: triggerError });
  } else if (options?.takenTriggers?.has((draft.trigger as string).trim())) {
    // Callers should exclude the draft's own trigger via `collectTakenTriggers(…, currentId)`.
    errors.push({
      field: "trigger",
      message: "Trigger conflicts with another snippet.",
    });
  }

  const bodyError = validateSnippetBody(draft.body);
  if (bodyError) {
    errors.push({ field: "body", message: bodyError });
  }

  return errors;
}

/**
 * Normalize a single user snippet. Returns null when the record is unusable
 * (invalid id/trigger/body). Does not resolve cross-record uniqueness.
 */
export function normalizeUserSnippetRecord(
  input: Partial<UserSnippetRecord> | unknown,
  fallbackId = createUserSnippetId(),
): UserSnippetRecord | null {
  const source = isRecord(input) ? input : {};
  const rawId = typeof source.id === "string" ? source.id.trim() : fallbackId;
  const id = isUserSnippetId(rawId) ? rawId : fallbackId;
  if (!isUserSnippetId(id)) {
    return null;
  }

  const name =
    typeof source.name === "string" && source.name.trim().length > 0
      ? source.name.trim().slice(0, SNIPPET_LIMITS.name)
      : "Untitled snippet";
  const description =
    typeof source.description === "string"
      ? source.description.slice(0, SNIPPET_LIMITS.description)
      : "";
  const trigger =
    typeof source.trigger === "string" ? source.trigger.trim() : "";
  if (validateSnippetTrigger(trigger)) {
    return null;
  }
  const body = typeof source.body === "string" ? source.body : "";
  if (validateSnippetBody(body)) {
    return null;
  }

  return {
    id,
    name,
    description,
    trigger,
    body,
    enabled: normalizeBoolean(source.enabled, true),
  };
}

function normalizeEnabledBuiltinIds(value: unknown): BuiltinSnippetId[] {
  if (!Array.isArray(value)) {
    return [...defaultMarkdownSnippetSettings.enabledBuiltinIds];
  }
  const seen = new Set<BuiltinSnippetId>();
  const result: BuiltinSnippetId[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isBuiltinSnippetId(entry)) {
      continue;
    }
    if (seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    result.push(entry);
  }
  // Preserve catalog order for stability.
  return BUILTIN_SNIPPET_IDS.filter((id) => seen.has(id));
}

/**
 * Normalize persisted snippet settings. Drops invalid user records and
 * resolves duplicate ids/triggers deterministically (first wins; later dropped).
 */
export function normalizeMarkdownSnippetSettings(
  input?: Partial<MarkdownSnippetSettings> | unknown,
): MarkdownSnippetSettings {
  const source = isRecord(input) ? input : {};
  const enabledBuiltinIds = normalizeEnabledBuiltinIds(source.enabledBuiltinIds);

  const takenTriggers = new Set<string>(
    enabledBuiltinIds
      .map((id) => getBuiltinSnippet(id)?.trigger)
      .filter((trigger): trigger is string => typeof trigger === "string"),
  );
  // Also reserve triggers of disabled builtins so enabling later cannot collide
  // with a user snippet that reused a built-in trigger.
  for (const builtin of listBuiltinSnippets()) {
    takenTriggers.add(builtin.trigger);
  }

  const takenIds = new Set<string>();
  const userSnippets: UserSnippetRecord[] = [];
  const rawList = Array.isArray(source.userSnippets) ? source.userSnippets : [];

  for (const entry of rawList) {
    if (userSnippets.length >= SNIPPET_LIMITS.maxUserSnippets) {
      break;
    }
    const normalized = normalizeUserSnippetRecord(entry);
    if (!normalized) {
      continue;
    }
    if (takenIds.has(normalized.id)) {
      continue;
    }
    if (takenTriggers.has(normalized.trigger)) {
      continue;
    }
    takenIds.add(normalized.id);
    takenTriggers.add(normalized.trigger);
    userSnippets.push(normalized);
  }

  return { enabledBuiltinIds, userSnippets };
}

/** Resolve enabled snippets for completion, picker, and direct insert. */
export function listEnabledMarkdownSnippets(
  settings: MarkdownSnippetSettings,
): ResolvedMarkdownSnippet[] {
  const normalized = normalizeMarkdownSnippetSettings(settings);
  const enabledBuiltin = new Set(normalized.enabledBuiltinIds);
  const builtins = listBuiltinSnippets()
    .filter((entry) => enabledBuiltin.has(entry.id as BuiltinSnippetId))
    .map((entry) => ({ ...entry, enabled: true }));

  const users = normalized.userSnippets
    .filter((entry) => entry.enabled)
    .map(
      (entry): ResolvedMarkdownSnippet => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        trigger: entry.trigger,
        body: entry.body,
        scope: "markdown",
        source: "user",
        enabled: true,
      }),
    );

  return [...builtins, ...users];
}

/** All snippets for settings UI (builtins + users), with enable flags. */
export function listAllMarkdownSnippets(
  settings: MarkdownSnippetSettings,
): ResolvedMarkdownSnippet[] {
  const normalized = normalizeMarkdownSnippetSettings(settings);
  const enabledBuiltin = new Set(normalized.enabledBuiltinIds);
  const builtins = listBuiltinSnippets().map((entry) => ({
    ...entry,
    enabled: enabledBuiltin.has(entry.id as BuiltinSnippetId),
  }));
  const users = normalized.userSnippets.map(
    (entry): ResolvedMarkdownSnippet => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      trigger: entry.trigger,
      body: entry.body,
      scope: "markdown",
      source: "user",
      enabled: entry.enabled,
    }),
  );
  return [...builtins, ...users];
}

export function findResolvedSnippet(
  settings: MarkdownSnippetSettings,
  snippetId: string,
): ResolvedMarkdownSnippet | undefined {
  return listEnabledMarkdownSnippets(settings).find((entry) => entry.id === snippetId);
}

/**
 * Triggers claimed by other snippets (for draft validation).
 * Pass `excludeId` when editing an existing user snippet.
 */
export function collectTakenTriggers(
  settings: MarkdownSnippetSettings,
  excludeId?: string,
): Set<string> {
  const normalized = normalizeMarkdownSnippetSettings(settings);
  const taken = new Set<string>();
  for (const builtin of listBuiltinSnippets()) {
    taken.add(builtin.trigger);
  }
  for (const user of normalized.userSnippets) {
    if (excludeId && user.id === excludeId) {
      continue;
    }
    taken.add(user.trigger);
  }
  return taken;
}

export function collectTakenUserIds(
  settings: MarkdownSnippetSettings,
  excludeId?: string,
): Set<string> {
  const normalized = normalizeMarkdownSnippetSettings(settings);
  const taken = new Set<string>();
  for (const user of normalized.userSnippets) {
    if (excludeId && user.id === excludeId) {
      continue;
    }
    taken.add(user.id);
  }
  return taken;
}
