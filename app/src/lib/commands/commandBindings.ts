import type {
  AppCommandId,
  CommandBinding,
  CommandBindingOverrides,
  CommandDefinition,
} from "../domain/contracts";
import { isMacOs } from "../services/platform";

export type { CommandBindingOverrides };

const BINDING_KEY_TO_KEYMAP_TOKEN: Record<string, string> = {
  Up: "arrowup",
  Down: "arrowdown",
  Tab: "tab",
};

const KEYMAP_TOKEN_TO_BINDING_KEY: Record<string, string> = {
  arrowup: "Up",
  arrowdown: "Down",
  tab: "Tab",
};

const MODIFIER_ONLY_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

export function bindingToKeymapToken(binding: string, platform: "mac" | "windows"): string | null {
  if (binding === "none") {
    return null;
  }

  const parts = binding.split("+");
  const keyPart = parts[parts.length - 1] ?? "";
  const modifierParts = parts.slice(0, -1);
  const tokens: string[] = [];

  for (const modifier of modifierParts) {
    if (modifier === "Cmd") {
      if (platform === "mac") {
        tokens.push("Meta");
      }
    } else if (modifier === "Ctrl") {
      tokens.push("Ctrl");
    } else if (modifier === "Shift") {
      tokens.push("Shift");
    } else if (modifier === "Alt") {
      tokens.push("Alt");
    }
  }

  const keyToken = BINDING_KEY_TO_KEYMAP_TOKEN[keyPart] ?? keyPart.toLowerCase();
  tokens.push(keyToken);
  return tokens.join("+");
}

export function expandPlatformKeymaps(
  definitions: CommandDefinition[],
): Record<string, AppCommandId> {
  const keymap: Record<string, AppCommandId> = {};
  for (const definition of definitions) {
    if (!definition.binding) {
      continue;
    }
    const macToken = bindingToKeymapToken(definition.binding.mac, "mac");
    if (macToken) {
      keymap[macToken] = definition.id;
    }
    const windowsToken = bindingToKeymapToken(definition.binding.windows, "windows");
    if (windowsToken) {
      keymap[windowsToken] = definition.id;
    }
  }
  return keymap;
}

export function getEffectiveBinding(
  definition: CommandDefinition,
  overrides: CommandBindingOverrides,
): CommandBinding | undefined {
  if (!definition.binding) {
    return undefined;
  }
  const override = overrides[definition.id];
  return {
    mac: override?.mac ?? definition.binding.mac,
    windows: override?.windows ?? definition.binding.windows,
  };
}

export function mergeCommandDefinitionsWithOverrides(
  definitions: CommandDefinition[],
  overrides: CommandBindingOverrides,
): CommandDefinition[] {
  return definitions.map((definition) => {
    const binding = getEffectiveBinding(definition, overrides);
    if (!binding) {
      return definition;
    }
    return { ...definition, binding };
  });
}

export function listShortcutCommands(
  definitions: CommandDefinition[],
  overrides: CommandBindingOverrides,
): Array<{ id: AppCommandId; label: string; binding: CommandBinding; isCustomized: boolean }> {
  const platform = isMacOs() ? "mac" : "windows";
  const rows: Array<{
    id: AppCommandId;
    label: string;
    binding: CommandBinding;
    isCustomized: boolean;
  }> = [];

  for (const definition of definitions) {
    const binding = getEffectiveBinding(definition, overrides);
    if (!binding || binding[platform] === "none") {
      continue;
    }
    const override = overrides[definition.id];
    const isCustomized = Boolean(override?.[platform]);
    rows.push({
      id: definition.id,
      label: definition.label,
      binding,
      isCustomized,
    });
  }

  return rows.sort((left, right) => left.label.localeCompare(right.label));
}

export function formatBindingForDisplay(binding: string): string {
  return formatBindingForPlatform(binding, isMacOs() ? "mac" : "windows");
}

export function formatBindingForPlatform(
  binding: string,
  platform: "mac" | "windows",
): string {
  if (binding === "none") {
    return "None";
  }
  if (platform === "mac") {
    return binding
      .replaceAll("Cmd+", "⌘")
      .replaceAll("Alt+", "⌥")
      .replaceAll("Shift+", "⇧")
      .replaceAll("Ctrl+", "⌃");
  }
  return binding;
}

function formatBindingKeyFromKeyboard(key: string): string | null {
  if (MODIFIER_ONLY_KEYS.has(key)) {
    return null;
  }
  if (key === " ") {
    return "Space";
  }
  if (key === "ArrowUp") {
    return "Up";
  }
  if (key === "ArrowDown") {
    return "Down";
  }
  if (key.length === 1) {
    if (/[a-z]/i.test(key)) {
      return key.toUpperCase();
    }
    return key;
  }
  if (key === "Tab") {
    return "Tab";
  }
  return key;
}

export function keyboardEventToBinding(event: KeyboardEvent): string | null {
  const keyPart = formatBindingKeyFromKeyboard(event.key);
  if (!keyPart) {
    return null;
  }

  const modifiers: string[] = [];
  if (isMacOs()) {
    if (event.metaKey) {
      modifiers.push("Cmd");
    }
    if (event.ctrlKey) {
      modifiers.push("Ctrl");
    }
  } else if (event.ctrlKey || event.metaKey) {
    modifiers.push("Ctrl");
  }
  if (event.shiftKey) {
    modifiers.push("Shift");
  }
  if (event.altKey) {
    modifiers.push("Alt");
  }

  if (modifiers.length === 0) {
    return null;
  }

  return [...modifiers, keyPart].join("+");
}

export function findKeymapConflict(
  definitions: CommandDefinition[],
  commandId: AppCommandId,
  binding: string,
  platform: "mac" | "windows",
): AppCommandId | null {
  const token = bindingToKeymapToken(binding, platform);
  if (!token) {
    return null;
  }
  const keymap = expandPlatformKeymaps(definitions);
  const existing = keymap[token];
  if (!existing || existing === commandId) {
    return null;
  }
  return existing;
}

export function normalizeCommandBindingOverrides(
  value: unknown,
): CommandBindingOverrides {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const normalized: CommandBindingOverrides = {};
  for (const [commandId, binding] of Object.entries(record)) {
    if (typeof binding !== "object" || binding === null) {
      continue;
    }
    const partial = binding as Record<string, unknown>;
    const mac = typeof partial.mac === "string" ? partial.mac : undefined;
    const windows = typeof partial.windows === "string" ? partial.windows : undefined;
    if (!mac && !windows) {
      continue;
    }
    normalized[commandId as AppCommandId] = { mac, windows };
  }
  return normalized;
}

export function keymapTokenToDisplayBinding(token: string): string {
  const parts = token.split("+");
  const keyToken = parts[parts.length - 1] ?? "";
  const keyLabel = KEYMAP_TOKEN_TO_BINDING_KEY[keyToken] ?? keyToken.toUpperCase();
  const modifiers = parts.slice(0, -1).map((modifier) => {
    if (modifier === "Meta") {
      return "Cmd";
    }
    return modifier;
  });
  return [...modifiers, keyLabel].join("+");
}
