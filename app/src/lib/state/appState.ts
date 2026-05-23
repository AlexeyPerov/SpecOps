import { writable } from "svelte/store";
import type {
  AccentOption,
  AppDomainState,
  AppSettingsState,
  DiskFingerprint,
  DocumentState,
  DocumentIdentity,
  ExternalFilesSettings,
  TabState,
  WindowBounds,
  WindowSessionSnapshot,
  ThemeMode,
} from "../domain/contracts";
import { normalizePathSync } from "../services/diskFingerprint";

const defaultExternalFilesSettings: ExternalFilesSettings = {
  watchExternalChanges: true,
  autoReloadCleanFiles: true,
  checkOnWindowFocus: true,
  checkOnTabActivate: true,
};

const defaultSettings: AppSettingsState = {
  themeMode: "dark",
  accent: "blue",
  statusBarVisible: true,
  externalFiles: defaultExternalFilesSettings,
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

function deriveUntitledTitle(content: string): string {
  const firstLine = (content.split(/\r?\n/, 1)[0] ?? "").trim();
  if (!firstLine) {
    return "Untitled";
  }
  return Array.from(firstLine).slice(0, 64).join("");
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
    diskFingerprint: null,
    dismissedFingerprint: null,
    fileMissing: false,
    scrollTop: 0,
  };
}

function normalizeDocument(documentState: DocumentState): DocumentState {
  return {
    ...documentState,
    diskFingerprint: documentState.diskFingerprint ?? null,
    dismissedFingerprint: documentState.dismissedFingerprint ?? null,
    fileMissing: documentState.fileMissing ?? false,
    scrollTop: documentState.scrollTop ?? 0,
  };
}

function findDocumentByPath(state: AppDomainState, filePath: string): DocumentState | undefined {
  const normalized = normalizePathSync(filePath);
  return state.documents.find(
    (documentState) =>
      documentState.filePath !== null &&
      normalizePathSync(documentState.filePath) === normalized,
  );
}

function reopenTabForDocument(state: AppDomainState, documentId: string): AppDomainState {
  tabCounter += 1;
  const tabId = `tab-${tabCounter}`;
  return {
    ...state,
    session: {
      ...state.session,
      openTabs: [...state.session.openTabs, { id: tabId, documentId, pinned: false }],
      selectedTabId: tabId,
    },
  };
}

function moveTab(tabs: TabState[], fromIndex: number, toIndex: number): TabState[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= tabs.length ||
    toIndex >= tabs.length ||
    fromIndex === toIndex
  ) {
    return tabs;
  }
  const next = [...tabs];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) {
    return tabs;
  }
  next.splice(toIndex, 0, moved);
  return next;
}

function tabIdsToCloseOtherThan(
  openTabs: TabState[],
  contextTabId: string,
): string[] {
  return openTabs
    .filter((tab) => tab.id !== contextTabId && !tab.pinned)
    .map((tab) => tab.id);
}

function tabIdsToCloseToRightOf(
  openTabs: TabState[],
  contextTabId: string,
): string[] {
  const contextIndex = openTabs.findIndex((tab) => tab.id === contextTabId);
  if (contextIndex < 0) {
    return [];
  }
  return openTabs
    .slice(contextIndex + 1)
    .filter((tab) => !tab.pinned)
    .map((tab) => tab.id);
}

function missingTabIdsToClose(
  openTabs: TabState[],
  documents: DocumentState[],
): string[] {
  const missingByDocumentId = new Map(
    documents.map((documentState) => [documentState.id, documentState.fileMissing]),
  );
  return openTabs
    .filter((tab) => !tab.pinned && missingByDocumentId.get(tab.documentId) === true)
    .map((tab) => tab.id);
}

function nextSelectedTabAfterBulkClose(
  previousTabs: TabState[],
  remainingTabs: TabState[],
  previousSelectedTabId: string | null,
  preferredTabId: string | null = null,
): string | null {
  if (preferredTabId && remainingTabs.some((tab) => tab.id === preferredTabId)) {
    return preferredTabId;
  }
  if (!previousSelectedTabId) {
    return remainingTabs[0]?.id ?? null;
  }
  if (remainingTabs.some((tab) => tab.id === previousSelectedTabId)) {
    return previousSelectedTabId;
  }

  const selectedIndex = previousTabs.findIndex((tab) => tab.id === previousSelectedTabId);
  if (selectedIndex >= 0) {
    for (let idx = selectedIndex - 1; idx >= 0; idx -= 1) {
      const candidateId = previousTabs[idx]?.id;
      if (candidateId && remainingTabs.some((tab) => tab.id === candidateId)) {
        return candidateId;
      }
    }
  }
  return remainingTabs[0]?.id ?? null;
}

function closeTabsForce(state: AppDomainState, tabIds: string[], preferredTabId: string | null): AppDomainState {
  if (tabIds.length === 0) {
    return state;
  }
  const idsToClose = new Set(tabIds);
  const filteredTabs = state.session.openTabs.filter((tab) => !idsToClose.has(tab.id));
  if (filteredTabs.length === state.session.openTabs.length) {
    return state;
  }
  if (filteredTabs.length === 0) {
    docCounter += 1;
    tabCounter += 1;
    const docId = `doc-${docCounter}`;
    const tabId = `tab-${tabCounter}`;
    const newDocument = buildDocument(
      { id: docId, filePath: null },
      "",
      "Untitled",
    );
    return {
      ...state,
      documents: [...state.documents, newDocument],
      session: {
        ...state.session,
        openTabs: [{ id: tabId, documentId: docId, pinned: false }],
        selectedTabId: tabId,
      },
    };
  }

  return {
    ...state,
    session: {
      ...state.session,
      openTabs: filteredTabs,
      selectedTabId: nextSelectedTabAfterBulkClose(
        state.session.openTabs,
        filteredTabs,
        state.session.selectedTabId,
        preferredTabId,
      ),
    },
  };
}

const initialState: AppDomainState = {
  documents: [buildDocument({ id: "doc-1", filePath: null }, "", "Untitled")],
  session: {
    selectedTabId: "tab-1",
    openTabs: [{ id: "tab-1", documentId: "doc-1", pinned: false }],
    lastActiveWindowId: "main",
    windowBounds: null,
  },
  settings: defaultSettings,
  recentFiles: [],
  editor: {
    cursorLine: 1,
    cursorColumn: 1,
    zoomPercent: 100,
    wrapLines: true,
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
      docCounter = 1;
      tabCounter = 1;
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
        documents: snapshot.documents.map(normalizeDocument),
        session: {
          ...snapshot.session,
          windowBounds: snapshot.session.windowBounds ?? null,
        },
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
          "Untitled",
        );
        const tabId = `tab-${tabCounter}`;
        const nextState = {
          ...state,
          documents: [...state.documents, newDocument],
          session: {
            ...state.session,
            openTabs: [...state.session.openTabs, { id: tabId, documentId: id, pinned: false }],
            selectedTabId: tabId,
          },
        };
        return nextState;
      });
    },
    selectTab(tabId: string) {
      update((state) => selectTabInternal(state, tabId));
    },
    selectOrReopenTabForDocument(documentId: string) {
      update((state) => {
        const existingTab = state.session.openTabs.find(
          (tab) => tab.documentId === documentId,
        );
        if (existingTab) {
          return selectTabInternal(state, existingTab.id);
        }
        return reopenTabForDocument(state, documentId);
      });
    },
    findDocumentIdByPath(filePath: string): string | null {
      const snapshot = this.getSnapshot();
      return findDocumentByPath(snapshot, filePath)?.id ?? null;
    },
    reorderTabs(fromIndex: number, toIndex: number) {
      update((state) => {
        const openTabs = moveTab(state.session.openTabs, fromIndex, toIndex);
        if (openTabs === state.session.openTabs) {
          return state;
        }
        return {
          ...state,
          session: {
            ...state.session,
            openTabs,
          },
        };
      });
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
            "Untitled",
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
    closeTabWithPrompt(tabId: string, confirm: (message: string) => boolean): boolean {
      const snapshot = this.getSnapshot();
      const targetTab = snapshot.session.openTabs.find((tab) => tab.id === tabId);
      if (!targetTab) {
        return false;
      }
      const targetDocument = snapshot.documents.find((documentState) => documentState.id === targetTab.documentId);
      if (targetDocument?.isDirty && !confirm(`Close ${targetDocument.title} without saving?`)) {
        return false;
      }
      this.closeTabForce(tabId);
      return true;
    },
    closeOtherTabs(contextTabId: string, confirm: (message: string) => boolean): boolean {
      const snapshot = this.getSnapshot();
      if (!snapshot.session.openTabs.some((tab) => tab.id === contextTabId)) {
        return false;
      }
      const tabIds = tabIdsToCloseOtherThan(snapshot.session.openTabs, contextTabId);
      if (tabIds.length === 0) {
        return false;
      }

      for (const tabId of tabIds) {
        const tab = snapshot.session.openTabs.find((entry) => entry.id === tabId);
        if (!tab) {
          continue;
        }
        const doc = snapshot.documents.find((documentState) => documentState.id === tab.documentId);
        if (doc?.isDirty && !confirm(`Close ${doc.title} without saving?`)) {
          return false;
        }
      }

      update((state) => closeTabsForce(state, tabIds, contextTabId));
      return true;
    },
    closeTabsToRight(contextTabId: string, confirm: (message: string) => boolean): boolean {
      const snapshot = this.getSnapshot();
      const tabIds = tabIdsToCloseToRightOf(snapshot.session.openTabs, contextTabId);
      if (tabIds.length === 0) {
        return false;
      }

      for (const tabId of tabIds) {
        const tab = snapshot.session.openTabs.find((entry) => entry.id === tabId);
        if (!tab) {
          continue;
        }
        const doc = snapshot.documents.find((documentState) => documentState.id === tab.documentId);
        if (doc?.isDirty && !confirm(`Close ${doc.title} without saving?`)) {
          return false;
        }
      }

      update((state) => closeTabsForce(state, tabIds, contextTabId));
      return true;
    },
    closeMissingFileTabs(): boolean {
      const snapshot = this.getSnapshot();
      const tabIds = missingTabIdsToClose(snapshot.session.openTabs, snapshot.documents);
      if (tabIds.length === 0) {
        return false;
      }

      update((state) => closeTabsForce(state, tabIds, null));
      return true;
    },
    openFileInTab(filePath: string, content: string): string {
      let openedDocumentId = "";
      update((state) => {
        const duplicate = findDocumentByPath(state, filePath);
        if (duplicate) {
          openedDocumentId = duplicate.id;
          const existingTab = state.session.openTabs.find(
            (tab) => tab.documentId === duplicate.id,
          );
          if (existingTab) {
            return selectTabInternal(state, existingTab.id);
          }
          return reopenTabForDocument(state, duplicate.id);
        }

        docCounter += 1;
        tabCounter += 1;
        const docId = `doc-${docCounter}`;
        openedDocumentId = docId;
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
      return openedDocumentId;
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
    }): string | null {
      let documentId: string | null = null;
      update((state) => {
        if (payload.filePath) {
          const duplicate = findDocumentByPath(state, payload.filePath);
          if (duplicate) {
            documentId = duplicate.id;
            const existingTab = state.session.openTabs.find(
              (tab) => tab.documentId === duplicate.id,
            );
            if (existingTab) {
              return selectTabInternal(state, existingTab.id);
            }
            return reopenTabForDocument(state, duplicate.id);
          }
        }
        docCounter += 1;
        tabCounter += 1;
        const docId = `doc-${docCounter}`;
        documentId = docId;
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
      return documentId;
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
    refreshUntitledTitle(documentId: string) {
      update((state) => {
        let changed = false;
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId || documentState.filePath !== null) {
            return documentState;
          }
          const title = deriveUntitledTitle(documentState.content);
          if (title === documentState.title) {
            return documentState;
          }
          changed = true;
          return { ...documentState, title };
        });
        if (!changed) {
          return state;
        }
        return { ...state, documents };
      });
    },
    normalizeUntitledTitles() {
      update((state) => {
        let changed = false;
        const documents = state.documents.map((documentState) => {
          if (documentState.filePath !== null) {
            return documentState;
          }
          const title = deriveUntitledTitle(documentState.content);
          if (title === documentState.title) {
            return documentState;
          }
          changed = true;
          return { ...documentState, title };
        });
        if (!changed) {
          return state;
        }
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
            fileMissing: false,
          };
        });
        const recentFiles =
          filePath === null
            ? state.recentFiles
            : [filePath, ...state.recentFiles.filter((entry) => entry !== filePath)].slice(0, 15);
        return { ...state, documents, recentFiles };
      });
    },
    applyDocumentDiskReload(
      documentId: string,
      content: string,
      diskFingerprint: DiskFingerprint,
    ) {
      update((state) => ({
        ...state,
        documents: state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          return {
            ...documentState,
            content,
            savedContent: content,
            isDirty: false,
            diskFingerprint,
            dismissedFingerprint: null,
            fileMissing: false,
            lineEnding: (content.includes("\r\n") ? "crlf" : "lf") as "lf" | "crlf",
          };
        }),
      }));
    },
    applyDocumentKeepLocal(
      documentId: string,
      dismissedFingerprint: DiskFingerprint,
    ) {
      update((state) => ({
        ...state,
        documents: state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          return {
            ...documentState,
            dismissedFingerprint,
          };
        }),
      }));
    },
    setDocumentDiskState(
      documentId: string,
      patch: {
        diskFingerprint: DiskFingerprint | null;
        fileMissing: boolean;
      },
    ) {
      update((state) => ({
        ...state,
        documents: state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          return {
            ...documentState,
            diskFingerprint: patch.diskFingerprint,
            fileMissing: patch.fileMissing,
          };
        }),
      }));
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
    setDocumentScrollTop(documentId: string, scrollTop: number) {
      update((state) => {
        let changed = false;
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          if (documentState.scrollTop === scrollTop) {
            return documentState;
          }
          changed = true;
          return { ...documentState, scrollTop };
        });
        if (!changed) {
          return state;
        }
        return { ...state, documents };
      });
    },
    setWindowBounds(windowBounds: WindowBounds | null) {
      update((state) => {
        if (state.session.windowBounds === windowBounds) {
          return state;
        }
        return {
          ...state,
          session: {
            ...state.session,
            windowBounds,
          },
        };
      });
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
    setExternalFilesSettings(externalFiles: ExternalFilesSettings) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          externalFiles,
        },
      }));
    },
    applyPersistedSettings(partial: {
      themeMode?: ThemeMode;
      accent?: AccentOption;
      wrapLines?: boolean;
      zoomPercent?: number;
      externalFiles?: ExternalFilesSettings;
    }) {
      update((state) => {
        let next = state;
        if (partial.themeMode && partial.themeMode !== state.settings.themeMode) {
          const themeMode = partial.themeMode;
          const settings = { ...state.settings, themeMode };
          applyTheme(settings);
          next = { ...next, settings };
        }
        if (partial.accent && partial.accent !== next.settings.accent) {
          const settings = { ...next.settings, accent: partial.accent };
          applyTheme(settings);
          next = { ...next, settings };
        }
        if (typeof partial.wrapLines === "boolean" && partial.wrapLines !== next.editor.wrapLines) {
          next = {
            ...next,
            editor: { ...next.editor, wrapLines: partial.wrapLines },
          };
        }
        if (typeof partial.zoomPercent === "number") {
          next = {
            ...next,
            editor: { ...next.editor, zoomPercent: partial.zoomPercent },
          };
        }
        if (partial.externalFiles) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              externalFiles: partial.externalFiles,
            },
          };
        }
        return next;
      });
    },
  };
}

export const appState = createStateStore();
