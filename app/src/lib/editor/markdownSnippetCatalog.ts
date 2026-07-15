/**
 * SpecOps-native built-in Markdown snippet catalog (M6.1).
 * Immutable data — users may disable entries but never mutate them.
 */
import type { BuiltinSnippetId, ResolvedMarkdownSnippet } from "../domain/snippets";

export const BUILTIN_SNIPPET_IDS: readonly BuiltinSnippetId[] = [
  "front-matter",
  "requirements",
  "acceptance-checklist",
  "decision-record",
  "callout",
  "fenced-block",
  "table",
] as const;

type BuiltinSnippetSeed = Omit<ResolvedMarkdownSnippet, "source" | "scope" | "enabled"> & {
  id: BuiltinSnippetId;
};

const BUILTIN_SNIPPETS: readonly BuiltinSnippetSeed[] = [
  {
    id: "front-matter",
    name: "Front matter",
    description: "YAML front matter block for a note or spec.",
    trigger: "fm",
    body: ["---", "title: ${1:Title}", "status: ${2:draft}", "---", "", "${0}"].join("\n"),
  },
  {
    id: "requirements",
    name: "Requirements section",
    description: "Heading and bullet list for requirements.",
    trigger: "req",
    body: [
      "## Requirements",
      "",
      "### ${1:Feature name}",
      "",
      "- ${2:Requirement}",
      "${0}",
    ].join("\n"),
  },
  {
    id: "acceptance-checklist",
    name: "Acceptance checklist",
    description: "Checkbox list for acceptance criteria.",
    trigger: "ac",
    body: [
      "## Acceptance criteria",
      "",
      "- [ ] ${1:Criterion}",
      "- [ ] ${2:Criterion}",
      "${0}",
    ].join("\n"),
  },
  {
    id: "decision-record",
    name: "Decision record",
    description: "Lightweight decision record with context and consequences.",
    trigger: "adr",
    body: [
      "## Decision: ${1:Title}",
      "",
      "**Status:** ${2:Proposed}",
      "",
      "### Context",
      "",
      "${3:Why this decision is needed.}",
      "",
      "### Decision",
      "",
      "${4:What we decided.}",
      "",
      "### Consequences",
      "",
      "${5:Follow-on effects.}",
      "${0}",
    ].join("\n"),
  },
  {
    id: "callout",
    name: "Callout",
    description: "Blockquote callout. Wraps the current selection when present.",
    trigger: "note",
    body: "> **${1:Note}:** ${SELECTION}${2}${0}",
  },
  {
    id: "fenced-block",
    name: "Fenced block",
    description: "Fenced code block. Wraps the current selection when present.",
    trigger: "code",
    body: ["```${1:markdown}", "${SELECTION}${2}", "```", "${0}"].join("\n"),
  },
  {
    id: "table",
    name: "Table",
    description: "Two-column Markdown table scaffold.",
    trigger: "table",
    body: [
      "| ${1:Column} | ${2:Column} |",
      "| --- | --- |",
      "| ${3:Value} | ${4:Value} |",
      "${0}",
    ].join("\n"),
  },
];

export function isBuiltinSnippetId(value: string): value is BuiltinSnippetId {
  return (BUILTIN_SNIPPET_IDS as readonly string[]).includes(value);
}

/** Immutable built-in catalog (always enabled in this list; settings may disable). */
export function listBuiltinSnippets(): readonly ResolvedMarkdownSnippet[] {
  return BUILTIN_SNIPPETS.map((entry) => ({
    ...entry,
    scope: "markdown" as const,
    source: "builtin" as const,
    enabled: true,
  }));
}

export function getBuiltinSnippet(id: BuiltinSnippetId): ResolvedMarkdownSnippet | undefined {
  return listBuiltinSnippets().find((entry) => entry.id === id);
}
