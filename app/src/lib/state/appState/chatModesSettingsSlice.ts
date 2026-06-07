import type {
  AppSettingsState,
  BuiltinChatModeId,
  ChatModeContextToggles,
  CustomChatModeDefinition,
} from "../../domain/contracts";
import {
  createCustomChatModeId,
  normalizeChatModesSettings,
  normalizeCustomChatModeDefinition,
} from "../../ai/modes/chatModesSettings";
import type { SettingsUpdate } from "./logSettingsSlice";

export function createChatModesSettingsSlice(update: SettingsUpdate) {
  return {
    setChatModesSettings(chatModes: AppSettingsState["chatModes"]) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          chatModes: normalizeChatModesSettings(chatModes),
        },
      }));
    },
    setRawEnabled(rawEnabled: boolean) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          chatModes: normalizeChatModesSettings({
            ...state.settings.chatModes,
            rawEnabled,
          }),
        },
      }));
    },
    updateBuiltinModeToggles(
      modeId: BuiltinChatModeId,
      patch: Partial<ChatModeContextToggles>,
    ) {
      update((state) => {
        const current = state.settings.chatModes.builtinToggles[modeId];
        return {
          ...state,
          settings: {
            ...state.settings,
            chatModes: normalizeChatModesSettings({
              ...state.settings.chatModes,
              builtinToggles: {
                ...state.settings.chatModes.builtinToggles,
                [modeId]: {
                  ...current,
                  ...patch,
                },
              },
            }),
          },
        };
      });
    },
    addCustomChatMode(mode: Partial<CustomChatModeDefinition>) {
      update((state) => {
        const normalized = normalizeCustomChatModeDefinition(mode);
        const withoutDuplicate = state.settings.chatModes.customModes.filter(
          (entry) => entry.id !== normalized.id,
        );
        return {
          ...state,
          settings: {
            ...state.settings,
            chatModes: normalizeChatModesSettings({
              ...state.settings.chatModes,
              customModes: [...withoutDuplicate, normalized],
            }),
          },
        };
      });
    },
    updateCustomChatMode(modeId: string, patch: Partial<CustomChatModeDefinition>) {
      const normalizedId = modeId.trim();
      if (!normalizedId) {
        return;
      }
      update((state) => {
        const existing = state.settings.chatModes.customModes.find((mode) => mode.id === normalizedId);
        if (!existing) {
          return state;
        }
        const customModes = state.settings.chatModes.customModes.map((mode) =>
          mode.id === normalizedId
            ? normalizeCustomChatModeDefinition({ ...mode, ...patch, id: normalizedId })
            : mode,
        );
        return {
          ...state,
          settings: {
            ...state.settings,
            chatModes: normalizeChatModesSettings({
              ...state.settings.chatModes,
              customModes,
            }),
          },
        };
      });
    },
    removeCustomChatMode(modeId: string) {
      const normalizedId = modeId.trim();
      if (!normalizedId) {
        return;
      }
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          chatModes: normalizeChatModesSettings({
            ...state.settings.chatModes,
            customModes: state.settings.chatModes.customModes.filter(
              (mode) => mode.id !== normalizedId,
            ),
          }),
        },
      }));
    },
    createCustomChatModeDraft(name = "Untitled mode"): string {
      const id = createCustomChatModeId();
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          chatModes: normalizeChatModesSettings({
            ...state.settings.chatModes,
            customModes: [
              ...state.settings.chatModes.customModes,
              normalizeCustomChatModeDefinition({ id, name, enabled: false }),
            ],
          }),
        },
      }));
      return id;
    },
  };
}
