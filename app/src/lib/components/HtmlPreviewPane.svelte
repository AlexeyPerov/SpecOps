<script lang="ts">
  import { onDestroy } from "svelte";
  import { attachHtmlPreviewLinks, buildHtmlPreview } from "../services/htmlPreview";

  let { content, filePath, windowId, notify }: {
    content: string;
    filePath: string | null;
    windowId: string;
    notify: (message: string) => void;
  } = $props();

  let srcdoc = $state("");
  let disposeLinks: (() => void) | undefined;
  $effect(() => {
    const source = content;
    const path = filePath;
    const timer = setTimeout(() => { srcdoc = buildHtmlPreview(source, path); }, 120);
    return () => clearTimeout(timer);
  });
  onDestroy(() => disposeLinks?.());

  function handleLoad(event: Event): void {
    disposeLinks?.();
    const doc = (event.currentTarget as HTMLIFrameElement).contentDocument;
    if (doc) disposeLinks = attachHtmlPreviewLinks(doc, { filePath, windowId, notify });
  }
</script>

<iframe title="HTML preview" sandbox="allow-same-origin" {srcdoc} onload={handleLoad}></iframe>

<style>
  iframe {
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    min-height: 0;
    border: 0;
    background: white;
    color-scheme: normal;
  }
</style>
