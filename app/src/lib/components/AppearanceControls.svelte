<script lang="ts">
  import { appState } from '../state/appState';
  import { appearanceForTheme, baseModeForRef, resolveActiveTheme, resolveTokensForRef } from '../state/appState/themeController';
  import { FONT_OPTIONS, type ThemeAppearance } from '../styles/themeAppearance';
  import { FONT_SCALE_MIN, FONT_SCALE_MAX, defaultFontSettings } from '../services/fontSettings';
  import ThemePreview from './ThemePreview.svelte';
  let { typographyOnly = false, section = "all" }: { typographyOnly?: boolean; section?: string } = $props();
  const snapshot = $derived($appState);
  const appearance = $derived(appearanceForTheme(snapshot.theme));
  const activeRef = $derived(resolveActiveTheme(snapshot.theme));
  const activeTokens = $derived(resolveTokensForRef(activeRef, snapshot.theme.customThemes));
  const mode = $derived(baseModeForRef(activeRef, snapshot.theme.customThemes));
  const surfaces = [
    { label: 'Interface', font: 'uiFont', size: 'uiScale', height: 'uiLineHeight' },
    { label: 'Chat & prose', font: 'chatFont', size: 'chatScale', height: 'chatLineHeight' },
    { label: 'Editor & code', font: 'codeFont', size: 'editorScale', height: 'codeLineHeight' },
  ] as const;
  const effects = [
    { key: 'glow', label: 'Text glow' }, { key: 'scanlines', label: 'Scanlines' },
    { key: 'vignette', label: 'Darken screen edges' }, { key: 'texture', label: 'Paper texture' },
  ] as const;
  function set<K extends keyof ThemeAppearance>(key: K, value: ThemeAppearance[K]) {
    appState.setAppearance({ [key]: value });
  }
</script>

{#if typographyOnly || section === "all" || section === "typography"}
<section class="settings-section appearance-controls" aria-label="Typography">
  <h3>Typography</h3>
  <p class="settings-hint">Personal adjustments stay with you when you switch themes. Fonts are included for offline use.</p>
  {#each surfaces as surface}
    <div class="settings-subsection">
      <h4>{surface.label}</h4>
      <div class="typography-fields">
        <label class="settings-field">
          <span>Font</span>
          <select aria-label={`${surface.label} font`} value={appearance[surface.font]}
            onchange={e => set(surface.font, e.currentTarget.value as ThemeAppearance['uiFont'])}>
            {#each FONT_OPTIONS.filter(f => surface.font !== 'codeFont' || ['mono', 'jetbrains', 'plex', 'terminal'].includes(f.id)) as font}
              <option value={font.id}>{font.label}</option>
            {/each}
          </select>
        </label>
        <label class="settings-field">
          <span>Size (%)</span>
          <input type="number" aria-label={`${surface.label} size`} min={FONT_SCALE_MIN} max={FONT_SCALE_MAX} step="5"
            value={snapshot.settings.fontSettings[surface.size]}
            onchange={e => appState.setFontSettings({ [surface.size]: Number(e.currentTarget.value) })} />
        </label>
        <label class="settings-field">
          <span>Line height</span>
          <input type="number" aria-label={`${surface.label} line height`} min="1.1" max={surface.font === 'uiFont' ? 2 : 2.2} step="0.05"
            value={appearance[surface.height]} onchange={e => set(surface.height, Number(e.currentTarget.value))} />
        </label>
      </div>
    </div>
  {/each}
  <label class="settings-field">
    <span>Letter spacing (px)</span>
    <input type="number" aria-label="Letter spacing" min="-0.5" max="2" step="0.1" value={appearance.letterSpacing}
      onchange={e => set('letterSpacing', Number(e.currentTarget.value))} />
  </label>
  <label class="settings-toggle">
    <input type="checkbox" checked={appearance.ligatures} onchange={e => set('ligatures', e.currentTarget.checked)} />
    Code ligatures
  </label>
  <button type="button" class="settings-button" onclick={() => appState.setFontSettings({ ...defaultFontSettings })}>Reset text sizes</button>
  <p class="settings-hint">VT323 gives Latin text a pixel terminal look; other scripts use IBM Plex Mono.</p>
</section>

{/if}
{#if !typographyOnly}
  {#if section === "all" || section === "layout"}
  <section class="settings-section" aria-label="Layout">
    <h3>Layout</h3>
    {#each [
      { key: 'density', label: 'Density', options: ['compact', 'comfortable', 'spacious'] },
      { key: 'corners', label: 'Corners', options: ['square', 'soft', 'round'] },
      { key: 'elevation', label: 'Shadows', options: ['flat', 'subtle', 'raised'] },
      { key: 'borders', label: 'Borders', options: ['subtle', 'strong'] },
      { key: 'caret', label: 'Editor cursor', options: ['bar', 'block', 'underline'] },
      { key: 'icons', label: 'File icons', options: ['color', 'monochrome'] },
    ] as field}
      <label class="settings-field">
        <span>{field.label}</span>
        <select aria-label={field.label} value={appearance[field.key as keyof ThemeAppearance]}
          onchange={e => {
            if (field.key === 'icons') appState.setColoredProjectFileIcons(e.currentTarget.value === 'color');
            else appState.setAppearance({ [field.key]: e.currentTarget.value });
          }}>
          {#each field.options as option}<option value={option}>{option[0].toUpperCase() + option.slice(1)}</option>{/each}
        </select>
      </label>
    {/each}
    <label class="settings-field">
      <span>Accent color</span>
      <input type="color" aria-label="Appearance accent color" value={appearance.accent || activeTokens['accent-color']}
        oninput={e => set('accent', e.currentTarget.value)} />
    </label>
    <button type="button" class="settings-button" onclick={() => set('accent', '')}>Use palette accent</button>
  </section>
  {/if}
  {#if section === "all" || section === "effects"}
  <section class="settings-section" aria-label="Effects">
    <h3>Effects</h3>
    {#each effects as effect}
      <label class="settings-field effect-field">
        <span>{effect.label}</span>
        <input type="range" aria-label={effect.label} min="0" max="100" step="1" value={appearance[effect.key]}
          oninput={e => set(effect.key, Number(e.currentTarget.value))} />
        <output>{appearance[effect.key]}%</output>
      </label>
    {/each}
    <label class="settings-toggle">
      <input type="checkbox" checked={appearance.flicker} onchange={e => set('flicker', e.currentTarget.checked)} />
      Gentle CRT shimmer
    </label>
    <p class="settings-hint">Shimmer is off by default and respects your system's reduced motion preference.</p>
  </section>
  {/if}
  {#if section === "all" || section === "preview"}
  <section class="settings-section" aria-label="Appearance preview">
    <h3>Live preview</h3>
    <div class="appearance-live-preview">
      <ThemePreview tokens={activeTokens} baseMode={mode} {appearance} coloredIcons={appearance.icons === 'color'} />
    </div>
    <div class="appearance-actions">
      <button type="button" class="settings-button" onclick={() => appState.saveAppearanceAsTheme()}>Save appearance as theme</button>
      <button type="button" class="settings-button" onclick={() => appState.applyFullThemeStyle()}>Apply full theme style</button>
      <button type="button" class="settings-button" onclick={() => appState.resetAppearance()}>Reset personal style</button>
    </div>
    <p class="settings-hint">Saving includes the palette, style and text sizes. Applying a full style clears personal style overrides and restores saved sizes for custom themes.</p>
  </section>
  {/if}
{/if}

<style>
  .typography-fields { display: grid; grid-template-columns: minmax(140px, 2fr) minmax(80px, 1fr) minmax(80px, 1fr); gap: var(--space-4); }
  .typography-fields input, .typography-fields select { width: 100%; min-width: 0; }
  .appearance-actions { display: flex; flex-wrap: wrap; gap: var(--space-4); }
  .appearance-live-preview { width: min(100%, 560px); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); overflow: hidden; }
  .effect-field { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(80px, 2fr) 45px; gap: var(--space-4); align-items: center; }
  output { font-variant-numeric: tabular-nums; text-align: right; color: var(--color-text-secondary); }
  @media (max-width: 480px) { .typography-fields { grid-template-columns: 1fr; } }
</style>
