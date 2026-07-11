import { createContext } from "svelte";
import type { EditorToolController } from "./editorToolController";

export const [getEditorToolController, setEditorToolController] =
  createContext<EditorToolController>();
