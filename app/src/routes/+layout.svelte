<script lang="ts">
  import "../lib/styles/tokens.css";
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
  import "../lib/styles/settingsFormMultiline.css";
  import "../lib/styles/settingsDialogForm.css";
  import "../lib/styles/settingsPanelLists.css";
  import "../lib/styles/settingsFoldout.css";
</script>

<slot />
