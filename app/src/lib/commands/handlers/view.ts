import { appState } from "../../state/appState";
import type { LayoutKind } from "../../domain/contracts";
import type { CommandHandlerMap } from "./types";

export const viewHandlers: CommandHandlerMap = {
  "view.toggleDiffPreview": ({ getState, notify }) => {
    const next = getState().editor.previewMode === "diff" ? "editor" : "diff";
    appState.setPreviewMode(next);
    notify(next === "diff" ? "Diff preview on." : "Diff preview off.");
  },
  "view.toggleWrap": ({ getState, getEditorRunner, notify }) => {
    const nextWrap = !getState().editor.wrapLines;
    appState.toggleWrap();
    getEditorRunner()?.setWrap(nextWrap);
    notify(nextWrap ? "Wrap enabled." : "Wrap disabled.");
  },
  "view.zoomIn": ({ getState, getEditorRunner }) => {
    const next = Math.min(220, getState().editor.zoomPercent + 10);
    appState.setZoomPercent(next);
    getEditorRunner()?.setZoom(next);
  },
  "view.zoomOut": ({ getState, getEditorRunner }) => {
    const next = Math.max(60, getState().editor.zoomPercent - 10);
    appState.setZoomPercent(next);
    getEditorRunner()?.setZoom(next);
  },
  "view.zoomReset": ({ getEditorRunner }) => {
    appState.setZoomPercent(100);
    getEditorRunner()?.setZoom(100);
  },
  "view.layoutSingle": () => appState.setEditorLayout("single"),
  "view.layoutCols2": () => appState.setEditorLayout("cols-2"),
  "view.layoutRows2": () => appState.setEditorLayout("rows-2"),
  "view.layoutRows3": () => appState.setEditorLayout("rows-3"),
  "view.layoutGrid": () => appState.setEditorLayout("grid-2x2"),
  "view.focusPane1": () => appState.setActiveEditorPaneBySlot(1),
  "view.focusPane2": () => appState.setActiveEditorPaneBySlot(2),
  "view.focusPane3": () => appState.setActiveEditorPaneBySlot(3),
  "view.focusPane4": () => appState.setActiveEditorPaneBySlot(4),
};

/** Preset → command id map, used to mark the active layout in the View menu. */
export const LAYOUT_PRESET_COMMANDS: ReadonlyArray<{
  kind: LayoutKind;
  commandId:
    | "view.layoutSingle"
    | "view.layoutCols2"
    | "view.layoutRows2"
    | "view.layoutRows3"
    | "view.layoutGrid";
}> = [
  { kind: "single", commandId: "view.layoutSingle" },
  { kind: "cols-2", commandId: "view.layoutCols2" },
  { kind: "rows-2", commandId: "view.layoutRows2" },
  { kind: "rows-3", commandId: "view.layoutRows3" },
  { kind: "grid-2x2", commandId: "view.layoutGrid" },
];

