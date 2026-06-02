import { describe, expect, it } from "vitest";
import type { CommandDefinition } from "../domain/contracts";
import { mockNavigatorPlatform } from "../test/helpers";
import {
  expandPlatformKeymaps,
  findKeymapConflict,
  formatBindingForDisplay,
  getEffectiveBinding,
  keyboardEventToBinding,
  listShortcutCommands,
  mergeCommandDefinitionsWithOverrides,
  normalizeCommandBindingOverrides,
} from "./commandBindings";
import { commandDefinitions } from "./registry";

describe("commandBindings", () => {
  it("merges overrides into effective bindings", () => {
    const definition: CommandDefinition = {
      id: "file.save",
      label: "Save",
      menuPath: "File/Save",
      binding: { mac: "Cmd+S", windows: "Ctrl+S" },
    };
    expect(getEffectiveBinding(definition, { "file.save": { mac: "Cmd+Shift+S" } })).toEqual({
      mac: "Cmd+Shift+S",
      windows: "Ctrl+S",
    });
  });

  it("rebuilds keymap from merged definitions", () => {
    const merged = mergeCommandDefinitionsWithOverrides(commandDefinitions, {
      "file.save": { mac: "Cmd+Shift+K" },
    });
    const keymap = expandPlatformKeymaps(merged);
    expect(keymap["Meta+Shift+k"]).toBe("file.save");
    expect(keymap["Meta+s"]).toBeUndefined();
  });

  it("lists only commands with a binding on the current platform", () => {
    const restore = mockNavigatorPlatform("MacIntel");
    const rows = listShortcutCommands(commandDefinitions, {});
    restore();
    expect(rows.some((row) => row.id === "file.save")).toBe(true);
    expect(rows.some((row) => row.id === "file.openRecent")).toBe(false);
  });

  it("detects keymap conflicts", () => {
    const merged = mergeCommandDefinitionsWithOverrides(commandDefinitions, {});
    expect(findKeymapConflict(merged, "file.new", "Cmd+S", "mac")).toBe("file.save");
    expect(findKeymapConflict(merged, "file.save", "Cmd+S", "mac")).toBeNull();
  });

  it("parses keyboard events into binding strings on macOS", () => {
    const restore = mockNavigatorPlatform("MacIntel");
    const binding = keyboardEventToBinding({
      key: "s",
      metaKey: true,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
    } as KeyboardEvent);
    restore();
    expect(binding).toBe("Cmd+S");
  });

  it("normalizes persisted override records", () => {
    expect(
      normalizeCommandBindingOverrides({
        "file.save": { mac: "Cmd+Shift+S", windows: 1 },
        invalid: "x",
      }),
    ).toEqual({ "file.save": { mac: "Cmd+Shift+S" } });
  });

  it("formats bindings for display on macOS", () => {
    const restore = mockNavigatorPlatform("MacIntel");
    expect(formatBindingForDisplay("Cmd+Shift+S")).toBe("⌘⇧S");
    restore();
  });
});
