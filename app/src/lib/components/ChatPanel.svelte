<section class="chat-panel" aria-label="Workspace chat placeholder">
  <p class="chat-title">Start chat</p>
  <p class="chat-hint">Ask about the active workspace once provider setup is enabled.</p>
</section>

<style>
  .chat-panel {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    height: 100%;
    padding: var(--space-4) var(--space-8);
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
