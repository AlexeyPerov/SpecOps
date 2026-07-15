import type {
  AppSettingsState,
  BuiltinSnippetId,
  MarkdownSnippetSettings,
  UserSnippetRecord,
} from "../../domain/contracts";
import {
  createUserSnippetId,
  normalizeMarkdownSnippetSettings,
  normalizeUserSnippetRecord,
} from "../../editor/markdownSnippetSettings";
import { isBuiltinSnippetId } from "../../editor/markdownSnippetCatalog";
import type { SettingsUpdate } from "./logSettingsSlice";

export function createSnippetSettingsSlice(update: SettingsUpdate) {
  return {
    setMarkdownSnippetSettings(markdownSnippets: MarkdownSnippetSettings) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          markdownSnippets: normalizeMarkdownSnippetSettings(markdownSnippets),
        },
      }));
    },
    setBuiltinSnippetEnabled(snippetId: BuiltinSnippetId, enabled: boolean) {
      if (!isBuiltinSnippetId(snippetId)) {
        return;
      }
      update((state) => {
        const current = new Set(state.settings.markdownSnippets.enabledBuiltinIds);
        if (enabled) {
          current.add(snippetId);
        } else {
          current.delete(snippetId);
        }
        return {
          ...state,
          settings: {
            ...state.settings,
            markdownSnippets: normalizeMarkdownSnippetSettings({
              ...state.settings.markdownSnippets,
              enabledBuiltinIds: [...current],
            }),
          },
        };
      });
    },
    addUserSnippet(snippet: Partial<UserSnippetRecord>) {
      update((state) => {
        const normalized = normalizeUserSnippetRecord(snippet);
        if (!normalized) {
          return state;
        }
        const withoutDuplicate = state.settings.markdownSnippets.userSnippets.filter(
          (entry) => entry.id !== normalized.id,
        );
        return {
          ...state,
          settings: {
            ...state.settings,
            markdownSnippets: normalizeMarkdownSnippetSettings({
              ...state.settings.markdownSnippets,
              userSnippets: [...withoutDuplicate, normalized],
            }),
          },
        };
      });
    },
    updateUserSnippet(snippetId: string, patch: Partial<UserSnippetRecord>) {
      const normalizedId = snippetId.trim();
      if (!normalizedId) {
        return;
      }
      update((state) => {
        const existing = state.settings.markdownSnippets.userSnippets.find(
          (entry) => entry.id === normalizedId,
        );
        if (!existing) {
          return state;
        }
        const next = normalizeUserSnippetRecord({
          ...existing,
          ...patch,
          id: normalizedId,
        });
        if (!next) {
          return state;
        }
        const userSnippets = state.settings.markdownSnippets.userSnippets.map((entry) =>
          entry.id === normalizedId ? next : entry,
        );
        return {
          ...state,
          settings: {
            ...state.settings,
            markdownSnippets: normalizeMarkdownSnippetSettings({
              ...state.settings.markdownSnippets,
              userSnippets,
            }),
          },
        };
      });
    },
    removeUserSnippet(snippetId: string) {
      const normalizedId = snippetId.trim();
      if (!normalizedId) {
        return;
      }
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          markdownSnippets: normalizeMarkdownSnippetSettings({
            ...state.settings.markdownSnippets,
            userSnippets: state.settings.markdownSnippets.userSnippets.filter(
              (entry) => entry.id !== normalizedId,
            ),
          }),
        },
      }));
    },
    duplicateUserSnippet(snippetId: string): string | null {
      const normalizedId = snippetId.trim();
      if (!normalizedId) {
        return null;
      }
      let createdId: string | null = null;
      update((state) => {
        const existing = state.settings.markdownSnippets.userSnippets.find(
          (entry) => entry.id === normalizedId,
        );
        if (!existing) {
          return state;
        }
        const id = createUserSnippetId();
        // Find a free trigger by suffixing -copy / -2 / …
        let trigger = `${existing.trigger}-copy`;
        const taken = new Set([
          ...state.settings.markdownSnippets.userSnippets.map((entry) => entry.trigger),
        ]);
        let suffix = 2;
        while (taken.has(trigger) && trigger.length <= 32) {
          trigger = `${existing.trigger}-${suffix}`;
          suffix += 1;
        }
        const duplicate = normalizeUserSnippetRecord({
          ...existing,
          id,
          name: `${existing.name} copy`.slice(0, 80),
          trigger,
          enabled: false,
        });
        if (!duplicate) {
          return state;
        }
        createdId = duplicate.id;
        return {
          ...state,
          settings: {
            ...state.settings,
            markdownSnippets: normalizeMarkdownSnippetSettings({
              ...state.settings.markdownSnippets,
              userSnippets: [...state.settings.markdownSnippets.userSnippets, duplicate],
            }),
          },
        };
      });
      return createdId;
    },
    createUserSnippetDraft(name = "Untitled snippet"): string {
      const id = createUserSnippetId();
      update((state) => {
        // Draft uses a temporary unique trigger; user edits before enabling.
        const taken = new Set(
          state.settings.markdownSnippets.userSnippets.map((entry) => entry.trigger),
        );
        let trigger = "snip";
        let n = 1;
        while (taken.has(trigger)) {
          trigger = `snip${n}`;
          n += 1;
        }
        const draft = normalizeUserSnippetRecord({
          id,
          name,
          description: "",
          trigger,
          body: "${1:text}${0}",
          enabled: false,
        });
        if (!draft) {
          return state;
        }
        return {
          ...state,
          settings: {
            ...state.settings,
            markdownSnippets: normalizeMarkdownSnippetSettings({
              ...state.settings.markdownSnippets,
              userSnippets: [...state.settings.markdownSnippets.userSnippets, draft],
            }),
          },
        };
      });
      return id;
    },
  };
}

export type SnippetSettingsSlice = ReturnType<typeof createSnippetSettingsSlice>;

// Re-export for callers that need the settings shape from the slice module.
export type { AppSettingsState };
