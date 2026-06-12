<script lang="ts">
  import Select from "../Select.svelte";
  import type { ChatProviderId } from "../../domain/contracts";
  import {
    formatModelListForInput,
    getProviderModelCatalog,
    parseModelListInput,
  } from "../../ai/providers/providerModelCatalog";
  import { appState } from "../../state/appState";
  import { chatStore } from "../../state/chatStore";

  let {
    providerId,
    heading,
  }: {
    providerId: ChatProviderId;
    heading: string;
  } = $props();

  const snapshot = $derived($appState);
  const catalog = $derived(
    getProviderModelCatalog(snapshot.settings.providerModelCatalogs, providerId),
  );
  const modelOptions = $derived(
    catalog.modelIds.map((id) => ({ value: id, label: id })),
  );

  function updateProviderModelList(rawValue: string): void {
    const modelIds = parseModelListInput(rawValue);
    const currentCatalog = getProviderModelCatalog(
      snapshot.settings.providerModelCatalogs,
      providerId,
    );
    appState.updateProviderModelCatalog(providerId, {
      modelIds,
      defaultModelId: currentCatalog.defaultModelId,
    });
    if (providerId === "http") {
      void chatStore.runAccessPreflight();
    }
  }

  function updateProviderDefaultModel(defaultModelId: string): void {
    appState.updateProviderModelCatalog(providerId, { defaultModelId });
    if (providerId === "http") {
      void chatStore.runAccessPreflight();
    }
  }
</script>

<div class="settings-subsection">
  <h4>{heading}</h4>
  <p class="settings-section-note">
    One model ID per line. Duplicate entries are removed when saved.
  </p>
  <label class="settings-field">
    <span>Model list</span>
    <textarea
      rows={Math.max(3, catalog.modelIds.length + 1)}
      spellcheck="false"
      value={formatModelListForInput(catalog.modelIds)}
      onchange={(event) =>
        updateProviderModelList((event.currentTarget as HTMLTextAreaElement).value)}
    ></textarea>
  </label>
  <label class="settings-field">
    <span>Default model</span>
    <Select
      options={modelOptions}
      value={catalog.defaultModelId}
      onchange={updateProviderDefaultModel}
      ariaLabel="Select default model"
    />
  </label>
</div>

<style>
  @import "../../styles/settingsForm.css";
  @import "../../styles/settingsFormMultiline.css";
  @import "../../styles/settingsDialogForm.css";
</style>
