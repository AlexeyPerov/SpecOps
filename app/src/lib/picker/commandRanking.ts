/**
 * Command-candidate ranking adapter over shared fuzzy scoring.
 *
 * Translates palette catalog entries into fuzzy-rankable candidates (label as
 * primary text, category/aliases/id as alt texts), applies stable category +
 * practical-frequency ordering for empty queries, keeps disabled commands
 * searchable, and filters hidden availability rows.
 *
 * Pure and side-effect free: no state mutation, no I/O.
 */

import type { AppCommandId, CommandCategory } from "../domain/commands";
import type { PaletteCommandEntry } from "../commands/catalog";
import { fuzzyRank, type FuzzyCandidate, type FuzzyMatch, type FuzzyMatchRange } from "./fuzzyRank";

export interface RankCommandsOptions {
  /** Maximum number of ranked results to return. Default 200. */
  limit?: number;
}

/** A ranked command candidate ready for palette rendering. */
export interface RankedCommand {
  entry: PaletteCommandEntry;
  score: number;
  /** Match ranges against the command label for highlighting. */
  ranges: readonly FuzzyMatchRange[];
}

/** Metadata about the ranking pass. */
export interface RankedCommandsResult {
  matches: RankedCommand[];
  totalMatches: number;
  scannedCount: number;
  truncated: boolean;
}

const DEFAULT_LIMIT = 200;

const CATEGORY_ORDER: readonly CommandCategory[] = [
  "File",
  "Edit",
  "View",
  "Navigation",
  "Tab",
  "Workspace",
  "App",
];

/** Lower index = higher practical frequency within a category for empty-query order. */
const FREQUENCY_ORDER: readonly AppCommandId[] = [
  "app.quickOpenFile",
  "file.save",
  "app.toggleFindReplace",
  "file.new",
  "file.open",
  "app.openCommandPalette",
  "edit.undo",
  "edit.redo",
  "tab.close",
  "app.toggleSettings",
  "app.findInProject",
  "view.focusEditor",
  "file.saveAll",
  "app.toggleGoTo",
  "view.toggleMarkdownPreview",
];

function categoryRank(category: CommandCategory): number {
  const index = CATEGORY_ORDER.indexOf(category);
  return index >= 0 ? index : CATEGORY_ORDER.length;
}

function frequencyRank(id: AppCommandId): number {
  const index = FREQUENCY_ORDER.indexOf(id);
  return index >= 0 ? index : FREQUENCY_ORDER.length + 1;
}

function compareEmptyQueryOrder(a: PaletteCommandEntry, b: PaletteCommandEntry): number {
  const categoryDelta = categoryRank(a.category) - categoryRank(b.category);
  if (categoryDelta !== 0) {
    return categoryDelta;
  }
  const frequencyDelta = frequencyRank(a.id) - frequencyRank(b.id);
  if (frequencyDelta !== 0) {
    return frequencyDelta;
  }
  const labelDelta = a.label.localeCompare(b.label);
  if (labelDelta !== 0) {
    return labelDelta;
  }
  return a.id.localeCompare(b.id);
}

function compareStableOrder(a: PaletteCommandEntry, b: PaletteCommandEntry): number {
  const enabledDelta = Number(b.runnable) - Number(a.runnable);
  if (enabledDelta !== 0) {
    return enabledDelta;
  }
  return compareEmptyQueryOrder(a, b);
}

function toCandidate(entry: PaletteCommandEntry): FuzzyCandidate<PaletteCommandEntry> {
  return {
    item: entry,
    text: entry.label,
    altTexts: [entry.category, ...entry.searchTerms, entry.id.replaceAll(".", " ")],
    recentScore: entry.runnable ? 1 : 0,
  };
}

/**
 * Rank palette command entries for the command palette.
 *
 * Empty query orders by category, then practical frequency, then label.
 * Disabled commands remain visible but sort after enabled commands.
 */
export function rankCommands(
  entries: readonly PaletteCommandEntry[],
  query: string,
  options: RankCommandsOptions = {},
): RankedCommandsResult {
  const limit = Math.max(0, options.limit ?? DEFAULT_LIMIT);
  const visible = entries.filter((entry) => entry.availability.status !== "hidden");
  const scannedCount = visible.length;
  const needle = query.trim();

  if (needle.length === 0) {
    const ordered = [...visible].sort(compareStableOrder);
    const totalMatches = ordered.length;
    const matches: RankedCommand[] = ordered.map((entry) => ({
      entry,
      score: 0,
      ranges: [],
    }));
    return {
      matches: limit > 0 ? matches.slice(0, limit) : matches,
      totalMatches,
      scannedCount,
      truncated: limit > 0 && totalMatches > limit,
    };
  }

  const candidates = visible.map(toCandidate);
  const ranked: FuzzyMatch<PaletteCommandEntry>[] = fuzzyRank(candidates, query);
  const enabledMatches = ranked.filter((match) => match.item.runnable);
  const disabledMatches = ranked.filter((match) => !match.item.runnable);
  const ordered = [...enabledMatches, ...disabledMatches];
  const totalMatches = ordered.length;
  const bounded = limit > 0 ? ordered.slice(0, limit) : ordered;

  const matches: RankedCommand[] = bounded.map((match) => ({
    entry: match.item,
    score: match.score,
    ranges: match.ranges,
  }));

  return {
    matches,
    totalMatches,
    scannedCount,
    truncated: limit > 0 && totalMatches > limit,
  };
}
