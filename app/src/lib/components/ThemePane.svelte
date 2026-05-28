<script lang="ts">
  import { appState } from "../state/appState";
  import type { CustomThemeRecord } from "../services/themeStore";
  import {
    BUILTIN_THEME_IDS,
    getBuiltinAccentHex,
    getBuiltinThemeLabel,
    THEME_TOKEN_GROUPS,
    THEME_TOKEN_LABELS,
    type ThemeTokenKey,
  } from "../styles/themeTokens";

  let { open = false }: { open?: boolean } = $props();

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

  function pickerValueForToken(value: string): string {
    return cssColorToHex(value) ?? "#000000";
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

<aside class="theme-pane" data-open={open} aria-label="Theme and decoration" aria-hidden={!open}>
  <header class="theme-pane-header">
    <h2 class="theme-pane-title">Theme</h2>
  </header>

  <div class="theme-pane-scroll">
    <section class="settings-section">
      <h3>Appearance</h3>
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
            {#each group.keys as key (key)}
              {@const tokenValue = activeCustom.tokens[key]}
              <div class="theme-token-row">
                <span class="theme-token-label">{THEME_TOKEN_LABELS[key]}</span>
                <div class="theme-token-controls">
                  <input
                    type="color"
                    value={pickerValueForToken(tokenValue)}
                    aria-label="{THEME_TOKEN_LABELS[key]} color picker"
                    oninput={(event) =>
                      updateToken(
                        activeCustom.id,
                        key,
                        (event.currentTarget as HTMLInputElement).value,
                      )}
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
                      )}
                  />
                </div>
              </div>
            {/each}
          </div>
        {/each}
      </section>
    {/if}

    <section class="settings-section">
      <h3>Decoration</h3>
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
      <label class="settings-toggle">
        <input
          type="checkbox"
          checked={snapshot.settings.hideActivityRailWhenNotepadOnly}
          onchange={(event) =>
            appState.setHideActivityRailWhenNotepadOnly(
              (event.currentTarget as HTMLInputElement).checked,
            )}
        />
        Hide activity rail when Notepad only
      </label>
    </section>
  </div>
</aside>

<style>
  @import "../styles/settingsForm.css";
  @import "../styles/themePaneForm.css";

  .theme-pane {
    position: absolute;
    top: var(--space-8);
    right: var(--space-8);
    width: var(--settings-pane-width);
    max-width: calc(100% - var(--space-8) * 2);
    height: calc(100% - var(--space-8) * 2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    display: flex;
    flex-direction: column;
    min-height: 0;
    transform: translateX(110%);
    opacity: 0;
    pointer-events: none;
    transition:
      transform var(--motion-medium) var(--easing-emphasized),
      opacity var(--motion-medium) var(--easing-standard);
  }

  .theme-pane[data-open="true"] {
    transform: translateX(0);
    opacity: 1;
    pointer-events: auto;
  }

  .theme-pane-header {
    flex-shrink: 0;
    padding: var(--space-12) var(--space-12) var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .theme-pane-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .theme-pane-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-8) var(--space-12) var(--space-12);
  }
</style>
