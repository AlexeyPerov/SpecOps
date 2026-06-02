export type SettingsDialogTab = "editor" | "shortcuts" | "glm" | "debugAi";

export interface SettingsTabDefinition {
  id: SettingsDialogTab;
  label: string;
  panelAriaLabel: string;
}

export const SETTINGS_TABS = [
  {
    id: "editor",
    label: "Editor",
    panelAriaLabel: "Editor settings",
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    panelAriaLabel: "Keyboard shortcuts",
  },
  {
    id: "glm",
    label: "GLM",
    panelAriaLabel: "GLM provider settings",
  },
  {
    id: "debugAi",
    label: "Debug AI",
    panelAriaLabel: "Debug AI provider settings",
  },
] as const satisfies readonly SettingsTabDefinition[];

type SettingsDialogOpener = (tab: SettingsDialogTab) => void;

let opener: SettingsDialogOpener | null = null;

export function registerSettingsDialogOpener(next: SettingsDialogOpener | null): void {
  opener = next;
}

export function openSettingsDialog(tab: SettingsDialogTab = "editor"): void {
  opener?.(tab);
}

export function getSettingsTabDefinition(tab: SettingsDialogTab): SettingsTabDefinition {
  const definition = SETTINGS_TABS.find((entry) => entry.id === tab);
  if (!definition) {
    throw new Error(`Unknown settings tab: ${tab}`);
  }
  return definition;
}
