<script lang="ts">
  import "@fontsource/inter/400.css";
  import "@fontsource/inter/600.css";
  import "@fontsource/jetbrains-mono/400.css";
  import "@fontsource/jetbrains-mono/600.css";
  import "@fontsource/ibm-plex-mono/400.css";
  import "@fontsource/ibm-plex-mono/600.css";
  import "@fontsource/ibm-plex-serif/400.css";
  import "@fontsource/ibm-plex-serif/600.css";
  import "@fontsource/vt323/400.css";
  import "../lib/styles/tokens.css";
  import "../lib/styles/appearance.css";
  import "../lib/styles/buttons.css";
  import "../lib/styles/chatProse.css";
  // Shared settings stylesheets are imported once globally. They use flat
  // global classes (`.settings-*` / `.connection-row-*` / `.required-section-*`
  // / `.settings-foldout-*`) applied directly in component markup, so per-
  // component `@import` only re-emitted the same CSS into 15 bundles and
  // tripped svelte-check's "unused CSS selector" false positives (the CSS
  // analyzer can't trace selectors across an `@import` boundary). See
  // `execution-plan-m12.md` M12-T3b.
  import "../lib/styles/settingsForm.css";
  import "../lib/styles/themePaneForm.css";
  import "../lib/styles/settingsFormMultiline.css";
  import "../lib/styles/settingsDialogForm.css";
  import "../lib/styles/settingsPanelLists.css";
  import "../lib/styles/settingsFoldout.css";
</script>

<slot />
