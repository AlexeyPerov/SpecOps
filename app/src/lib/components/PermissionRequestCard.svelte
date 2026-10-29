<script lang="ts">
  import {
    answerPermissionPrompt,
    type PendingPermissionPrompt,
    type PermissionPromptResult,
  } from "../services/permissionPrompt";

  interface Props {
    entry: PendingPermissionPrompt;
  }

  let { entry }: Props = $props();

  let submitting = $state(false);

  const payload = $derived(entry.request.payload as { allowAlways?: boolean } | undefined);
  const allowAlways = $derived(payload?.allowAlways !== false);
  const details = $derived(payload ? JSON.stringify(payload, null, 2) : "");
  const titleId = $derived(`permission-request-title-${entry.seq}`);

  function submitReply(reply: PermissionPromptResult["reply"]): void {
    if (submitting) return;
    submitting = true;
    answerPermissionPrompt(entry, { reply });
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      submitReply("reject");
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="session-request-card permission-request-card"
  role="group"
  aria-labelledby={titleId}
  data-session-id={entry.sessionId}
  onkeydown={handleKeydown}
>
  <p id={titleId} class="session-request-card-title">Permission request</p>
  <p class="session-request-card-label">{entry.request.label}</p>
  {#if details}<pre class="session-request-card-details">{details}</pre>{/if}
  <div class="session-request-card-actions">
    <button
      type="button"
      class="btn btn-danger permission-deny"
      disabled={submitting}
      onclick={() => submitReply("reject")}
    >
      Deny
    </button>
    {#if allowAlways}
      <button
        type="button"
        class="btn btn-secondary permission-always"
        disabled={submitting}
        onclick={() => submitReply("always")}
      >
        Allow for session
      </button>
    {/if}
    <button
      type="button"
      class="btn btn-primary permission-once"
      disabled={submitting}
      onclick={() => submitReply("once")}
    >
      Allow once
    </button>
  </div>
</section>

<style>
  .session-request-card {
    display: grid;
    gap: var(--space-6);
    padding: var(--space-6);
    border: 1px solid color-mix(in srgb, var(--color-accent) 35%, var(--color-border-subtle));
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    min-width: 0;
  }

  .session-request-card-title {
    margin: 0;
    font-size: var(--font-size-sm);
    line-height: 1.4;
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .session-request-card-label {
    margin: 0;
    font-size: var(--font-size-md);
    line-height: 1.5;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }

  .session-request-card-details {
    margin: 0;
    max-height: 200px;
    overflow: auto;
    padding: var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: var(--font-size-sm);
  }

  .session-request-card-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .permission-deny {
    margin-right: auto;
  }
</style>
