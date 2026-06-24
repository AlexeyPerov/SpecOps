<script lang="ts">
  import {
    FONT_SCALE_MAX,
    FONT_SCALE_MIN,
    defaultFontSettings,
  } from "../../services/fontSettings";
  import type {
    NotificationEventId,
  } from "../../domain/contracts";
  import { NOTIFICATION_EVENT_IDS } from "../../domain/contracts";
  import { playSound } from "../../services/soundNotifications";
  import { appState } from "../../state/appState";

  const snapshot = $derived($appState);
  const font = $derived(snapshot.settings.fontSettings);
  const sound = $derived(snapshot.settings.soundSettings);
  const os = $derived(snapshot.settings.osNotificationSettings);

  const EVENT_LABELS: Record<NotificationEventId, string> = {
    sessionDone: "Session finished",
    permission: "Permission requested",
    question: "Question asked",
    error: "Error",
  };

  function fontLabel(scale: number): string {
    return `${scale}%`;
  }

  function resetFonts(): void {
    appState.setFontSettings({ ...defaultFontSettings });
  }
</script>

<section class="settings-section">
  <h3>Font size</h3>
  <p class="settings-section-note">
    Scale the three rendered surfaces independently. Font families stay fixed; only the size changes.
  </p>

  <label class="settings-field appearance-slider">
    <span class="appearance-slider-label">UI</span>
    <input
      type="range"
      min={FONT_SCALE_MIN}
      max={FONT_SCALE_MAX}
      step="5"
      value={font.uiScale}
      oninput={(event) =>
        appState.setFontSettings({
          uiScale: Number((event.currentTarget as HTMLInputElement).value),
        })}
    />
    <span class="appearance-slider-value">{fontLabel(font.uiScale)}</span>
  </label>

  <label class="settings-field appearance-slider">
    <span class="appearance-slider-label">Editor</span>
    <input
      type="range"
      min={FONT_SCALE_MIN}
      max={FONT_SCALE_MAX}
      step="5"
      value={font.editorScale}
      oninput={(event) =>
        appState.setFontSettings({
          editorScale: Number((event.currentTarget as HTMLInputElement).value),
        })}
    />
    <span class="appearance-slider-value">{fontLabel(font.editorScale)}</span>
  </label>

  <label class="settings-field appearance-slider">
    <span class="appearance-slider-label">Chat</span>
    <input
      type="range"
      min={FONT_SCALE_MIN}
      max={FONT_SCALE_MAX}
      step="5"
      value={font.chatScale}
      oninput={(event) =>
        appState.setFontSettings({
          chatScale: Number((event.currentTarget as HTMLInputElement).value),
        })}
    />
    <span class="appearance-slider-value">{fontLabel(font.chatScale)}</span>
  </label>

  <button type="button" class="appearance-reset" onclick={resetFonts}>
    Reset font sizes
  </button>
</section>

<section class="settings-section">
  <h3>Sound notifications</h3>
  <p class="settings-section-note">
    Play a tone when an agent event occurs. Uncheck an event to silence it.
  </p>
  <label class="settings-toggle">
    <input
      type="checkbox"
      checked={sound.enabled}
      onchange={(event) =>
        appState.setSoundEnabled((event.currentTarget as HTMLInputElement).checked)}
    />
    Enable sound
  </label>

  <label class="settings-field appearance-slider">
    <span class="appearance-slider-label">Volume</span>
    <input
      type="range"
      min="0"
      max="100"
      step="5"
      value={sound.volume}
      disabled={!sound.enabled}
      oninput={(event) =>
        appState.setSoundVolume(Number((event.currentTarget as HTMLInputElement).value))}
    />
    <span class="appearance-slider-value">{sound.volume}%</span>
  </label>

  {#each NOTIFICATION_EVENT_IDS as eventId (eventId)}
    <label class="settings-toggle appearance-event-toggle">
      <input
        type="checkbox"
        checked={sound.events[eventId]}
        disabled={!sound.enabled}
        onchange={(event) =>
          appState.toggleSoundEvent(
            eventId,
            (event.currentTarget as HTMLInputElement).checked,
          )}
      />
      {EVENT_LABELS[eventId]}
      <button
        type="button"
        class="appearance-preview"
        disabled={!sound.enabled || !sound.events[eventId]}
        aria-label={`Preview sound for ${EVENT_LABELS[eventId]}`}
        onclick={() => playSound(eventId, sound)}
      >
        Preview
      </button>
    </label>
  {/each}
</section>

<section class="settings-section">
  <h3>OS notifications</h3>
  <p class="settings-section-note">
    Show a system notification when the SpecOps window is not focused. Permission is requested on first use.
  </p>
  <label class="settings-toggle">
    <input
      type="checkbox"
      checked={os.enabled}
      onchange={(event) =>
        appState.setOsNotificationsEnabled(
          (event.currentTarget as HTMLInputElement).checked,
        )}
    />
    Enable OS notifications
  </label>

  {#each NOTIFICATION_EVENT_IDS as eventId (eventId)}
    <label class="settings-toggle appearance-event-toggle">
      <input
        type="checkbox"
        checked={os.events[eventId]}
        disabled={!os.enabled}
        onchange={(event) =>
          appState.toggleOsNotificationEvent(
            eventId,
            (event.currentTarget as HTMLInputElement).checked,
          )}
      />
      {EVENT_LABELS[eventId]}
    </label>
  {/each}
</section>

<style>
  .appearance-slider {
    display: grid;
    grid-template-columns: 64px 1fr 48px;
    align-items: center;
    gap: var(--space-6);
  }

  .appearance-slider-label {
    color: var(--color-text-secondary);
    font-size: 0.8125rem;
  }

  .appearance-slider input[type="range"] {
    width: 100%;
    accent-color: var(--color-accent);
  }

  .appearance-slider-value {
    text-align: right;
    color: var(--color-text-secondary);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .appearance-reset,
  .appearance-preview {
    padding: var(--space-2) var(--space-6);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2, var(--color-surface-1));
    color: var(--color-text-primary);
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .appearance-reset:hover,
  .appearance-preview:hover {
    border-color: var(--color-accent);
    background: var(--color-hover);
  }

  .appearance-reset:focus-visible,
  .appearance-preview:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .appearance-event-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-6);
  }

  .appearance-preview {
    margin-left: auto;
  }
</style>
