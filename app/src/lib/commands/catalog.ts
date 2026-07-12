/**
 * Unified command catalog entries for menus / shortcuts / command palette.
 * Display metadata only — handlers stay in the registry.
 */

import type {
  AppCommandId,
  CommandBinding,
  CommandBindingOverrides,
  CommandCategory,
  CommandDefinition,
} from "../domain/commands";
import {
  resolveCommandAvailability,
  type CommandAvailability,
  type CommandAvailabilitySnapshot,
} from "./availability";
import {
  formatBindingForPlatform,
  getEffectiveBinding,
  mergeCommandDefinitionsWithOverrides,
} from "./commandBindings";
import { commandDefinitions } from "./definitions";
import { isMacOs } from "../services/platform";

export interface CommandCatalogEntry {
  id: AppCommandId;
  label: string;
  category: CommandCategory;
  searchTerms: readonly string[];
  menuPath: string;
  /** Whether this command is intended for the command palette. */
  paletteVisible: boolean;
  paletteExcludeReason: string | null;
  binding: CommandBinding | undefined;
  availability: CommandAvailability;
}

/** Palette row with runnable state and platform-formatted shortcut display. */
export interface PaletteCommandEntry extends CommandCatalogEntry {
  runnable: boolean;
  disabledReason: string | null;
  displayBinding: string | null;
}

export interface BuildCommandCatalogOptions {
  definitions?: readonly CommandDefinition[];
  snapshot?: CommandAvailabilitySnapshot;
  bindingOverrides?: CommandBindingOverrides;
}

export interface BuildPaletteSnapshotOptions {
  snapshot: CommandAvailabilitySnapshot;
  bindingOverrides?: CommandBindingOverrides;
  platform?: "mac" | "windows";
}

function defaultSnapshot(): CommandAvailabilitySnapshot {
  return {
    hasWorkspace: false,
    hasActiveDocument: false,
    isDirty: false,
    paneCount: 1,
    markdownPreviewAvailable: false,
    markdownEditAvailable: false,
  };
}

function effectiveDefinitions(
  options: BuildCommandCatalogOptions,
): readonly CommandDefinition[] {
  const base = options.definitions ?? commandDefinitions;
  if (!options.bindingOverrides || Object.keys(options.bindingOverrides).length === 0) {
    return base;
  }
  return mergeCommandDefinitionsWithOverrides([...base], options.bindingOverrides);
}

function formatEffectiveBinding(
  binding: CommandBinding | undefined,
  platform: "mac" | "windows",
): string | null {
  if (!binding) {
    return null;
  }
  const value = binding[platform];
  if (!value || value === "none") {
    return null;
  }
  return formatBindingForPlatform(value, platform);
}

function toPaletteEntry(
  entry: CommandCatalogEntry,
  platform: "mac" | "windows",
): PaletteCommandEntry {
  const availability = entry.availability;
  const runnable = availability.status === "enabled";
  const disabledReason = availability.status === "disabled" ? availability.reason : null;
  return {
    ...entry,
    runnable,
    disabledReason,
    displayBinding: formatEffectiveBinding(entry.binding, platform),
  };
}

/**
 * Build catalog rows from definitions + a pure availability snapshot.
 * Does not dispatch handlers or perform I/O.
 */
export function buildCommandCatalog(
  options: BuildCommandCatalogOptions = {},
): CommandCatalogEntry[] {
  const definitions = effectiveDefinitions(options);
  const snapshot = options.snapshot ?? defaultSnapshot();

  return definitions.map((definition) => {
    const paletteVisible = definition.paletteIntent === "palette";
    const effectiveBinding = definition.binding;
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
      binding: effectiveBinding,
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

/**
 * Build a fresh palette snapshot: palette-visible commands with effective
 * bindings, availability, and display fields. Hidden availability rows are
 * omitted — callers refresh by rebuilding when context changes.
 */
export function buildPaletteSnapshot(
  options: BuildPaletteSnapshotOptions,
): PaletteCommandEntry[] {
  const platform = options.platform ?? (isMacOs() ? "mac" : "windows");
  return paletteCatalogEntries({
    snapshot: options.snapshot,
    bindingOverrides: options.bindingOverrides,
  })
    .filter((entry) => entry.availability.status !== "hidden")
    .map((entry) => toPaletteEntry(entry, platform));
}

/** Rebuild palette entries after context or binding changes. */
export function refreshPaletteSnapshot(
  previous: readonly PaletteCommandEntry[],
  options: BuildPaletteSnapshotOptions,
): PaletteCommandEntry[] {
  void previous;
  return buildPaletteSnapshot(options);
}

/** Resolve the effective binding for one command id (shared with Shortcuts settings). */
export function catalogEffectiveBinding(
  commandId: AppCommandId,
  overrides: CommandBindingOverrides = {},
): CommandBinding | undefined {
  const definition = commandDefinitions.find((entry) => entry.id === commandId);
  if (!definition) {
    return undefined;
  }
  return getEffectiveBinding(definition, overrides);
}
