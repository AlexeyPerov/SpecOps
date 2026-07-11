<script lang="ts">
  import EditorOverlayHost from "./EditorOverlayHost.svelte";

  let {
    lineValue = $bindable(""),
    onGo,
    onClose,
  }: {
    lineValue?: string;
    onGo: () => void;
    onClose: () => void;
  } = $props();

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      onGo();
    }
  }
</script>

<EditorOverlayHost
  open={true}
  label="Go to line"
  role="dialog"
  onClose={onClose}
  restoreFocus={false}
  class="floating-tool goto-tool"
>
  <h3>Go To Line</h3>
  <input
    placeholder="Line number..."
    bind:value={lineValue}
    onkeydown={handleKeydown}
  />
  <div class="tool-actions">
    <button type="button" class="toolbar-button" onclick={onGo}>Go</button>
    <button type="button" class="toolbar-button" onclick={onClose}>Close</button>
  </div>
</EditorOverlayHost>
