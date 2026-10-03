import { IMPORTED_THEMES } from './importedThemes';
import { CURATED_THEMES } from './curatedThemes';
import { readableColor } from './themeContrast';
import type { PresetThemeRecord } from './convertVscodeTheme';
/** One catalog for selection, persistence, resolution and cycling. */
export const PRESET_THEMES: readonly PresetThemeRecord[] = [...IMPORTED_THEMES, ...CURATED_THEMES].map(preset => {
  const tokens = { ...preset.tokens };
  const backgrounds = [tokens['color-bg-root']!, tokens['color-surface-1']!];
  for (const key of ['color-text-primary', 'color-text-secondary', 'syntax-comment', 'project-pane-color-hidden'] as const) {
    if (tokens[key]) tokens[key] = readableColor(tokens[key], backgrounds);
  }
  return { ...preset, name: preset.id === "github" ? "GitHub Light" : preset.name[0].toUpperCase() + preset.name.slice(1), tokens };
});
