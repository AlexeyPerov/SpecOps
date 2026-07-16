<script lang="ts">
  import { appState } from "../state/appState";
  import type { ActiveThemeRef } from "../services/themeStore";
  import {
    BUILTIN_THEME_IDS,
    extractSolidColor,
    getBuiltinAccentHex,
    getBuiltinThemeLabel,
    getBuiltinThemeMode,
    GRADIENT_CAPABLE_KEYS,
    THEME_TOKEN_GROUPS,
    THEME_TOKEN_LABELS,
    type ThemeTokenKey,
  } from "../styles/themeTokens";
  import { IMPORTED_THEMES } from "../styles/importedThemes";
  import { CURATED_THEMES } from "../styles/curatedThemes";

  const snapshot = $derived($appState);

  /** A unified theme entry for the light/dark pickers. */
  interface ThemeOption {
    ref: ActiveThemeRef;
    name: string;
    accent: string;
    baseMode: "dark" | "light";
    editable: boolean;
  }

  const THEME_MODES = [
    { id: "manual", label: "Manual" },
    { id: "auto", label: "Auto" },
  ] as const;

  // Build the option list once per render from builtins + presets + customs.
  const allOptions = $derived<ThemeOption[]>([
    ...BUILTIN_THEME_IDS.map<ThemeOption>((id) => ({
      ref: { kind: "builtin", id },
      name: getBuiltinThemeLabel(id),
      accent: getBuiltinAccentHex(id),
      baseMode: getBuiltinThemeMode(id),
      editable: false,
    })),
    ...IMPORTED_THEMES.map<ThemeOption>((preset) => ({
      ref: { kind: "preset", id: preset.id },
      name: preset.name,
      accent: preset.tokens["accent-color"] ?? "#000000",
      baseMode: preset.baseMode,
      editable: false,
    })),
    ...CURATED_THEMES.map<ThemeOption>((preset) => ({
      ref: { kind: "preset", id: preset.id },
      name: preset.name,
      accent: preset.tokens["accent-color"] ?? "#000000",
      baseMode: preset.baseMode,
      editable: false,
    })),
    ...snapshot.theme.customThemes.map<ThemeOption>((custom) => ({
      ref: { kind: "custom", id: custom.id },
      name: custom.name,
      accent: custom.tokens["accent-color"],
      baseMode: custom.baseMode,
      editable: true,
    })),
  ]);

  const lightOptions = $derived(allOptions.filter((option) => option.baseMode === "light"));
  const darkOptions = $derived(allOptions.filter((option) => option.baseMode === "dark"));

  const activeCustom = $derived.by(() => {
    // The editor targets whichever theme is currently rendered: manual mode pins
    // manualTheme, auto mode follows the current OS pref between the two slots.
    const effectiveRef =
      snapshot.theme.mode === "manual"
        ? snapshot.theme.manualTheme
        : systemPrefersDark()
          ? snapshot.theme.darkTheme
          : snapshot.theme.lightTheme;
    if (effectiveRef.kind !== "custom") {
      return null;
    }
    return (
      snapshot.theme.customThemes.find((custom) => custom.id === effectiveRef.id) ?? null
    );
  });

  let nameDraft = $state("");

  $effect(() => {
    nameDraft = activeCustom?.name ?? "";
  });

  function systemPrefersDark(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return true;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function refsEqual(a: ActiveThemeRef, b: ActiveThemeRef): boolean {
    return a.kind === b.kind && a.id === b.id;
  }

  function isLightActive(option: ThemeOption): boolean {
    return refsEqual(option.ref, snapshot.theme.lightTheme);
  }

  function isDarkActive(option: ThemeOption): boolean {
    return refsEqual(option.ref, snapshot.theme.darkTheme);
  }

  function isManualActive(option: ThemeOption): boolean {
    return refsEqual(option.ref, snapshot.theme.manualTheme);
  }

  function isModeActive(mode: "auto" | "manual"): boolean {
    return snapshot.theme.mode === mode;
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
        <h4>Mode</h4>
        <div class="theme-mode-segmented" role="radiogroup" aria-label="Theme mode">
          {#each THEME_MODES as mode (mode.id)}
            <button
              type="button"
              role="radio"
              aria-checked={isModeActive(mode.id)}
              class="theme-mode-option"
              class:active={isModeActive(mode.id)}
              onclick={() => appState.setThemeMode(mode.id)}
            >
              {mode.label}
            </button>
          {/each}
        </div>
        {#if snapshot.theme.mode === "auto"}
          <p class="settings-hint">
            Auto follows your system appearance (dark/light). Pick the two themes to switch between below.
          </p>
        {/if}
      </div>

      {#if snapshot.theme.mode === "manual"}
        <div class="settings-subsection">
          <h4>Theme</h4>
          {#each allOptions as option (option.ref.kind + ":" + option.ref.id)}
            <label class="settings-theme-row" aria-label="{option.name} {option.baseMode}">
              <input
                type="radio"
                name="manual-theme"
                value={option.ref.id}
                checked={isManualActive(option)}
                onchange={() => appState.setManualTheme(option.ref)}
              />
              <span class="theme-swatch" style="background-color: {option.accent}"></span>
              <span>{option.name}</span>
              <span class="theme-row-tag theme-mode-tag">{option.baseMode}</span>
              {#if option.editable}
                <span class="theme-row-tag">custom</span>
              {/if}
              <button
                type="button"
                class="theme-row-duplicate"
                aria-label="Duplicate {option.name}"
                onclick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  appState.duplicateTheme(option.ref);
                }}
              >Duplicate</button>
            </label>
          {/each}
        </div>
      {:else}
        <div class="settings-subsection">
          <h4>Light theme</h4>
          {#each lightOptions as option (option.ref.kind + ":" + option.ref.id)}
            <label class="settings-theme-row" aria-label="{option.name} {option.baseMode}">
              <input
                type="radio"
                name="light-theme"
                value={option.ref.id}
                checked={isLightActive(option)}
                onchange={() => appState.setLightTheme(option.ref)}
              />
              <span class="theme-swatch" style="background-color: {option.accent}"></span>
              <span>{option.name}</span>
              <span class="theme-row-tag theme-mode-tag">{option.baseMode}</span>
              {#if option.editable}
                <span class="theme-row-tag">custom</span>
              {/if}
              <button
                type="button"
                class="theme-row-duplicate"
                aria-label="Duplicate {option.name}"
                onclick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  appState.duplicateTheme(option.ref);
                }}
              >Duplicate</button>
            </label>
          {/each}
        </div>

      <div class="settings-subsection">
        <h4>Dark theme</h4>
        {#each darkOptions as option (option.ref.kind + ":" + option.ref.id)}
          <label class="settings-theme-row" aria-label="{option.name} {option.baseMode}">
            <input
              type="radio"
              name="dark-theme"
              value={option.ref.id}
              checked={isDarkActive(option)}
              onchange={() => appState.setDarkTheme(option.ref)}
            />
            <span class="theme-swatch" style="background-color: {option.accent}"></span>
            <span>{option.name}</span>
            <span class="theme-row-tag theme-mode-tag">{option.baseMode}</span>
            {#if option.editable}
              <span class="theme-row-tag">custom</span>
            {/if}
            <button
              type="button"
              class="theme-row-duplicate"
              aria-label="Duplicate {option.name}"
              onclick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                appState.duplicateTheme(option.ref);
              }}
            >Duplicate</button>
          </label>
        {/each}
      </div>
      {/if}

      <button type="button" class="settings-button" onclick={() => appState.createCustomTheme()}>
        + New theme
      </button>
    </section>

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

  .theme-mode-segmented {
    display: inline-flex;
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--color-surface-2);
    border-radius: var(--radius-md, 6px);
    border: 1px solid var(--color-border-subtle);
  }

  .theme-mode-option {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    padding: var(--space-4) var(--space-12);
    border-radius: 4px;
    font-size: 0.8125rem;
    cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease;
  }

  .theme-mode-option.active {
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-sm);
  }

  .theme-mode-option:hover:not(.active) {
    color: var(--color-text-primary);
  }
</style>
