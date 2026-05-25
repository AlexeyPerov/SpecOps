<script lang="ts">
  import type { ChatMessage } from "../domain/contracts";
  import { chatMessages, chatStore } from "../state/chatStore";
  import { scheduleWorkspaceChatFilePersistence } from "../services/chatPersistence";

  let draft = $state("");
  let sending = $state(false);

  const messages = $derived($chatMessages);
  const isEmpty = $derived(messages.length === 0);
  const isSendDisabled = $derived(sending || draft.trim().length === 0);

  function messageRoleLabel(message: ChatMessage): string {
    if (message.role === "assistant") {
      return "Assistant";
    }
    if (message.role === "system") {
      return "System";
    }
    return "You";
  }

  function persistActiveThreadSnapshot(): void {
    const root = chatStore.getActiveWorkspaceRoot();
    const thread = chatStore.getActiveThreadSnapshot();
    if (!root) {
      return;
    }
    scheduleWorkspaceChatFilePersistence(root, {
      version: 1,
      thread,
    });
  }

  function createUserMessage(content: string): ChatMessage {
    return {
      id: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
  }

  async function submitMessage(): Promise<void> {
    const content = draft.trim();
    if (!content || sending) {
      return;
    }
    sending = true;
    const appended = chatStore.appendMessage(createUserMessage(content));
    if (appended) {
      draft = "";
      persistActiveThreadSnapshot();
    }
    sending = false;
  }

  function handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  }
</script>

<section class="chat-panel" aria-label="Workspace chat">
  {#if isEmpty}
    <div class="chat-empty-state">
      <p class="chat-title">Start chat</p>
      <p class="chat-hint">Ask about this workspace. Provider responses will be enabled in later milestones.</p>
    </div>
  {:else}
    <ol class="chat-message-list" aria-label="Conversation">
      {#each messages as message (message.id)}
        <li class={`chat-message chat-message-${message.role}`}>
          <p class="chat-message-role">{messageRoleLabel(message)}</p>
          <p class="chat-message-content">{message.content}</p>
        </li>
      {/each}
    </ol>
  {/if}

  <div class="chat-composer" role="group" aria-label="Chat composer">
    <textarea
      class="chat-input"
      rows="3"
      bind:value={draft}
      placeholder="Message workspace chat"
      aria-label="Chat message"
      onkeydown={handleComposerKeydown}
      disabled={sending}
    ></textarea>
    <div class="chat-composer-actions">
      <button
        type="button"
        class="chat-send-button"
        onclick={() => void submitMessage()}
        disabled={isSendDisabled}
      >
        Send
      </button>
      <span class="chat-assistant-status">Assistant responses unavailable in this milestone.</span>
    </div>
  </div>
</section>

<style>
  .chat-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    height: 100%;
    min-height: 0;
    padding: var(--space-8);
    color: var(--color-text-primary);
  }

  .chat-empty-state {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    color: var(--color-text-secondary);
  }

  .chat-message-list {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .chat-message {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    padding: var(--space-6);
    background: var(--color-surface-1);
  }

  .chat-message-user {
    border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface-1));
  }

  .chat-message-assistant {
    border-color: var(--color-border-subtle);
    background: var(--color-surface-1);
  }

  .chat-message-system {
    border-style: dashed;
    border-color: color-mix(in srgb, var(--color-text-secondary) 45%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-text-secondary) 8%, var(--color-surface-1));
  }

  .chat-message-role {
    margin: 0 0 var(--space-2) 0;
    font-size: 11px;
    line-height: 1.4;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .chat-message-content {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .chat-composer {
    border-top: 1px solid var(--color-border-subtle);
    padding-top: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .chat-input {
    width: 100%;
    resize: vertical;
    min-height: 68px;
    max-height: 200px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: var(--space-6);
    font: inherit;
    font-size: 12px;
    line-height: 1.4;
  }

  .chat-input:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .chat-composer-actions {
    display: flex;
    align-items: center;
    gap: var(--space-8);
  }

  .chat-send-button {
    min-height: 26px;
    padding: 0 var(--space-8);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-accent) 18%, var(--color-surface-1));
    color: var(--color-text-primary);
    font-size: 12px;
    line-height: 1;
  }

  .chat-send-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-accent) 26%, var(--color-surface-1));
    cursor: pointer;
  }

  .chat-send-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chat-assistant-status {
    font-size: 11px;
    line-height: 1.4;
    color: var(--color-text-secondary);
  }

  .chat-title {
    margin: 0;
    color: var(--color-text-primary);
    font-size: 12px;
    line-height: 1.4;
    font-weight: 600;
  }

  .chat-hint {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
  }
</style>
