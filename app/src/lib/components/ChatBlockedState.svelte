<script lang="ts">
  import type { ChatProviderId } from "../domain/contracts";
  import { openSettingsDialog } from "../services/settingsDialogUi";

  interface BlockedCopy {
    title: string;
    message: string;
    recoveryHint?: string;
  }

  interface Props {
    isAccessBlocked?: boolean;
    isChatHttpFeatureBlocked?: boolean;
    isHttpBlocked?: boolean;
    isDebugBlocked?: boolean;
    isModelBlocked?: boolean;
    activeProvider?: ChatProviderId;
    accessBlockedCopy?: BlockedCopy;
    httpBlockedCopy?: BlockedCopy;
    debugBlockedCopy?: BlockedCopy;
    modelBlockedCopy?: BlockedCopy;
  }

  let {
    isAccessBlocked = false,
    isChatHttpFeatureBlocked = false,
    isHttpBlocked = false,
    isDebugBlocked = false,
    isModelBlocked = false,
    activeProvider = "debug-chat",
    accessBlockedCopy,
    httpBlockedCopy,
    debugBlockedCopy,
    modelBlockedCopy,
  }: Props = $props();

  const debugSettingsTab = $derived(
    activeProvider === "debug-workspace" ? "debugAgent" : "debugAi",
  );
  const debugSettingsLabel = $derived("Debug Provider");
</script>

{#if isChatHttpFeatureBlocked}
  <div class="chat-blocked-state" role="status" aria-live="polite">
    <p class="chat-blocked-title">Chat (beta) is off</p>
    <p class="chat-blocked-message">
      The HTTP chat context is an experimental beta feature and is disabled by default.
    </p>
    <p class="chat-blocked-hint">
      Enable Chat (beta) in Settings → Dev, then configure HTTP providers or Debug Provider under Chats.
    </p>
    <button type="button" class="btn btn-primary chat-setup-button" onclick={() => openSettingsDialog("dev")}>
      Open Settings → Dev
    </button>
  </div>
{:else if isAccessBlocked && accessBlockedCopy}
  <div class="chat-blocked-state" role="status" aria-live="polite">
    <p class="chat-blocked-title">{accessBlockedCopy.title}</p>
    <p class="chat-blocked-message">{accessBlockedCopy.message}</p>
    {#if accessBlockedCopy.recoveryHint}
      <p class="chat-blocked-hint">{accessBlockedCopy.recoveryHint}</p>
    {/if}
  </div>
{:else if isHttpBlocked && httpBlockedCopy}
  <div class="chat-blocked-state" role="status" aria-live="polite">
    <p class="chat-blocked-title">{httpBlockedCopy.title}</p>
    <p class="chat-blocked-message">{httpBlockedCopy.message}</p>
    <p class="chat-blocked-hint">{httpBlockedCopy.recoveryHint}</p>
    <button type="button" class="btn btn-primary chat-setup-button" onclick={() => openSettingsDialog("connections")}>
      Open Providers settings
    </button>
  </div>
{:else if isDebugBlocked && debugBlockedCopy}
  <div class="chat-blocked-state" role="status" aria-live="polite">
    <p class="chat-blocked-title">{debugBlockedCopy.title}</p>
    <p class="chat-blocked-message">{debugBlockedCopy.message}</p>
    <p class="chat-blocked-hint">{debugBlockedCopy.recoveryHint}</p>
    <button
      type="button"
      class="btn btn-primary chat-setup-button"
      onclick={() => openSettingsDialog(debugSettingsTab)}
    >
      Open {debugSettingsLabel} settings
    </button>
  </div>
{:else if isModelBlocked && modelBlockedCopy}
  <div class="chat-blocked-state" role="status" aria-live="polite">
    <p class="chat-blocked-title">{modelBlockedCopy.title}</p>
    <p class="chat-blocked-message">{modelBlockedCopy.message}</p>
    <p class="chat-blocked-hint">{modelBlockedCopy.recoveryHint}</p>
    <button type="button" class="btn btn-primary chat-setup-button" onclick={() => openSettingsDialog("connections")}>
      Open Providers settings
    </button>
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

  .chat-setup-button {
    align-self: flex-start;
    min-height: 26px;
    margin-top: var(--space-2);
    padding: 0 var(--space-8);
    font-size: 12px;
  }
</style>
