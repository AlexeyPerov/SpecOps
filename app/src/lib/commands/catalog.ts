/**
 * Unified command catalog entries for menus / shortcuts / future palette.
 * Display metadata only — handlers stay in the registry.
 */

import type {
  AppCommandId,
  CommandBinding,
  CommandCategory,
  CommandDefinition,
} from "../domain/commands";
import {
  resolveCommandAvailability,
  type CommandAvailability,
  type CommandAvailabilitySnapshot,
} from "./availability";
import { commandDefinitions } from "./definitions";

export interface CommandCatalogEntry {
  id: AppCommandId;
  label: string;
  category: CommandCategory;
  searchTerms: readonly string[];
  menuPath: string;
  /** Whether this command is intended for the future palette. */
  paletteVisible: boolean;
  paletteExcludeReason: string | null;
  binding: CommandBinding | undefined;
  availability: CommandAvailability;
}

export interface BuildCommandCatalogOptions {
  definitions?: readonly CommandDefinition[];
  snapshot?: CommandAvailabilitySnapshot;
}

/**
 * Build catalog rows from definitions + a pure availability snapshot.
 * Does not dispatch handlers or perform I/O.
 */
export function buildCommandCatalog(
  options: BuildCommandCatalogOptions = {},
): CommandCatalogEntry[] {
  const definitions = options.definitions ?? commandDefinitions;
  const snapshot = options.snapshot ?? {
    hasWorkspace: false,
    hasActiveDocument: false,
    isDirty: false,
    paneCount: 1,
    markdownPreviewAvailable: false,
  };

  return definitions.map((definition) => {
    const paletteVisible = definition.paletteIntent === "palette";
    return {
      id: definition.id,
      label: definition.label,
      category: definition.category,
      searchTerms: definition.searchTerms ?? [],
      menuPath: definition.menuPath,
      paletteVisible,
      paletteExcludeReason:
        definition.paletteIntent === "exclude"
          ? (definition.paletteExcludeReason ?? "Excluded from palette.")
          : null,
      binding: definition.binding,
      availability: resolveCommandAvailability(definition.availability, snapshot),
    };
  });
}

/** Palette-intended entries only (still may be disabled/hidden by availability). */
export function paletteCatalogEntries(
  options: BuildCommandCatalogOptions = {},
): CommandCatalogEntry[] {
  return buildCommandCatalog(options).filter((entry) => entry.paletteVisible);
}
