import {
  parseChatConnectionSelection,
  resolveActiveChatConnectionSelection,
} from "./providers/selection";
import type {
  AppProviderSettings,
  ChatModeId,
  ChatProviderId,
  ProviderModelCatalogs,
} from "../domain/contracts";
import { chatStore } from "../state/chatStore";
import { persistActiveThreadSnapshot } from "./composerSendActions";

export interface ComposerSelectionActionsDeps {
  getActiveMode: () => ChatModeId;
  getActiveProvider: () => ChatProviderId;
  getActiveModel: () => string;
  getActiveConnectionId: () => string | undefined;
  getProviderSettings: () => AppProviderSettings;
  getProviderApiKeys: () => Partial<Record<string, string>>;
  getProviderModelCatalogs: () => ProviderModelCatalogs;
  getChatContextKind: () => "workspace" | "chat-http";
  getIsModeSelectionDisabled: () => boolean;
  getIsProviderSelectionDisabled: () => boolean;
  getIsModelSelectionDisabled: () => boolean;
  onInlineError: (message: string) => void;
}

export function createComposerSelectionActions(deps: ComposerSelectionActionsDeps) {
  function selectMode(nextMode: ChatModeId): void {
    if (nextMode === deps.getActiveMode() || deps.getIsModeSelectionDisabled()) {
      return;
    }
    const updated = chatStore.updateThreadMetadata({ mode: nextMode });
    if (updated) {
      persistActiveThreadSnapshot();
    }
  }

  async function selectConnection(nextValue: string): Promise<void> {
    if (deps.getIsProviderSelectionDisabled()) {
      return;
    }
    const parsed = parseChatConnectionSelection(nextValue);
    if (!parsed) {
      return;
    }
    const providerSettings = deps.getProviderSettings();
    const providerApiKeys = deps.getProviderApiKeys();
    const providerModelCatalogs = deps.getProviderModelCatalogs();
    const activeProvider = deps.getActiveProvider();
    const activeConnectionId = deps.getActiveConnectionId();
    const currentSelection = resolveActiveChatConnectionSelection(
      activeProvider,
      activeConnectionId,
      providerSettings,
      providerApiKeys,
      deps.getChatContextKind(),
    );
    if (currentSelection === nextValue) {
      return;
    }
    if (parsed.providerId === "http" && parsed.connectionId) {
      if (activeProvider !== "http") {
        const switchProviderResult = await chatStore.switchThreadProvider("http", {
          providerSettings,
          providerModelCatalogs,
        });
        if (!switchProviderResult.switched) {
          return;
        }
      }
      const switchConnectionResult = chatStore.switchThreadConnection(parsed.connectionId, {
        providerSettings,
        providerModelCatalogs,
      });
      if (switchConnectionResult.switched) {
        persistActiveThreadSnapshot();
        void chatStore.runAccessPreflight();
      } else if (switchConnectionResult.message) {
        deps.onInlineError(switchConnectionResult.message);
      }
      return;
    }
    const result = await chatStore.switchThreadProvider(parsed.providerId, {
      providerSettings,
      providerModelCatalogs,
    });
    if (result.switched) {
      persistActiveThreadSnapshot();
      void chatStore.runAccessPreflight();
    }
  }

  async function selectModel(nextModelId: string): Promise<void> {
    if (nextModelId === deps.getActiveModel() || deps.getIsModelSelectionDisabled()) {
      return;
    }

    if (deps.getChatContextKind() === "workspace") {
      const updated = chatStore.updateThreadMetadata({ selectedModelId: nextModelId });
      if (updated) {
        persistActiveThreadSnapshot();
      }
      return;
    }

    const result = await chatStore.switchThreadModel(nextModelId, {
      providerSettings: deps.getProviderSettings(),
      providerModelCatalogs: deps.getProviderModelCatalogs(),
    });
    if (result.switched) {
      persistActiveThreadSnapshot();
    } else if (result.message) {
      deps.onInlineError(result.message);
    }
  }

  return {
    selectMode,
    selectConnection,
    selectModel,
  };
}
