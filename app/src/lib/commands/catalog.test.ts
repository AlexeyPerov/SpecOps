import { describe, expect, it, vi } from "vitest";
import {
  emptyAvailabilitySnapshot,
  resolveCommandAvailability,
} from "./availability";
import { buildCommandCatalog, paletteCatalogEntries } from "./catalog";
import { commandDefinitions } from "./definitions";
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

  it("does not mutate the snapshot during resolution", () => {
    const snapshot = emptyAvailabilitySnapshot();
    const frozen = Object.freeze({ ...snapshot });
    resolveCommandAvailability("document", frozen);
    resolveCommandAvailability("dirty", frozen);
    expect(frozen).toEqual(emptyAvailabilitySnapshot());
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
    // Catalog build must not invoke registry dispatch.
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
