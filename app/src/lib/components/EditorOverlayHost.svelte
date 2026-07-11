<script lang="ts">
  /**
   * Focus-restoring overlay host for editor chrome tools (find, go-to) and
   * future quick-open / palette shells. Enforces Escape → close and restores
   * focus to the previously focused element unless the caller already moved it.
   */
  import { tick } from "svelte";

  let {
    open = false,
    label,
    role = "dialog",
    onClose,
    /** When true, restore focus on close (default). Set false when a controller restores editor focus. */
    restoreFocus = true,
    class: className = "",
    children,
  }: {
    open?: boolean;
    label: string;
    role?: "dialog" | "listbox" | "region";
    onClose: () => void;
    restoreFocus?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
  } = $props();

  let hostEl = $state<HTMLDivElement | null>(null);
  let previouslyFocused: HTMLElement | null = null;
  let wasOpen = false;

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  $effect(() => {
    if (open) {
      if (!wasOpen) {
        previouslyFocused = (document.activeElement as HTMLElement) ?? null;
        wasOpen = true;
        void tick().then(() => {
          if (!hostEl) {
            return;
          }
          const alreadyInside = hostEl.contains(document.activeElement);
          if (!alreadyInside) {
            const focusable = hostEl.querySelector<HTMLElement>(
              "input, textarea, button, [tabindex]:not([tabindex='-1'])",
            );
            focusable?.focus();
          }
        });
      }
      return;
    }

    if (wasOpen) {
      wasOpen = false;
      if (restoreFocus && previouslyFocused) {
        previouslyFocused.focus?.();
      }
      previouslyFocused = null;
    }
  });
</script>

{#if open}
  <div
    bind:this={hostEl}
    class={`editor-overlay-host ${className}`.trim()}
    {role}
    aria-label={label}
    aria-modal={role === "dialog" ? "true" : undefined}
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    {@render children?.()}
  </div>
{/if}

<style>
  .editor-overlay-host {
    outline: none;
  }
</style>
