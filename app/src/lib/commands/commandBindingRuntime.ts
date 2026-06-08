import type { AppCommandId, CommandBindingOverrides } from "../domain/contracts";
import {
  expandPlatformKeymaps,
  mergeCommandDefinitionsWithOverrides,
} from "./commandBindings";
import { commandDefinitions } from "./definitions";

let keyBindingsByPlatform = expandPlatformKeymaps(commandDefinitions);

export function setCommandBindingOverrides(overrides: CommandBindingOverrides): void {
  keyBindingsByPlatform = expandPlatformKeymaps(
    mergeCommandDefinitionsWithOverrides(commandDefinitions, overrides),
  );
}

export function resetCommandBindingOverrides(): void {
  setCommandBindingOverrides({});
}

export function getKeyBindingsByPlatform(): Readonly<Record<string, AppCommandId>> {
  return keyBindingsByPlatform;
}
