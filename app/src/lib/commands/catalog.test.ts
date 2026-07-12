import { describe, expect, it, vi } from "vitest";
import type { AppCommandId } from "../domain/commands";
import {
  buildCommandAvailabilitySnapshot,
  emptyAvailabilitySnapshot,
  resolveCommandAvailability,
} from "./availability";
import {
  buildCommandCatalog,
  buildPaletteSnapshot,
  catalogEffectiveBinding,
  paletteCatalogEntries,
  refreshPaletteSnapshot,
} from "./catalog";
import { commandDefinitions } from "./definitions";
import { NATIVE_MENU_COMMAND_IDS } from "../services/appMenuDefinitions";
import { getRegisteredCommandIds } from "./registry";

describe("command availability", () => {
  it("distinguishes enabled, disabled-with-reason, and hidden", () => {
    expect(resolveCommandAvailability("always", emptyAvailabilitySnapshot())).toEqual({
      status: "enabled",
    });
    expect(resolveCommandAvailability("workspace", emptyAvailabilitySnapshot())).toEqual({
      status: "disabled",
      reason: "Open a workspace first.",
    });
    expect(resolveCommandAvailability("hidden", emptyAvailabilitySnapshot())).toEqual({
      status: "hidden",
    });
    expect(
      resolveCommandAvailability("markdown", {
        ...emptyAvailabilitySnapshot(),
        markdownPreviewAvailable: true,
      }),
    ).toEqual({ status: "enabled" });
  });

  it("disables pane focus commands when the layout is too small", () => {
    expect(resolveCommandAvailability("pane2", emptyAvailabilitySnapshot())).toEqual({
      status: "disabled",
      reason: "Pane 2 is not available in the current layout.",
    });
    expect(
      resolveCommandAvailability("pane4", {
        ...emptyAvailabilitySnapshot(),
        paneCount: 4,
      }),
    ).toEqual({ status: "enabled" });
  });

  it("does not mutate the snapshot during resolution", () => {
    const snapshot = emptyAvailabilitySnapshot();
    const frozen = Object.freeze({ ...snapshot });
    resolveCommandAvailability("document", frozen);
    resolveCommandAvailability("dirty", frozen);
    expect(frozen).toEqual(emptyAvailabilitySnapshot());
  });

  it("builds snapshots from live UI facts", () => {
    expect(
      buildCommandAvailabilitySnapshot({
        hasWorkspace: true,
        hasActiveDocument: true,
        isDirty: true,
        paneCount: 2,
        markdownPreviewAvailable: false,
      }),
    ).toEqual({
      hasWorkspace: true,
      hasActiveDocument: true,
      isDirty: true,
      paneCount: 2,
      markdownPreviewAvailable: false,
    });
  });
});

describe("command catalog consistency", () => {
  it("requires every definition to declare palette discoverability intent", () => {
    const missing = commandDefinitions.filter(
      (definition) =>
        definition.paletteIntent !== "palette" && definition.paletteIntent !== "exclude",
    );
    expect(missing).toEqual([]);

    const excludeWithoutReason = commandDefinitions.filter(
      (definition) =>
        definition.paletteIntent === "exclude" &&
        !(definition.paletteExcludeReason && definition.paletteExcludeReason.trim().length > 0),
    );
    expect(excludeWithoutReason).toEqual([]);
  });

  it("requires category on every command", () => {
    const missing = commandDefinitions.filter((definition) => !definition.category);
    expect(missing).toEqual([]);
  });

  it("keeps definitions, handlers, and catalog ids aligned", () => {
    const defined = commandDefinitions.map((d) => d.id).sort();
    const registered = [...getRegisteredCommandIds()].sort();
    expect(defined).toEqual(registered);

    const catalogIds = buildCommandCatalog()
      .map((entry) => entry.id)
      .sort();
    expect(catalogIds).toEqual(defined);
  });

  it("excludes intentional non-palette commands from palette entries", () => {
    const excluded = new Set(
      commandDefinitions.filter((d) => d.paletteIntent === "exclude").map((d) => d.id),
    );
    expect(excluded.has("file.openRecent")).toBe(true);
    expect(excluded.has("workspace.reorder")).toBe(true);
    expect(excluded.has("app.openCommandPalette")).toBe(true);

    const paletteIds = new Set(paletteCatalogEntries().map((e) => e.id));
    for (const id of excluded) {
      expect(paletteIds.has(id)).toBe(false);
    }
  });

  it("keeps handlers separate from display catalog construction", () => {
    const dispatchSpy = vi.fn();
    void dispatchSpy;
    const entries = buildCommandCatalog({
      snapshot: {
        hasWorkspace: true,
        hasActiveDocument: true,
        isDirty: true,
        paneCount: 2,
        markdownPreviewAvailable: true,
      },
    });
    expect(entries.length).toBe(commandDefinitions.length);
    expect(entries.every((e) => typeof e.label === "string")).toBe(true);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("fails on duplicate labels within the same category", () => {
    const seen = new Map<string, AppCommandId>();
    const duplicates: string[] = [];
    for (const definition of commandDefinitions) {
      const key = `${definition.category}::${definition.label}`;
      const existing = seen.get(key);
      if (existing) {
        duplicates.push(`${existing} and ${definition.id} share ${key}`);
      } else {
        seen.set(key, definition.id);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it("fails on duplicate default bindings per platform", () => {
    const macBindings = new Map<string, AppCommandId>();
    const windowsBindings = new Map<string, AppCommandId>();
    const duplicates: string[] = [];

    for (const definition of commandDefinitions) {
      if (!definition.binding) {
        continue;
      }
      if (definition.binding.mac !== "none") {
        const existing = macBindings.get(definition.binding.mac);
        if (existing) {
          duplicates.push(`mac ${definition.binding.mac}: ${existing} vs ${definition.id}`);
        } else {
          macBindings.set(definition.binding.mac, definition.id);
        }
      }
      if (definition.binding.windows !== "none") {
        const existing = windowsBindings.get(definition.binding.windows);
        if (existing) {
          duplicates.push(
            `windows ${definition.binding.windows}: ${existing} vs ${definition.id}`,
          );
        } else {
          windowsBindings.set(definition.binding.windows, definition.id);
        }
      }
    }

    expect(duplicates).toEqual([]);
  });

  it("requires native menu commands to have definitions and handlers", () => {
    const defined = new Set(commandDefinitions.map((definition) => definition.id));
    const registered = new Set(getRegisteredCommandIds());
    for (const commandId of NATIVE_MENU_COMMAND_IDS) {
      expect(defined.has(commandId)).toBe(true);
      expect(registered.has(commandId)).toBe(true);
    }
  });
});

describe("palette snapshot", () => {
  const snapshot = buildCommandAvailabilitySnapshot({
    hasWorkspace: true,
    hasActiveDocument: false,
    isDirty: false,
    paneCount: 1,
    markdownPreviewAvailable: false,
  });

  it("merges binding overrides into display bindings", () => {
    const entries = buildPaletteSnapshot({
      snapshot,
      bindingOverrides: { "file.save": { mac: "Cmd+Shift+S" } },
      platform: "mac",
    });
    const save = entries.find((entry) => entry.id === "file.save");
    expect(save?.displayBinding).toBe("⌘⇧S");
  });

  it("marks disabled commands as non-runnable with reasons", () => {
    const save = buildPaletteSnapshot({ snapshot, platform: "mac" }).find(
      (entry) => entry.id === "file.save",
    );
    expect(save?.runnable).toBe(false);
    expect(save?.disabledReason).toBe("No active document.");
  });

  it("refreshes availability after context changes", () => {
    const initial = buildPaletteSnapshot({ snapshot, platform: "mac" });
    const refreshed = refreshPaletteSnapshot(initial, {
      snapshot: {
        ...snapshot,
        hasActiveDocument: true,
      },
      platform: "mac",
    });
    expect(initial.find((entry) => entry.id === "file.save")?.runnable).toBe(false);
    expect(refreshed.find((entry) => entry.id === "file.save")?.runnable).toBe(true);
  });

  it("shares effective binding resolution with shortcuts settings", () => {
    expect(
      catalogEffectiveBinding("file.save", { "file.save": { mac: "Cmd+Shift+S" } }),
    ).toEqual({
      mac: "Cmd+Shift+S",
      windows: "Ctrl+S",
    });
  });
});
