import { chatStore } from "../state/chatStore";
import { resolveComposerModelId } from "./providers/threadModelCatalog";
import type {
  AppProviderSettings,
  ChatModeId,
  ChatProviderId,
  ProviderModelCatalogs,
} from "../domain/contracts";
import { persistActiveThreadSnapshot } from "./composerSendActions";

interface ConnectionOption {
  value: string;
  label: string;
}

interface ModeOption {
  id: ChatModeId;
  name: string;
}

export interface SyncComposerConnectionFallbackInput {
  activeConnectionSelection: string | null;
  availableConnections: ConnectionOption[];
  isProviderSelectionDisabled: boolean;
  selectConnection: (value: string) => Promise<void>;
}

export function syncComposerConnectionFallback(input: SyncComposerConnectionFallbackInput): void {
  const { activeConnectionSelection, availableConnections, isProviderSelectionDisabled, selectConnection } =
    input;
  if (
    (activeConnectionSelection &&
      availableConnections.some((connection) => connection.value === activeConnectionSelection)) ||
    isProviderSelectionDisabled
  ) {
    return;
  }
  const fallback = availableConnections[0];
  if (fallback) {
    void selectConnection(fallback.value);
  }
}

export interface SyncComposerModeFallbackInput {
  activeMode: ChatModeId;
  availableModes: ModeOption[];
  isModeSelectionDisabled: boolean;
}

export function syncComposerModeFallback(input: SyncComposerModeFallbackInput): void {
  const { activeMode, availableModes, isModeSelectionDisabled } = input;
  if (isModeSelectionDisabled) {
    return;
  }
  if (availableModes.some((mode) => mode.id === activeMode)) {
    return;
  }
  const fallback = availableModes[0];
  if (fallback) {
    const updated = chatStore.updateThreadMetadata({ mode: fallback.id });
    if (updated) {
      persistActiveThreadSnapshot();
    }
  }
}

export interface SyncComposerModelFallbackInput {
  activeModel: string;
  availableModels: string[];
  activeProvider: ChatProviderId;
  activeConnectionId: string | undefined;
  providerSettings: AppProviderSettings;
  providerModelCatalogs: ProviderModelCatalogs;
  isModelSelectionDisabled: boolean;
}

export function syncComposerModelFallback(input: SyncComposerModelFallbackInput): void {
  const {
    activeModel,
    availableModels,
    activeProvider,
    activeConnectionId,
    providerSettings,
    providerModelCatalogs,
    isModelSelectionDisabled,
  } = input;
  if (isModelSelectionDisabled) {
    return;
  }
  const agentId = chatStore.getActiveAgentId();
  if (!agentId) {
    return;
  }
  if (activeModel && availableModels.includes(activeModel)) {
    return;
  }
  const thread = chatStore.getActiveThreadSnapshot(agentId);
  const fallbackModel =
    resolveComposerModelId({
      thread,
      providerId: activeProvider,
      providerSettings,
      providerModelCatalogs,
      connectionId: activeConnectionId,
    }) || availableModels[0];
  if (!fallbackModel || !availableModels.includes(fallbackModel) || fallbackModel === activeModel) {
    return;
  }
  chatStore.updateThreadMetadata({ selectedModelId: fallbackModel }, undefined, agentId);
}
