import { writable } from "svelte/store";
import type {
  AccentOption,
  AppDomainState,
  AppSettingsState,
  DocumentState,
  DocumentIdentity,
  WindowSessionSnapshot,
  ThemeMode,
} from "../domain/contracts";

const defaultSettings: AppSettingsState = {
  themeMode: "dark",
  accent: "blue",
  statusBarVisible: true,
};

let docCounter = 1;
let tabCounter = 1;

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

function inferLanguage(path: string | null): "plaintext" | "markdown" {
  if (!path) {
    return "plaintext";
  }
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown")
    ? "markdown"
    : "plaintext";
}

function buildDocument(identity: DocumentIdentity, content: string, title: string): DocumentState {
  return {
    id: identity.id,
    filePath: identity.filePath,
    title,
    content,
    savedContent: content,
    isDirty: false,
    language: inferLanguage(identity.filePath),
    encoding: "utf-8",
    lineEnding: content.includes("\r\n") ? "crlf" : "lf",
  };
}

const initialState: AppDomainState = {
  documents: [buildDocument({ id: "doc-1", filePath: null }, "", "Untitled")],
  session: {
    selectedTabId: "tab-1",
    openTabs: [{ id: "tab-1", documentId: "doc-1", pinned: false }],
    lastActiveWindowId: "main",
  },
  settings: defaultSettings,
  recentFiles: [],
  editor: {
    cursorLine: 1,
    cursorColumn: 1,
    zoomPercent: 100,
    wrapLines: false,
    findReplaceOpen: false,
    goToOpen: false,
    previewMode: "editor",
  },
};

const accentColors: Record<AccentOption, string> = {
  blue: "#2f80ed",
  violet: "#8b5cf6",
  green: "#22a06b",
};

function applyTheme(settings: AppSettingsState): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = settings.themeMode;
  document.documentElement.style.setProperty(
    "--accent-color",
    accentColors[settings.accent],
  );
}

function createStateStore() {
  const { subscribe, update, set } = writable<AppDomainState>(initialState);

  function selectTabInternal(state: AppDomainState, tabId: string): AppDomainState {
    if (!state.session.openTabs.some((tab) => tab.id === tabId)) {
      return state;
    }
    return {
      ...state,
      session: { ...state.session, selectedTabId: tabId },
    };
  }

  return {
    subscribe,
    getSnapshot() {
      let snapshot = initialState;
      const un = subscribe((state) => {
        snapshot = state;
      });
      un();
      return snapshot;
    },
    toggleTheme() {
      update((state) => {
        const themeMode: ThemeMode =
          state.settings.themeMode === "dark" ? "light" : "dark";
        const settings = { ...state.settings, themeMode };
        applyTheme(settings);
        return { ...state, settings };
      });
    },
    cycleAccent() {
      update((state) => {
        const accents: AccentOption[] = ["blue", "violet", "green"];
        const index = accents.indexOf(state.settings.accent);
        const accent = accents[(index + 1) % accents.length];
        const settings = { ...state.settings, accent };
        applyTheme(settings);
        return { ...state, settings };
      });
    },
    initializeTheme() {
      applyTheme(initialState.settings);
    },
    resetWorkspace() {
      set(initialState);
      applyTheme(initialState.settings);
    },
    applyWindowSession(snapshot: WindowSessionSnapshot) {
      docCounter = Math.max(
        1,
        ...snapshot.documents.map((documentState) =>
          Number(documentState.id.replace("doc-", "")) || 1,
        ),
      );
      tabCounter = Math.max(
        1,
        ...snapshot.session.openTabs.map((tab) =>
          Number(tab.id.replace("tab-", "")) || 1,
        ),
      );
      set({
        documents: snapshot.documents,
        session: snapshot.session,
        settings: defaultSettings,
        recentFiles: snapshot.recentFiles,
        editor: {
          ...snapshot.editor,
          findReplaceOpen: false,
          goToOpen: false,
          previewMode: "editor",
        },
      });
      applyTheme(defaultSettings);
    },
    createTab() {
      update((state) => {
        docCounter += 1;
        tabCounter += 1;
        const id = `doc-${docCounter}`;
        const newDocument = buildDocument(
          { id, filePath: null },
          "",
          `Untitled ${docCounter - 1}`,
        );
        const tabId = `tab-${tabCounter}`;
        return {
          ...state,
          documents: [...state.documents, newDocument],
          session: {
            ...state.session,
            openTabs: [...state.session.openTabs, { id: tabId, documentId: id, pinned: false }],
            selectedTabId: tabId,
          },
        };
      });
    },
    selectTab(tabId: string) {
      update((state) => selectTabInternal(state, tabId));
    },
    closeTab(tabId: string) {
      update((state) => {
        const openTabs = state.session.openTabs;
        if (openTabs.length <= 1) {
          return state;
        }
        const idx = openTabs.findIndex((tab) => tab.id === tabId);
        if (idx < 0) {
          return state;
        }
        const filtered = openTabs.filter((tab) => tab.id !== tabId);
        const selectedTabId =
          state.session.selectedTabId === tabId
            ? filtered[Math.max(0, idx - 1)]?.id ?? filtered[0]?.id ?? null
            : state.session.selectedTabId;
        return {
          ...state,
          session: {
            ...state.session,
            openTabs: filtered,
            selectedTabId,
          },
        };
      });
    },
    closeTabForce(tabId: string) {
      update((state) => {
        const openTabs = state.session.openTabs;
        if (openTabs.length === 0) {
          return state;
        }
        const idx = openTabs.findIndex((tab) => tab.id === tabId);
        if (idx < 0) {
          return state;
        }
        const filtered = openTabs.filter((tab) => tab.id !== tabId);
        if (filtered.length === 0) {
          docCounter += 1;
          tabCounter += 1;
          const docId = `doc-${docCounter}`;
          const tabIdNew = `tab-${tabCounter}`;
          const newDocument = buildDocument(
            { id: docId, filePath: null },
            "",
            `Untitled ${docCounter - 1}`,
          );
          return {
            ...state,
            documents: [...state.documents, newDocument],
            session: {
              ...state.session,
              openTabs: [{ id: tabIdNew, documentId: docId, pinned: false }],
              selectedTabId: tabIdNew,
            },
          };
        }
        const selectedTabId =
          state.session.selectedTabId === tabId
            ? filtered[Math.max(0, idx - 1)]?.id ?? filtered[0]?.id ?? null
            : state.session.selectedTabId;
        return {
          ...state,
          session: {
            ...state.session,
            openTabs: filtered,
            selectedTabId,
          },
        };
      });
    },
    moveTab(fromIndex: number, toIndex: number) {
      update((state) => {
        const tabs = [...state.session.openTabs];
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= tabs.length ||
          toIndex >= tabs.length ||
          fromIndex === toIndex
        ) {
          return state;
        }
        const [moved] = tabs.splice(fromIndex, 1);
        tabs.splice(toIndex, 0, moved);
        return {
          ...state,
          session: {
            ...state.session,
            openTabs: tabs,
          },
        };
      });
    },
    openFileInTab(filePath: string, content: string) {
      update((state) => {
        const duplicate = state.documents.find(
          (doc) => doc.filePath === filePath,
        );
        if (duplicate) {
          const existingTab = state.session.openTabs.find(
            (tab) => tab.documentId === duplicate.id,
          );
          if (existingTab) {
            return selectTabInternal(state, existingTab.id);
          }
        }

        docCounter += 1;
        tabCounter += 1;
        const docId = `doc-${docCounter}`;
        const tabId = `tab-${tabCounter}`;
        const documentState = buildDocument(
          { id: docId, filePath },
          content,
          basename(filePath),
        );
        const recentFiles = [filePath, ...state.recentFiles.filter((entry) => entry !== filePath)].slice(
          0,
          15,
        );

        return {
          ...state,
          documents: [...state.documents, documentState],
          recentFiles,
          session: {
            ...state.session,
            openTabs: [...state.session.openTabs, { id: tabId, documentId: docId, pinned: false }],
            selectedTabId: tabId,
          },
        };
      });
    },
    transferActiveTabOut(): { filePath: string | null; content: string; title: string } | null {
      const snapshot = this.getSnapshot();
      const selectedTab = snapshot.session.openTabs.find(
        (tab) => tab.id === snapshot.session.selectedTabId,
      );
      if (!selectedTab) {
        return null;
      }
      const doc = snapshot.documents.find(
        (documentState) => documentState.id === selectedTab.documentId,
      );
      if (!doc) {
        return null;
      }
      this.closeTabForce(selectedTab.id);
      return {
        filePath: doc.filePath,
        content: doc.content,
        title: doc.title,
      };
    },
    openTransferredTab(payload: {
      filePath: string | null;
      content: string;
      title: string;
    }) {
      update((state) => {
        if (payload.filePath) {
          const duplicate = state.documents.find(
            (doc) => doc.filePath === payload.filePath,
          );
          if (duplicate) {
            const existingTab = state.session.openTabs.find(
              (tab) => tab.documentId === duplicate.id,
            );
            if (existingTab) {
              return selectTabInternal(state, existingTab.id);
            }
          }
        }
        docCounter += 1;
        tabCounter += 1;
        const docId = `doc-${docCounter}`;
        const tabId = `tab-${tabCounter}`;
        const newDoc = buildDocument(
          { id: docId, filePath: payload.filePath },
          payload.content,
          payload.title,
        );
        return {
          ...state,
          documents: [...state.documents, newDoc],
          session: {
            ...state.session,
            openTabs: [...state.session.openTabs, { id: tabId, documentId: docId, pinned: false }],
            selectedTabId: tabId,
          },
        };
      });
    },
    setDocumentContent(documentId: string, content: string) {
      update((state) => {
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          const lineEnding: "lf" | "crlf" = content.includes("\r\n")
            ? "crlf"
            : "lf";
          return {
            ...documentState,
            content,
            lineEnding,
            isDirty: content !== documentState.savedContent,
          };
        });
        return { ...state, documents };
      });
    },
    markDocumentSaved(documentId: string, filePath: string | null, content: string) {
      update((state) => {
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          return {
            ...documentState,
            filePath,
            title: filePath ? basename(filePath) : documentState.title,
            savedContent: content,
            content,
            lineEnding: (content.includes("\r\n") ? "crlf" : "lf") as
              | "lf"
              | "crlf",
            isDirty: false,
            language: inferLanguage(filePath),
          };
        });
        const recentFiles =
          filePath === null
            ? state.recentFiles
            : [filePath, ...state.recentFiles.filter((entry) => entry !== filePath)].slice(0, 15);
        return { ...state, documents, recentFiles };
      });
    },
    renameDocument(documentId: string, filePath: string, title: string) {
      update((state) => {
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          return {
            ...documentState,
            filePath,
            title,
            language: inferLanguage(filePath),
          };
        });
        const recentFiles = [filePath, ...state.recentFiles.filter((entry) => entry !== filePath)].slice(0, 15);
        return { ...state, documents, recentFiles };
      });
    },
    setCursor(line: number, column: number) {
      update((state) => ({
        ...state,
        editor: {
          ...state.editor,
          cursorLine: line,
          cursorColumn: column,
        },
      }));
    },
    setZoomPercent(zoomPercent: number) {
      update((state) => ({
        ...state,
        editor: {
          ...state.editor,
          zoomPercent,
        },
      }));
    },
    setPreviewMode(previewMode: "editor" | "markdown" | "diff") {
      update((state) => ({
        ...state,
        editor: { ...state.editor, previewMode },
      }));
    },
    toggleFindReplace() {
      update((state) => ({
        ...state,
        editor: {
          ...state.editor,
          findReplaceOpen: !state.editor.findReplaceOpen,
        },
      }));
    },
    setFindReplaceOpen(findReplaceOpen: boolean) {
      update((state) => ({
        ...state,
        editor: { ...state.editor, findReplaceOpen },
      }));
    },
    toggleGoTo() {
      update((state) => ({
        ...state,
        editor: {
          ...state.editor,
          goToOpen: !state.editor.goToOpen,
        },
      }));
    },
    setGoToOpen(goToOpen: boolean) {
      update((state) => ({
        ...state,
        editor: { ...state.editor, goToOpen },
      }));
    },
    toggleWrap() {
      update((state) => ({
        ...state,
        editor: {
          ...state.editor,
          wrapLines: !state.editor.wrapLines,
        },
      }));
    },
  };
}

export const appState = createStateStore();
