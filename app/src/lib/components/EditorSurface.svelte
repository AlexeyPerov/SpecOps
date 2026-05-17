<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { markdown } from "@codemirror/lang-markdown";
  import { EditorView, keymap, lineNumbers } from "@codemirror/view";

  let hostEl: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  export let initialContent = "";

  onMount(() => {
    if (!hostEl) {
      return;
    }

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        EditorView.theme({
          "&": {
            height: "100%",
            fontFamily: "var(--font-family-ui)",
            fontSize: "13px",
            color: "var(--color-text-primary)",
            backgroundColor: "var(--color-surface-1)",
          },
          ".cm-content, .cm-gutter": {
            minHeight: "100%",
          },
          ".cm-gutters": {
            backgroundColor: "var(--color-surface-1)",
            color: "var(--color-text-secondary)",
            borderRight: "1px solid var(--color-border-subtle)",
          },
          "&.cm-focused": {
            outline: "2px solid var(--color-focus-ring)",
            outlineOffset: "-2px",
          },
          ".cm-activeLine, .cm-activeLineGutter": {
            backgroundColor: "var(--color-hover)",
          },
        }),
      ],
    });

    view = new EditorView({
      state,
      parent: hostEl,
    });
  });

  onDestroy(() => {
    view?.destroy();
  });
</script>

<div bind:this={hostEl} class="editor-host"></div>

<style>
  .editor-host {
    height: 100%;
    border-radius: var(--radius-md);
    overflow: hidden;
    border: 1px solid var(--color-border-subtle);
  }
</style>
