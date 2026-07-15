/**
 * Fuzzy ranking for the Insert Snippet picker (M6.2).
 */
import type { ResolvedMarkdownSnippet } from "../domain/snippets";
import { fuzzyRank, type FuzzyMatch } from "./fuzzyRank";

export type RankedSnippetMatch = FuzzyMatch<ResolvedMarkdownSnippet> & {
  sourceLabel: string;
};

export type RankedSnippetsResult = {
  matches: RankedSnippetMatch[];
  totalMatches: number;
  truncated: boolean;
};

const RESULT_LIMIT = 100;

export function rankSnippets(
  snippets: readonly ResolvedMarkdownSnippet[],
  query: string,
): RankedSnippetsResult {
  const ranked = fuzzyRank(
    snippets.map((item) => ({
      item,
      text: item.name,
      altTexts: [item.trigger, item.description, item.source],
    })),
    query,
    { limit: RESULT_LIMIT },
  );

  return {
    matches: ranked.map((match) => ({
      ...match,
      sourceLabel: match.item.source === "builtin" ? "Built-in" : "Custom",
    })),
    totalMatches: ranked.length,
    truncated: ranked.length >= RESULT_LIMIT && snippets.length > RESULT_LIMIT,
  };
}
