<script lang="ts">
  interface BlockedCopy {
    title: string;
    message: string;
    recoveryHint?: string;
  }

  interface Props {
    isAccessBlocked?: boolean;
    accessBlockedCopy?: BlockedCopy;
  }

  let {
    isAccessBlocked = false,
    accessBlockedCopy,
  }: Props = $props();
</script>

{#if isAccessBlocked && accessBlockedCopy}
  <div class="chat-blocked-state" role="status" aria-live="polite">
    <p class="chat-blocked-title">{accessBlockedCopy.title}</p>
    <p class="chat-blocked-message">{accessBlockedCopy.message}</p>
    {#if accessBlockedCopy.recoveryHint}
      <p class="chat-blocked-hint">{accessBlockedCopy.recoveryHint}</p>
    {/if}
  </div>
{/if}

<style>
  .chat-blocked-state {
    border: 1px solid color-mix(in srgb, var(--color-danger) 48%, var(--color-border-subtle));
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-danger) 9%, var(--color-surface-1));
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .chat-blocked-title {
    margin: 0;
    font-size: 12px;
    line-height: 1.4;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .chat-blocked-message,
  .chat-blocked-hint {
    margin: 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--color-text-secondary);
  }
</style>
