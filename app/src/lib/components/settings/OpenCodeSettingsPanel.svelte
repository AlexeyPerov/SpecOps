<script lang="ts">
  import type { OpencodeHealthStatus, OpencodeTransportMode } from "../../domain/contracts";
  import {
    loadOpencodeServerPassword,
    saveOpencodeServerPassword,
  } from "../../services/providerSecretsStore";
  import {
    buildOpencodeSidecarBaseUrl,
    validateOpencodeBaseUrl,
    validateOpencodeSidecarPort,
  } from "../../services/opencodeSettings";
  import { appState } from "../../state/appState";
  import { chatStore } from "../../state/chatStore";
  import { refreshOpencodeCatalog } from "../../ai/opencodeCatalog";
  import { requestOpencodeHealthRefresh } from "../../services/appShellEffects";
  import {
    clearOpencodeSidecarCircuitBreaker,
    getOpencodeSidecarLastFailureSignature,
  } from "../../services/opencodeSidecarEnsure";
  import { isOpencodeSidecarError } from "../../services/opencodeSidecar";

  let {
    dialogOpen = false,
    onHardFailure = (_message: string) => {},
  }: { dialogOpen?: boolean; onHardFailure?: (message: string) => void } = $props();

  const snapshot = $derived($appState);
  let opencodeServerPassword = $state("");

  function opencodeHealthStatusLabel(status: OpencodeHealthStatus): string {
    switch (status) {
      case "checking":
        return "Checking";
      case "healthy":
        return "Healthy";
      case "degraded":
        return "Degraded";
      case "error":
        return "Error";
      case "unknown":
      default:
        return "Unknown";
    }
  }

  function opencodeHealthStatusClass(status: OpencodeHealthStatus): string {
    switch (status) {
      case "healthy":
        return "opencode-health-good";
      case "degraded":
        return "opencode-health-warn";
      case "error":
        return "opencode-health-bad";
      case "checking":
        return "opencode-health-checking";
      case "unknown":
      default:
        return "opencode-health-unknown";
    }
  }

  function applyOpencodeReconnectState(
    nextOpencode: Partial<{
      mode: OpencodeTransportMode;
      baseUrl: string;
      sidecarPort: number;
    }>,
  ): void {
    // M13.5 — toggling transport / URL clears the circuit breaker so the
    // user can retry without first navigating to a workspace.
    clearOpencodeSidecarCircuitBreaker();
    appState.applyPersistedSettings({
      opencode: nextOpencode,
      opencodeHealth: {
        status: "checking",
        source: nextOpencode.mode ?? snapshot.settings.opencode.mode,
        checkedAt: new Date().toISOString(),
        lastErrorMessage: null,
      },
    });
    void chatStore.runAccessPreflight();
  }

  function updateOpencodeMode(mode: OpencodeTransportMode): void {
    if (snapshot.settings.opencode.mode === mode) {
      return;
    }
    applyOpencodeReconnectState({ mode });
  }

  function updateOpencodeBaseUrl(baseUrl: string): void {
    applyOpencodeReconnectState({ baseUrl });
  }

  /**
   * M14-T5 — persist a new sidecar port. Validates the input (1024–65535,
   * integer) before writing; rejects out-of-range / non-integer values
   * without surfacing them to settings store. Sidecar mode reuses this
   * same reconnect flow so the running sidecar (if any) restarts on the
   * new port on the next attach.
   */
  function updateOpencodeSidecarPort(rawPort: string): void {
    const trimmed = rawPort.trim();
    if (trimmed.length === 0) {
      // Treat empty as "no change" — the user is mid-edit; the existing
      // persisted port remains valid and the input shows the value again
      // on next render. Avoids bouncing the input back to a stale number
      // while typing.
      return;
    }
    const candidate = Number(trimmed);
    if (validateOpencodeSidecarPort(candidate) !== null) {
      return;
    }
    applyOpencodeReconnectState({
      mode: "sidecar",
      sidecarPort: candidate,
      baseUrl: buildOpencodeSidecarBaseUrl(candidate),
    });
  }

  async function loadOpencodePassword(): Promise<void> {
    opencodeServerPassword = await loadOpencodeServerPassword();
  }

  async function updateOpencodeServerPassword(password: string): Promise<void> {
    opencodeServerPassword = password;
    await saveOpencodeServerPassword(password);
    appState.applyPersistedSettings({
      opencodeHealth: {
        status: "checking",
        source: snapshot.settings.opencode.mode,
        checkedAt: new Date().toISOString(),
        lastErrorMessage: null,
      },
    });
    void chatStore.runAccessPreflight();
  }

  function checkOpencodeConnection(): void {
    appState.applyPersistedSettings({
      opencodeHealth: {
        status: "checking",
        source: snapshot.settings.opencode.mode,
        checkedAt: new Date().toISOString(),
        lastErrorMessage: null,
      },
    });
    requestOpencodeHealthRefresh({
      opencodeEnabled: snapshot.settings.opencode.enabled,
      opencodeMode: snapshot.settings.opencode.mode,
      opencodeBaseUrl: snapshot.settings.opencode.baseUrl,
      opencodeSidecarPort: snapshot.settings.opencode.sidecarPort,
      serverPassword: opencodeServerPassword,
      setOpencodeHealth: (patch) => appState.applyPersistedSettings({ opencodeHealth: patch }),
    });
    void chatStore.runAccessPreflight();
  }

  function refreshOpencodeModels(): void {
    const workspaceRoot = chatStore.getActiveWorkspaceRoot();
    if (workspaceRoot) {
      void refreshOpencodeCatalog(workspaceRoot);
    }
  }

  const opencodeUrlValidationMessage = $derived(
    snapshot.settings.opencode.mode === "url"
      ? validateOpencodeBaseUrl(snapshot.settings.opencode.baseUrl)
      : null,
  );
  const opencodeSidecarPortValidationMessage = $derived(
    snapshot.settings.opencode.mode === "sidecar"
      ? validateOpencodeSidecarPort(snapshot.settings.opencode.sidecarPort)
      : null,
  );
  const opencodeHealth = $derived(snapshot.settings.opencodeHealth);

  let wasDialogOpen = false;

  $effect(() => {
    if (dialogOpen && !wasDialogOpen) {
      void loadOpencodePassword();
    }
    wasDialogOpen = dialogOpen;
  });
</script>

<section class="settings-section">
  <h3>OpenCode</h3>
  <p class="settings-section-note">
    Workspace sessions backend. The master enable toggle lives in
    Settings → Dev (OpenCode is a beta feature). Configure transport mode and
    server health here.
  </p>
  <div class="settings-subsection">
    <h4>Transport</h4>
    <label class="settings-toggle">
      <input
        type="radio"
        name="opencode-transport-mode"
        checked={snapshot.settings.opencode.mode === "sidecar"}
        title="Use local OpenCode sidecar transport"
        onchange={() => updateOpencodeMode("sidecar")}
      />
      Sidecar (default)
    </label>
    <label class="settings-toggle">
      <input
        type="radio"
        name="opencode-transport-mode"
        checked={snapshot.settings.opencode.mode === "url"}
        title="Connect to OpenCode by server URL"
        onchange={() => updateOpencodeMode("url")}
      />
      URL
    </label>
    {#if snapshot.settings.opencode.mode === "url"}
      <label class="settings-field">
        <span>OpenCode server URL</span>
        <input
          type="url"
          spellcheck="false"
          placeholder="https://opencode.example.com"
          value={snapshot.settings.opencode.baseUrl}
          oninput={(event) =>
            updateOpencodeBaseUrl((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      {#if opencodeUrlValidationMessage}
        <p class="settings-section-note opencode-validation-note">{opencodeUrlValidationMessage}</p>
      {/if}
    {:else}
      <label class="settings-field">
        <span>Sidecar port</span>
        <input
          type="number"
          inputmode="numeric"
          min="1024"
          max="65535"
          step="1"
          spellcheck="false"
          placeholder="4096"
          title="Local port the OpenCode sidecar binds to. Default 4096; change if the port is already in use locally."
          value={snapshot.settings.opencode.sidecarPort}
          oninput={(event) =>
            updateOpencodeSidecarPort((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      {#if opencodeSidecarPortValidationMessage}
        <p class="settings-section-note opencode-validation-note">
            {opencodeSidecarPortValidationMessage}
          </p>
        {/if}
        <p class="settings-section-note">
          Sidecar URL: <code>{snapshot.settings.opencode.baseUrl}</code>
        </p>
      {/if}
      <label class="settings-field">
        <span>Server password</span>
        <input
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="Enter OpenCode server password"
          value={opencodeServerPassword}
          oninput={(event) =>
            void updateOpencodeServerPassword((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
    </div>
    <div class="settings-subsection">
      <h4>Health</h4>
      <p class="settings-section-note">
        Status:
        <span class={`opencode-health-pill ${opencodeHealthStatusClass(opencodeHealth.status)}`}>
          {opencodeHealthStatusLabel(opencodeHealth.status)}
        </span>
        {#if opencodeHealth.source}
          <span class="opencode-health-source">({opencodeHealth.source})</span>
        {/if}
      </p>
      {#if opencodeHealth.lastErrorMessage}
        <p class="settings-section-note opencode-health-error">{opencodeHealth.lastErrorMessage}</p>
      {/if}
      <button
        type="button"
        class="btn btn-sm"
        onclick={checkOpencodeConnection}
        title="Check OpenCode connection status"
      >
        Check connection
      </button>
    </div>
    <div class="settings-subsection">
      <h4>Models</h4>
      <p class="settings-section-note">
        Workspace model selection is populated from the OpenCode server catalog.
      </p>
      <button
        type="button"
        class="btn btn-sm"
        onclick={refreshOpencodeModels}
        title="Reload models from OpenCode"
      >
        Refresh model list
      </button>
    </div>
</section>

<style>
  .opencode-validation-note,
  .opencode-health-error {
    color: var(--color-text-danger);
  }

  .opencode-health-pill {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    padding: 1px var(--space-3);
    margin-left: var(--space-3);
    font-size: 0.75rem;
    line-height: 1.4;
  }

  .opencode-health-source {
    margin-left: var(--space-2);
  }

  .opencode-health-good {
    color: var(--color-text-success);
  }

  .opencode-health-warn {
    color: var(--color-text-warning);
  }

  .opencode-health-bad {
    color: var(--color-text-danger);
  }

  .opencode-health-checking,
  .opencode-health-unknown {
    color: var(--color-text-secondary);
  }
</style>
