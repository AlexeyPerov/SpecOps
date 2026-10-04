import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, normalizeAppearanceOverrides, resolveAppearance } from './themeAppearance';
import { PRESET_THEMES } from './themeCatalog';
import { contrastRatio } from './themeContrast';
import { applyThemeState, appearanceForTheme } from '../state/appState/themeController';
import { defaultThemeState } from '../state/appState/themeController';

describe('appearance preferences', () => {
  it('bounds persisted settings and ignores invalid fonts, effects and CSS values', () => {
    expect(normalizeAppearanceOverrides({ codeFont: 'serif', uiFont: 'missing', scanlines: 500, glow: -1, chatLineHeight: NaN, accent: 'url(x)', flicker: 'yes' })).toEqual({ scanlines: 100, glow: 0 });
    expect(normalizeAppearanceOverrides(null)).toEqual({});
  });
  it('preserves personal typography and explicitly disabled effects across palettes', () => {
    const personal = { uiFont: 'serif', glow: 0, flicker: false } as const;
    expect(resolveAppearance({ uiFont: 'terminal', glow: 40, scanlines: 30 }, personal)).toMatchObject({ ...personal, scanlines: 30 });
    expect(resolveAppearance({}, personal)).toMatchObject(personal);
  });
  it('resets all effects, cursor and custom accent when returning to a plain theme', () => {
    const root = document.documentElement;
    applyThemeState({ ...defaultThemeState, mode: 'manual', manualTheme: { kind: 'preset', id: 'crt-green' }, appearanceOverrides: { accent: '#123456', flicker: true } });
    expect(root.dataset.appearanceCaret).toBe('block');
    expect(root.style.getPropertyValue('--appearance-scanlines')).not.toBe('0');
    expect(root.style.getPropertyValue('--accent-color')).toBe('#123456');
    applyThemeState({ ...defaultThemeState, mode: 'manual', manualTheme: { kind: 'builtin', id: 'light-blue' } });
    expect(root.dataset.appearanceCaret).toBe('bar');
    expect(root.dataset.appearanceFlicker).toBe('false');
    expect(root.style.getPropertyValue('--appearance-scanlines')).toBe('0');
    expect(root.style.getPropertyValue('--color-selection')).toBe('');
    expect(appearanceForTheme(defaultThemeState)).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('unified theme catalog', () => {
  it('keeps ordinary and retro palettes available to the same resolver', () => {
    expect(new Set(PRESET_THEMES.map(t => t.id)).size).toBe(PRESET_THEMES.length);
    for (const id of ['terminal-green', 'terminal-amber', 'crt-green', 'dos-blue', 'vintage-lcd', 'catppuccin-latte', 'solarized-light', 'gruvbox-light', 'tokyo-day', 'paper-ink']) {
      const preset = PRESET_THEMES.find(t => t.id === id)!;
      expect(preset).toBeDefined();
      applyThemeState({ ...defaultThemeState, mode: 'manual', manualTheme: { kind: 'preset', id } });
      expect(document.documentElement.style.getPropertyValue('--color-bg-root')).toBe(preset.tokens['color-bg-root']);
    }
  });
  it('keeps primary, secondary, hidden-file and comment text readable on both surfaces', () => {
    for (const preset of PRESET_THEMES) {
      for (const key of ['color-text-primary', 'color-text-secondary', 'syntax-comment', 'project-pane-color-hidden'] as const) {
        for (const bg of ['color-bg-root', 'color-surface-1'] as const) {
          expect(contrastRatio(preset.tokens[key]!, preset.tokens[bg]!), `${preset.id} ${key} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
