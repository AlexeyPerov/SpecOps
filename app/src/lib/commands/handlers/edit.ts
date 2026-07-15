import type { CommandHandlerMap } from "./types";

export const editHandlers: CommandHandlerMap = {
  "edit.undo": ({ getEditorRunner }) => {
    getEditorRunner()?.undo();
  },
  "edit.redo": ({ getEditorRunner }) => {
    getEditorRunner()?.redo();
  },
  "edit.indent": ({ getEditorRunner }) => {
    getEditorRunner()?.indent();
  },
  "edit.outdent": ({ getEditorRunner }) => {
    getEditorRunner()?.outdent();
  },
  "edit.moveLineUp": ({ getEditorRunner }) => {
    getEditorRunner()?.moveLineUp();
  },
  "edit.moveLineDown": ({ getEditorRunner }) => {
    getEditorRunner()?.moveLineDown();
  },
  "edit.duplicateLine": ({ getEditorRunner }) => {
    getEditorRunner()?.duplicateLine();
  },
  "edit.joinLines": ({ getEditorRunner }) => {
    getEditorRunner()?.joinLines();
  },
  "edit.selectNextOccurrence": ({ getEditorRunner }) => {
    getEditorRunner()?.selectNextOccurrence();
  },
  "edit.selectAllOccurrences": ({ getEditorRunner }) => {
    getEditorRunner()?.selectAllOccurrences();
  },
  "edit.skipOccurrence": ({ getEditorRunner }) => {
    getEditorRunner()?.skipOccurrence();
  },
  "edit.undoOccurrence": ({ getEditorRunner }) => {
    getEditorRunner()?.undoOccurrence();
  },
  "edit.toggleFold": ({ getEditorRunner }) => {
    getEditorRunner()?.toggleFold();
  },
  "edit.fold": ({ getEditorRunner }) => {
    getEditorRunner()?.fold();
  },
  "edit.unfold": ({ getEditorRunner }) => {
    getEditorRunner()?.unfold();
  },
  "edit.foldAll": ({ getEditorRunner }) => {
    getEditorRunner()?.foldAll();
  },
  "edit.unfoldAll": ({ getEditorRunner }) => {
    getEditorRunner()?.unfoldAll();
  },
  "edit.triggerCompletion": ({ getEditorRunner }) => {
    getEditorRunner()?.completeWord();
  },
  "edit.insertSnippet": ({ openSnippetInsert }) => {
    openSnippetInsert?.();
  },
  "edit.toggleBookmark": ({ getEditorRunner, notify }) => {
    const toggled = getEditorRunner()?.toggleBookmark() ?? false;
    if (toggled) {
      notify("Bookmark toggled.");
    }
  },
  "edit.nextBookmark": ({ getEditorRunner, notify }) => {
    const moved = getEditorRunner()?.nextBookmark() ?? false;
    if (!moved) {
      notify("No bookmarks.");
    }
  },
  "edit.previousBookmark": ({ getEditorRunner, notify }) => {
    const moved = getEditorRunner()?.previousBookmark() ?? false;
    if (!moved) {
      notify("No bookmarks.");
    }
  },
  "edit.clearBookmarks": ({ getEditorRunner, notify }) => {
    getEditorRunner()?.clearBookmarks();
    notify("Bookmarks cleared.");
  },
  "edit.listBookmarks": ({ openBookmarkList }) => {
    openBookmarkList?.();
  },
};
