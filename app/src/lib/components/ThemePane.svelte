<script lang="ts">
  import { appState } from "../state/appState";
  import { BUILTIN_THEME_IDS, getBuiltinAccentHex, getBuiltinThemeLabel } from "../styles/themeTokens";

  let { open = false }: { open?: boolean } = $props();

  const snapshot = $derived($appState);

  function isBuiltinActive(id: string): boolean {
    return snapshot.theme.activeTheme.kind === "builtin" && snapshot.theme.activeTheme.id === id;
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
    </section>

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
