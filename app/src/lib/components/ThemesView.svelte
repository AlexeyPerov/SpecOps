<script lang="ts">
  import { appState } from "../state/appState";
  import type { ActiveThemeRef } from "../services/themeStore";
  import {
    BUILTIN_THEME_IDS,
    extractSolidColor,
    resolveBuiltinTokens,
    type ThemeTokens,
    getBuiltinThemeLabel,
    getBuiltinThemeMode,
    GRADIENT_CAPABLE_KEYS,
    THEME_TOKEN_GROUPS,
    THEME_TOKEN_LABELS,
    type ThemeTokenKey,
  } from "../styles/themeTokens";
  import { PRESET_THEMES } from "../styles/themeCatalog";
  import AppearanceControls from "./AppearanceControls.svelte";
  import { appearanceForTheme, resolveActiveTheme, getSystemPrefersDark } from "../state/appState/themeController";
  import { resolveAppearance, type ThemeAppearance } from "../styles/themeAppearance";
  import ThemeCard from "./ThemeCard.svelte";
  import ProjectFileIcon from "./icons/ProjectFileIcon.svelte";

  const snapshot = $derived($appState);

  /** A unified theme entry for the light/dark pickers. */
  interface ThemeOption {
    ref: ActiveThemeRef;
    name: string;
    tokens: Partial<ThemeTokens>;
    baseMode: "dark" | "light";
    editable: boolean;
    appearance?: Partial<ThemeAppearance>;
    category?: string;
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
      tokens: resolveBuiltinTokens(id),
      baseMode: getBuiltinThemeMode(id),
      editable: false,
    })),
    ...PRESET_THEMES.map<ThemeOption>((preset) => ({
      ref: { kind: "preset", id: preset.id },
      name: preset.name,
      tokens: preset.tokens,
      appearance: preset.appearance,
      category: preset.category ?? "classic",
      baseMode: preset.baseMode,
      editable: false,
    })),
    ...snapshot.theme.customThemes.map<ThemeOption>((custom) => ({
      ref: { kind: "custom", id: custom.id },
      name: custom.name,
      tokens: custom.tokens,
      appearance: custom.appearance,
      category: "custom",
      baseMode: custom.baseMode,
      editable: true,
    })),
  ]);

  let section = $state("palette");
  let search = $state("");
  let category = $state("all");
  const filteredOptions = $derived(allOptions.filter(o => o.name.toLowerCase().includes(search.toLowerCase().trim()) && (category === "all" || (o.category ?? "classic") === category)));
  const currentName = $derived(allOptions.find(o => refsEqual(o.ref, resolveActiveTheme(snapshot.theme)))?.name ?? "Theme");
  const personalAppearance = $derived(appearanceForTheme(snapshot.theme));
  const lightOptions = $derived(filteredOptions.filter((option) => option.baseMode === "light"));
  const darkOptions = $derived(filteredOptions.filter((option) => option.baseMode === "dark"));

  const activeCustom = $derived.by(() => {
    // The editor targets whichever theme is currently rendered: manual mode pins
    // manualTheme, auto mode follows the current OS pref between the two slots.
    const effectiveRef =
      snapshot.theme.mode === "manual"
        ? snapshot.theme.manualTheme
        : getSystemPrefersDark()
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

<div class="themes-view" aria-label="Appearance">
  <header class="themes-view-header">
    <h2 class="themes-view-title">Appearance <span class="current-theme-name">{currentName}</span></h2>
    <nav class="appearance-nav" aria-label="Appearance sections">
      {#each ["palette", "typography", "layout", "effects", "preview"] as name}
        <button type="button" class:active={section === name} aria-pressed={section === name} onclick={() => section = name}>{name[0].toUpperCase() + name.slice(1)}</button>
      {/each}
    </nav>
    <div class="appearance-toolbar">
      <button type="button" class="settings-button" onclick={() => appState.applyFullThemeStyle()}>Apply full theme style</button>
      <button type="button" class="settings-button" onclick={() => appState.saveAppearanceAsTheme()}>Save as theme</button>
      {#if activeCustom}<button type="button" class="settings-button" onclick={() => appState.updateCustomThemeAppearance(activeCustom.id)}>Save changes to theme</button>{/if}
      <button type="button" class="settings-button" onclick={() => appState.resetAppearance()}>Reset personal style</button>
    </div>
  </header>

  <div class="themes-view-scroll">
    {#if section === "palette"}
    <section class="settings-section">
      <h3>Palette</h3>
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
      <pre
        class="plaintext-preview"
        class:decorated={snapshot.settings.decoratePlaintextSymbols}
        aria-label="Plain text preview"
      ><code>Notes<span>:</span> <span>[</span>draft<span>]</span>{"\n"}<span>-</span> Review <span>(</span>v2<span>)</span> <span>-&gt;</span> ready<span>!</span></code></pre>

      <div class="settings-subsection">
        <h4>File icons</h4>
        {#each [{ label: "Color", colored: true }, { label: "Monochrome", colored: false }] as option}
          <label class="settings-theme-row file-icon-choice">
            <input type="radio" name="file-icons"
              checked={(personalAppearance.icons === "color" && snapshot.settings.coloredProjectFileIcons) === option.colored}
              onchange={() => appState.setColoredProjectFileIcons(option.colored)} />
            <span>{option.label}</span>
            <span class="file-icon-samples" aria-hidden="true">
              {#each ["notes.md", "data.json", "main.ts", "App.svelte", "Player.cs", "cover.png"] as name}
                <ProjectFileIcon {name} colored={option.colored} />
              {/each}
            </span>
          </label>
        {/each}
      </div>

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

      {#snippet themeGrid(options: ThemeOption[], group: "manual" | "light" | "dark")}
        <div class="theme-grid" role="group" aria-label={group === "manual" ? "Theme" : `${group === "light" ? "Light" : "Dark"} theme`}>
          {#each options as option (option.ref.kind + ":" + option.ref.id)}
            <ThemeCard
              name={option.name}
              baseMode={option.baseMode}
              tokens={option.tokens}
              editable={option.editable}
              appearance={resolveAppearance(option.appearance, snapshot.theme.appearanceOverrides)}
              coloredIcons={snapshot.settings.coloredProjectFileIcons && resolveAppearance(option.appearance, snapshot.theme.appearanceOverrides).icons === "color"}
              group={`${group}-theme`}
              value={`${option.ref.kind}:${option.ref.id}`}
              selected={group === "manual" ? isManualActive(option) : group === "light" ? isLightActive(option) : isDarkActive(option)}
              onselect={() => {
                if (group === "manual") appState.setManualTheme(option.ref);
                else if (group === "light") appState.setLightTheme(option.ref);
                else appState.setDarkTheme(option.ref);
              }}
              onduplicate={() => appState.duplicateTheme(option.ref)}
            />
          {/each}
        </div>
      {/snippet}

      <div class="theme-filters">
        <label class="settings-field"><span>Search themes</span><input type="search" bind:value={search} placeholder="Theme name" /></label>
        <label class="settings-field"><span>Collection</span><select bind:value={category}>
          <option value="all">All themes</option><option value="classic">Classic</option><option value="retro">Retro</option><option value="creative">Creative</option><option value="accessible">High contrast</option><option value="custom">Custom</option>
        </select></label>
      </div>
      {#if filteredOptions.length === 0}<p class="settings-hint">No themes match your search.</p>{/if}
      {#if snapshot.theme.mode === "manual"}
        <div class="settings-subsection">
          <h4>Theme</h4>
          {@render themeGrid(filteredOptions, "manual")}
        </div>
      {:else}
        <div class="settings-subsection">
          <h4>Light theme</h4>
          {@render themeGrid(lightOptions, "light")}
        </div>
        <div class="settings-subsection">
          <h4>Dark theme</h4>
          {@render themeGrid(darkOptions, "dark")}
        </div>
      {/if}

      <button type="button" class="settings-button" onclick={() => appState.createCustomTheme()}>
        + New theme
      </button>
    </section>

    {/if}
    {#if section !== "palette"}<AppearanceControls {section} />{/if}

    {#if activeCustom && section === "palette"}
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

  .current-theme-name { font-size: 0.8125rem; font-weight: 400; color: var(--color-text-secondary); margin-left: var(--space-4); }
  .appearance-nav { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); }
  .appearance-nav button { border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--color-text-secondary); font: inherit; padding: var(--space-2) var(--space-4); cursor: pointer; }
  .appearance-nav button.active { color: var(--color-text-primary); background: var(--color-hover); border-color: var(--color-accent); }
  .appearance-nav button:focus-visible { outline: 2px solid var(--color-focus-ring); }
  .appearance-toolbar { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); }
  .theme-filters { display: flex; flex-wrap: wrap; gap: var(--space-6); }
  .theme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
    gap: 12px;
  }

  .plaintext-preview {
    align-self: flex-start;
    max-width: 100%;
    box-sizing: border-box;
    margin: 2px 0 6px;
    padding: 10px 12px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-bg-root);
    color: var(--color-text-primary);
    font: 0.8125rem/var(--line-height-code, 1.5) var(--font-family-mono, monospace);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .plaintext-preview code {
    font: inherit;
  }

  .plaintext-preview.decorated span {
    color: var(--syntax-plaintext-symbol);
    opacity: 0.85;
  }

  .file-icon-choice {
    flex-wrap: wrap;
  }

  .file-icon-samples {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

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
    align-self: flex-start;
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
