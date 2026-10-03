<script lang="ts">
  import { THEME_TOKEN_KEYS, GRADIENT_CAPABLE_KEYS, extractSolidColor, resolveBuiltinTokens, type ThemeTokens } from "../styles/themeTokens";
  import { appearanceVariables, resolveAppearance, type ThemeAppearance } from "../styles/themeAppearance";
  import ProjectFileIcon from "./icons/ProjectFileIcon.svelte";
  let { appearance, tokens, baseMode, coloredIcons = true }: { appearance?: ThemeAppearance; tokens: Partial<ThemeTokens>; baseMode: "dark" | "light"; coloredIcons?: boolean } = $props();
  // Scope derived colors as well as literal colors to this miniature.
  const style = $derived(resolveAppearance(appearance));
  const styleVariables = $derived(Object.entries(appearanceVariables(style)).map(([k, v]) => `${k}:${v}`).join(";"));
  const paletteStyle = $derived.by(() => {
    const defaults = resolveBuiltinTokens(baseMode === "dark" ? "dark-amber" : "light-blue");
    return THEME_TOKEN_KEYS.map((key) => {
      const value = tokens[key] || defaults[key];
      const scoped = value.replace(/var\(--([a-z-]+)\)/g, (original, reference: string) => {
        const token = reference as keyof ThemeTokens;
        if (!THEME_TOKEN_KEYS.includes(token)) return original;
        return `var(--preview-${reference}${GRADIENT_CAPABLE_KEYS.has(token) ? "-solid" : ""})`;
      });
      const solid = GRADIENT_CAPABLE_KEYS.has(key) ? `--preview-${key}-solid: ${extractSolidColor(scoped)};` : "";
      return `--preview-${key}: ${scoped};${solid}`;
    }).join("");
  });
</script>

<div class="theme-preview" data-mode={baseMode} style={`${paletteStyle}${styleVariables};${style.accent ? `--preview-accent-color:${style.accent};--preview-color-accent:${style.accent};` : ""}`} aria-hidden="true">
  <div class="preview-effects"></div>
  <div class="document">
    <div class="tab">overview.md</div>
    <div class="sample">
      <div class="heading"># Project notes</div>
      <div>Build something useful.</div>
      <div><span class="symbol">•</span> Review the <span class="link">next steps</span></div>
      <div class="code">
        <div class="comment">// Ready to start</div>
        <div><span class="keyword">const</span> title <span class="punctuation">=</span> <span class="string">"SpecOps"</span></div>
        <div><span class="type">Task</span><span class="punctuation">(</span><span class="number">3</span><span class="punctuation">)</span></div>
      </div>
    </div>
  </div>
  <div class="project">
    <div class="project-title">PROJECT</div>
    <div class="tree-row folder">⌄ workspace</div>
    <div class="tree-row selected"><ProjectFileIcon name="overview.md" size={11} colored={coloredIcons && style.icons === "color"} /><span>overview.md</span></div>
    <div class="tree-row"><ProjectFileIcon name="tasks.ts" size={11} colored={coloredIcons && style.icons === "color"} /><span>tasks.ts</span></div>
    <div class="tree-row"><ProjectFileIcon name="config.json" size={11} colored={coloredIcons && style.icons === "color"} /><span>config.json</span></div>
    <div class="tree-row hidden"><ProjectFileIcon name=".gitignore" size={11} colored={false} /><span>.gitignore</span></div>
  </div>
  <div class="status"><span>Markdown</span><span>Ln 3, Col 1</span></div>
</div>

<style>
  .theme-preview {
    position: relative;
    text-shadow: none;
    font-size-adjust: var(--font-size-adjust-chat);
    letter-spacing: var(--text-letter-spacing);
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(0, 3fr);
    grid-template-rows: minmax(0, 1fr) 17px;
    height: 150px;
    overflow: hidden;
    background: var(--preview-color-bg-root);
    color: var(--preview-color-text-primary);
    font: 10px/var(--line-height-chat) var(--font-family-chat);
    --color-text-primary: var(--preview-color-text-primary);
    text-align: left;
    --color-text-secondary: var(--preview-color-text-secondary);
  }
  .theme-preview[data-mode="dark"] {
    --project-file-icon-blue: #61aed5;
    --project-file-icon-yellow: #c6cf49;
    --project-file-icon-orange: #dd9469;
    --project-file-icon-purple: #b693dd;
    --project-file-icon-green: #82b591;
    --project-file-icon-red: #df8390;
  }
  .theme-preview[data-mode="light"] {
    --project-file-icon-blue: #247bb0;
    --project-file-icon-yellow: #93800a;
    --project-file-icon-orange: #be6537;
    --project-file-icon-purple: #8257b3;
    --project-file-icon-green: #438459;
    --project-file-icon-red: #bf4d59;
  }
  .preview-effects { position: absolute; inset: 0; pointer-events: none; z-index: 2;
    background: repeating-linear-gradient(to bottom, transparent 0 2px, rgb(0 0 0 / var(--appearance-scanlines)) 2px 3px), radial-gradient(ellipse, transparent 50%, rgb(0 0 0 / var(--appearance-vignette)) 100%), repeating-linear-gradient(18deg, rgb(90 65 30 / var(--appearance-texture)) 0 1px, transparent 1px 4px); }
  .sample { text-shadow: 0 0 var(--appearance-glow) currentColor; }
  .document, .project {
    min-width: 0;
    overflow: hidden;
  }
  .tab {
    padding: 2px 10px;
    background: var(--preview-color-surface-1);
    color: var(--preview-color-text-secondary);
    border-bottom: 1px solid var(--preview-color-border-subtle);
  }
  .sample {
    padding: calc(var(--space-4) * 0.875) 10px;
    white-space: nowrap;
  }
  .heading {
    color: var(--preview-syntax-heading);
    font-weight: 700;
  }
  .symbol {
    color: var(--preview-syntax-plaintext-symbol);
  }
  .link {
    color: var(--preview-syntax-link);
    text-decoration: underline;
  }
  .code {
    margin-top: 4px;
    font-family: var(--font-family-mono);
    font-variant-ligatures: var(--code-ligatures);
  }
  .comment {
    color: var(--preview-syntax-comment);
  }
  .keyword {
    color: var(--preview-syntax-keyword);
  }
  .string {
    color: var(--preview-syntax-string);
  }
  .type {
    color: var(--preview-syntax-type);
  }
  .number {
    color: var(--preview-syntax-number);
  }
  .punctuation {
    color: var(--preview-syntax-punctuation);
  }
  .project {
    background: var(--preview-color-surface-1);
    border-left: 1px solid var(--preview-color-border-subtle);
    color: var(--preview-project-pane-color-text);
  }
  .project-title {
    padding: 4px 6px;
    font: 600 8px/18px var(--font-family-ui);
    color: var(--preview-color-text-secondary);
  }
  .tree-row {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: calc(var(--space-2) * 0.5) 4px calc(var(--space-2) * 0.5) 9px;
    min-height: calc(var(--project-tree-row-height) * 0.65);
    font-size: 8px;
    white-space: nowrap;
  }
  .tree-row span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .folder {
    padding-left: 4px;
  }
  .selected {
    background: var(--preview-color-hover);
  }
  .hidden {
    color: var(--preview-project-pane-color-hidden);
  }
  .status {
    grid-column: 1 / -1;
    display: flex;
    justify-content: space-between;
    padding: 0 8px;
    background: var(--preview-color-statusbar-bg);
    color: var(--preview-color-text-secondary);
    font-size: 8px;
  }
</style>
