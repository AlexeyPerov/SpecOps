<script lang="ts">
  import type { ThemeTokens } from "../styles/themeTokens";
  import type { ThemeAppearance } from "../styles/themeAppearance";
  import ThemePreview from "./ThemePreview.svelte";
  let { appearance, name, baseMode, tokens, editable, coloredIcons, group, value, selected, onselect, onduplicate }: {
    appearance?: ThemeAppearance; name: string; baseMode: "dark" | "light"; tokens: Partial<ThemeTokens>; editable: boolean; coloredIcons: boolean;
    group: string; value: string; selected: boolean; onselect: () => void; onduplicate: () => void;
  } = $props();
</script>

<div class="theme-card" class:selected data-theme-ref={value}>
  <label class="theme-choice">
    <input type="radio" name={group} {value} checked={selected} onchange={onselect} aria-label="{name} {baseMode}" />
    <ThemePreview {tokens} {baseMode} {coloredIcons} {appearance} />
    <span class="caption"><span class="name" title={name}>{name}</span><span class="check" aria-hidden="true">{selected ? "✓" : ""}</span></span>
  </label>
  <div class="footer">
    <span class="tags">{baseMode}{editable ? " · custom" : ""}</span>
    <button type="button" aria-label="Duplicate {name}" onclick={onduplicate}>Duplicate</button>
  </div>
</div>

<style>
  .theme-card {
    min-width: 0;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    overflow: hidden;
  }
  .theme-card.selected {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-accent);
  }
  .theme-card:has(input:focus-visible) {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 3px;
  }
  .theme-choice {
    display: block;
    position: relative;
    cursor: pointer;
  }
  input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .caption {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 2px;
    color: var(--color-text-primary);
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .check {
    width: 16px;
    color: var(--color-accent);
    text-align: center;
  }
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 2px 10px 8px;
  }
  .tags {
    font-size: 0.6875rem;
    color: var(--color-text-secondary);
  }
  button {
    border: 0;
    border-radius: var(--radius-sm);
    padding: 3px 5px;
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: 0.6875rem;
    cursor: pointer;
  }
  .theme-choice:hover .caption, button:hover {
    background: var(--color-hover);
  }
  button:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }
</style>
