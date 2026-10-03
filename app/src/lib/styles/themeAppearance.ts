/** Appearance is resolved from a theme's style, followed by personal overrides. */
export const FONT_OPTIONS = [
  { id: 'system', label: 'System sans', css: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  { id: 'inter', label: 'Inter', css: '"Inter", system-ui, sans-serif' },
  { id: 'serif', label: 'IBM Plex Serif', css: '"IBM Plex Serif", Georgia, serif' },
  { id: 'mono', label: 'System monospace', css: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace' },
  { id: 'jetbrains', label: 'JetBrains Mono', css: '"JetBrains Mono", ui-monospace, monospace' },
  { id: 'plex', label: 'IBM Plex Mono', css: '"IBM Plex Mono", ui-monospace, monospace' },
  { id: 'terminal', label: 'VT323 · retro', css: '"VT323", "IBM Plex Mono", monospace' },
] as const;
export type FontId = (typeof FONT_OPTIONS)[number]['id'];
export interface ThemeAppearance {
  uiFont: FontId;
  chatFont: FontId;
  codeFont: FontId;
  uiLineHeight: number;
  chatLineHeight: number;
  codeLineHeight: number;
  letterSpacing: number;
  ligatures: boolean;
  caret: 'bar' | 'block' | 'underline';
  density: 'compact' | 'comfortable' | 'spacious';
  corners: 'square' | 'soft' | 'round';
  elevation: 'flat' | 'subtle' | 'raised';
  borders: 'subtle' | 'strong';
  icons: 'color' | 'monochrome';
  accent: string;
  glow: number;
  scanlines: number;
  vignette: number;
  texture: number;
  flicker: boolean;
}
export const DEFAULT_APPEARANCE: ThemeAppearance = {
  uiFont: 'inter', chatFont: 'inter', codeFont: 'jetbrains',
  uiLineHeight: 1.45, chatLineHeight: 1.55, codeLineHeight: 1.5,
  letterSpacing: 0, ligatures: false, caret: 'bar', density: 'comfortable',
  corners: 'soft', elevation: 'subtle', borders: 'subtle', icons: 'color',
  accent: '', glow: 0, scanlines: 0, vignette: 0, texture: 0, flicker: false,
};
const choices = {
  uiFont: FONT_OPTIONS.map(f => f.id), chatFont: FONT_OPTIONS.map(f => f.id),
  codeFont: ['mono', 'jetbrains', 'plex', 'terminal'],
  caret: ['bar', 'block', 'underline'],
  density: ['compact', 'comfortable', 'spacious'], corners: ['square', 'soft', 'round'],
  elevation: ['flat', 'subtle', 'raised'], borders: ['subtle', 'strong'], icons: ['color', 'monochrome'],
} as const;
const ranges = {
  uiLineHeight: [1.1, 2], chatLineHeight: [1.1, 2.2], codeLineHeight: [1.1, 2.2],
  letterSpacing: [-0.5, 2], glow: [0, 100], scanlines: [0, 100], vignette: [0, 100], texture: [0, 100],
} as const;
export function normalizeAppearanceOverrides(raw: unknown): Partial<ThemeAppearance> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, values] of Object.entries(choices)) {
    if ((values as readonly unknown[]).includes(record[key])) result[key] = record[key];
  }
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = Math.min(max, Math.max(min, value));
  }
  for (const key of ['ligatures', 'flicker']) if (typeof record[key] === 'boolean') result[key] = record[key];
  if (typeof record.accent === 'string' && (record.accent === '' || /^#[a-f\d]{6}$/i.test(record.accent))) result.accent = record.accent;
  return result as Partial<ThemeAppearance>;
}
export function resolveAppearance(style?: Partial<ThemeAppearance>, personal?: Partial<ThemeAppearance>): ThemeAppearance {
  return { ...DEFAULT_APPEARANCE, ...normalizeAppearanceOverrides(style), ...normalizeAppearanceOverrides(personal) };
}
export function fontCss(id: FontId): string {
  return FONT_OPTIONS.find(f => f.id === id)?.css ?? FONT_OPTIONS[0].css;
}
/** Shared with isolated previews; does not change application state. */
export function appearanceVariables(a: ThemeAppearance): Record<string, string> {
  const spacing = a.density === 'compact' ? 0.8 : a.density === 'spacious' ? 1.2 : 1;
  const radius = a.corners === 'square' ? [0, 0] : a.corners === 'round' ? [10, 16] : [6, 10];
  const shadowOpacity = a.elevation === 'raised' ? [0.22, 0.3, 0.4] : [0.12, 0.18, 0.28];
  return {
    '--font-size-adjust-ui': a.uiFont === 'terminal' ? '0.65' : 'none',
    '--font-size-adjust-chat': a.chatFont === 'terminal' ? '0.65' : 'none',
    '--font-size-adjust-code': a.codeFont === 'terminal' ? '0.65' : 'none',
    '--font-family-ui': fontCss(a.uiFont), '--font-family-chat': fontCss(a.chatFont),
    '--font-family-mono': fontCss(a.codeFont), '--font-mono': fontCss(a.codeFont),
    '--line-height-ui': String(a.uiLineHeight), '--line-height-chat': String(a.chatLineHeight),
    '--line-height-code': String(a.codeLineHeight), '--text-letter-spacing': `${a.letterSpacing}px`,
    '--code-ligatures': a.ligatures ? 'normal' : 'none',
    '--radius-sm': `${radius[0]}px`, '--radius-md': `${radius[1]}px`,
    '--tab-header-height': `${Math.round(32 * spacing)}px`,
    '--statusbar-height': `${Math.round(25 * spacing)}px`,
    '--project-tree-row-height': `${Math.round(19 * spacing)}px`,
    '--project-tree-row-spacing': `${a.density === 'compact' ? 1 : a.density === 'spacious' ? 4 : 2}px`,
    ...Object.fromEntries([1, 2, 3, 4, 5, 6, 8, 10, 12].map(n => [`--space-${n}`, `${Math.round(n * 2 * spacing)}px`])),
    '--shadow-sm': a.elevation === 'flat' ? 'none' : `0 1px 4px rgb(0 0 0 / ${shadowOpacity[0]})`,
    '--shadow-popover': a.elevation === 'flat' ? 'none' : `0 4px 16px rgb(0 0 0 / ${shadowOpacity[1]})`,
    '--shadow-overlay': a.elevation === 'flat' ? 'none' : `0 16px 44px rgb(0 0 0 / ${shadowOpacity[2]})`,
    '--appearance-glow': `${a.glow / 12}px`, '--appearance-scanlines': String(a.scanlines / 100 * 0.22),
    '--appearance-vignette': String(a.vignette / 100 * 0.6), '--appearance-texture': String(a.texture / 100 * 0.12),
  };
}
export function applyAppearance(a: ThemeAppearance, root: HTMLElement): void {
  for (const [key, value] of Object.entries(appearanceVariables(a))) root.style.setProperty(key, value);
  root.style.removeProperty('--color-selection');
  root.dataset.appearanceCaret = a.caret;
  root.dataset.appearanceIcons = a.icons;
  root.dataset.appearanceFlicker = String(a.flicker);
  root.dataset.appearanceGlow = String(a.glow > 0);
  if (a.borders === 'strong') root.style.setProperty('--color-border-subtle', 'color-mix(in srgb, var(--color-text-primary) 42%, transparent)');
  if (a.accent) {
    root.style.setProperty('--accent-color', a.accent);
    root.style.setProperty('--color-accent', a.accent);
    root.style.setProperty('--color-selection', 'color-mix(in srgb, var(--color-accent) 28%, transparent)');
  }
  root.dispatchEvent?.(new Event('appearancechange'));
}
