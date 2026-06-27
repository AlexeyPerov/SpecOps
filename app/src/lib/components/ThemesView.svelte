<script lang="ts">
  import { appState } from "../state/appState";
  import type { CustomThemeRecord } from "../services/themeStore";
  import {
    BUILTIN_THEME_IDS,
    extractSolidColor,
    getBuiltinAccentHex,
    getBuiltinThemeLabel,
    GRADIENT_CAPABLE_KEYS,
    THEME_TOKEN_GROUPS,
    THEME_TOKEN_LABELS,
    type ThemeTokenKey,
  } from "../styles/themeTokens";
  import { IMPORTED_THEMES } from "../styles/importedThemes";

  const snapshot = $derived($appState);

  const activeCustom = $derived(
    snapshot.theme.activeTheme.kind === "custom"
      ? (snapshot.theme.customThemes.find(
          (custom) => custom.id === snapshot.theme.activeTheme.id,
        ) ?? null)
      : null,
  );

  let nameDraft = $state("");

  $effect(() => {
    nameDraft = activeCustom?.name ?? "";
  });

  function isBuiltinActive(id: string): boolean {
    return snapshot.theme.activeTheme.kind === "builtin" && snapshot.theme.activeTheme.id === id;
  }

  function isCustomActive(id: string): boolean {
    return snapshot.theme.activeTheme.kind === "custom" && snapshot.theme.activeTheme.id === id;
  }

  function isPresetActive(id: string): boolean {
    return snapshot.theme.activeTheme.kind === "preset" && snapshot.theme.activeTheme.id === id;
  }

  function customAccentSwatch(custom: CustomThemeRecord): string {
    return custom.tokens["accent-color"];
  }

  function cssColorToHex(value: string): string | null {
    const trimmed = value.trim();
    const shortHex = /^#([0-9a-f]{3})$/i.exec(trimmed);
    if (shortHex) {
      const [r, g, b] = shortHex[1];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
      return trimmed.toLowerCase();
    }
    const rgbMatch = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(trimmed);
    if (rgbMatch) {
      const channels = [rgbMatch[1], rgbMatch[2], rgbMatch[3]].map((channel) =>
        Math.round(Number(channel))
          .toString(16)
          .padStart(2, "0"),
      );
      return `#${channels.join("")}`;
    }
    return null;
  }

  function pickerValueForToken(key: ThemeTokenKey, value: string): string {
    const solid = GRADIENT_CAPABLE_KEYS.has(key) ? extractSolidColor(value) : value;
    return cssColorToHex(solid) ?? "#000000";
  }

  function updateToken(customId: string, key: ThemeTokenKey, value: string): void {
    appState.updateCustomThemeToken(customId, key, value);
  }

  function commitCustomName(): void {
    if (!activeCustom) {
      return;
    }
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === activeCustom.name) {
      nameDraft = activeCustom.name;
      return;
    }
    appState.renameCustomTheme(activeCustom.id, trimmed);
  }

  function handleNameKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      (event.currentTarget as HTMLInputElement).blur();
    }
  }
</script>

<div class="themes-view" aria-label="Theme">
  <header class="themes-view-header">
    <h2 class="themes-view-title">Theme</h2>
  </header>

  <div class="themes-view-scroll">
    <section class="settings-section">
      <h3>Appearance</h3>
      <label class="settings-toggle">
        <input
          type="checkbox"
          checked={snapshot.settings.decoratePlaintextSymbols}
          onchange={(event) =>
            appState.setDecoratePlaintextSymbols(
              (event.currentTarget as HTMLInputElement).checked,
            )}
        />
        Decorate plaintext symbols
      </label>
      <div class="settings-subsection">
        <h4>Built-in themes</h4>
        {#each BUILTIN_THEME_IDS as themeId}
          <label class="settings-theme-row">
            <input
              type="radio"
              name="theme"
              value={themeId}
              checked={isBuiltinActive(themeId)}
              onchange={() => appState.setActiveTheme({ kind: "builtin", id: themeId })}
            />
            <span class="theme-swatch" style="background-color: {getBuiltinAccentHex(themeId)}"></span>
            <span>{getBuiltinThemeLabel(themeId)}</span>
          </label>
        {/each}
      </div>
      {#if IMPORTED_THEMES.length > 0}
        <div class="settings-subsection">
          <h4>Presets</h4>
          <p class="settings-hint">
            Read-only — create a custom theme from “+ New theme” to edit colors.
          </p>
          {#each IMPORTED_THEMES as preset (preset.id)}
            <label class="settings-theme-row">
              <input
                type="radio"
                name="theme"
                value={preset.id}
                checked={isPresetActive(preset.id)}
                onchange={() => appState.setActiveTheme({ kind: "preset", id: preset.id })}
              />
              <span
                class="theme-swatch"
                style="background-color: {preset.tokens["accent-color"]}"
              ></span>
              <span>{preset.name}</span>
              <span class="theme-row-tag">{preset.baseMode}</span>
            </label>
          {/each}
        </div>
      {/if}
      <button type="button" class="settings-button" onclick={() => appState.createCustomTheme()}>
        + New theme
      </button>
    </section>

    {#if snapshot.theme.customThemes.length > 0}
      <section class="settings-section">
        <h3>Your themes</h3>
        {#each snapshot.theme.customThemes as custom (custom.id)}
          <label class="settings-theme-row">
            <input
              type="radio"
              name="theme"
              value={custom.id}
              checked={isCustomActive(custom.id)}
              onchange={() => appState.setActiveTheme({ kind: "custom", id: custom.id })}
            />
            <span class="theme-swatch" style="background-color: {customAccentSwatch(custom)}"></span>
            <span>{custom.name}</span>
          </label>
        {/each}
      </section>
    {/if}

    {#if activeCustom}
      <section class="settings-section">
        <label class="settings-field">
          <span>Name</span>
          <input
            type="text"
            bind:value={nameDraft}
            onblur={commitCustomName}
            onkeydown={handleNameKeydown}
          />
        </label>
        <button
          type="button"
          class="settings-button settings-button-danger"
          onclick={() => appState.deleteCustomTheme(activeCustom.id)}
        >
          Delete theme
        </button>
      </section>

      <section class="settings-section">
        <h3>Theme tokens</h3>
        {#each THEME_TOKEN_GROUPS as group}
          <div class="settings-subsection">
            <h4>{group.label}</h4>
            {#if group.id === "background"}
              <p class="settings-hint">
                Background fields accept CSS gradients (e.g.
                <code>linear-gradient(#1a1a2e, #16213e)</code>).
              </p>
            {/if}
            {#each group.keys as key (key)}
              {@const tokenValue = activeCustom.tokens[key]}
              <div class="theme-token-row">
                <span class="theme-token-label">{THEME_TOKEN_LABELS[key]}</span>
                <div class="theme-token-controls">
                  <input
                    type="color"
                    value={pickerValueForToken(key, tokenValue)}
                    aria-label="{THEME_TOKEN_LABELS[key]} color picker"
                    oninput={(event) =>
                      updateToken(
                        activeCustom.id,
                        key,
                        (event.currentTarget as HTMLInputElement).value,
                      )
                    }
                  />
                  <input
                    type="text"
                    class="theme-token-text"
                    value={tokenValue}
                    aria-label="{THEME_TOKEN_LABELS[key]} CSS value"
                    oninput={(event) =>
                      updateToken(
                        activeCustom.id,
                        key,
                        (event.currentTarget as HTMLInputElement).value,
                      )
                    }
                  />
                </div>
              </div>
            {/each}
          </div>
        {/each}
      </section>
    {/if}
  </div>
</div>

<style>
  @import "../styles/settingsForm.css";
  @import "../styles/themePaneForm.css";

  .themes-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--color-surface-1);
  }

  .themes-view-header {
    flex-shrink: 0;
    padding: var(--space-12) var(--space-12) var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .themes-view-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .themes-view-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-8) var(--space-12) var(--space-12);
  }
</style>
