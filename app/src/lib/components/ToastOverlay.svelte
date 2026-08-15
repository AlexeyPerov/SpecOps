<script lang="ts">
  import { dismissToast, toasts } from "../services/toastBus";

  /**
   * Transient message stack for outcomes a user must not miss (e.g. a dropped
   * file that failed to open). Purely presentational; the bus lives in
   * `toastBus.ts`. Stacks bottom-right, above every other surface, and never
   * intercepts pointer events outside the messages themselves.
   */
</script>

{#if $toasts.length > 0}
  <div class="toast-stack" role="status" aria-live="polite">
    {#each $toasts as toast (toast.id)}
      <div class={`toast toast-${toast.kind}`}>
        <span class="toast-message">{toast.message}</span>
        <button
          type="button"
          class="toast-dismiss"
          aria-label="Dismiss notification"
          onclick={() => dismissToast(toast.id)}
        >
          ×
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-stack {
    position: fixed;
    right: var(--space-6);
    bottom: var(--space-6);
    z-index: 1340;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: min(420px, calc(100vw - 2 * var(--space-6)));
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    font-size: var(--font-size-ui);
    color: var(--color-text-primary);
  }

  .toast-error {
    border-color: var(--color-danger);
  }

  .toast-message {
    overflow-wrap: anywhere;
  }

  .toast-dismiss {
    flex: none;
    margin-left: auto;
    border: none;
    background: none;
    padding: 0 var(--space-1);
    color: var(--color-text-secondary);
    font-size: var(--font-size-md);
    line-height: 1.2;
    cursor: pointer;
  }

  .toast-dismiss:hover {
    color: var(--color-text-primary);
  }
</style>
