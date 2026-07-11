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
};
